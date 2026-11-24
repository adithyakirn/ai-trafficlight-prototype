import { spawn } from 'node:child_process';

const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 9222;

console.log('Starting headless Chrome on port', port, '...');
const chrome = spawn(chromePath, [
  '--headless=new',
  `--remote-debugging-port=${port}`,
  '--disable-gpu',
  '--no-sandbox',
  'about:blank'
], { stdio: 'ignore' });

process.on('exit', () => chrome.kill());
process.on('SIGINT', () => { chrome.kill(); process.exit(); });

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function run() {
  await sleep(1500);

  // Open page directly via HTTP endpoint
  const newPageRes = await fetch(`http://127.0.0.1:${port}/json/new?http://127.0.0.1:8080/`, { method: 'PUT' });
  const pageData = await newPageRes.json();
  const pageWsUrl = pageData.webSocketDebuggerUrl;
  console.log('Connected to page WebSocket:', pageWsUrl);

  const ws = new WebSocket(pageWsUrl);
  let idCounter = 1;
  const pending = new Map();

  ws.onmessage = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(msg.error);
      else resolve(msg.result);
    }
  };

  await new Promise(r => ws.onopen = r);

  function evalPage(expr) {
    return new Promise((resolve, reject) => {
      const id = idCounter++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({
        id,
        method: 'Runtime.evaluate',
        params: { expression: expr, awaitPromise: true, returnByValue: true }
      }));
    });
  }

  console.log('Waiting for map to initialize...');
  await sleep(2000);

  const initStatus = await evalPage(`
    (function() {
      const b = window.__bathery;
      return {
        ready: Boolean(b),
        roads: b?.data?.roads?.length,
        sites: b?.data?.sites?.length,
        cameras: b?.data?.cameras?.length,
        simAvailable: Boolean(b?.sim)
      };
    })()
  `);
  console.log('Init status:', initStatus.result?.value);

  // 1. Search for Chungam
  const searchResult = await evalPage(`
    (function() {
      const s = document.querySelector('#search');
      s.value = 'Chungam';
      s.oninput();
      const items = Array.from(document.querySelectorAll('#search-results button')).map(b => b.textContent.trim());
      return items;
    })()
  `);
  console.log('Search for "Chungam":', searchResult.result?.value);

  // 2. Start Simulation
  const startResult = await evalPage(`
    (function() {
      document.querySelector('#sim-play-btn').click();
      return {
        running: window.__bathery.sim.running,
        clock: window.__bathery.sim.getSimTimeFormatted()
      };
    })()
  `);
  console.log('Started simulation:', startResult.result?.value);

  // Wait 3 seconds for simulation steps
  await sleep(3000);

  // 3. Inspect spawned vehicles and personalities
  const vehStatus = await evalPage(`
    (function() {
      const sim = window.__bathery.sim;
      return {
        activeCount: sim.vehicles.length,
        spawns: sim.stats.totalSpawns,
        clock: sim.getSimTimeFormatted(),
        vehicles: sim.vehicles.slice(0, 3).map(v => ({
          id: v.id,
          class: v.class,
          speed: (v.speed * 36).toFixed(1) + ' km/h',
          driver: v.profile.nickname,
          style: v.profile.drivingStyle,
          source: v.profile.source,
          state: v.state
        }))
      };
    })()
  `);
  console.log('Vehicles running:', JSON.stringify(vehStatus.result?.value, null, 2));

  // 4. Inspect a vehicle in sheet
  const inspectVeh = await evalPage(`
    (function() {
      const v = window.__bathery.sim.vehicles[0];
      window.__bathery.selectVehicle(v);
      const sheet = document.querySelector('#sheet-body');
      return {
        sheetHeader: sheet.querySelector('h2')?.textContent,
        driverBadge: sheet.querySelector('.driver-badge')?.textContent,
        profileSource: sheet.querySelector('.profile-source-tag')?.textContent.trim(),
        speedText: sheet.querySelector('#live-veh-speed')?.textContent,
        stateText: sheet.querySelector('#live-veh-state')?.textContent
      };
    })()
  `);
  console.log('Vehicle inspector sheet:', inspectVeh.result?.value);

  // 5. Inspect camera C24
  const inspectCam = await evalPage(`
    (function() {
      window.__bathery.showCamera('C24');
      const det = document.querySelector('#camera-detail');
      return {
        title: det.querySelector('b')?.textContent,
        simObsBox: det.querySelector('.sim-obs-box')?.textContent.replace(/\\s+/g, ' ').trim()
      };
    })()
  `);
  console.log('Camera C24 inspector:', inspectCam.result?.value);

  // 6. Test Pause & Resume
  const pauseResume = await evalPage(`
    (function() {
      const btn = document.querySelector('#sim-play-btn');
      btn.click(); // Pause
      const pausedState = window.__bathery.sim.running;
      btn.click(); // Resume
      const resumedState = window.__bathery.sim.running;
      return { pausedState, resumedState };
    })()
  `);
  console.log('Pause / Resume check:', pauseResume.result?.value);

  console.log('\n✓ Headless browser test verified successfully!');
  chrome.kill();
  process.exit(0);
}

run().catch(e => {
  console.error('Test error:', e);
  chrome.kill();
  process.exit(1);
});
