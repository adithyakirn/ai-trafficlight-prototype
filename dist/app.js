import * as THREE from 'three';
import {SoftwareRenderer} from './software-renderer.js';
import {OrbitControls} from './vendor/OrbitControls.js';
import {mergeGeometries} from './vendor/BufferGeometryUtils.js';
import {TrafficSimulation} from './traffic-sim.js';

const icons={
 camera:'<rect x="3" y="6" width="13" height="12" rx="3"/><path d="m16 10 5-3v10l-5-3"/>',
 signal:'<rect x="7" y="2" width="10" height="17" rx="3"/><circle cx="12" cy="6" r="1"/><circle cx="12" cy="10" r="1"/><circle cx="12" cy="14" r="1"/><path d="M12 19v3"/>',
 search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',
 layers:'<path d="m12 3 9 5-9 5-9-5zM3 12l9 5 9-5M3 16l9 5 9-5"/>',
 plus:'<path d="M12 5v14M5 12h14"/>',
 minus:'<path d="M5 12h14"/>',
 focus:'<path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5"/><circle cx="12" cy="12" r="4"/>',
 map:'<path d="m3 5 6-2 6 3 6-2v15l-6 2-6-3-6 2zM9 3v15M15 6v15"/>',
 pin:'<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2.5"/>',
 file:'<path d="M14 2H5v20h14V7zM14 2v5h5M8 12h8M8 16h8"/>',
 info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v.1"/>',
 grid:'<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
 back:'<path d="m14 5-7 7 7 7"/>',
 download:'<path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5"/>',
 bus:'<rect x="5" y="3" width="14" height="16" rx="3"/><path d="M5 11h14M8 19v2M16 19v2M8 15h.1M16 15h.1"/>',
 car:'<path d="M5 17h14M6 13l2-5h8l2 5M4 14h16v4H4zM7 18v2M17 18v2"/><circle cx="7.5" cy="15.5" r="1.5"/><circle cx="16.5" cy="15.5" r="1.5"/>',
 play:'<polygon points="6 3 20 12 6 21 6 3"/>',
 pause:'<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>'
};

const icon=n=>`<svg viewBox="0 0 24 24" aria-hidden="true">${icons[n]||icons.pin}</svg>`;
function applyIcons(root=document){root.querySelectorAll('[data-icon]').forEach(e=>e.innerHTML=icon(e.dataset.icon));}
applyIcons();

const $=s=>document.querySelector(s),mobile=()=>innerWidth<=700;
const homeHTML=$('#sheet-body').innerHTML;
let data,scene,renderer,camera,controls,sim,dirty=true,topView=false,selected=null,selectedCamera=null,selectedVehicle=null,animation=null,activeTab='map';
const groups={},markers=[],roadLabels=[],layerState={cameras:true,signals:true,coverage:false,buildings:true};
const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
let lastFrameTime=performance.now();

// Reusable vehicle 3D mesh pool
const vehicleMeshPool=[];
let highlightMesh=null;
const raycaster=new THREE.Raycaster();
const mouseVec=new THREE.Vector2();

function toast(t){$('#toast').textContent=t;$('#toast').classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').classList.remove('show'),2800)}
function markDirty(){dirty=true}
function mesh(geometry,material,group){const m=new THREE.Mesh(geometry,material);group.add(m);return m}

function roadGeometry(points,width,y){
 const p=[];
 for(let i=1;i<points.length;i++){
  const [x1,z1]=points[i-1],[x2,z2]=points[i],dx=x2-x1,dz=z2-z1,len=Math.hypot(dx,dz);
  if(!len)continue;
  const nx=-dz/len*width/2,nz=dx/len*width/2;
  p.push(x1+nx,y,z1+nz,x1-nx,y,z1-nz,x2+nx,y,z2+nz,x2+nx,y,z2+nz,x1-nx,y,z1-nz,x2-nx,y,z2-nz);
 }
 const g=new THREE.BufferGeometry();
 g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));
 g.computeVertexNormals();
 return g;
}

function polygon(pts,h){
 const sh=new THREE.Shape();
 pts.forEach(([x,z],i)=>i?sh.lineTo(x,-z):sh.moveTo(x,-z));
 const g=new THREE.ExtrudeGeometry(sh,{depth:h,bevelEnabled:false,steps:1});
 g.rotateX(-Math.PI/2);
 return g;
}

function addMerged(gs,mat,group){
 if(!gs.length)return;
 const g=mergeGeometries(gs,false);
 if(g){mesh(g,mat,group);gs.forEach(x=>x.dispose())}
}

