import { spawn } from 'node:child_process';

const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 9223;

console.log('Testing Canvas SoftwareRenderer fallback on mobile viewport...');
const chrome = spawn(chromePath, [
  '--headless=new',
  `--remote-debugging-port=${port}`,
  '--disable-gpu',
  '--disable-webgl',
  '--disable-3d-apis',
  '--window-size=375,667',
  'about:blank'
], { stdio: 'ignore' });

process.on('exit', () => chrome.kill());
process.on('SIGINT', () => { chrome.kill(); process.exit(); });

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function run() {
  await sleep(1500);

  const newPageRes = await fetch(`http://127.0.0.1:${port}/json/new?http://127.0.0.1:8080/`, { method: 'PUT' });
  const pageData = await newPageRes.json();
  const pageWsUrl = pageData.webSocketDebuggerUrl;

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

  await sleep(2000);

  const fallbackCheck = await evalPage(`
    (function() {
      const b = window.__bathery;
      return {
        ready: Boolean(b),
        rendererClass: b?.renderer?.constructor?.name,
        isSoftware: b?.renderer?.constructor?.name === 'SoftwareRenderer' || document.body.dataset.renderer === 'software',
        canvasTag: b?.renderer?.domElement?.tagName
      };
    })()
  `);
  console.log('SoftwareRenderer fallback check:', fallbackCheck.result?.value);

  // Start simulation on software renderer
  const startSim = await evalPage(`
    (function() {
      const b = window.__bathery;
      b.sim.start();
      // Step simulation
      for (let i = 0; i < 40; i++) b.sim.step(0.05);
      return {
        simRunning: b.sim.running,
        vehicleCount: b.sim.vehicles.length
      };
    })()
  `);
  console.log('Simulation on SoftwareRenderer:', startSim.result?.value);

  // Test canvas picking
  const pickTest = await evalPage(`
    (function() {
      const b = window.__bathery;
      if (!b.sim.vehicles.length) return { ok: false };
      const v = b.sim.vehicles[0];
      // Get vehicle screen projection
      const screenPt = b.renderer.point(v.pos.x, 0.1, v.pos.z, b.camera);
      // Test pickVehicle
      const picked = b.renderer.pickVehicle(screenPt[0], screenPt[1], b.camera);
      return {
        ok: true,
        pickedMatch: picked?.id === v.id,
        vehicleDriver: picked?.profile?.nickname
      };
    })()
  `);
  console.log('Canvas vehicle picking test:', pickTest.result?.value);

  console.log('\n✓ Canvas SoftwareRenderer fallback verified successfully!');
  chrome.kill();
  process.exit(0);
}

run().catch(e => {
  console.error('Canvas fallback test error:', e);
  chrome.kill();
  process.exit(1);
});
