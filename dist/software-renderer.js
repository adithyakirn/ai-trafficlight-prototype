import * as THREE from 'three';
// Lightweight canvas projection fallback for browsers that cannot create a WebGL context.
export class SoftwareRenderer {
 constructor(data,layers){
  this.data=data;
  this.layers=layers;
  this.domElement=document.createElement('canvas');
  this.ctx=this.domElement.getContext('2d');
  this.ratio=1;
  this.w=1;
  this.h=1;
  this.v=new THREE.Vector3();
  this.sim=null;
 }
 setPixelRatio(v){this.ratio=Math.min(v,1.5)}
 setSize(w,h){this.w=w;this.h=h;this.domElement.width=w*this.ratio;this.domElement.height=h*this.ratio;this.domElement.style.width=w+'px';this.domElement.style.height=h+'px'}
 point(x,y,z,camera){this.v.set(x,y,z).project(camera);return [(this.v.x+1)*this.w/2,(-this.v.y+1)*this.h/2,this.v.z]}
 path(points,fill,stroke,width=1){const c=this.ctx;c.beginPath();points.forEach((p,i)=>i?c.lineTo(p[0],p[1]):c.moveTo(p[0],p[1]));if(fill){c.closePath();c.fillStyle=fill;c.fill()}if(stroke){c.strokeStyle=stroke;c.lineWidth=width;c.lineJoin='round';c.lineCap='round';c.stroke()}}

 pickVehicle(screenX, screenY, camera){
  if(!this.sim||!this.sim.vehicles.length)return null;
  let best=null;
  let minD=24; // 24px pick radius
  for(const v of this.sim.vehicles){
   const p=this.point(v.pos.x,.1,v.pos.z,camera);
   const d=Math.hypot(p[0]-screenX,p[1]-screenY);
   if(d<minD){minD=d;best=v;}
  }
  return best;
 }

 render(scene,camera){
  camera.updateMatrixWorld();
  const ctx=this.ctx;
  ctx.setTransform(this.ratio,0,0,this.ratio,0,0);
  ctx.fillStyle='#e4ece4';
  ctx.fillRect(0,0,this.w,this.h);
  const proj=(p,h=.06)=>this.point(p[0],h,p[1],camera),unit=this.h/(camera.top-camera.bottom)*camera.zoom;

  for(const g of this.data.greens)this.path(g.map(p=>proj(p)),'#c8dcbf');
  for(const r of this.data.roads){
   const width=({trunk:1.45,primary:1.25,secondary:1.05,tertiary:.75}[r.kind]||.48)*unit;
   const pts=r.pts.map(p=>proj(p));
   this.path(pts,null,'#b9c8bb',width+.3*unit);
   this.path(pts,null,r.kind==='trunk'?'#faf8e9':'#f5f7f1',width);
   if(r.kind==='trunk'){
    ctx.setLineDash([unit,unit*1.2]);
    this.path(pts,null,'#c0b991',Math.max(.6,unit*.05));
    ctx.setLineDash([]);
   }
  }

  if(this.layers.buildings){
   const bs=this.data.buildings.map(b=>({b,d:proj(b.pts[0])[2]})).sort((a,b)=>b.d-a.d);
   for(const {b}of bs){
    const base=b.pts.map(p=>proj(p,.07)),top=b.pts.map(p=>proj(p,b.h*1.8));
    if(!top.some(p=>p[0]>-100&&p[0]<this.w+100&&p[1]>-100&&p[1]<this.h+100))continue;
    for(let i=1;i<top.length;i++)this.path([base[i-1],base[i],top[i],top[i-1]],i%2?'#acbeb1':'#b6c8ba');
    this.path(top,'#d5e0d3','#c4d2c4',.5);
   }
  }

  if(this.layers.coverage)for(const c of this.data.cameras){
   const points=[proj(c.pos,.14)];
   for(let i=0;i<=12;i++){
    const a=c.angle-.42+i*.84/12;
    points.push(proj([c.pos[0]+Math.cos(a)*10,c.pos[1]+Math.sin(a)*10],.14));
   }
   this.path(points,'#24a6b52d','#24a6b54a',1);
  }

  if(this.layers.cameras)for(const c of this.data.cameras){
   const a=proj(c.pos),b=proj(c.pos,2.8);
   this.path([a,b],null,'#4b7769',Math.max(1,unit*.18));
   ctx.fillStyle='#07889a';
   ctx.fillRect(b[0]-unit*.5,b[1]-unit*.3,unit*.95,unit*.55);
  }

  if(this.layers.signals)for(const s of this.data.sites.filter(s=>s.signal)){
   const a=proj(s.pos),b=proj(s.pos,4);
   this.path([a,b],null,'#435f50',Math.max(1,unit*.2));
   ctx.fillStyle='#294b3a';
   ctx.fillRect(b[0]-unit*.45,b[1]-unit*1.6,unit*.9,unit*1.8);
   for(let i=0;i<3;i++){
    ctx.beginPath();
    ctx.arc(b[0],b[1]-unit*(1.3-i*.55),Math.max(.8,unit*.18),0,Math.PI*2);
    ctx.fillStyle=['#b77965','#edb265','#83a085'][i];
    ctx.fill();
   }
  }

  // Render simulated vehicles in 2D Canvas fallback
  if(this.sim&&this.sim.vehicles){
   for(const v of this.sim.vehicles){
    const pt=proj([v.pos.x,v.pos.z],.1);
    if(pt[0]<-50||pt[0]>this.w+50||pt[1]<-50||pt[1]>this.h+50)continue;
    const vLen=Math.max(4,v.vClass.length*unit);
    const vWid=Math.max(2.5,v.vClass.width*unit);

    ctx.save();
    ctx.translate(pt[0],pt[1]);
    ctx.rotate(-v.pos.angle);

    // Selected vehicle highlight ring
    if(this.sim.selectedVehicle===v){
     ctx.beginPath();
     ctx.arc(0,0,vLen*.8,0,Math.PI*2);
     ctx.fillStyle='#eab30844';
     ctx.fill();
     ctx.strokeStyle='#ca8a04';
     ctx.lineWidth=1.5;
     ctx.stroke();
    }

    // Vehicle body
    ctx.fillStyle=v.color;
    ctx.strokeStyle='#1e293b';
    ctx.lineWidth=Math.max(.6,unit*.04);
    ctx.beginPath();
    ctx.roundRect(-vWid/2,-vLen/2,vWid,vLen,Math.max(1,unit*.06));
    ctx.fill();
    ctx.stroke();

    // Windshield / roof indicator (front facing along direction)
    ctx.fillStyle='#ffffffcc';
    ctx.fillRect(-vWid*.35,0,vWid*.7,vLen*.35);

    ctx.restore();
   }
  }
 }
}