function buildMap(){
 scene=new THREE.Scene();
 scene.background=new THREE.Color('#e8efea');
 scene.add(new THREE.HemisphereLight(0xffffff,0xb1c5b6,2.6));
 const sun=new THREE.DirectionalLight(0xfff9e9,2.1);
 sun.position.set(-180,350,-120);
 scene.add(sun);

 for(const k of ['roads','buildings','green','cameras','signals','coverage','rings','vehicles','vehicleHighlight']){
  groups[k]=new THREE.Group();
  scene.add(groups[k]);
 }
 groups.coverage.visible=false;

 const ground=mesh(new THREE.PlaneGeometry(3000,3000),new THREE.MeshLambertMaterial({color:'#e4ece4'}),scene);
 ground.rotation.x=-Math.PI/2;
 ground.position.y=-.06;

 const matGreen=new THREE.MeshLambertMaterial({color:'#c1d7b9',side:THREE.DoubleSide});
 for(const pts of data.greens){
  try{const m=mesh(polygon(pts,.03),matGreen,groups.green);m.position.y=.01}catch{}
 }

 const styles={trunk:[1.45,'#f7f5e7'],primary:[1.25,'#f4f5ee'],secondary:[1.05,'#f4f5ee'],tertiary:[.75,'#f2f4ed']};
 const borders=[],roadGs={},lines=[];
 for(const r of data.roads){
  const [w,c]=styles[r.kind]||[.48,'#eff3ed'];
  borders.push(roadGeometry(r.pts,w+.22,.025));
  (roadGs[c]??=[]).push(roadGeometry(r.pts,w,.055));
  if(r.kind==='trunk'){
   for(let i=1;i<r.pts.length;i++){
    const a=r.pts[i-1],b=r.pts[i];
    lines.push(a[0],.08,a[1],b[0],.08,b[1]);
   }
  }
 }
 addMerged(borders,new THREE.MeshBasicMaterial({color:'#bbc9bd',side:THREE.DoubleSide}),groups.roads);
 for(const [color,gs]of Object.entries(roadGs))addMerged(gs,new THREE.MeshBasicMaterial({color,side:THREE.DoubleSide}),groups.roads);

 const lg=new THREE.BufferGeometry();
 lg.setAttribute('position',new THREE.Float32BufferAttribute(lines,3));
 const ll=new THREE.LineSegments(lg,new THREE.LineDashedMaterial({color:'#bdba8b',dashSize:1,gapSize:1.2}));
 ll.computeLineDistances();
 groups.roads.add(ll);

 const buildings=[];
 for(const b of data.buildings){
  try{buildings.push(polygon(b.pts,b.h*1.8))}catch{}
 }
 addMerged(buildings,new THREE.MeshLambertMaterial({color:'#c8d6cb',side:THREE.DoubleSide}),groups.buildings);

 const cameraMat=new THREE.MeshLambertMaterial({color:'#087e91'}),poleMat=new THREE.MeshLambertMaterial({color:'#527365'}),darkMat=new THREE.MeshLambertMaterial({color:'#203b32'}),lightMat=new THREE.MeshBasicMaterial({color:'#efad63'});
 for(const c of data.cameras){
  const g=new THREE.Group();
  g.position.set(c.pos[0],0,c.pos[1]);
  const pole=mesh(new THREE.CylinderGeometry(.1,.14,2.7,6),poleMat,g);
  pole.position.y=1.35;
  const head=mesh(new THREE.BoxGeometry(.95,.45,.45),cameraMat,g);
  head.position.set(.3,2.75,0);
  g.rotation.y=-c.angle;
  groups.cameras.add(g);

  const conePts=[[c.pos[0],c.pos[1]]];
  for(let j=0;j<=12;j++){
   const a=c.angle-.42+j*.84/12;
   conePts.push([c.pos[0]+Math.cos(a)*10,c.pos[1]+Math.sin(a)*10]);
  }
  const cone=mesh(polygon(conePts,.01),new THREE.MeshBasicMaterial({color:'#24a6b5',transparent:true,opacity:.17,depthWrite:false,side:THREE.DoubleSide}),groups.coverage);
  cone.position.y=.11;
  addMarker('camera',c.id,c.pos,()=>showCamera(c.id));
 }

 for(const s of data.sites){
  if(s.signal){
   const g=new THREE.Group();
   g.position.set(s.pos[0]+.8,0,s.pos[1]+.8);
   const pole=mesh(new THREE.CylinderGeometry(.12,.15,3.2,6),poleMat,g);
   pole.position.y=1.6;
   const box=mesh(new THREE.BoxGeometry(.65,1.65,.45),darkMat,g);
   box.position.y=3.5;
   for(let j=0;j<3;j++){
    const l=mesh(new THREE.SphereGeometry(.16,8,6),j===1?lightMat:new THREE.MeshBasicMaterial({color:j===0?'#a56756':'#658969'}),g);
    l.position.set(0,4.02-j*.49,.25);
   }
   groups.signals.add(g);
   addMarker('signal',s.id,[s.pos[0]+1.8,s.pos[1]+1.8],()=>showSite(s.id));
  }
  addMarker('site',s.id,s.pos,()=>showSite(s.id),s.name.replace(' Junction','').replace('Town Bus Stand','Town Bus Stand').replace('Central NH766 junction','Town centre'));
 }

 for(const [label,lon,lat]of [['NH 766 · Kozhikode',76.241,11.6598],['NH 766 · Mysuru',76.274,11.665],['Pulpally Road',76.2631,11.6745],['Chulliyode Road',76.2566,11.6525],['MINI BYPASS',76.2616,11.655]]){
  const pos=[(lon-data.origin[0])*10900,-(lat-data.origin[1])*11132];
  const e=document.createElement('span');
  e.className='street-label';
  e.textContent=label;
  $('#labels').append(e);
  roadLabels.push({e,pos});
 }

 // Build vehicle mesh pool for 3D Three.js scene (max 50 vehicles)
 initVehicleMeshPool();
}

function initVehicleMeshPool(){
 const bodyGeo=new THREE.BoxGeometry(1,1,1);
 const roofGeo=new THREE.BoxGeometry(1,1,1);
 const wheelGeo=new THREE.CylinderGeometry(.06,.06,.04,6);
 wheelGeo.rotateZ(Math.PI/2);
 const wheelMat=new THREE.MeshBasicMaterial({color:'#1f2937'});
 const glassMat=new THREE.MeshBasicMaterial({color:'#e2e8f0'});

 for(let i=0;i<50;i++){
  const g=new THREE.Group();
  const bodyMat=new THREE.MeshLambertMaterial({color:'#3b82f6'});
  const body=new THREE.Mesh(bodyGeo,bodyMat);
  body.name='body';
  g.add(body);

  const roof=new THREE.Mesh(roofGeo,glassMat);
  roof.name='roof';
  g.add(roof);

  g.visible=false;
  groups.vehicles.add(g);
  vehicleMeshPool.push({group:g,body,roof,bodyMat});
 }

 // Vehicle selection ring
 const ringGeo=new THREE.RingGeometry(.35,.45,24);
 ringGeo.rotateX(-Math.PI/2);
 const ringMat=new THREE.MeshBasicMaterial({color:'#eab308',side:THREE.DoubleSide});
 highlightMesh=new THREE.Mesh(ringGeo,ringMat);
 highlightMesh.position.y=.09;
 highlightMesh.visible=false;
 groups.vehicleHighlight.add(highlightMesh);
}

