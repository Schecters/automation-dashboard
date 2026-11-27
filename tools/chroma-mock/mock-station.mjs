// ==========================================
// 🧪 คอมเทสจำลอง (Chroma Station App ปลอม) สำหรับทดสอบหน้า /chroma — ไม่ต่อเครื่องจริง ไม่จ่ายไฟ
//  ตอบตามสัญญา API ใน D:\Chroma DCR\CLAUDE.md: HTTPS /api/v1/*, SSE /events, X-Api-Key
//  + ส่ง event ขึ้น server (/api/chroma/ingest, /heartbeat) ถ้าใส่ --server --station --key
//
//  ใช้: node tools/chroma-mock/mock-station.mjs --port 8443 --key <API key> [--server https://localhost:5173 --station 1]
//  certificate self-signed สร้างครั้งแรกด้วย openssl (มากับ Git for Windows) เก็บที่ tools/chroma-mock/.cert/
// ==========================================
import https from 'https';
import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith('--') ? [...acc, [a.slice(2), arr[i + 1]?.startsWith('--') ? 'true' : arr[i + 1] ?? 'true']] : acc), [])
);
const PORT = Number(args.port || 8443);
let API_KEY = args.key || process.env.CHROMA_MOCK_KEY || '';
const SERVER = (args.server || '').replace(/\/+$/, '');
const STATION_ID = args.station || '';
const DIR = path.dirname(fileURLToPath(import.meta.url));
const CERT_DIR = path.join(DIR, '.cert');

// ---------- certificate ----------
const keyFile = path.join(CERT_DIR, 'key.pem');
const certFile = path.join(CERT_DIR, 'cert.pem');
if (!fs.existsSync(certFile)) {
  fs.mkdirSync(CERT_DIR, { recursive: true });
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '3650', '-subj', '/CN=ChromaStationMock',
    '-keyout', keyFile, '-out', certFile], { stdio: 'ignore' });
}
const certPem = fs.readFileSync(certFile, 'utf8');
const fp = new crypto.X509Certificate(certPem).fingerprint256.replace(/:/g, '');

// ---------- เครื่องจำลอง ----------
const MODE_LABEL = { DCR: 'DC Resistance', AC: 'AC Withstand', IWT: 'Impulse Winding' };
const P = (path, label, unit, kind, min, max, value, section, extra = {}) => ({ path, label, unit, kind, min, max, section, value, ...extra });
const newStep = (mode) =>
  mode === 'DCR'
    ? [P('LIM:HIGH', 'High', 'Ω', 'Number', 1e-4, 2e6, 1.6, 'Limit'), P('LIM:LOW', 'Low', 'Ω', 'Number', 1e-4, 2e6, 1.25, 'Limit', { tokens: ['OFF'] }),
       P('TIME:TEST', 'Test', 's', 'Number', 0.1, 999, 0.5, 'Time', { tokens: ['KEY'] })]
    : mode === 'AC'
      ? [P('LEV', 'Voltage', 'V', 'Number', 50, 5000, 1500, 'Output'), P('LIM:HIGH', 'High', 'A', 'Number', 0, 0.12, 0.005, 'Limit'),
         P('TIME:TEST', 'Test', 's', 'Number', 0.3, 999, 1, 'Time', { tokens: ['CONT'] })]
      : [P('LEV', 'Voltage', 'V', 'Number', 100, 6000, 1500, 'Output'), P('WIDT', 'Width (sampling)', '', 'Int', 1, 11, 6, 'Output'),
         P('AREA:SCOP:BEG', 'Area begin', '', 'Int', 1, 512, 120, 'Area'), P('AREA:SCOP:END', 'Area end', '', 'Int', 1, 512, 400, 'Area'),
         P('AREA:LIM:PLUS', 'Area LIMIT+', '', 'Number', 0, 1, 0.1, 'Area', { percent: true }),
         P('FLUT:SCOP:BEG', 'Flutter begin', '', 'Int', 1, 512, 150, 'Flutter'), P('FLUT:SCOP:END', 'Flutter end', '', 'Int', 1, 512, 300, 'Flutter'),
         P('LAPL:SCOP:BEG', 'Laplac begin', '', 'Int', 1, 512, 160, 'Laplac'), P('LAPL:SCOP:END', 'Laplac end', '', 'Int', 1, 512, 260, 'Laplac')];
