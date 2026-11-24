import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read .env if present (without external dependencies)
function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    try {
      const content = fs.readFileSync(envPath, 'utf8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx !== -1) {
          const k = trimmed.slice(0, eqIdx).trim();
          const v = trimmed.slice(eqIdx + 1).trim().replace(/^['"]|['"]$/g, '');
          if (!process.env[k]) {
            process.env[k] = v;
          }
        }
      }
    } catch (e) {
      // Ignore env read errors
    }
  }
}
loadEnv();

const PORT = parseInt(process.env.PORT || process.argv[2] || '8080', 10);
const HOST = '127.0.0.1'; // strictly loopback

const OLLAMA_API_KEY = process.env.OLLAMA_API_KEY || process.env.api_key || '';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || process.env.model || (OLLAMA_API_KEY ? 'glm-5.3-flash:cloud' : 'llama3.2');
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.geojson': 'application/geo+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

const STYLES = ['cautious', 'steady', 'patient', 'brisk'];

function sanitizeText(str, maxLen = 140) {
  if (typeof str !== 'string') return '';
  return str.replace(/<[^>]*>?/gm, '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, maxLen);
}

function clamp(val, min, max, fallback) {
  const num = parseFloat(val);
  if (Number.isNaN(num)) return fallback;
  return Math.min(Math.max(num, min), max);
}

function validateAndCleanProfiles(rawArray) {
  if (!Array.isArray(rawArray)) return [];
  const cleaned = [];
  for (const item of rawArray) {
    if (!item || typeof item !== 'object') continue;
    const nickname = sanitizeText(item.nickname || item.name || '', 32);
    const description = sanitizeText(item.description || item.bio || item.character || '', 160);
    const rawStyle = String(item.drivingStyle || item.style || '').toLowerCase().trim();
    const drivingStyle = STYLES.includes(rawStyle) ? rawStyle : 'steady';

    const desiredSpeedFactor = clamp(item.desiredSpeedFactor || item.speedMultiplier, 0.75, 1.30, 1.0);
    const headwaySeconds = clamp(item.headwaySeconds || item.headway, 1.0, 3.0, 1.8);
    const accelPreference = clamp(item.accelPreference || item.accel, 0.5, 1.3, 0.9);
    const gapAcceptance = clamp(item.gapAcceptance || item.safeGap, 1.5, 4.0, 2.2);

    if (nickname) {
      cleaned.push({
        id: 'ollama-' + Math.random().toString(36).slice(2, 9),
        nickname,
        description: description || 'A simulated driver traveling across Sulthan Bathery.',
        drivingStyle,
        desiredSpeedFactor,
        headwaySeconds,
        accelPreference,
        gapAcceptance,
        source: 'ollama'
      });
    }
  }
  return cleaned;
}

let activeRequest = null;

async function queryOllama(count = 5) {
  if (activeRequest) {
    return activeRequest;
  }

  const promptBrief = `Generate a JSON array of exactly ${count} fictional driver characters for a traffic simulation in Kerala, India.
Each element must be a JSON object with these exact keys:
- "nickname": a short 2-word fictional nickname (e.g. "Swift Appu", "Gentle Mary", "Rush Rahul", "Steady Shaji", "Calm Deepa", "Patient Paul")
- "description": a one-sentence fictional backstory or destination in Bathery (plain text only)
- "drivingStyle": one of "cautious", "steady", "patient", "brisk"
- "desiredSpeedFactor": number between 0.85 and 1.20
- "headwaySeconds": number between 1.1 and 2.8
- "accelPreference": number between 0.6 and 1.25
- "gapAcceptance": number between 1.6 and 3.5

Output ONLY the JSON array. Do not include markdown code fences or explanatory prose.`;

  activeRequest = (async () => {
    // 1. Try Ollama Cloud if API key is present
    if (OLLAMA_API_KEY) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      try {
        const cloudUrl = 'https://ollama.com/api/chat';
        const response = await fetch(cloudUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${OLLAMA_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: OLLAMA_MODEL,
            messages: [
              { role: 'system', content: 'You are a character generator for an interactive traffic model. Output only a valid JSON array.' },
              { role: 'user', content: promptBrief }
            ],
            stream: false
          }),
          signal: controller.signal
        });

        if (response.ok) {
          const data = await response.json();
          const parsed = tryParseJSON(data.message?.content);
          const valid = validateAndCleanProfiles(parsed);
          if (valid.length > 0) {
            return { ok: true, source: 'ollama-cloud', count: valid.length, profiles: valid };
          }
        } else {
          console.warn(`[Ollama Cloud] Status ${response.status}. Attempting local Ollama fallback if available...`);
        }
      } catch (err) {
        console.warn(`[Ollama Cloud] Request error: ${err.name === 'AbortError' ? 'timeout' : err.message}. Checking local Ollama...`);
      } finally {
        clearTimeout(timeoutId);
      }
    }

    // 2. Try Local Ollama (e.g. 127.0.0.1:11434)
    const localController = new AbortController();
    const localTimeoutId = setTimeout(() => localController.abort(), 8000);
    try {
      // Find a local model (smollm:135m, llama3.2, etc.)
      let localModel = OLLAMA_MODEL && !OLLAMA_MODEL.includes(':cloud') ? OLLAMA_MODEL : 'smollm:135m';
      try {
        const tagsRes = await fetch(`${OLLAMA_HOST.replace(/\/+$/, '')}/api/tags`, { signal: AbortSignal.timeout(1500) });
        if (tagsRes.ok) {
          const tagData = await tagsRes.json();
          const nonCloud = tagData.models?.find(m => !m.name.includes(':cloud'));
          if (nonCloud) localModel = nonCloud.name;
        }
      } catch (e) {}

      const localUrl = `${OLLAMA_HOST.replace(/\/+$/, '')}/api/chat`;
      const response = await fetch(localUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: localModel,
          messages: [
            { role: 'system', content: 'You are a character generator for an interactive traffic model. Output only a valid JSON array.' },
            { role: 'user', content: promptBrief }
          ],
          format: 'json',
          stream: false
        }),
        signal: localController.signal
      });

      if (response.ok) {
        const data = await response.json();
        const parsed = tryParseJSON(data.message?.content);
        const valid = validateAndCleanProfiles(parsed);
        if (valid.length > 0) {
          return { ok: true, source: 'ollama-local', count: valid.length, profiles: valid };
        }
      }
    } catch (err) {
      // Local Ollama offline
    } finally {
      clearTimeout(localTimeoutId);
      activeRequest = null;
    }

    return { ok: false, error: 'Ollama unavailable', fallback: 'use_local' };
  })();

  return activeRequest;
}