function updateVehicleMeshes(){
 if(!sim)return;
 const vehicles=sim.vehicles;
 const activeLen=vehicles.length;

 for(let i=0;i<vehicleMeshPool.length;i++){
  const item=vehicleMeshPool[i];
  if(i<activeLen){
   const v=vehicles[i];
   const vClass=v.vClass;
   item.group.position.set(v.pos.x,.10,v.pos.z);
   item.group.rotation.y=-v.pos.angle;
   item.group.userData.vehicle=v;
   item.body.userData.vehicle=v;
   item.roof.userData.vehicle=v;

   // Scale body and roof to match vehicle class dimensions
   const bHeight=vClass.height*.55;
   item.body.scale.set(vClass.width,bHeight,vClass.length);
   item.body.position.y=bHeight/2;
   item.bodyMat.color.set(v.color);

   const rHeight=vClass.height*.45;
   item.roof.scale.set(vClass.width*.85,rHeight,vClass.length*.55);
   item.roof.position.set(0,bHeight+rHeight/2,-vClass.length*.05);

   item.group.visible=true;
  }else{
   item.group.visible=false;
   item.group.userData.vehicle=null;
  }
 }

 if(selectedVehicle&&sim.vehicles.includes(selectedVehicle)){
  highlightMesh.position.set(selectedVehicle.pos.x,.09,selectedVehicle.pos.z);
  highlightMesh.visible=true;
 }else{
  highlightMesh.visible=false;
  if(selectedVehicle&&!sim.vehicles.includes(selectedVehicle)){
   // Deselect if vehicle finished its trip
   selectedVehicle=null;
   if(activeTab==='vehicle'){
    tab('map');
    toast('Selected vehicle finished its trip');
   }
  }
 }
}

function selectVehicle(v){
 if(!v)return;
 selectedVehicle=v;
 selected=null;
 selectedCamera=null;
 renderVehicleInspector(v);
 dirty=true;
}

function renderVehicleInspector(v){
 activeTab='vehicle';
 $('#sheet').classList.remove('collapsed');
 document.querySelectorAll('[data-tab]').forEach(e=>e.classList.remove('active'));

 const speedKmh=(v.speed*36).toFixed(1);
 const targetKmh=(v.route[v.routeIdx]?.speedLimit*v.profile.desiredSpeedFactor*36).toFixed(1);
 const originRoad=v.route[0]?.name||'Entrance';
 const destRoad=v.route[v.route.length-1]?.name||'Exit';
 const progress=Math.round((v.routeIdx/Math.max(1,v.route.length-1))*100);

 const sourceBadge=v.profile.source==='ollama'
  ? `<span class="profile-source-tag ollama"><i class="key camera"></i> Generated by Ollama AI</span>`
  : `<span class="profile-source-tag local"><i class="key signal"></i> Seeded Local Generator</span>`;

 $('#sheet-body').innerHTML=`
  <button class="back" id="back-from-vehicle">${icon('back')} Back to overview</button>
  <span class="detail-type">SIMULATED VEHICLE · ${v.class.toUpperCase()}</span>
  <h2>${v.profile.nickname}</h2>
  <span class="driver-badge ${v.profile.drivingStyle}">${v.profile.drivingStyle.toUpperCase()} DRIVER</span>
  ${sourceBadge}
  <p class="intro">${v.profile.description}</p>

  <div class="driver-metric-grid">
   <div class="driver-metric-item">
    <span>Current speed</span>
    <b id="live-veh-speed">${speedKmh} km/h</b>
   </div>
   <div class="driver-metric-item">
    <span>Simulated target</span>
    <b>${targetKmh} km/h</b>
   </div>
   <div class="driver-metric-item">
    <span>Simulation state</span>
    <b id="live-veh-state" style="text-transform:capitalize">${v.state}</b>
   </div>
   <div class="driver-metric-item">
    <span>Trip progress</span>
    <b id="live-veh-prog">${progress}%</b>
   </div>
  </div>

  <h3>Driver Personality Traits</h3>
  <div class="driver-metric-grid">
   <div class="driver-metric-item">
    <span>Desired speed</span>
    <b>${v.profile.desiredSpeedFactor}×</b>
   </div>
   <div class="driver-metric-item">
    <span>Following headway</span>
    <b>${v.profile.headwaySeconds} s</b>
   </div>
   <div class="driver-metric-item">
    <span>Acceleration trait</span>
    <b>${v.profile.accelPreference}×</b>
   </div>
   <div class="driver-metric-item">
    <span>Safe gap tolerance</span>
    <b>${v.profile.gapAcceptance} s</b>
   </div>
  </div>

  <div class="detail-note">
   <b>Route:</b> ${originRoad} → ${destRoad}<br>
   <b>Vehicle class:</b> ${v.class} (${(v.vClass.length*10).toFixed(1)}m length, max accel ${(v.vClass.maxAccel*10).toFixed(1)} m/s²)
  </div>

  <button class="primary" id="veh-focus-btn">Focus on vehicle ${icon('focus')}</button>
  <p class="disclaimer">Synthetic vehicle and driver · For simulation and planning review</p>
 `;

 $('#back-from-vehicle').onclick=()=>tab('map');
 $('#veh-focus-btn').onclick=()=>{
  flyTo([v.pos.x,0,v.pos.z],mobile()?4.5:4.0);
 };
 placeFooter();
}

