import http from 'node:http';
import { TrafficSimulation } from '../dist/traffic-sim.js';
import fs from 'node:fs';

console.log('=== TESTING OLLAMA BACKEND INTEGRATION (LIVE & MOCKED) ===\n');

// 1. Mock Ollama Server on loopback port 11439
const mockProfiles = [
  {
    nickname: 'Swift Anoop',
    description: 'A courier rushing parcels to Chungam.',
    drivingStyle: 'brisk',
    desiredSpeedFactor: 1.15,
    headwaySeconds: 1.2,
    accelPreference: 1.1,
    gapAcceptance: 1.8
  },
  {
    nickname: 'Gentle Deepa',
    description: 'A doctor heading to the clinic near Beenachi.',
    drivingStyle: 'cautious',
    desiredSpeedFactor: 0.90,
    headwaySeconds: 2.4,
    accelPreference: 0.7,
    gapAcceptance: 3.2
  }
];

const mockServer = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    ok: true,
    source: 'ollama',
    count: mockProfiles.length,
    profiles: mockProfiles.map(p => ({ ...p, id: 'ollama-' + Math.random().toString(36).slice(2), source: 'ollama' }))
  }));
});

await new Promise(r => mockServer.listen(11439, '127.0.0.1', r));
console.log('Mock Ollama API endpoint running on 127.0.0.1:11439');

// 2. Initialize TrafficSimulation and point ProfilePool to mock backend
const data = JSON.parse(fs.readFileSync('./dist/map-data.json', 'utf8'));
const sim = new TrafficSimulation(data);
sim.profilePool.apiBase = 'http://127.0.0.1:11439';
sim.profilePool.backendAvailable = true;

// Verify immediate profile is available before fetch
const immediateProfile = sim.profilePool.getProfile();
console.log('Immediate profile before fetch:', immediateProfile.nickname, '(source:', immediateProfile.source + ')');
if (immediateProfile.source !== 'local') throw new Error('First profile should be immediate local');

// Fetch profiles from backend
await sim.profilePool.fetchOllamaProfiles();
console.log('Profiles in pool after fetch:', sim.profilePool.pool.length);
if (sim.profilePool.pool.length === 0) throw new Error('Pool should be populated');

// Next profile should come from Ollama!
const ollamaProfile = sim.profilePool.getProfile();
console.log('Next profile from pool:', ollamaProfile.nickname, '(source:', ollamaProfile.source + ')');
if (ollamaProfile.source !== 'ollama') throw new Error('Expected profile from Ollama');

console.log('\n--- VERIFYING SIMULATED VEHICLE SPAWNS WITH OLLAMA PROFILE ---');
sim.start();
sim.spawnVehicle();
const spawnedVeh = sim.vehicles[0];
console.log('Spawned vehicle:', spawnedVeh.id, spawnedVeh.class);
console.log('Driver nickname:', spawnedVeh.profile.nickname);
console.log('Driver style:', spawnedVeh.profile.drivingStyle);
console.log('Driver source:', spawnedVeh.profile.source);
if (spawnedVeh.profile.source !== 'ollama') throw new Error('Spawned vehicle should have Ollama profile');

mockServer.close();
console.log('\n✓ Ollama mocked testing verified successfully!');
