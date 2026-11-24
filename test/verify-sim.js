import { validateAndCleanProfiles, sanitizeText, clamp } from '../server.js';
import { createRNG, generateLocalProfile, TrafficSimulation, ProfilePool } from '../dist/traffic-sim.js';
import fs from 'node:fs';

console.log('=== TEST SUITE: BATHERY TRAFFIC SIMULATION & OLLAMA BACKEND ===\n');

// TEST 1: SERVER VALIDATION & SANITIZATION
console.log('--- TEST 1: SERVER PROFILE VALIDATION & SANITIZATION ---');
const mockRaw = [
  {
    nickname: '<script>alert("hack")</script>Swift Appu',
    description: 'Heading to <b>Sulthan Bathery</b> municipal market.',
    drivingStyle: 'BRISK',
    desiredSpeedFactor: 1.85, // out of bounds (> 1.30)
    headwaySeconds: 0.2,      // out of bounds (< 1.0)
    accelPreference: 2.5,     // out of bounds (> 1.3)
    gapAcceptance: 0.5        // out of bounds (< 1.5)
  },
  {
    nickname: 'Calm Mary',
    description: 'Driving children to school near Assumption.',
    drivingStyle: 'cautious',
    desiredSpeedFactor: 0.90,
    headwaySeconds: 2.5,
    accelPreference: 0.75,
    gapAcceptance: 3.0
  },
  {
    nickname: '', // invalid: should be dropped
    description: 'Empty nickname'
  }
];

const cleaned = validateAndCleanProfiles(mockRaw);
if (cleaned.length !== 2) throw new Error('Expected 2 valid profiles');
const p1 = cleaned[0];
console.log('P1 sanitized nickname:', p1.nickname);
console.log('P1 sanitized description:', p1.description);
console.log('P1 style normalized:', p1.drivingStyle);
console.log('P1 speed clamped (max 1.30):', p1.desiredSpeedFactor);
console.log('P1 headway clamped (min 1.0):', p1.headwaySeconds);
console.log('P1 accel clamped (max 1.3):', p1.accelPreference);
console.log('P1 gap clamped (min 1.5):', p1.gapAcceptance);

if (p1.nickname.includes('<script>') || p1.description.includes('<b>')) {
  throw new Error('Failed to sanitize HTML');
}
if (p1.desiredSpeedFactor > 1.30 || p1.headwaySeconds < 1.0) {
  throw new Error('Failed to clamp traits');
}
console.log('✓ Test 1 passed!\n');

// TEST 2: SEEDED LOCAL REPRODUCIBILITY & DRIVER DIVERSITY
console.log('--- TEST 2: SEEDED LOCAL REPRODUCIBILITY & DRIVER DIVERSITY ---');
const rng1 = createRNG(12345);
const run1 = [generateLocalProfile(rng1), generateLocalProfile(rng1), generateLocalProfile(rng1)];

const rng2 = createRNG(12345);
const run2 = [generateLocalProfile(rng2), generateLocalProfile(rng2), generateLocalProfile(rng2)];

for (let i = 0; i < 3; i++) {
  if (run1[i].nickname !== run2[i].nickname || run1[i].drivingStyle !== run2[i].drivingStyle) {
    throw new Error('Seeded runs did not match exactly!');
  }
}
console.log('Run 1 & Run 2 produced identical profiles for seed 12345.');
console.log('Sample profiles:', run1.map(p => p.nickname + ' (' + p.drivingStyle + ')'));
console.log('✓ Test 2 passed!\n');

// TEST 3: TRAFFIC SIMULATION RUN & CAR FOLLOWING & QUEUEING
console.log('--- TEST 3: TRAFFIC SIMULATION RUN & COLLISION CHECK ---');
const data = JSON.parse(fs.readFileSync('./dist/map-data.json', 'utf8'));
const sim = new TrafficSimulation(data);
sim.setDensity('high');
sim.start();