function updateVehicleLiveMetrics(){
 if(!selectedVehicle)return;
 const speedElem=$('#live-veh-speed');
 const stateElem=$('#live-veh-state');
 const progElem=$('#live-veh-prog');
 if(speedElem)speedElem.textContent=`${(selectedVehicle.speed*36).toFixed(1)} km/h`;
 if(stateElem)stateElem.textContent=selectedVehicle.state;
 if(progElem){
  const progress=Math.round((selectedVehicle.routeIdx/Math.max(1,selectedVehicle.route.length-1))*100);
  progElem.textContent=`${progress}%`;
 }
}

function addMarker(type,id,pos,onClick,name){
 const e=document.createElement('button');
 e.className=type==='site'?'map-pin':`map-pin equipment-pin ${type==='signal'?'signal-pin':''}`;
 e.innerHTML=icon(type==='site'?(data.sites.find(s=>s.id===id).signal?'signal':id.endsWith('-bus')?'bus':'pin'):type)+(name?`<span>${name}</span>`:'');
 e.title=type==='site'?name:`Proposed ${type} ${id}`;
 e.setAttribute('aria-label',e.title);
 e.addEventListener('click',ev=>{ev.stopPropagation();onClick()});
 $('#labels').append(e);
 markers.push({e,type,id,pos});
}

function getZoom(){return camera.zoom}

function updateLabels(){
 const w=innerWidth,h=innerHeight,v=new THREE.Vector3();
 const positions=[];
 for(const m of markers){
  const layer=m.type==='camera'?'cameras':m.type==='signal'?'signals':null;
  let visible=!layer||layerState[layer];
  const site=data.sites.find(s=>s.id===m.id);
  const focusSite=m.type==='camera'?data.cameras.find(c=>c.id===m.id)?.site:m.id;
  if(m.type!=='site'&&getZoom()<2.2&&focusSite!==selected)visible=false;
  if(m.type==='site'&&getZoom()>3.4&&selected&&m.id!==selected)visible=false;
  v.set(m.pos[0],m.type==='site'?4.2:3.8,m.pos[1]).project(camera);
  let x=(v.x+1)/2*w,y=(-v.y+1)/2*h;
  if(v.z>1||x<-80||x>w+80||y<80||y>h+30)visible=false;
  if(m.type==='site'&&visible){
   if(m.id==='town-bus')y+=30;
   if(m.id==='chungam-bus')y+=29;
   m.e.classList.toggle('selected',selected===m.id);
   if(positions.some(p=>Math.abs(p.x-x)<78&&Math.abs(p.y-y)<34)&&selected!==m.id&&getZoom()<1.5)visible=false;
   else positions.push({x,y});
  }
  m.e.hidden=!visible;
  m.e.style.left=x+'px';
  m.e.style.top=y+'px';
 }
 for(const m of roadLabels){
  v.set(m.pos[0],.2,m.pos[1]).project(camera);
  m.e.style.left=((v.x+1)/2*w)+'px';
  m.e.style.top=((-v.y+1)/2*h)+'px';
  m.e.hidden=getZoom()>3||v.z>1;
 }
 $('#scale').textContent=(camera.zoom>2?'Close view':'Town view');
}

function resize(){
 if(!renderer)return;
 const aspect=innerWidth/innerHeight,span=mobile()?300:470;
 camera.left=-span*aspect/2;
 camera.right=span*aspect/2;
 camera.top=span/2;
 camera.bottom=-span/2;
 camera.updateProjectionMatrix();
 renderer.setSize(innerWidth,innerHeight);
 dirty=true;
 placeFooter();
}

function placeFooter(){
 const height=$('#sheet').getBoundingClientRect().height;
 if(mobile()){
  $('.map-footer').style.bottom=(height+10)+'px';
  $('#gesture').style.bottom=(height+38)+'px';
 }else{
  $('.map-footer').style.bottom='18px';
  $('#gesture').style.bottom='24px';
 }
}

function flyTo(target,zoom=camera.zoom,tilt=topView){
 const current=controls.target.clone(),oldPos=camera.position.clone(),dst=new THREE.Vector3(...target),offset=tilt?new THREE.Vector3(0,500,.01):new THREE.Vector3(65,280,240);
 if(!mobile())dst.x-=55/zoom;
 else dst.z+=22/zoom;
 animation={start:performance.now(),duration:reduced?1:700,from:current,to:dst,oldPos,newPos:dst.clone().add(offset),oldZoom:camera.zoom,zoom};
 dirty=true;
}

function reset(){
 selected=null;
 selectedCamera=null;
 selectedVehicle=null;
 flyTo(mobile()?[-85,0,0]:[-65,0,0],mobile()?.64:1);
 toast('Showing the town and western approach');
}

function setLayer(k,on){
 layerState[k]=on;
 groups[k].visible=on;
 const input=$(`[data-layer="${k}"]`);
 if(input)input.checked=on;
 dirty=true;
}

function renderLoop(now){
 requestAnimationFrame(renderLoop);
 const dt=(now-lastFrameTime)/1000;
 lastFrameTime=now;

 if(sim&&sim.running){
  sim.step(dt);
  updateVehicleMeshes();
  updateVehicleLiveMetrics();
  updateSimPanelUI();
  dirty=true;
 }

 if(animation){
  let t=Math.min(1,(now-animation.start)/animation.duration);
  t=1-(1-t)**3;
  controls.target.lerpVectors(animation.from,animation.to,t);
  camera.position.lerpVectors(animation.oldPos,animation.newPos,t);
  camera.zoom=THREE.MathUtils.lerp(animation.oldZoom,animation.zoom,t);
  camera.updateProjectionMatrix();
  dirty=true;
  if(t>=1)animation=null;
 }

 controls.update();
 if(dirty){
  renderer.render(scene,camera);
  updateLabels();
  dirty=false;
 }
}