const memories = new Map([
  [1, { name: '9UMA1120', steps: ['DCR', 'AC', 'IWT'] }],
  [11, { name: 'WEB-TEST', steps: ['DCR'] }],
]);
let memoryNo = 1;
let steps = memories.get(1).steps.map((m) => ({ mode: m, params: newStep(m) }));
let mode = 'Manual';
let state = 'Idle';
let hvTokens = new Map();
let plcConfig = { ip: '192.168.1.10', port: 502, unitId: 1, series: 'DVP', mCoilBase: 2048, dRegBase: 4096, signals: {} };
let lastRun = null;
const today = { total: 0, pass: 0, fail: 0 };
let runTimer = null;
const sampleWave = Array.from({ length: 512 }, (_, i) => (i < 120 ? 1000 * Math.cos((i / 120) * Math.PI) : 800 * Math.exp(-(i - 120) / 160) * Math.cos((i - 120) / 9)));
let lastWave = null;

const fmt = (p) => (p.percent ? `${+(p.value * 100).toFixed(2)}%` : String(p.value));
const stepDef = (i) => ({
  main: i + 1, sub: null, mode: steps[i].mode, modeLabel: MODE_LABEL[steps[i].mode], subCount: 0,
  params: steps[i].params.map((p) => ({ path: p.path, label: p.label, unit: p.unit, kind: p.kind, min: p.min, max: p.max,
    percent: !!p.percent, tokens: p.tokens || [], choices: [], section: p.section, note: '', display: fmt(p), edit: fmt(p), error: null })),
});
const status = () => ({
  stationId: STATION_ID || null, name: 'MOCK-01', version: 'mock-1.0', mode, state, busy: null, warning: null,
  connected: { chroma: true, plc: true, server: !!SERVER }, idn: { raw: 'Chroma,19036,MOCK,3.04', firmware: '3.04' },
  memory: { no: memoryNo, name: memories.get(memoryNo)?.name || '', steps: steps.length },
  plc: { heartbeat: Math.floor(Date.now() / 1000) % 32768, start: 0, busy: state === 'Running' ? 1 : 0, done: 0, error: 0 },
  lastRun, today, outboxPending: outbox.length, certSha256: fp,
});

// ---------- SSE ----------
const clients = new Set();
const push = (type, data) => {
  for (const res of clients) res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
};

// ---------- ส่งขึ้น server ----------
const outbox = [];
const addEvent = (type, data, user, source = 'WEB') =>
  outbox.push({ id: crypto.randomUUID(), type, at: new Date().toISOString(), employeeId: user || null, source, data });
// server dev ใช้ cert self-signed ของ vite → สคริปต์ทดสอบนี้ไม่ตรวจ cert ของ server (เฉพาะ request นี้)
const postServer = (pathname, body) =>
  new Promise((resolve, reject) => {
    const u = new URL(`${SERVER}${pathname}`);
    const data = Buffer.from(JSON.stringify(body));
    const req = (u.protocol === 'https:' ? https : http).request(
      { host: u.hostname, port: u.port, path: u.pathname, method: 'POST', rejectUnauthorized: false,
        headers: { 'Content-Type': 'application/json', 'Content-Length': data.length, 'X-Station-Id': String(STATION_ID), 'X-Api-Key': API_KEY } },
      (res) => {
        let t = '';
        res.on('data', (c) => (t += c));
        res.on('end', () => { let b = null; try { b = JSON.parse(t); } catch { /* */ } resolve({ status: res.statusCode, body: b }); });
      }
    );
    req.on('error', reject);
    req.end(data);
  });