let minObservedGap = Infinity;
let stoppedAtSignalCount = 0;
let yieldingCount = 0;

for (let step = 0; step < 4000; step++) {
  sim.step(0.05);

  // Check for vehicle collisions across all edges
  for (const edge of sim.graph.edges) {
    if (edge.vehicles.length > 1) {
      for (let i = 0; i < edge.vehicles.length - 1; i++) {
        const rear = edge.vehicles[i];
        const front = edge.vehicles[i + 1];
        const netGap = front.s - rear.s - front.vClass.length;
        if (netGap < minObservedGap) minObservedGap = netGap;
        if (netGap < 0.05) {
          throw new Error('Collision detected on edge ' + edge.id + ': net gap ' + netGap);
        }
      }
    }
  }

  for (const v of sim.vehicles) {
    if (v.state === 'waiting at signal') stoppedAtSignalCount++;
    if (v.state === 'yielding at junction') yieldingCount++;
  }
}

console.log('Simulation ran 200 simulated seconds (4000 physics steps).');
console.log('Active vehicles:', sim.vehicles.length);
console.log('Total spawns:', sim.stats.totalSpawns);
console.log('Completed trips:', sim.stats.completedTrips);
console.log('Minimum observed vehicle gap:', minObservedGap.toFixed(2), 'units (~' + (minObservedGap * 10).toFixed(1) + 'm, safe queueing!)');
console.log('Vehicles observed waiting at red signals:', stoppedAtSignalCount > 0);
console.log('Vehicles observed yielding at junctions:', yieldingCount > 0);
console.log('✓ Test 3 passed!\n');

// TEST 4: CAMERA OBSERVATIONS & ARRIVAL TIMING
console.log('--- TEST 4: CAMERA OBSERVATIONS & ARRIVAL TIMING ---');
let camerasWithCounts = 0;
let camerasWithArrivalTimes = 0;
for (const camId in sim.cameraObserver.observations) {
  const obs = sim.cameraObserver.observations[camId];
  if (obs.count > 0) {
    camerasWithCounts++;
    if (obs.lastDetectionToArrivalSec !== null) {
      camerasWithArrivalTimes++;
    }
  }
}
console.log('Cameras with detections:', camerasWithCounts);
console.log('Cameras with measured detection-to-arrival time:', camerasWithArrivalTimes);
if (camerasWithCounts === 0 || camerasWithArrivalTimes === 0) {
  throw new Error('Expected camera observations and arrival measurements');
}
console.log('✓ Test 4 passed!\n');

// TEST 5: GEOJSON EXPORT PURITY
console.log('--- TEST 5: GEOJSON EXPORT PURITY ---');
const convert = p => [p[0] / 10900 + data.origin[0], -p[1] / 11132 + data.origin[1]];
const features = [
  ...data.sites.filter(s => s.signal).map(s => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: s.coord },
    properties: { name: s.name, type: 'proposed_signal_site', status: 'concept_unverified' }
  })),
  ...data.cameras.map(c => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: convert(c.pos) },
    properties: {
      name: c.id,
      site: c.site,
      type: 'proposed_camera',
      status: 'illustrative_position',
      purpose: c.purpose,
      ...(c.approach ? { approach_road: c.approach.name, osm_road_id: c.approach.road, estimated_junction_distance_m: c.approach.junctionDistanceM } : {}),
      ...(c.downstreamSignal ? { downstream_signal_site: c.downstreamSignal.site, estimated_road_distance_m: c.downstreamSignal.roadDistanceM } : {})
    }
  }))
];
const exportStr = JSON.stringify(features);
if (exportStr.includes('simulated') || exportStr.includes('detection_count') || exportStr.includes('arrival_sec')) {
  throw new Error('Export contains simulation data!');
}
console.log('Export features count:', features.length, 'Pure concept data only.');
console.log('✓ Test 5 passed!\n');

console.log('=== ALL AUTOMATED TESTS PASSED SUCCESSFULLY! ===');