function tab(name){
 activeTab=name;
 $('#sheet').classList.remove('collapsed');
 document.querySelectorAll('[data-tab]').forEach(e=>e.classList.toggle('active',e.dataset.tab===name));
 if(name==='map'){
  selected=null;
  selectedVehicle=null;
  $('#sheet-body').innerHTML=homeHTML;
  applyIcons($('#sheet-body'));
  wireHome();
 }else if(name==='sites'){
  renderSites();
 }else if(name==='simulation'){
  renderSimTab();
 }else{
  renderPlan();
 }
 placeFooter();
 dirty=true;
}

function renderSimTab(){
 $('#sheet-body').innerHTML=`
  <div class="eyebrow">PLAYABLE TRAFFIC SIMULATION</div>
  <h2>Synthetic town flow.</h2>
  <p class="intro">Watch simulated vehicles follow Bathery’s mapped roads, obey left-hand traffic, stop at candidate signals, and yield at junctions.</p>
  <div class="stats">
   <div><b id="tab-veh-count">${sim?sim.vehicles.length:0}</b><span>Active vehicles</span></div>
   <div><b id="tab-spawns-count">${sim?sim.stats.totalSpawns:0}</b><span>Total spawns</span></div>
   <div><b id="tab-trips-count">${sim?sim.stats.completedTrips:0}</b><span>Trips completed</span></div>
  </div>
  <button class="primary" id="open-sim-controls-btn">${sim&&sim.running?'Pause or Adjust Simulation':'Start Simulation Controls'} ${icon('car')}</button>
  <div class="plan-copy" style="margin-top:16px">
   <h3>Driver personalities</h3>
   <p>Every spawned vehicle has a stable fictional driver profile with unique driving styles (cautious, steady, patient, brisk) and bounded headway and acceleration traits.</p>
   <p>Tap any vehicle on the map to inspect their driver profile and observe their behavior in real time.</p>
  </div>
  <p class="disclaimer">All traffic, timing, and counts are synthetic and simulated.</p>
 `;
 $('#open-sim-controls-btn').onclick=()=>{
  $('#sim-panel').hidden=false;
  if(sim&&!sim.running){
   sim.start();
   updateSimPanelUI();
   toast('Simulation started');
  }
 };
}

function wireHome(){
 $('#explore').onclick=()=>tab('sites');
 $('#site-stat').onclick=()=>tab('sites');
 $('#camera-stat').onclick=()=>{setLayer('cameras',true);tab('sites');toast('Choose a location to inspect its cameras')};
 $('#signal-stat').onclick=()=>{setLayer('signals',true);tab('sites');toast('Six candidate signal locations')};
}

function renderSites(){
 $('#sheet-body').innerHTML=`<div class="eyebrow">THE PROPOSED NETWORK</div><h2>Survey locations.</h2><p class="intro">Select a location to explore its proposed equipment.</p><div>${data.sites.map(s=>`<button class="site-row" data-site="${s.id}"><span class="site-type">${icon(s.signal?'signal':s.id.endsWith('-bus')?'bus':'pin')}</span><span class="row-text"><b>${s.name}</b><small>${s.area} · ${s.cameras.length} camera views</small></span><span>${s.signal?'Signal':'Monitor'}</span></button>`).join('')}</div>`;
 document.querySelectorAll('[data-site]').forEach(e=>e.onclick=()=>showSite(e.dataset.site));
}

function showSite(id,move=true){
 const s=data.sites.find(s=>s.id===id);
 selected=id;
 selectedCamera=null;
 selectedVehicle=null;
 $('#sheet').classList.remove('collapsed');
 document.querySelectorAll('[data-tab]').forEach(e=>e.classList.toggle('active',e.dataset.tab==='sites'));
 $('#sheet-body').innerHTML=`<button class="back" id="back-sites">${icon('back')} All locations</button><span class="detail-type">${s.signal?'CANDIDATE SIGNAL SITE':'MONITORING LOCATION'}</span><h2>${s.name}</h2><p class="intro">${s.desc}</p><div class="detail-counts"><span><i class="key camera"></i>${s.cameras.length} camera views</span><span><i class="key signal"></i>${s.signal?'1 signal site':'No signal proposed'}</span></div><h3>Proposed cameras</h3><div class="camera-chips">${s.cameras.map(c=>`<button data-camera="${c}">${icon('camera')}${c}</button>`).join('')}</div><div id="camera-detail" class="detail-note">Tap a camera to inspect its illustrative viewpoint. Mounting positions require a field survey.</div><button class="primary" id="coverage-toggle">${layerState.coverage?'Hide':'Show'} viewing sectors ${icon('layers')}</button><p class="coordinates">${s.coord[1].toFixed(5)}° N, ${s.coord[0].toFixed(5)}° E</p><p class="disclaimer">${s.signal?'Signal need and phase design are unverified.':s.id.endsWith('-bus')?'Bus facility centroid; verify entrances on site.':'Mapped junction reference; verify the proposed camera position and sight lines on site.'}</p>`;
 $('#back-sites').onclick=()=>tab('sites');
 document.querySelectorAll('[data-camera]').forEach(e=>e.onclick=()=>showCamera(e.dataset.camera));
 $('#coverage-toggle').onclick=()=>{setLayer('coverage',!layerState.coverage);$('#coverage-toggle').innerHTML=(layerState.coverage?'Hide':'Show')+' viewing sectors '+icon('layers')};
 if(move)flyTo([s.pos[0],0,s.pos[1]],mobile()?3.2:3.1);
 placeFooter();
 dirty=true;
}