if (SERVER) {
  setInterval(async () => {
    if (!outbox.length) return;
    try {
      const batch = outbox.slice(0, 100);
      const r = await postServer('/api/chroma/ingest', { events: batch });
      const ok = new Set(r.body?.accepted || []);
      for (let i = outbox.length - 1; i >= 0; i--) if (ok.has(outbox[i].id)) outbox.splice(i, 1);
      console.log(`ingest ${r.status}: accepted ${ok.size}/${batch.length}`);
    } catch (e) {
      console.log('ingest error', e.message);
    }
  }, 3000);
  const hb = () => postServer('/api/chroma/heartbeat', { version: 'mock-1.0', port: PORT, mode, state, memory: status().memory, outboxPending: outbox.length })
    .then((r) => console.log('heartbeat', r.status)).catch((e) => console.log('heartbeat error', e.message));
  hb();
  setInterval(hb, 30000);
}

// ---------- เทสจำลอง ----------
const finishRun = (run, result) => {
  clearInterval(runTimer);
  runTimer = null;
  state = 'Idle';
  run.endedAt = new Date().toISOString();
  run.result = result;
  lastRun = run;
  today.total++;
  if (result === 'PASS') today.pass++;
  if (result === 'FAIL') today.fail++;
  if (steps.some((s) => s.mode === 'IWT')) lastWave = sampleWave.map((v) => v * (1 + (Math.random() - 0.5) * 0.06));
  addEvent('test_run', run, run.employeeId, run.source);
  push('runCompleted', run);
  push('status', status());
};
const startRun = (sn, user, source = 'WEB') => {
  state = 'Running';
  const failAt = args.fail ? Number(args.fail) : 0;
  const run = { startedAt: new Date().toISOString(), sn: sn || '', memoryNo, memoryName: memories.get(memoryNo)?.name || '', source, employeeId: user,
    result: null, failStep: 0, failCode: null, failText: null, steps: [] };
  push('runStarted', run);
  push('status', status());
  let i = 0;
  runTimer = setInterval(() => {
    const s = steps[i];
    const failed = failAt === i + 1;
    push('live', { step: i + 1, mode: s.mode, met1: s.mode === 'DCR' ? 1.4 + Math.random() * 0.05 : 1500, met2: s.mode === 'AC' ? 0.001 : null, remaining: 0.5 });
    run.steps.push({ stepNo: i + 1, mode: s.mode, outcome: failed ? 'FAIL' : 'PASS', stateCodes: failed ? '502' : '6', text: failed ? 'DCR HIGH FAIL' : 'PASS',
      mets: [{ label: 'R', unit: 'Ω', raw: '1.42' }], testTime: 0.5 });
    if (failed) {
      Object.assign(run, { failStep: i + 1, failCode: '502', failText: 'DCR HIGH FAIL' });
      return finishRun(run, 'FAIL');
    }
    if (++i >= steps.length) finishRun(run, 'PASS');
  }, 800);
};

// ---------- HTTP ----------
const send = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
};
const err = (res, code, msg) => send(res, code, { error: msg });
const readBody = (req) => new Promise((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { try { r(b ? JSON.parse(b) : {}); } catch { r(null); } }); });
const keyOk = (k) => API_KEY && k && crypto.timingSafeEqual(crypto.createHash('sha256').update(k).digest(), crypto.createHash('sha256').update(API_KEY).digest());
const takeToken = (t) => { const at = hvTokens.get(t); hvTokens.delete(t); return at && Date.now() - at < 15000; };