function tryParseJSON(content) {
  if (!content) return null;
  try {
    return JSON.parse(content);
  } catch (e) {
    const match = content.match(/\[[\s\S]*\]/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch (e2) {}
    }
    return null;
  }
}

const server = http.createServer(async (req, res) => {
  // Enforce loopback check
  const remote = req.socket.remoteAddress;
  const isLoopback = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
  if (!isLoopback) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden: Loopback access only');
    return;
  }

  // Set CORS headers for loopback development
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const reqUrl = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
  const pathname = reqUrl.pathname;

  // API endpoints
  if (pathname === '/api/status' || pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      ollama: {
        configured: Boolean(OLLAMA_API_KEY || OLLAMA_HOST),
        type: OLLAMA_API_KEY ? 'cloud' : 'local',
        model: OLLAMA_MODEL
      }
    }));
    return;
  }

  if (pathname === '/api/profiles' || pathname === '/api/profiles/generate') {
    let count = 5;
    if (req.method === 'POST') {
      try {
        const bodyText = await new Promise(resolve => {
          let str = '';
          req.on('data', chunk => str += chunk);
          req.on('end', () => resolve(str));
        });
        if (bodyText) {
          const body = JSON.parse(bodyText);
          if (body.count) count = Math.min(Math.max(parseInt(body.count, 10), 1), 10);
        }
      } catch (e) {}
    } else {
      const qCount = parseInt(reqUrl.searchParams.get('count') || '5', 10);
      if (!Number.isNaN(qCount)) count = Math.min(Math.max(qCount, 1), 10);
    }

    const result = await queryOllama(count);
    res.writeHead(result.ok ? 200 : 503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
    return;
  }

  // Static file serving from dist/
  let filePath = path.join(__dirname, 'dist', pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, ''));
  filePath = path.normalize(filePath);

  // Security check: ensure path is inside dist/
  const distDir = path.join(__dirname, 'dist');
  if (!filePath.startsWith(distDir)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Access Denied');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  });
});

export { validateAndCleanProfiles, sanitizeText, clamp, queryOllama };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is already in use. Run with another port, e.g.: node server.js 8081`);
      process.exit(1);
    } else {
      console.error('Server error:', err);
    }
  });

  server.listen(PORT, HOST, () => {
    console.log(`Bathery Traffic Atlas server running at http://${HOST}:${PORT}/`);
    console.log(`Ollama configuration: ${OLLAMA_API_KEY ? 'Ollama Cloud' : 'Local Ollama'} (Model: ${OLLAMA_MODEL})`);
  });
}