function showCamera(id){
 const c=data.cameras.find(c=>c.id===id);
 if(selected!==c.site||!$('#camera-detail'))showSite(c.site,false);
 selectedCamera=id;
 selectedVehicle=null;
 const downstream=c.downstreamSignal;
 const signal=downstream&&data.sites.find(s=>s.id===downstream.site);
 const approach=c.approach;
 const approachLabel=approach?`<br><b>Approach</b> · ${approach.name}`:'';
 const separation=signal?`<br><b>About ${downstream.roadDistanceM} m along NH766 to ${signal.name}</b><br>At 40 km/h, a vehicle would take about ${Math.round(downstream.roadDistanceM*3.6/40)} seconds to cover that distance at constant speed. Distance estimated from mapped road geometry.`:approach?`<br>About ${approach.junctionDistanceM} m along the road to ${data.sites.find(s=>s.id===c.site).name}, estimated from mapped road geometry.`:'';

 // Simulated observations
 let simObsHTML='';
 if(sim){
  const obs=sim.cameraObserver.getObservation(c.id);
  const travelTimeText=obs.lastDetectionToArrivalSec!=null?`${obs.lastDetectionToArrivalSec} s`:'Awaiting observation';
  const signalArrivalHTML=downstream
   ? `<div><b>Simulated detection-to-arrival:</b> ${travelTimeText} <small>(measured to ${signal.name} stop line during active simulation)</small></div>`
   : `<div><small>Monitoring-only location (no downstream signal)</small></div>`;

  simObsHTML=`
   <div class="sim-obs-box">
    <span class="sim-tag">SIMULATED OBSERVATION</span>
    <div><b>Vehicles observed:</b> ${obs.count} passing vehicles (simulated)</div>
    ${signalArrivalHTML}
    <small>All traffic and observations are synthetic and generated during active simulation runs.</small>
   </div>
  `;
 }

 setLayer('cameras',true);
 setLayer('coverage',true);
 $('#coverage-toggle').innerHTML='Hide viewing sectors '+icon('layers');
 document.querySelectorAll('[data-camera]').forEach(e=>e.classList.toggle('active',e.dataset.camera===id));
 $('#camera-detail').innerHTML=`<b>${c.id} · Proposed fixed camera</b>${approachLabel}<br>${c.purpose}. Viewing direction is conceptual; lens, range and pole position are not specified.${separation}${simObsHTML}`;
 flyTo([c.pos[0],0,c.pos[1]],mobile()?4.6:4.2);
 dirty=true;
}

function renderPlan(){
 $('#sheet-body').innerHTML=`<div class="eyebrow">FROM MAP TO MEASUREMENT</div><h2>A plan to test.<br>Not a live system.</h2><div class="plan-copy"><p>This concept connects <b>six candidate signal junctions</b> and <b>${data.cameras.length} illustrative camera views</b> across ${data.sites.length} locations in Bathery.</p></div><div class="plan-step"><span>${icon('camera')}</span><p><b>Observe the approaches</b>Measure turns, vehicle classes, pedestrians and queue lengths.</p></div><div class="plan-step"><span>${icon('layers')}</span><p><b>Coordinate the corridor</b>Use downstream occupancy to inform signal timing across adjoining junctions.</p></div><div class="plan-step"><span>${icon('signal')}</span><p><b>Keep control local</b>Approved controllers enforce clearance times, pedestrian phases and fallback operation.</p></div><div class="plan-copy"><h3>What this map represents</h3><p>Roads and building footprints come from OpenStreetMap, retrieved 23 November 2026. <b>Building heights are schematic</b>; terrain is flat. Positions and viewing sectors illustrate a possible layout, not surveyed coverage.</p><p>Camera views cover turns and crossings at junctions, arrivals and queue tails along approaches, and bus access at the terminals. Each mapped junction approach has a proposed roadside view. Check travel directions, sight lines and mounting options during the field survey. This is a visual scenario, not an equipment requirement or an approved installation plan.</p><h3>Before installation</h3><p>Collect 7–14 days of counts, verify geometry and sight lines, inventory existing equipment, and have traffic engineers assess signal need and pedestrian safety.</p><p>No live feeds, vehicle tracking or real-time congestion estimates are connected.</p><p><a href="https://www.openstreetmap.org/#map=15/11.6635/76.2595" target="_blank" rel="noopener">Open the source map</a> · <a href="https://natpac.kerala.gov.in/consultancy-projects/" target="_blank" rel="noopener">NATPAC studies</a></p></div><button class="primary" id="export">Download proposed locations ${icon('download')}</button><p class="disclaimer">GeoJSON · WGS84 coordinates · Concept only</p>`;
 $('#export').onclick=exportPlan;
}

function exportPlan(){
 const convert=p=>[p[0]/10900+data.origin[0],-p[1]/11132+data.origin[1]];
 const features=[
  ...data.sites.filter(s=>s.signal).map(s=>({type:'Feature',geometry:{type:'Point',coordinates:s.coord},properties:{name:s.name,type:'proposed_signal_site',status:'concept_unverified'}})),
  ...data.cameras.map(c=>({type:'Feature',geometry:{type:'Point',coordinates:convert(c.pos)},properties:{name:c.id,site:c.site,type:'proposed_camera',status:'illustrative_position',purpose:c.purpose,...(c.approach?{approach_road:c.approach.name,osm_road_id:c.approach.road,estimated_junction_distance_m:c.approach.junctionDistanceM}:{}),...(c.downstreamSignal?{downstream_signal_site:c.downstreamSignal.site,estimated_road_distance_m:c.downstreamSignal.roadDistanceM}:{})}}))
 ];
 const url=URL.createObjectURL(new Blob([JSON.stringify({type:'FeatureCollection',features},null,2)],{type:'application/geo+json'}));
 const a=document.createElement('a');
 a.href=url;
 a.download='Bathery_Proposed_Traffic_Network.geojson';
 a.click();
 setTimeout(()=>URL.revokeObjectURL(url),1000);
 toast('Concept locations exported');
}