const server = https.createServer({ key: fs.readFileSync(keyFile), cert: certPem }, async (req, res) => {
  const url = new URL(req.url, 'https://x');
  const p = url.pathname.replace(/^\/api\/v1/, '');
  if (!url.pathname.startsWith('/api/v1/')) return err(res, 404, 'ไม่มี path นี้');
  if (!keyOk(req.headers['x-api-key'])) return err(res, 401, 'X-Api-Key ไม่ถูกต้อง');
  const user = req.headers['x-user'] || null;
  const m = req.method;
  const body = ['POST', 'PUT'].includes(m) ? await readBody(req) : {};
  if (body === null) return err(res, 400, 'JSON ไม่ถูกต้อง');
  const manualOnly = () => { if (mode !== 'Manual') { err(res, 409, 'โหมด Auto — ทำจากเว็บไม่ได้'); return false; } if (state !== 'Idle') { err(res, 409, 'เครื่องไม่ว่าง'); return false; } return true; };
  let mm;

  if (m === 'GET' && p === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(`event: status\ndata: ${JSON.stringify(status())}\n\n`);
    clients.add(res);
    const ka = setInterval(() => res.write(': ka\n\n'), 15000);
    req.on('close', () => { clients.delete(res); clearInterval(ka); });
    return;
  }
  if (m === 'GET' && p === '/status') return send(res, 200, status());
  if (m === 'GET' && p === '/programs') {
    const from = Number(url.searchParams.get('from') || 1), count = Math.min(Number(url.searchParams.get('count') || 20), 50);
    return send(res, 200, Array.from({ length: count }, (_, k) => from + k).filter((n) => n <= 200)
      .map((n) => ({ index: n, name: memories.get(n)?.name || '', steps: memories.get(n)?.steps.length || 0 })));
  }
  if (m === 'POST' && (mm = p.match(/^\/programs\/(\d+)\/(recall|save)$/))) {
    if (!manualOnly()) return;
    const n = Number(mm[1]);
    if (mm[2] === 'recall') {
      if (!memories.has(n)) return err(res, 400, `memory ${n} ว่าง`);
      memoryNo = n;
      steps = memories.get(n).steps.map((x) => ({ mode: x, params: newStep(x) }));
      addEvent('memory_recall', { memoryNo: n, name: memories.get(n).name }, user);
      push('status', status());
      return send(res, 200, { ok: true, total: steps.length, errors: [] });
    }
    const name = String(body.name || memories.get(n)?.name || `MEM${n}`);
    memories.set(n, { name, steps: steps.map((s) => s.mode) });
    memoryNo = n;
    addEvent('memory_save', { memoryNo: n, name }, user);
    return send(res, 200, { ok: true, saved: true, errors: [] });
  }
  if (m === 'GET' && p === '/steps') return send(res, 200, { steps: steps.map((_, i) => stepDef(i)), main: steps.length, total: steps.length });
  if ((mm = p.match(/^\/steps\/(\d+)$/))) {
    const i = Number(mm[1]) - 1;
    if (!steps[i]) return err(res, 400, `ไม่มี step ${i + 1}`);
    if (m === 'GET') return send(res, 200, stepDef(i));
    if (m === 'DELETE') {
      if (!manualOnly()) return;
      addEvent('step_delete', { memoryNo, step: i + 1, mode: steps[i].mode }, user);
      steps.splice(i, 1);
      return send(res, 200, { ok: true, errors: [] });
    }
    if (m === 'PUT') {
      if (!manualOnly()) return;
      const results = Object.entries(body).map(([k, v]) => {
        const prm = steps[i].params.find((x) => x.path === k);
        if (!prm) return { path: k, ok: false, error: 'ไม่มีช่องนี้' };
        const old = fmt(prm);
        let n = String(v).trim().toUpperCase() === 'OFF' ? null : Number(String(v).replace('%', '')) / (String(v).includes('%') ? 100 : 1);
        if (n !== null && (Number.isNaN(n) || n < prm.min || n > prm.max)) return { path: k, ok: false, error: `ต้องอยู่ระหว่าง ${prm.min} – ${prm.max}` };
        prm.value = n === null ? 'OFF' : n;
        addEvent('param_change', { memoryNo, memoryName: memories.get(memoryNo)?.name, step: i + 1, sub: null, mode: steps[i].mode, path: k, label: prm.label, oldValue: old, newValue: fmt(prm) }, user);
        return { path: k, ok: true, display: fmt(prm) };
      });
      return send(res, 200, { step: stepDef(i), results, warning: steps[i].mode === 'IWT' ? 'เปลี่ยน Voltage / Width ของ IWT แล้ว — ต้องทำ SAMPLE GET ใหม่ก่อนเทส' : null });
    }
  }
  if (m === 'GET' && (mm = p.match(/^\/steps\/(\d+)\/waves$/))) {
    const s = steps[Number(mm[1]) - 1];
    if (!s) return err(res, 400, 'ไม่มี step นี้');
    if (s.mode !== 'IWT') return err(res, 400, `step ${mm[1]} เป็น ${s.mode} — กราฟ waveform ใช้กับ IWT / IWT COMPARE`);
    return send(res, 200, { mode: 'IWT', sample: sampleWave, last: lastWave });
  }
  if (m === 'POST' && p === '/hv/prepare') {
    const token = crypto.randomUUID();
    hvTokens.set(token, Date.now());
    return send(res, 200, { token, expiresInSec: 15 });
  }
  if (m === 'POST' && (mm = p.match(/^\/steps\/(\d+)\/sample$/))) {
    if (!manualOnly()) return;
    if (!takeToken(body.token)) return err(res, 400, 'token ยืนยันไม่ถูกต้อง / หมดอายุ');
    state = 'Operation';
    push('status', status());
    setTimeout(() => {
      state = 'Idle';
      addEvent('sample_get', { memoryNo, step: Number(mm[1]), mode: 'IWT', ok: true }, user);
      push('operationDone', { label: `SAMPLE GET step ${mm[1]}`, ok: true });
      push('status', status());
    }, 1500);
    return send(res, 200, { ok: true });
  }
  if (m === 'POST' && p === '/start') {
    if (!manualOnly()) return;
    if (!takeToken(body.token)) return err(res, 400, 'token ยืนยันไม่ถูกต้อง / หมดอายุ');
    startRun(body.sn, user);
    return send(res, 200, { ok: true });
  }
  if (m === 'POST' && p === '/stop') {
    if (runTimer && lastRun !== null) { /* ไม่มีผล */ }
    if (runTimer) {
      clearInterval(runTimer);
      runTimer = null;
      state = 'Idle';
      const run = { startedAt: new Date().toISOString(), endedAt: new Date().toISOString(), sn: '', memoryNo, memoryName: memories.get(memoryNo)?.name || '', result: 'ABORT', failStep: 0, steps: [] };
      lastRun = run;
      addEvent('test_run', run, user);
      push('runCompleted', run);
    }
    push('status', status());
    return send(res, 200, { ok: true });
  }
  if (m === 'PUT' && p === '/mode') {
    if (state !== 'Idle') return err(res, 409, 'สลับโหมดได้เฉพาะตอนเครื่องว่าง');
    if (!['Manual', 'Auto'].includes(body.mode)) return err(res, 400, 'mode ต้องเป็น Manual / Auto');
    addEvent('mode_change', { from: mode, to: body.mode }, user);
    mode = body.mode;
    push('status', status());
    return send(res, 200, { ok: true, mode });
  }
  if (p === '/config/plc') {
    if (m === 'GET') return send(res, 200, plcConfig);
    if (m === 'PUT') {
      if (!manualOnly()) return;
      plcConfig = body;
      addEvent('plc_config', { config: body }, user);
      return send(res, 200, plcConfig);
    }
  }
  err(res, 404, 'ไม่มีคำสั่งนี้');
});

// โหมด Auto: จำลอง PLC สั่ง Start ทุก 10 วิ (ใส่ --auto-every <วิ>)
if (args['auto-every']) setInterval(() => { if (mode === 'Auto' && state === 'Idle') startRun('', null, 'PLC'); }, Number(args['auto-every']) * 1000);

server.listen(PORT, () => {
  console.log(`คอมเทสจำลองพร้อมที่ https://localhost:${PORT}/api/v1  (cert SHA-256 ${fp})`);
  if (!API_KEY) console.log('⚠️ ยังไม่ได้ใส่ --key: ทุก request จะได้ 401');
});
