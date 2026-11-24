/**
 * Bathery 3D Traffic Map - Microscopic Traffic Simulation Engine
 * 
 * Implements:
 * - Directed road graph with left-hand traffic (LHT) lane offsets
 * - Intelligent Driver Model (IDM) car following and queueing
 * - Deterministic demonstration signal phases at 6 candidate signal sites
 * - Yield rules and junction clearance at unsignalized junctions
 * - Fictional driver personality profiles (seeded local generator + Ollama pool)
 * - Synthetic camera detection lines and arrival observations
 * - Fixed simulation timestep with pause, resume, reset, seed, density, speed
 * 
 * All traffic counts and observations are strictly synthetic and simulated.
 */

// Simple seeded PRNG (Mulberry32) for reproducible runs
export function createRNG(seed = 42) {
  let s = (Math.floor(Math.abs(seed)) || 1) >>> 0;
  return function next() {
    s |= 0; s = s + 0x6D2B79F5 | 0;
    let t = Math.imul(s ^ s >>> 15, 1 | s);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// Vehicle Classes with dimensions, physical limits and weight in mix
export const VEHICLE_CLASSES = {
  hatchback: {
    name: 'Hatchback',
    length: 0.38,   // ~3.8m
    width: 0.17,    // ~1.7m
    height: 0.14,
    maxSpeed: 1.30, // ~47 km/h (1 unit = 10m)
    maxAccel: 0.28, // ~2.8 m/s²
    colors: ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#64748b', '#06b6d4', '#e2e8f0'],
    weight: 0.35
  },
  sedan: {
    name: 'Sedan',
    length: 0.44,   // ~4.4m
    width: 0.18,    // ~1.8m
    height: 0.14,
    maxSpeed: 1.35, // ~49 km/h
    maxAccel: 0.25, // ~2.5 m/s²
    colors: ['#1e293b', '#475569', '#3b82f6', '#94a3b8', '#0f766e', '#f8fafc'],
    weight: 0.25
  },
  suv: {
    name: 'SUV',
    length: 0.48,   // ~4.8m
    width: 0.19,    // ~1.9m
    height: 0.17,
    maxSpeed: 1.28, // ~46 km/h
    maxAccel: 0.24, // ~2.4 m/s²
    colors: ['#0f172a', '#991b1b', '#166534', '#334155', '#78350f', '#e2e8f0'],
    weight: 0.20
  },
  bus: {
    name: 'Bus',
    length: 0.95,   // ~9.5m
    width: 0.24,    // ~2.4m
    height: 0.26,
    maxSpeed: 0.90, // ~32 km/h
    maxAccel: 0.12, // ~1.2 m/s²
    colors: ['#dc2626', '#16a34a', '#2563eb', '#ca8a04', '#ea580c'],
    weight: 0.10
  },
  truck: {
    name: 'Truck',
    length: 0.82,   // ~8.2m
    width: 0.22,    // ~2.2m
    height: 0.24,
    maxSpeed: 0.85, // ~30 km/h
    maxAccel: 0.10, // ~1.0 m/s²
    colors: ['#d97706', '#0284c7', '#4b5563', '#65a30d', '#b45309'],
    weight: 0.10
  }
};

const ROAD_PRIORITIES = {
  trunk: 5,
  primary: 4,
  secondary: 3,
  tertiary: 2,
  residential: 1,
  service: 1,
  unclassified: 1,
  living_street: 1
};

const ROAD_WIDTHS = {
  trunk: 1.45,
  primary: 1.25,
  secondary: 1.05,
  tertiary: 0.75
};

const ROAD_SPEED_LIMITS = {
  trunk: 1.15,      // ~41 km/h
  primary: 1.10,    // ~40 km/h
  secondary: 0.95,  // ~34 km/h
  tertiary: 0.80,   // ~29 km/h
  residential: 0.60 // ~22 km/h
};

// Seeded local driver personalities
const DRIVER_FIRST_NAMES = [
  'Appu', 'Mary', 'Rahul', 'Shaji', 'Deepa', 'Paul', 'Binu', 'Anoop',
  'Kavitha', 'Jayan', 'Mathew', 'Priya', 'Suresh', 'Mini', 'Vijay',
  'Fatima', 'Thomas', 'Lakshmi', 'Vinu', 'Salim', 'Sreeja', 'Dileep',
  'Devika', 'Babu', 'Roshan', 'Ancy', 'Manoj', 'Rani', 'Prasad', 'Latha'
];

const STYLE_EPITHETS = {
  cautious: ['Careful', 'Gentle', 'Watchful', 'Vigilant', 'Mindful'],
  steady: ['Steady', 'Measured', 'Reliable', 'Smooth', 'Sure-Footed'],
  patient: ['Patient', 'Calm', 'Serene', 'Tranquil', 'Placid'],
  brisk: ['Swift', 'Brisk', 'Prompt', 'Eager', 'Active']
};

const FICTIONAL_BACKSTORIES = [
  'A daily commuter heading to the Sulthan Bathery municipal market.',
  'A school teacher making their regular morning trip past Assumption Junction.',
  'An experienced driver keeping a relaxed schedule along NH766.',
  'A delivery driver completing retail drop-offs between Chungam and Beenachi.',
  'A hospital staff member heading for morning shift near Assumption.',
  'A local merchant returning from the Kozhikode approach.',
  'A resident running family errands around the Town Bus Stand.',
  'A tea estate supervisor driving in from the Meppadi direction.',
  'A college student commuting along Chulliyode Road.',
  'A supply van driver heading toward Pulpally Road.',
  'A cooperative bank employee traveling through the town centre.',
  'A postal courier maintaining a prompt timetable across Bathery.'
];

export function generateLocalProfile(rng) {
  const styles = ['cautious', 'steady', 'patient', 'brisk'];
  // style weights: steady (40%), patient (25%), cautious (20%), brisk (15%)
  const r = rng();
  const style = r < 0.20 ? 'cautious' : r < 0.60 ? 'steady' : r < 0.85 ? 'patient' : 'brisk';

  const firstName = DRIVER_FIRST_NAMES[Math.floor(rng() * DRIVER_FIRST_NAMES.length)];
  const epithets = STYLE_EPITHETS[style];
  const epithet = epithets[Math.floor(rng() * epithets.length)];
  const nickname = `${epithet} ${firstName}`;
  const description = FICTIONAL_BACKSTORIES[Math.floor(rng() * FICTIONAL_BACKSTORIES.length)];

  let desiredSpeedFactor, headwaySeconds, accelPreference, gapAcceptance;

  if (style === 'cautious') {
    desiredSpeedFactor = 0.85 + rng() * 0.10; // 0.85 - 0.95
    headwaySeconds = 2.2 + rng() * 0.6;      // 2.2 - 2.8s
    accelPreference = 0.65 + rng() * 0.15;   // 0.65 - 0.80
    gapAcceptance = 2.8 + rng() * 0.7;       // 2.8 - 3.5s
  } else if (style === 'steady') {
    desiredSpeedFactor = 0.95 + rng() * 0.10; // 0.95 - 1.05
    headwaySeconds = 1.6 + rng() * 0.4;      // 1.6 - 2.0s
    accelPreference = 0.85 + rng() * 0.15;   // 0.85 - 1.00
    gapAcceptance = 2.0 + rng() * 0.5;       // 2.0 - 2.5s
  } else if (style === 'patient') {
    desiredSpeedFactor = 0.90 + rng() * 0.10; // 0.90 - 1.00
    headwaySeconds = 2.0 + rng() * 0.4;      // 2.0 - 2.4s
    accelPreference = 0.70 + rng() * 0.15;   // 0.70 - 0.85
    gapAcceptance = 2.4 + rng() * 0.6;       // 2.4 - 3.0s
  } else { // brisk
    desiredSpeedFactor = 1.08 + rng() * 0.12; // 1.08 - 1.20
    headwaySeconds = 1.1 + rng() * 0.4;      // 1.1 - 1.5s
    accelPreference = 1.05 + rng() * 0.20;   // 1.05 - 1.25
    gapAcceptance = 1.6 + rng() * 0.4;       // 1.6 - 2.0s
  }

  return {
    id: 'local-' + Math.floor(rng() * 1000000).toString(36),
    nickname,
    description,
    drivingStyle: style,
    desiredSpeedFactor: Math.round(desiredSpeedFactor * 100) / 100,
    headwaySeconds: Math.round(headwaySeconds * 10) / 10,
    accelPreference: Math.round(accelPreference * 100) / 100,
    gapAcceptance: Math.round(gapAcceptance * 10) / 10,
    source: 'local'
  };
}

/**
 * Profile Pool: manages asynchronous Ollama background generation
 * and fallback to seeded local generation.
 */
export class ProfilePool {
  constructor(rng) {
    this.rng = rng;
    this.pool = [];
    this.fetching = false;
    this.lastFetchTime = 0;
    this.backendAvailable = null;
    this.apiBase = ''; // same-origin by default
  }

  setSeed(seed) {
    this.rng = createRNG(seed);
    this.pool = [];
  }

  async checkBackend() {
    // Try same-origin /api/status first; if running python on 8080 and backend on 8081, check 8081 too
    const candidates = ['', 'http://127.0.0.1:8081', 'http://localhost:8081'];
    for (const base of candidates) {
      try {
        const res = await fetch(`${base}/api/status`, { signal: AbortSignal.timeout(1500) });
        if (res.ok) {
          const data = await res.json();
          this.apiBase = base;
          this.backendAvailable = true;
          this.ollamaInfo = data.ollama;
          return true;
        }
      } catch (e) {}
    }
    this.backendAvailable = false;
    return false;
  }

  async fetchOllamaProfiles() {
    if (this.fetching) return;
    if (this.backendAvailable === false) return;

    this.fetching = true;
    try {
      const url = `${this.apiBase}/api/profiles?count=5`;
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (res.ok) {
        const data = await res.json();
        if (data.ok && Array.isArray(data.profiles) && data.profiles.length > 0) {
          for (const p of data.profiles) {
            this.pool.push(p);
          }
          this.backendAvailable = true;
        }
      }
    } catch (e) {
      // Backend not running or timeout: use local fallback silently
    } finally {
      this.fetching = false;
      this.lastFetchTime = performance.now();
    }
  }

  getProfile() {
    // If we have an Ollama profile in pool, use it
    if (this.pool.length > 0) {
      const p = this.pool.shift();
      // If pool is running low, trigger background fetch
      if (this.pool.length < 3 && performance.now() - this.lastFetchTime > 4000) {
        this.fetchOllamaProfiles().catch(() => {});
      }
      return p;
    }

    // Trigger background fetch if backend hasn't been ruled out
    if (this.backendAvailable !== false && performance.now() - this.lastFetchTime > 5000) {
      this.fetchOllamaProfiles().catch(() => {});
    }

    // Always immediately return a deterministic seeded local profile
    return generateLocalProfile(this.rng);
  }
}

/**
 * Builds the directed road graph from map-data.json
 */
export function buildTrafficGraph(data) {
  const EPS = 0.05; // 0.5 meter snap radius
  const nodes = [];

  function findOrCreateNode(x, z) {
    for (const n of nodes) {
      if (Math.hypot(n.pos[0] - x, n.pos[1] - z) <= EPS) {
        return n;
      }
    }
    const n = { id: nodes.length, pos: [x, z], edges: [], incoming: [], isJunction: false, siteId: null };
    nodes.push(n);
    return n;
  }

  // Map coordinate strings to roads that use them
  const key = ([x, z]) => Math.round(x * 100) / 100 + ',' + Math.round(z * 100) / 100;
  const coordToRoads = new Map();
  for (const r of data.roads) {
    for (let idx = 0; idx < r.pts.length; idx++) {
      const k = key(r.pts[idx]);
      if (!coordToRoads.has(k)) coordToRoads.set(k, []);
      coordToRoads.get(k).push({ r, idx });
    }
  }

  const isJunctionVertex = (p, idx, len) => {
    if (idx === 0 || idx === len - 1) return true;
    const list = coordToRoads.get(key(p));
    return list && list.length > 1;
  };

  // Associate survey sites with nodes
  for (const s of data.sites) {
    const node = findOrCreateNode(s.pos[0], s.pos[1]);
    node.siteId = s.id;
    node.siteName = s.name;
    node.isSignal = Boolean(s.signal);
  }

  const edges = [];

  // Segment each road between junction vertices
  for (const r of data.roads) {
    let segStart = 0;
    for (let i = 1; i < r.pts.length; i++) {
      if (isJunctionVertex(r.pts[i], i, r.pts.length)) {
        const pts = r.pts.slice(segStart, i + 1);
        const uNode = findOrCreateNode(pts[0][0], pts[0][1]);
        const vNode = findOrCreateNode(pts[pts.length - 1][0], pts[pts.length - 1][1]);

        let length = 0;
        for (let j = 1; j < pts.length; j++) {
          length += Math.hypot(pts[j][0] - pts[j - 1][0], pts[j][1] - pts[j - 1][1]);
        }

        if (length > 0.05 && uNode.id !== vNode.id) {
          const kind = r.kind || 'residential';
          const roadWidth = ROAD_WIDTHS[kind] || 0.48;
          const laneOffset = roadWidth / 4; // Left-hand traffic offset
          const speedLimit = ROAD_SPEED_LIMITS[kind] || 0.60;
          const priority = ROAD_PRIORITIES[kind] || 1;

          // Forward edge (u -> v)
          const forwardEdge = createDirectedEdge(edges.length, r.id, r.name, kind, uNode.id, vNode.id, pts, length, laneOffset, speedLimit, priority);
          edges.push(forwardEdge);
          uNode.edges.push(forwardEdge);
          vNode.incoming.push(forwardEdge);

          // Backward edge (v -> u)
          const backwardPts = [...pts].reverse();
          const backwardEdge = createDirectedEdge(edges.length, r.id, r.name, kind, vNode.id, uNode.id, backwardPts, length, laneOffset, speedLimit, priority);
          edges.push(backwardEdge);
          vNode.edges.push(backwardEdge);
          uNode.incoming.push(backwardEdge);
        }
        segStart = i;
      }
    }
  }

  for (const n of nodes) {
    if (n.edges.length > 2 || n.siteId) {
      n.isJunction = true;
    }
  }

  // Precompute shortest paths helper
  return {
    nodes,
    edges,
    findPath: (startId, endId) => dijkstraShortestPath(nodes, startId, endId)
  };
}

function createDirectedEdge(id, roadId, name, kind, from, to, pts, length, laneOffset, speedLimit, priority) {
  // Precompute subsegment lengths, tangents, and left normals for smooth interpolation
  const subsegments = [];
  let cumLen = 0;
  for (let i = 1; i < pts.length; i++) {
    const p1 = pts[i - 1];
    const p2 = pts[i];
    const dx = p2[0] - p1[0];
    const dz = p2[1] - p1[1];
    const len = Math.hypot(dx, dz);
    if (!len) continue;
    const dirX = dx / len;
    const dirZ = dz / len;
    // Left-hand normal: (dirZ, -dirX)
    const normX = dirZ;
    const normZ = -dirX;
    subsegments.push({
      p1, p2, len, startDist: cumLen, endDist: cumLen + len,
      dirX, dirZ, normX, normZ
    });
    cumLen += len;
  }

  return {
    id,
    roadId,
    name: name || kind,
    kind,
    from,
    to,
    pts,
    length,
    laneOffset,
    speedLimit,
    priority,
    subsegments,
    vehicles: [], // active vehicles currently on this edge, sorted by s
    signalState: 'green', // 'green', 'amber', 'red'
    isYieldApproach: false,

    // Sample position, heading and left lane point at distance s along edge
    sample(s) {
      const dist = Math.max(0, Math.min(s, length));
      let sub = subsegments[0];
      for (let i = 0; i < subsegments.length; i++) {
        if (dist <= subsegments[i].endDist || i === subsegments.length - 1) {
          sub = subsegments[i];
          break;
        }
      }
      const t = (dist - sub.startDist) / sub.len;
      const cx = sub.p1[0] + (sub.p2[0] - sub.p1[0]) * t;
      const cz = sub.p1[1] + (sub.p2[1] - sub.p1[1]) * t;
      // Offset to the left for Left-Hand Traffic (LHT)
      const laneX = cx + sub.normX * laneOffset;
      const laneZ = cz + sub.normZ * laneOffset;
      const angle = Math.atan2(sub.dirX, sub.dirZ); // Three.js rotation angle
      return { x: laneX, z: laneZ, cx, cz, angle, dirX: sub.dirX, dirZ: sub.dirZ };
    }
  };
}

function dijkstraShortestPath(nodes, startId, endId) {
  if (startId === endId) return null;
  const dist = new Float32Array(nodes.length).fill(Infinity);
  const prevEdge = new Array(nodes.length).fill(null);
  const visited = new Uint8Array(nodes.length);

  dist[startId] = 0;
  const pq = [{ id: startId, d: 0 }];

  while (pq.length > 0) {
    // Pick minimum
    let minIdx = 0;
    for (let i = 1; i < pq.length; i++) {
      if (pq[i].d < pq[minIdx].d) minIdx = i;
    }
    const { id: u, d } = pq.splice(minIdx, 1)[0];

    if (u === endId) break;
    if (visited[u]) continue;
    visited[u] = 1;

    for (const e of nodes[u].edges) {
      const v = e.to;
      if (visited[v]) continue;
      // Slight penalty for turns / lower-class roads to prefer main corridors
      const cost = e.length * (e.kind === 'trunk' ? 0.9 : e.kind === 'primary' ? 0.95 : e.kind === 'secondary' ? 1.0 : 1.15);
      const alt = d + cost;
      if (alt < dist[v]) {
        dist[v] = alt;
        prevEdge[v] = e;
        pq.push({ id: v, d: alt });
      }
    }
  }

  if (dist[endId] === Infinity) return null;

  const path = [];
  let curr = endId;
  while (curr !== startId) {
    const e = prevEdge[curr];
    if (!e) return null;
    path.unshift(e);
    curr = e.from;
  }
  return path;
}

/**
 * Deterministic Signal Controller for the 6 candidate signal sites.
 * Uses simple phases with clearance intervals (amber + all-red)
 * and mutually exclusive conflicting movements.
 */
export class DemonstrationSignalController {
  constructor(graph, data) {
    this.graph = graph;
    this.signalJunctions = [];

    // Find candidate signal junctions from sites with signal: true
    for (const site of data.sites.filter(s => s.signal)) {
      const node = graph.nodes.find(n => n.siteId === site.id);
      if (!node) continue;

      const incoming = node.incoming;
      // Partition incoming edges into two non-conflicting phases:
      // Phase 1: main road / East-West corridor approaches
      // Phase 2: side / secondary approaches
      const p1Edges = [];
      const p2Edges = [];

      // Sort incoming by priority
      const sorted = [...incoming].sort((a, b) => b.priority - a.priority);
      for (let i = 0; i < sorted.length; i++) {
        if (i < 2 && sorted[i].priority >= 3) {
          p1Edges.push(sorted[i]);
        } else {
          p2Edges.push(sorted[i]);
        }
      }
      if (p2Edges.length === 0 && incoming.length > 1) {
        p2Edges.push(p1Edges.pop());
      }

      this.signalJunctions.push({
        siteId: site.id,
        siteName: site.name,
        nodeId: node.id,
        p1Edges,
        p2Edges,
        // Timings: P1 Green (16s), P1 Amber (3s), All-Red (1s), P2 Green (12s), P2 Amber (3s), All-Red (1s) = 36s cycle
        p1Green: 16,
        p1Amber: 3,
        allRed1: 1,
        p2Green: 12,
        p2Amber: 3,
        allRed2: 1,
        cycleTime: 36,
        offset: (node.id * 7) % 36 // stagger adjoining junctions along NH766
      });
    }
  }

  update(simTime) {
    for (const sj of this.signalJunctions) {
      const t = (simTime + sj.offset) % sj.cycleTime;
      const t1 = sj.p1Green;
      const t2 = t1 + sj.p1Amber;
      const t3 = t2 + sj.allRed1;
      const t4 = t3 + sj.p2Green;
      const t5 = t4 + sj.p2Amber;

      let p1State = 'red';
      let p2State = 'red';

      if (t < t1) {
        p1State = 'green';
        p2State = 'red';
      } else if (t < t2) {
        p1State = 'amber';
        p2State = 'red';
      } else if (t < t3) {
        p1State = 'red';
        p2State = 'red';
      } else if (t < t4) {
        p1State = 'red';
        p2State = 'green';
      } else if (t < t5) {
        p1State = 'red';
        p2State = 'amber';
      } else {
        p1State = 'red';
        p2State = 'red';
      }

      for (const e of sj.p1Edges) e.signalState = p1State;
      for (const e of sj.p2Edges) e.signalState = p2State;
    }
  }
}

/**
 * Camera Observation Manager
 * Associates cameras with nearby approach edges and tracks simulated detections.
 */
export class CameraObserver {
  constructor(data, graph) {
    this.cameras = [];
    this.observations = {};

    for (const c of data.cameras) {
      this.observations[c.id] = {
        count: 0,
        lastDetectionSimTime: null,
        lastArrivalSimTime: null,
        lastDetectionToArrivalSec: null
      };

      const targetSiteId = c.downstreamSignal ? c.downstreamSignal.site : c.site;
      const targetSite = data.sites.find(s => s.id === targetSiteId);
      const isBusTerminal = c.site.endsWith('-bus');

      // Find best approaching edge(s) for this camera
      const matchingEdges = [];
      let bestDist = Infinity;
      let bestMatch = null;

      for (const e of graph.edges) {
        const toNode = graph.nodes[e.to];
        const fromNode = graph.nodes[e.from];
        const dFrom = Math.hypot(fromNode.pos[0] - targetSite.pos[0], fromNode.pos[1] - targetSite.pos[1]);
        const dTo = Math.hypot(toNode.pos[0] - targetSite.pos[0], toNode.pos[1] - targetSite.pos[1]);

        // Moving towards target site (or bus terminal facility)
        if (dTo < dFrom || isBusTerminal) {
          for (const sub of e.subsegments) {
            const midX = (sub.p1[0] + sub.p2[0]) / 2;
            const midZ = (sub.p1[1] + sub.p2[1]) / 2;
            const dist = Math.hypot(midX - c.pos[0], midZ - c.pos[1]);
            if (dist < 3.8 && dist < bestDist) {
              bestDist = dist;
              bestMatch = { edge: e, distAlongEdge: sub.startDist + sub.len / 2 };
            }
          }
        }
      }

      if (bestMatch) {
        matchingEdges.push(bestMatch);
      }

      this.cameras.push({
        id: c.id,
        site: c.site,
        pos: c.pos,
        angle: c.angle,
        targetSiteId,
        downstreamSignal: c.downstreamSignal || null,
        matchingEdges
      });
    }
  }

  onVehicleMove(vehicle, edge, prevS, newS, simTime) {
    for (const cam of this.cameras) {
      if (vehicle.observedCameras.has(cam.id)) continue;

      for (const match of cam.matchingEdges) {
        if (match.edge.id === edge.id) {
          // Check if crossed detection line
          if (prevS <= match.distAlongEdge && newS >= match.distAlongEdge) {
            vehicle.observedCameras.add(cam.id);
            const obs = this.observations[cam.id];
            obs.count++;
            obs.lastDetectionSimTime = simTime;
            vehicle.cameraDetections[cam.id] = simTime;
          }
        }
      }
    }
  }

  onVehicleArriveAtSignal(vehicle, siteId, simTime) {
    for (const cam of this.cameras) {
      if (cam.downstreamSignal && cam.downstreamSignal.site === siteId) {
        const detectTime = vehicle.cameraDetections[cam.id];
        if (detectTime != null) {
          const diff = simTime - detectTime;
          if (diff >= 0) {
            const obs = this.observations[cam.id];
            obs.lastArrivalSimTime = simTime;
            obs.lastDetectionToArrivalSec = Math.round(diff * 10) / 10;
          }
          delete vehicle.cameraDetections[cam.id];
        }
      }
    }
  }

  getObservation(camId) {
    return this.observations[camId] || { count: 0, lastDetectionToArrivalSec: null };
  }
}

/**
 * Main Traffic Simulation Engine
 */
export class TrafficSimulation {
  constructor(data) {
    this.data = data;
    this.seed = 42;
    this.rng = createRNG(this.seed);
    this.graph = buildTrafficGraph(data);
    this.signals = new DemonstrationSignalController(this.graph, data);
    this.cameraObserver = new CameraObserver(data, this.graph);
    this.profilePool = new ProfilePool(this.rng);

    this.vehicles = [];
    this.vehicleIdCounter = 1;
    this.selectedVehicle = null;

    // Simulation Clock & State
    this.running = false;
    this.simTime = 8 * 3600 + 30 * 60; // 08:30:00 simulated clock
    this.timeScale = 1.0;              // 1x, 2x, 4x
    this.density = 'medium';           // 'low' (15 max), 'medium' (28 max), 'high' (45 max)
    this.targetVehicleCap = 28;
    this.spawnTimer = 0;
    this.fixedDt = 0.05;               // 50ms fixed physics timestep

    // Statistics
    this.stats = {
      totalSpawns: 0,
      completedTrips: 0
    };

    // Identify entry and exit candidate nodes
    this.setupDemandEntries();
    // Start background check for Ollama backend
    this.profilePool.checkBackend().catch(() => {});
  }

  setupDemandEntries() {
    this.entryNodes = [];
    this.exitNodes = [];

    // Find peripheral boundary nodes (degree 1 or edges of the map)
    for (const node of this.graph.nodes) {
      if (node.edges.length === 1 || node.incoming.length === 1) {
        let weight = 1.0;
        // Prioritize major external corridors
        if (node.pos[0] < -180) weight = 3.5; // Western NH766 entry
        else if (node.pos[0] > 100) weight = 3.0; // Eastern NH766 entry
        else if (node.pos[1] < -50) weight = 2.5; // Northern Pulpally entry
        else if (node.pos[1] > 60) weight = 2.5; // Southern Chulliyode entry

        this.entryNodes.push({ id: node.id, weight });
        this.exitNodes.push(node.id);
      }
    }

    // Bus terminals also act as entrance & exit
    const townBus = this.graph.nodes.find(n => n.siteId === 'town-bus');
    if (townBus) {
      this.entryNodes.push({ id: townBus.id, weight: 2.0, busOnly: true });
      this.exitNodes.push(townBus.id);
    }
    const chungamBus = this.graph.nodes.find(n => n.siteId === 'chungam-bus');
    if (chungamBus) {
      this.entryNodes.push({ id: chungamBus.id, weight: 2.0, busOnly: true });
      this.exitNodes.push(chungamBus.id);
    }
  }

  setDensity(level) {
    this.density = level;
    if (level === 'low') this.targetVehicleCap = 15;
    else if (level === 'high') this.targetVehicleCap = 45;
    else this.targetVehicleCap = 28;
  }

  setTimeScale(scale) {
    this.timeScale = Math.max(0.5, Math.min(scale, 4.0));
  }

  setSeed(seed) {
    this.seed = parseInt(seed, 10) || 42;
    this.reset();
  }

  start() {
    this.running = true;
  }

  pause() {
    this.running = false;
  }

  resume() {
    this.running = true;
  }

  reset() {
    this.running = false;
    this.simTime = 8 * 3600 + 30 * 60;
    this.spawnTimer = 0;
    this.rng = createRNG(this.seed);
    this.profilePool.setSeed(this.seed);

    // Clear all vehicles from edges
    for (const e of this.graph.edges) {
      e.vehicles.length = 0;
    }
    this.vehicles = [];
    this.selectedVehicle = null;
    this.stats.totalSpawns = 0;
    this.stats.completedTrips = 0;

    // Reset camera counts
    for (const camId in this.cameraObserver.observations) {
      const obs = this.cameraObserver.observations[camId];
      obs.count = 0;
      obs.lastDetectionSimTime = null;
      obs.lastArrivalSimTime = null;
      obs.lastDetectionToArrivalSec = null;
    }
  }

  getSimTimeFormatted() {
    const totalSec = Math.floor(this.simTime);
    const hrs = Math.floor(totalSec / 3600) % 24;
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  spawnVehicle() {
    if (this.vehicles.length >= this.targetVehicleCap) return false;
    if (!this.entryNodes.length || !this.exitNodes.length) return false;

    // Pick entry node by synthetic demand weight
    const totalWeight = this.entryNodes.reduce((sum, e) => sum + e.weight, 0);
    let r = this.rng() * totalWeight;
    let entry = this.entryNodes[0];
    for (const e of this.entryNodes) {
      r -= e.weight;
      if (r <= 0) { entry = e; break; }
    }

    const startNode = this.graph.nodes[entry.id];
    if (!startNode.edges.length) return false;

    // Pick a starting edge
    const startEdge = startNode.edges[Math.floor(this.rng() * startNode.edges.length)];

    // Check entry room: must have at least 1.2 units free at beginning of edge
    if (startEdge.vehicles.length > 0) {
      const firstCar = startEdge.vehicles[0];
      if (firstCar.s < 1.2) {
        return false; // insufficient room, skip spawn
      }
    }

    // Pick a connected destination node
    let destNodeId = this.exitNodes[Math.floor(this.rng() * this.exitNodes.length)];
    if (destNodeId === startNode.id) {
      destNodeId = this.exitNodes[(Math.floor(this.rng() * this.exitNodes.length) + 1) % this.exitNodes.length];
    }

    // Find route
    const route = this.graph.findPath(startEdge.to, destNodeId);
    if (!route || route.length === 0) return false;
    const fullRoute = [startEdge, ...route];

    // Pick vehicle class
    let className = 'hatchback';
    if (entry.busOnly) {
      className = this.rng() < 0.85 ? 'bus' : 'sedan';
    } else {
      const cr = this.rng();
      if (cr < 0.35) className = 'hatchback';
      else if (cr < 0.60) className = 'sedan';
      else if (cr < 0.80) className = 'suv';
      else if (cr < 0.90) className = 'bus';
      else className = 'truck';
    }

    const vClass = VEHICLE_CLASSES[className];
    const color = vClass.colors[Math.floor(this.rng() * vClass.colors.length)];

    // Assign driver personality profile (from Ollama pool or seeded generator)
    const profile = this.profilePool.getProfile();

    const vehicle = {
      id: `v-${this.vehicleIdCounter++}`,
      class: className,
      vClass,
      color,
      profile,
      route: fullRoute,
      routeIdx: 0,
      s: 0.1, // distance along current edge
      speed: 0.2 + this.rng() * 0.4, // initial speed
      accel: 0,
      state: 'cruising',
      observedCameras: new Set(),
      cameraDetections: {},
      pos: startEdge.sample(0.1)
    };

    startEdge.vehicles.push(vehicle);
    this.vehicles.push(vehicle);
    this.stats.totalSpawns++;
    return true;
  }

  step(rawDeltaTime) {
    if (!this.running) return;

    // Clamp delta time to avoid large jumps on tab switch
    const dt = Math.min(rawDeltaTime, 0.1) * this.timeScale;
    this.simTime += dt;

    // Update demonstration signals
    this.signals.update(this.simTime);

    // Spawn management
    this.spawnTimer += dt;
    const spawnInterval = this.density === 'high' ? 0.8 : this.density === 'low' ? 2.5 : 1.4;
    if (this.spawnTimer >= spawnInterval) {
      this.spawnTimer = 0;
      this.spawnVehicle();
    }

    // Physics step for all vehicles using IDM (Intelligent Driver Model)
    const deadVehicles = [];

    for (let vIdx = 0; vIdx < this.vehicles.length; vIdx++) {
      const v = this.vehicles[vIdx];
      const currentEdge = v.route[v.routeIdx];

      // Target speed on this road modified by driver's desiredSpeedFactor
      const v0 = Math.min(currentEdge.speedLimit * v.profile.desiredSpeedFactor, v.vClass.maxSpeed);
      const a = v.vClass.maxAccel * v.profile.accelPreference;
      const b = 0.22; // comfortable deceleration (~2.2 m/s²)
      const s0 = 0.35; // minimum jam gap (~3.5m)
      const T = v.profile.headwaySeconds;

      // 1. Find leading vehicle on the same edge
      let leader = null;
      let gap = Infinity;
      let deltaV = 0;

      // Current edge vehicles are kept sorted by s
      const edgeVehicles = currentEdge.vehicles;
      const myIdx = edgeVehicles.indexOf(v);
      if (myIdx !== -1 && myIdx < edgeVehicles.length - 1) {
        leader = edgeVehicles[myIdx + 1];
        gap = leader.s - v.s - leader.vClass.length;
        deltaV = v.speed - leader.speed;
      }

      // 2. If no leader on same edge, check stop line / junction rules
      const remainingOnEdge = currentEdge.length - v.s;
      let junctionStop = false;
      let junctionYield = false;

      if (!leader && remainingOnEdge < 6.0) {
        const nextEdge = v.route[v.routeIdx + 1];

        // Is this a signalized junction?
        if (currentEdge.signalState === 'red') {
          junctionStop = true;
        } else if (currentEdge.signalState === 'amber') {
          // Can vehicle stop comfortably before stop line?
          const stopDist = (v.speed * v.speed) / (2 * b);
          if (remainingOnEdge > stopDist * 0.9) {
            junctionStop = true;
          }
        }

        // "Don't block the box" rule: if green or unsignalized, check if next edge has room at entry
        if (!junctionStop && nextEdge) {
          if (nextEdge.vehicles.length > 0) {
            const firstOnNext = nextEdge.vehicles[0];
            if (firstOnNext.s < firstOnNext.vClass.length + 0.5 && firstOnNext.speed < 0.1) {
              junctionStop = true; // exit is queued, do not enter junction
            }
          }
        }

        // Unsignalized junction yielding:
        if (!junctionStop && nextEdge) {
          const junctionNode = this.graph.nodes[currentEdge.to];
          if (junctionNode && !junctionNode.isSignal && junctionNode.isJunction) {
            // Check higher-priority conflicting traffic
            for (const inc of junctionNode.incoming) {
              if (inc.id !== currentEdge.id && inc.priority > currentEdge.priority) {
                // Check if any car is approaching the junction on the higher priority road
                const incLeader = inc.vehicles[inc.vehicles.length - 1];
                if (incLeader && (inc.length - incLeader.s) < incLeader.speed * v.profile.gapAcceptance + 1.5) {
                  junctionYield = true;
                  break;
                }
              }
            }
          }
        }

        // Apply virtual leader at stop line if stopping or yielding
        if (junctionStop || junctionYield) {
          const stopLineGap = Math.max(0.01, remainingOnEdge - 0.4);
          if (stopLineGap < gap) {
            gap = stopLineGap;
            deltaV = v.speed - 0; // stop line is stationary
            leader = { vClass: { length: 0 }, speed: 0, s: currentEdge.length - 0.4 };
          }
        } else if (nextEdge && nextEdge.vehicles.length > 0) {
          // Lookahead to first car on next edge
          const nextLeader = nextEdge.vehicles[0];
          const lookaheadGap = remainingOnEdge + nextLeader.s - nextLeader.vClass.length;
          if (lookaheadGap < gap) {
            gap = lookaheadGap;
            deltaV = v.speed - nextLeader.speed;
            leader = nextLeader;
          }
        }
      }

      // 3. IDM Acceleration formula
      gap = Math.max(0.02, gap);
      const sStar = s0 + Math.max(0, v.speed * T + (v.speed * deltaV) / (2 * Math.sqrt(a * b)));
      let accel = a * (1 - Math.pow(v.speed / v0, 4) - Math.pow(sStar / gap, 2));

      // Emergency braking limit
      if (gap < 0.2) {
        accel = -0.55;
      }
      accel = Math.max(-0.60, Math.min(accel, a));

      // Update speed and position
      v.accel = accel;
      v.speed = Math.max(0, v.speed + accel * dt);
      const prevS = v.s;
      v.s += v.speed * dt;

      // Update state for inspector
      if (v.speed < 0.05 && junctionStop) {
        v.state = 'waiting at signal';
      } else if (v.speed < 0.05 && junctionYield) {
        v.state = 'yielding at junction';
      } else if (gap < sStar + 0.4 && v.speed < v0 * 0.85) {
        v.state = 'following';
      } else if (junctionStop && v.speed >= 0.05) {
        v.state = 'approaching stop';
      } else {
        v.state = 'cruising';
      }

      // Camera observation check
      this.cameraObserver.onVehicleMove(v, currentEdge, prevS, v.s, this.simTime);

      // Handle edge completion & junction transition
      if (v.s >= currentEdge.length) {
        // Did vehicle reach a candidate signal site?
        const toNode = this.graph.nodes[currentEdge.to];
        if (toNode && toNode.siteId) {
          this.cameraObserver.onVehicleArriveAtSignal(v, toNode.siteId, this.simTime);
        }

        // Transition to next edge in route
        v.routeIdx++;
        if (v.routeIdx < v.route.length) {
          // Remove from old edge
          const oldIdx = currentEdge.vehicles.indexOf(v);
          if (oldIdx !== -1) currentEdge.vehicles.splice(oldIdx, 1);

          // Add to new edge
          const newEdge = v.route[v.routeIdx];
          v.s = v.s - currentEdge.length;
          newEdge.vehicles.push(v);
          // Keep newEdge vehicles sorted by s
          newEdge.vehicles.sort((c1, c2) => c1.s - c2.s);
        } else {
          // Vehicle reached its destination!
          deadVehicles.push(v);
        }
      }

      // Sample 3D world coordinates along lane
      v.pos = currentEdge.sample(v.s);
    }

    // Clean up vehicles that reached their destination
    for (const dead of deadVehicles) {
      const lastEdge = dead.route[dead.routeIdx] || dead.route[dead.route.length - 1];
      const idx = lastEdge.vehicles.indexOf(dead);
      if (idx !== -1) lastEdge.vehicles.splice(idx, 1);

      const allIdx = this.vehicles.indexOf(dead);
      if (allIdx !== -1) this.vehicles.splice(allIdx, 1);

      if (this.selectedVehicle === dead) {
        this.selectedVehicle = null;
      }
      this.stats.completedTrips++;
    }

    // Ensure edge vehicle lists remain strictly sorted by position s
    for (const e of this.graph.edges) {
      if (e.vehicles.length > 1) {
        e.vehicles.sort((c1, c2) => c1.s - c2.s);
      }
    }
  }
}