function updateSimPanelUI(){
 if(!sim)return;
 const pill=$('#sim-status-pill');
 if(pill){
  if(sim.running){
   pill.textContent='RUNNING';
   pill.className='sim-status-pill running';
  }else if(sim.simTime>8*3600+30*60){
   pill.textContent='PAUSED';
   pill.className='sim-status-pill paused';
  }else{
   pill.textContent='OFF';
   pill.className='sim-status-pill off';
  }
 }

 const playBtn=$('#sim-play-btn');
 if(playBtn){
  playBtn.innerHTML=sim.running?`${icon('pause')} Pause`:`${icon('play')} ${sim.simTime>8*3600+30*60?'Resume':'Start'}`;
 }

 const clockElem=$('#sim-clock');
 if(clockElem)clockElem.textContent=sim.getSimTimeFormatted();

 const countElem=$('#sim-vehicle-count');
 if(countElem)countElem.textContent=sim.vehicles.length;

 const spawnElem=$('#sim-stat-spawns');
 if(spawnElem)spawnElem.textContent=sim.stats.totalSpawns;

 const tripElem=$('#sim-stat-trips');
 if(tripElem)tripElem.textContent=sim.stats.completedTrips;

 const sourceElem=$('#sim-stat-source');
 if(sourceElem){
  sourceElem.textContent=sim.profilePool.pool.length>0?'Ollama Ready':sim.profilePool.backendAvailable?'Ollama (Cloud/Local)':'Local (Seeded)';
 }
}

function wireSimControls(){
 $('#sim-toggle').onclick=()=>{
  const hide=!$('#sim-panel').hidden;
  $('#sim-panel').hidden=hide;
  $('#sim-toggle').setAttribute('aria-expanded',String(!hide));
  updateSimPanelUI();
 };

 $('#close-sim').onclick=()=>{
  $('#sim-panel').hidden=true;
  $('#sim-toggle').setAttribute('aria-expanded','false');
 };

 $('#sim-play-btn').onclick=()=>{
  if(!sim)return;
  if(sim.running){
   sim.pause();
   toast('Simulation paused');
  }else{
   sim.start();
   toast('Simulation running');
  }
  updateSimPanelUI();
  dirty=true;
 };

 $('#sim-reset-btn').onclick=()=>{
  if(!sim)return;
  sim.reset();
  updateVehicleMeshes();
  if(selectedVehicle){
   selectedVehicle=null;
   if(activeTab==='vehicle')tab('map');
  }
  updateSimPanelUI();
  toast('Simulation reset');
  dirty=true;
 };

 document.querySelectorAll('#sim-density button').forEach(btn=>{
  btn.onclick=()=>{
   document.querySelectorAll('#sim-density button').forEach(b=>b.classList.remove('active'));
   btn.classList.add('active');
   sim.setDensity(btn.dataset.density);
   toast(`Density set to ${btn.dataset.density}`);
  };
 });

 document.querySelectorAll('#sim-speed button').forEach(btn=>{
  btn.onclick=()=>{
   document.querySelectorAll('#sim-speed button').forEach(b=>b.classList.remove('active'));
   btn.classList.add('active');
   sim.setTimeScale(parseFloat(btn.dataset.speed));
   toast(`Playback speed set to ${btn.dataset.speed}×`);
  };
 });

 $('#sim-seed-input').onchange=e=>{
  const s=parseInt(e.target.value,10);
  if(!Number.isNaN(s)){
   sim.setSeed(s);
   updateVehicleMeshes();
   updateSimPanelUI();
   toast(`Seeded run: ${s}`);
   dirty=true;
  }
 };

 $('#sim-rand-seed').onclick=()=>{
  const nextSeed=Math.floor(Math.random()*900000)+10000;
  $('#sim-seed-input').value=nextSeed;
  sim.setSeed(nextSeed);
  updateVehicleMeshes();
  updateSimPanelUI();
  toast(`New randomized seed: ${nextSeed}`);
  dirty=true;
 };
}

function setupVehiclePicking(){
 const dom=renderer.domElement;
 dom.addEventListener('pointerdown',ev=>{
  // Ignore clicks if interacting with UI overlay
  if(ev.target!==dom)return;

  const rect=dom.getBoundingClientRect();
  const x=ev.clientX-rect.left;
  const y=ev.clientY-rect.top;

  if(renderer instanceof SoftwareRenderer){
   const picked=renderer.pickVehicle(x,y,camera);
   if(picked){
    selectVehicle(picked);
    return;
   }
  }else if(groups.vehicles){
   mouseVec.x=(x/dom.clientWidth)*2-1;
   mouseVec.y=-(y/dom.clientHeight)*2+1;
   raycaster.setFromCamera(mouseVec,camera);
   const intersects=raycaster.intersectObjects(groups.vehicles.children,true);
   if(intersects.length>0){
    let obj=intersects[0].object;
    while(obj&&!obj.userData?.vehicle&&obj.parent!==groups.vehicles){
     obj=obj.parent;
    }
    if(obj&&obj.userData?.vehicle){
     selectVehicle(obj.userData.vehicle);
     return;
    }
   }
  }

  // If clicked elsewhere, deselect vehicle
  if(selectedVehicle){
   selectedVehicle=null;
   if(activeTab==='vehicle')tab('map');
   dirty=true;
  }
 });
}

function wire() {
 document.querySelectorAll('[data-tab]').forEach(e=>e.onclick=()=>tab(e.dataset.tab));
 wireHome();
 wireSimControls();
 setupVehiclePicking();

 $('#about').onclick=()=>tab('plan');
 $('#layers').onclick=()=>{
  const hide=!$('#layer-panel').hidden;
  $('#layer-panel').hidden=hide;
  $('#layers').setAttribute('aria-expanded',String(!hide));
 };
 $('#close-layers').onclick=()=>{
  $('#layer-panel').hidden=true;
  $('#layers').setAttribute('aria-expanded','false');
 };
 document.querySelectorAll('[data-layer]').forEach(e=>e.onchange=()=>setLayer(e.dataset.layer,e.checked));
 $('#reset').onclick=reset;
 $('#zoom-in').onclick=()=>{
  camera.zoom=Math.min(12,camera.zoom*1.45);
  camera.updateProjectionMatrix();
  dirty=true;
 };
 $('#zoom-out').onclick=()=>{
  camera.zoom=Math.max(.35,camera.zoom/1.45);
  camera.updateProjectionMatrix();
  dirty=true;
 };
 $('#view-mode').onclick=()=>{
  topView=!topView;
  $('#view-mode').textContent=topView?'3D':'2D';
  $('#view-mode').setAttribute('aria-label',topView?'Switch to 3D view':'Switch to top view');
  const target=controls.target.clone();
  animation={
   start:performance.now(),
   duration:reduced?1:650,
   from:target,
   to:target,
   oldPos:camera.position.clone(),
   newPos:target.clone().add(topView?new THREE.Vector3(0,500,.01):new THREE.Vector3(65,280,240)),
   oldZoom:camera.zoom,
   zoom:camera.zoom
  };
  dirty=true;
 };
 $('#north').onclick=()=>{
  const t=controls.target.clone();
  camera.position.copy(t).add(topView?new THREE.Vector3(0,500,.01):new THREE.Vector3(0,300,240));
  controls.update();
  dirty=true;
 };
 $('#sheet-handle').onclick=()=>{
  $('#sheet').classList.toggle('collapsed');
  placeFooter();
 };

 const search=$('#search');
 search.oninput=()=>{
  const q=search.value.trim().toLowerCase();
  $('#clear-search').hidden=!q;
  $('#search-results').hidden=!q;
  if(!q)return;
  const found=data.sites.filter(s=>(s.name+' '+s.area).toLowerCase().includes(q));
  $('#search-results').innerHTML=found.length?found.map(s=>`<button class="search-result" data-result="${s.id}">${s.name}<small>${s.area}</small></button>`).join(''):'<div class="no-results">No matching location. Try “Chungam” or “bus”.</div>';
  document.querySelectorAll('[data-result]').forEach(e=>e.onclick=()=>{
   showSite(e.dataset.result);
   search.value='';
   $('#search-results').hidden=true;
   $('#clear-search').hidden=true;
   search.blur();
  });
 };
 search.onkeydown=e=>{
  if(e.key==='Enter')$('#search-results button')?.click();
  if(e.key==='Escape'){
   $('#search-results').hidden=true;
   search.blur();
  }
 };
 $('#clear-search').onclick=()=>{
  search.value='';
  search.oninput();
  search.focus();
 };

 addEventListener('resize',resize);
 new ResizeObserver(placeFooter).observe($('#sheet'));
}

async function init(){
 try{
  const response=await fetch('./map-data.json');
  if(!response.ok)throw Error('Map data could not load');
  data=await response.json();

  try{
   renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'low-power'});
  }catch(webglError){
   renderer=new SoftwareRenderer(data,layerState);
   document.body.dataset.renderer='software';
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.7));
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  $('#map').append(renderer.domElement);
  renderer.domElement.setAttribute('aria-label','Drag to pan, pinch to zoom, use two fingers to rotate. Select locations using the Locations panel.');

  buildMap();

  camera=new THREE.OrthographicCamera(-300,300,250,-250,.1,3000);
  camera.position.set(55,280,240);
  controls=new OrbitControls(camera,renderer.domElement);
  controls.enableDamping=true;
  controls.dampingFactor=.12;
  controls.screenSpacePanning=false;
  controls.minZoom=.35;
  controls.maxZoom=12;
  controls.minPolarAngle=.001;
  controls.maxPolarAngle=Math.PI/2.7;
  controls.touches.ONE=THREE.TOUCH.PAN;
  controls.touches.TWO=THREE.TOUCH.DOLLY_ROTATE;
  controls.mouseButtons.LEFT=THREE.MOUSE.PAN;
  controls.mouseButtons.RIGHT=THREE.MOUSE.ROTATE;
  controls.addEventListener('change',markDirty);
  controls.addEventListener('start',()=>{animation=null;$('#gesture').style.opacity='0'});
  controls.target.set(mobile()?0:-75,0,mobile()?35:0);
  camera.position.copy(controls.target).add(new THREE.Vector3(65,280,240));
  camera.zoom=mobile()?1.05:1.17;

  // Initialize traffic simulation engine
  sim=new TrafficSimulation(data);
  if(renderer instanceof SoftwareRenderer){
   renderer.sim=sim;
  }

  resize();
  wire();
  controls.update();
  requestAnimationFrame(renderLoop);

  $('#loading').style.opacity=0;
  setTimeout(()=>$('#loading').remove(),550);

  window.__bathery={data,scene,renderer,camera,controls,groups,sim,showSite,showCamera,selectVehicle,tab};
 }catch(error){
  console.error(error);
  $('#loading').innerHTML=`<div class="loading-logo">b.</div><p>3D view couldn’t start</p><span>Try a browser with WebGL enabled.</span><button class="primary" style="max-width:230px;margin-top:25px" id="fallback-list">View the location plan</button>`;
  $('#fallback-list').onclick=()=>{
   $('#loading').remove();
   if(data){
    wire();
    renderPlan();
    $('#sheet').style.maxHeight='85dvh';
   }else location.reload();
  };
 }
}

init();
