import express from 'express';
import crypto from 'crypto';
import { pool } from '../lib/db.js';
import { authenticateToken, requireRoles } from '../middleware/auth.js';
import { io, userRoom } from '../lib/realtime.js';
import {
  newApiKey, encryptKey, decryptKey, sameKey, normFp, fetchCert, validHost, validPort,
  stationRequest, openStationEvents, StationError, serverCertInfo,
} from '../lib/chromaStation.js';

// ==========================================
// 🔌 Chroma Tester (service chroma port 5006) — หน้า /chroma
//  - admin, me ลงทะเบียน / สั่งงานคอมเทส (C# Station App) ผ่าน proxy นี้เท่านั้น (เบราว์เซอร์ไม่ต่อคอมเทสตรง)
//  - คอมเทสส่ง log การแก้ parameter / ผลเทส / OEE มาที่ /api/chroma/ingest (X-Station-Id + X-Api-Key)
//  - ข้อมูลสด: service ถือ SSE ของคอมเทสที่มีคนเปิดดู แล้วส่งต่อทาง socket "chroma_event" ไปที่ห้องของผู้ดู
//  - สัญญา API ฝั่งคอมเทส: D:\Chroma DCR\CLAUDE.md
// ==========================================

const router = express.Router();
const ROLES = ['admin', 'me'];
const auth = [authenticateToken, requireRoles(...ROLES)];
const T = 'automation_lines';
const ONLINE_MS = 90 * 1000; // heartbeat ทุก 30 วิ → เกิน 90 วิ = offline
const MAX_RANGE_DAYS = 93;

const fail = (res, status, message) => res.status(status).json({ success: false, message });
const asInt = (v) => (v === undefined || v === null || v === '' || Number.isNaN(Number(v)) ? null : Math.trunc(Number(v)));
const toDate = (v) => {
  const d = v ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
};

// ---------- สถานี ----------
const stationCache = new Map(); // id → { row, at }
const getStation = async (id, { fresh = false } = {}) => {
  const n = asInt(id);
  if (!n) return null;
  const c = stationCache.get(n);
  if (!fresh && c && Date.now() - c.at < 30000) return c.row;
  const { rows } = await pool.query(`SELECT * FROM ${T}.chroma_stations WHERE id = $1`, [n]);
  if (rows[0]) stationCache.set(n, { row: rows[0], at: Date.now() });
  else stationCache.delete(n);
  return rows[0] || null;
};

const publicStation = (s) => ({
  id: s.id,
  name: s.name,
  ip: s.ip,
  port: s.port,
  line: s.line,
  location: s.location,
  certSha256: s.cert_sha256,
  plcConfig: s.plc_config,
  lastSeen: s.last_seen,
  online: !!s.last_seen && Date.now() - new Date(s.last_seen).getTime() < ONLINE_MS,
  lastStatus: s.last_status,
  createdBy: s.created_by,
  createdAt: s.created_at,
});

// ผลตรวจ cert ตอนลงทะเบียน (เก็บฝั่ง server กัน client ส่ง cert ปลอมมาเอง) อายุ 10 นาที
const probes = new Map();
const cleanProbes = () => {
  for (const [k, v] of probes) if (Date.now() - v.at > 10 * 60 * 1000) probes.delete(k);
};

router.get('/api/chroma/stations', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM ${T}.chroma_stations ORDER BY name, id`);
    res.json({ success: true, stations: rows.map(publicStation) });
  } catch (err) {
    console.error('chroma stations:', err);
    fail(res, 500, 'อ่านรายการเครื่องไม่ได้');
  }
});

// SHA-256 ของ certificate หน้าเว็บ (ให้ผู้ใช้ใส่ที่คอมเทสช่อง "Server cert SHA-256")
router.get('/api/chroma/server-cert', auth, (req, res) => {
  const info = serverCertInfo();
  res.json({ success: true, cert: info });
});

// ขั้น 1 ลงทะเบียน: อ่าน certificate ของคอมเทส ให้ผู้ใช้เทียบ fingerprint กับจอคอมเทส
router.post('/api/chroma/stations/probe', auth, async (req, res) => {
  const { ip, port = 8443 } = req.body || {};
  if (!validHost(ip) || !validPort(port)) return fail(res, 400, 'IP / port ไม่ถูกต้อง');
  try {
    const cert = await fetchCert(ip, Number(port));
    cleanProbes();
    const probeId = crypto.randomUUID();
    probes.set(probeId, { ...cert, ip, port: Number(port), at: Date.now(), by: req.user.employee_id });
    res.json({ success: true, probeId, certSha256: cert.sha256, subject: cert.subject, validTo: cert.validTo });
  } catch (err) {
    fail(res, 503, err.message);
  }
});

const takeProbe = (probeId, user) => {
  const p = probes.get(String(probeId || ''));
  if (!p || p.by !== user.employee_id || Date.now() - p.at > 10 * 60 * 1000) return null;
  probes.delete(String(probeId));
  return p;
};

// ขั้น 2: ผู้ใช้ยืนยัน fingerprint แล้ว → บันทึก + สร้าง API key (แสดงครั้งเดียว)
router.post('/api/chroma/stations', auth, async (req, res) => {
  const { name, line = null, location = null, probeId } = req.body || {};
  if (!String(name || '').trim()) return fail(res, 400, 'กรุณาตั้งชื่อเครื่อง');
  const p = takeProbe(probeId, req.user);
  if (!p) return fail(res, 400, 'ผลตรวจ certificate หมดอายุ — กด "ตรวจเครื่อง" ใหม่');
  try {
    const apiKey = newApiKey();
    const { rows } = await pool.query(
      `INSERT INTO ${T}.chroma_stations (name, ip, port, line, location, api_key_enc, cert_sha256, cert_pem, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [String(name).trim(), p.ip, p.port, line, location, encryptKey(apiKey), p.sha256, p.pem, req.user.employee_id]
    );
    res.json({ success: true, station: publicStation(rows[0]), apiKey, stationId: rows[0].id });
  } catch (err) {
    console.error('chroma add station:', err);
    fail(res, 500, 'บันทึกเครื่องไม่ได้');
  }
});

router.put('/api/chroma/stations/:id', auth, async (req, res) => {
  const s = await getStation(req.params.id, { fresh: true }).catch(() => null);
  if (!s) return fail(res, 404, 'ไม่พบเครื่อง');
  const { name, line, location, probeId } = req.body || {};
  // เปลี่ยน IP / port / cert ต้องตรวจเครื่องใหม่ (probe)
  const p = probeId ? takeProbe(probeId, req.user) : null;
  if (probeId && !p) return fail(res, 400, 'ผลตรวจ certificate หมดอายุ — กด "ตรวจเครื่อง" ใหม่');
  try {
    const { rows } = await pool.query(
      `UPDATE ${T}.chroma_stations SET name = $2, line = $3, location = $4,
         ip = $5, port = $6, cert_sha256 = $7, cert_pem = $8 WHERE id = $1 RETURNING *`,
      [s.id, String(name ?? s.name).trim() || s.name, line ?? s.line, location ?? s.location,
        p ? p.ip : s.ip, p ? p.port : s.port, p ? p.sha256 : s.cert_sha256, p ? p.pem : s.cert_pem]
    );
    stationCache.delete(s.id);
    restartWatch(s.id);
    res.json({ success: true, station: publicStation(rows[0]) });
  } catch (err) {
    console.error('chroma edit station:', err);
    fail(res, 500, 'แก้ไขเครื่องไม่ได้');
  }
});

router.post('/api/chroma/stations/:id/rotate-key', auth, async (req, res) => {
  const s = await getStation(req.params.id, { fresh: true }).catch(() => null);
  if (!s) return fail(res, 404, 'ไม่พบเครื่อง');
  const apiKey = newApiKey();
  await pool.query(`UPDATE ${T}.chroma_stations SET api_key_enc = $2 WHERE id = $1`, [s.id, encryptKey(apiKey)]);
  stationCache.delete(s.id);
  restartWatch(s.id);
  res.json({ success: true, apiKey, stationId: s.id });
});

router.delete('/api/chroma/stations/:id', auth, async (req, res) => {
  const s = await getStation(req.params.id, { fresh: true }).catch(() => null);
  if (!s) return fail(res, 404, 'ไม่พบเครื่อง');
  // เก็บประวัติ (runs / param changes) ไว้ ลบแค่เครื่อง
  await pool.query(`DELETE FROM ${T}.chroma_stations WHERE id = $1`, [s.id]);
  stationCache.delete(s.id);
  stopWatch(s.id);
  res.json({ success: true });
});

// ---------- proxy ไปคอมเทส ----------
// path ที่อนุญาต (หลัง /api/v1) — ตรงตามสัญญา API ใน D:\Chroma DCR\CLAUDE.md
const PROXY_RULES = [
  ['GET', /^\/status$/],
  ['GET', /^\/programs$/],
  ['POST', /^\/programs\/\d{1,3}\/(recall|save)$/],
  ['GET', /^\/steps$/],
  ['GET', /^\/steps\/\d{1,3}$/],
  ['PUT', /^\/steps\/\d{1,3}$/],
  ['DELETE', /^\/steps\/\d{1,3}$/],
  ['GET', /^\/steps\/\d{1,3}\/waves$/],
  ['POST', /^\/steps\/\d{1,3}\/sample$/],
  ['POST', /^\/hv\/prepare$/],
  ['POST', /^\/start$/],
  ['POST', /^\/stop$/],
  ['PUT', /^\/mode$/],
  ['GET', /^\/config\/plc$/],
  ['PUT', /^\/config\/plc$/],
];
const ALLOWED_QUERY = ['from', 'count', 'sub'];

// Express 5: wildcard ต้องมีชื่อ → req.params.path เป็น array ของแต่ละช่วง
router.all('/api/chroma/stations/:id/api/*path', auth, async (req, res) => {
  const parts = Array.isArray(req.params.path) ? req.params.path : [String(req.params.path || '')];
  const sub = '/' + parts.join('/');
  if (!PROXY_RULES.some(([m, re]) => m === req.method && re.test(sub))) return fail(res, 404, 'ไม่มีคำสั่งนี้');
  const s = await getStation(req.params.id).catch(() => null);
  if (!s) return fail(res, 404, 'ไม่พบเครื่อง');

  const qs = new URLSearchParams();
  for (const k of ALLOWED_QUERY) if (req.query[k] !== undefined) qs.set(k, String(req.query[k]));
  const path = sub + (qs.toString() ? `?${qs}` : '');
  const isStop = sub === '/stop';
  // อ่าน step ทั้งหมด (13 step) ใช้ ~10 วิ / SAMPLE GET / START รอเครื่องตอบ → timeout ยาวกว่าปกติ
  const timeoutMs = isStop ? 4000 : /^\/steps$|^\/programs$|\/waves$/.test(sub) ? 60000 : 20000;
  try {
    const r = await stationRequest(s, req.method, path, {
      body: ['POST', 'PUT'].includes(req.method) ? req.body || {} : undefined,
      user: req.user,
      timeoutMs,
    });
    if (sub === '/config/plc' && req.method === 'PUT' && r.status < 300) {
      await pool.query(`UPDATE ${T}.chroma_stations SET plc_config = $2 WHERE id = $1`, [s.id, JSON.stringify(req.body || {})]);
      stationCache.delete(s.id);
    }
    if (sub === '/status' && r.status === 200 && r.body && typeof r.body === 'object') {
      pool.query(`UPDATE ${T}.chroma_stations SET last_status = $2 WHERE id = $1`, [s.id, JSON.stringify(r.body)]).catch(() => {});
    }
    // คอมเทสตอบ error เป็น { error } → ส่งต่อพร้อม message ให้หน้าเว็บแสดง
    if (r.status >= 400) {
      const msg = (r.body && (r.body.error || r.body.message)) || `คอมเทสตอบ ${r.status}`;
      // 401 จากคอมเทส = key ไม่ตรง (ไม่ใช่ session ของผู้ใช้หลุด) → ตอบ 502 กันหน้าเว็บพาออกจากระบบ
      return fail(res, r.status === 401 ? 502 : r.status, r.status === 401 ? 'คอมเทสไม่รับ API key — ใส่ key ใหม่ที่คอมเทส' : msg);
    }
    res.status(r.status).json(r.body ?? {});
  } catch (err) {
    fail(res, err instanceof StationError ? err.status : 503, err.message);
  }
});

// ---------- ข้อมูลสด: SSE ของคอมเทส → socket ไปยังผู้ที่เปิดดู ----------
const watches = new Map(); // stationId → { viewers: Map(employeeId → lastPing), close, retry }
const WATCH_TTL = 60 * 1000;

const startStream = async (id) => {
  const w = watches.get(id);
  if (!w || w.close) return;
  const s = await getStation(id).catch(() => null);
  if (!s) return stopWatch(id);
  w.close = openStationEvents(
    s,
    (type, data) => {
      for (const emp of w.viewers.keys()) io.to(userRoom(emp)).emit('chroma_event', { stationId: id, type, data });
    },
    () => {
      w.close = null;
      if (!watches.has(id)) return;
      for (const emp of w.viewers.keys()) io.to(userRoom(emp)).emit('chroma_event', { stationId: id, type: 'stream_lost', data: null });
      clearTimeout(w.retry);
      w.retry = setTimeout(() => startStream(id), 3000);
    }
  );
};

function stopWatch(id) {
  const w = watches.get(id);
  if (!w) return;
  clearTimeout(w.retry);
  w.close?.();
  watches.delete(id);
}

function restartWatch(id) {
  const w = watches.get(id);
  if (!w) return;
  clearTimeout(w.retry);
  w.close?.();
  w.close = null;
  startStream(id);
}

setInterval(() => {
  for (const [id, w] of watches) {
    for (const [emp, at] of w.viewers) if (Date.now() - at > WATCH_TTL) w.viewers.delete(emp);
    if (!w.viewers.size) stopWatch(id);
  }
}, 15000).unref();

// หน้าเว็บเรียกทุก ~30 วิ ระหว่างเปิดดูเครื่องนั้น
router.post('/api/chroma/stations/:id/watch', auth, async (req, res) => {
  const s = await getStation(req.params.id).catch(() => null);
  if (!s) return fail(res, 404, 'ไม่พบเครื่อง');
  let w = watches.get(s.id);
  if (!w) {
    w = { viewers: new Map(), close: null, retry: null };
    watches.set(s.id, w);
  }
  w.viewers.set(req.user.employee_id, Date.now());
  if (!w.close && !w.retry) startStream(s.id);
  res.json({ success: true, streaming: !!w.close });
});

router.delete('/api/chroma/stations/:id/watch', auth, (req, res) => {
  const w = watches.get(asInt(req.params.id));
  if (w) {
    w.viewers.delete(req.user.employee_id);
    if (!w.viewers.size) stopWatch(asInt(req.params.id));
  }
  res.json({ success: true });
});

// ---------- รับข้อมูลจากคอมเทส (ไม่ใช้ JWT) ----------
const authStation = async (req, res, next) => {
  const s = await getStation(req.get('x-station-id')).catch(() => null);
  let ok = false;
  try {
    ok = !!s && sameKey(decryptKey(s.api_key_enc), req.get('x-api-key'));
  } catch {
    ok = false;
  }
  if (!ok) return res.status(401).json({ error: 'X-Station-Id / X-Api-Key ไม่ถูกต้อง' });
  req.station = s;
  next();
};

const KIND_OF = {
  param_change: 'param', memory_save: 'memory_save', memory_recall: 'memory_recall', step_delete: 'step_delete',
  sample_get: 'sample_get', mode_change: 'mode_change', plc_config: 'plc_config',
};

const short = (v, n = 2000) => (v === undefined || v === null ? null : String(typeof v === 'object' ? JSON.stringify(v) : v).slice(0, n));

const saveEvent = async (client, stationId, ev) => {
  const at = toDate(ev.at) || new Date();
  const d = ev.data && typeof ev.data === 'object' ? ev.data : {};
  const ins = await client.query(
    `INSERT INTO ${T}.chroma_events (id, station_id, type, at, employee_id, source, data)
     VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING RETURNING id`,
    [ev.id, stationId, String(ev.type).slice(0, 40), at, short(ev.employeeId, 30), short(ev.source, 10), JSON.stringify(d)]
  );
  if (!ins.rowCount) return; // เคยรับแล้ว

  if (KIND_OF[ev.type]) {
    const kind = KIND_OF[ev.type];
    let oldValue = short(d.oldValue);
    let newValue = short(d.newValue);
    if (kind === 'mode_change') [oldValue, newValue] = [short(d.from), short(d.to)];
    if (kind === 'memory_save' || kind === 'memory_recall') newValue = short(d.name);
    if (kind === 'sample_get') newValue = d.ok === false ? 'FAIL' : 'OK';
    if (kind === 'plc_config') newValue = short(d.config, 8000);
    await client.query(
      `INSERT INTO ${T}.chroma_param_changes (event_id, station_id, at, employee_id, source, kind, memory_no, memory_name,
         step, sub, mode, path, label, old_value, new_value)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [ev.id, stationId, at, short(ev.employeeId, 30), short(ev.source, 10), kind, asInt(d.memoryNo), short(d.memoryName ?? (kind.startsWith('memory') ? d.name : null), 100),
        asInt(d.step), asInt(d.sub), short(d.mode, 20), short(d.path, 100), short(d.label, 100), oldValue, newValue]
    );
  } else if (ev.type === 'test_run') {
    const r = await client.query(
      `INSERT INTO ${T}.chroma_test_runs (event_id, station_id, started_at, ended_at, source, sn, memory_no, memory_name,
         result, fail_step, fail_code, fail_text, employee_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (event_id) DO NOTHING RETURNING id`,
      [ev.id, stationId, toDate(d.startedAt), toDate(d.endedAt) || at, short(ev.source, 10), short(d.sn, 200), asInt(d.memoryNo),
        short(d.memoryName, 100), String(d.result || 'ERROR').toUpperCase().slice(0, 10), asInt(d.failStep) || null,
        short(d.failCode, 50), short(d.failText), short(ev.employeeId, 30)]
    );
    const runId = r.rows[0]?.id;
    if (runId && Array.isArray(d.steps)) {
      for (const st of d.steps.slice(0, 200)) {
        const no = asInt(st.stepNo);
        if (!no) continue;
        await client.query(
          `INSERT INTO ${T}.chroma_test_steps (run_id, step_no, mode, outcome, state_codes, text, mets, test_time)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
          [runId, no, short(st.mode, 20), short(st.outcome, 20), short(st.stateCodes, 100), short(st.text),
            JSON.stringify(Array.isArray(st.mets) ? st.mets : []), Number.isFinite(Number(st.testTime)) ? Number(st.testTime) : null]
        );
      }
    }
  } else if (ev.type === 'oee_minute') {
    const minute = toDate(d.minute);
    if (!minute) return;
    minute.setUTCSeconds(0, 0);
    await client.query(
      `INSERT INTO ${T}.chroma_oee_minutes (station_id, minute, run_sec, stop_sec, alarm_sec, planned_stop_sec, total_delta,
         ok_delta, ng_delta, ideal_ct_ms, alarm_codes, tester_pass, tester_fail)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (station_id, minute) DO UPDATE SET run_sec = EXCLUDED.run_sec, stop_sec = EXCLUDED.stop_sec,
         alarm_sec = EXCLUDED.alarm_sec, planned_stop_sec = EXCLUDED.planned_stop_sec, total_delta = EXCLUDED.total_delta,
         ok_delta = EXCLUDED.ok_delta, ng_delta = EXCLUDED.ng_delta, ideal_ct_ms = EXCLUDED.ideal_ct_ms,
         alarm_codes = EXCLUDED.alarm_codes, tester_pass = EXCLUDED.tester_pass, tester_fail = EXCLUDED.tester_fail`,
      [stationId, minute, asInt(d.runSec) || 0, asInt(d.stopSec) || 0, asInt(d.alarmSec) || 0, asInt(d.plannedStopSec) || 0,
        asInt(d.totalDelta) || 0, asInt(d.okDelta) || 0, asInt(d.ngDelta) || 0, asInt(d.idealCtMs),
        JSON.stringify(d.alarmCodes || {}), asInt(d.testerPass) || 0, asInt(d.testerFail) || 0]
    );
  }
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.post('/api/chroma/ingest', authStation, async (req, res) => {
  const events = Array.isArray(req.body?.events) ? req.body.events : null;
  if (!events) return res.status(400).json({ error: 'ต้องส่ง { events: [...] }' });
  if (events.length > 500) return res.status(400).json({ error: 'ส่งได้ครั้งละไม่เกิน 500 event' });
  const accepted = [];
  const client = await pool.connect();
  try {
    for (const ev of events) {
      if (!ev || !UUID_RE.test(String(ev.id || '')) || !ev.type) continue; // ผิดรูปแบบ → ไม่ accept (คอมเทสจะเห็นว่าค้าง)
      try {
        await client.query('BEGIN');
        await saveEvent(client, req.station.id, ev);
        await client.query('COMMIT');
        accepted.push(ev.id);
        if (ev.type === 'test_run' || KIND_OF[ev.type]) {
          const w = watches.get(req.station.id);
          if (w) for (const emp of w.viewers.keys()) io.to(userRoom(emp)).emit('chroma_event', { stationId: req.station.id, type: 'history_changed', data: { type: ev.type } });
        }
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error(`chroma ingest ${ev.type} ${ev.id}:`, err.message);
      }
    }
  } finally {
    client.release();
  }
  pool.query(`UPDATE ${T}.chroma_stations SET last_seen = NOW() WHERE id = $1`, [req.station.id]).catch(() => {});
  res.json({ accepted });
});

router.post('/api/chroma/heartbeat', authStation, async (req, res) => {
  const b = req.body && typeof req.body === 'object' ? req.body : {};
  await pool
    .query(`UPDATE ${T}.chroma_stations SET last_seen = NOW(), last_status = COALESCE(last_status, '{}'::jsonb) || $2::jsonb WHERE id = $1`, [
      req.station.id,
      JSON.stringify({ heartbeat: { ...b, at: new Date().toISOString() } }),
    ])
    .catch((err) => console.error('chroma heartbeat:', err.message));
  res.json({ ok: true });
});

// ---------- ประวัติ / สรุป ----------
const rangeOf = (q) => {
  const to = toDate(q.to) || new Date();
  const from = toDate(q.from) || new Date(to.getTime() - 7 * 86400000);
  if (to - from > MAX_RANGE_DAYS * 86400000) return null;
  return { from, to };
};

// วันทำงาน / กะ (เวลาไทย): 07:40-19:40 = เช้า, 19:40-07:40 = ดึก (นับเป็นวันที่เริ่มกะ) เหมือน MES
const workShiftOf = (d) => {
  const t = new Date(new Date(d).getTime() + 7 * 3600000).toISOString();
  const minutes = Number(t.slice(11, 13)) * 60 + Number(t.slice(14, 16));
  const date = t.slice(0, 10);
  if (minutes >= 460 && minutes < 1180) return { date, shift: 'day' };
  const prev = new Date(Date.parse(`${date}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
  return { date: minutes < 460 ? prev : date, shift: 'night' };
};

router.get('/api/chroma/runs', auth, async (req, res) => {
  const r = rangeOf(req.query);
  if (!r) return fail(res, 400, `เลือกช่วงได้ไม่เกิน ${MAX_RANGE_DAYS} วัน`);
  const params = [r.from, r.to];
  let where = 'r.ended_at >= $1 AND r.ended_at < $2';
  if (asInt(req.query.station)) where += ` AND r.station_id = $${params.push(asInt(req.query.station))}`;
  if (req.query.result) where += ` AND r.result = $${params.push(String(req.query.result).toUpperCase())}`;
  if (req.query.sn) where += ` AND r.sn ILIKE $${params.push(`%${String(req.query.sn)}%`)}`;
  const limit = Math.min(asInt(req.query.limit) || 200, 5000);
  try {
    const { rows } = await pool.query(
      `SELECT r.*, s.name AS station_name FROM ${T}.chroma_test_runs r LEFT JOIN ${T}.chroma_stations s ON s.id = r.station_id
       WHERE ${where} ORDER BY r.ended_at DESC LIMIT ${limit}`,
      params
    );
    res.json({ success: true, runs: rows });
  } catch (err) {
    console.error('chroma runs:', err);
    fail(res, 500, 'อ่านผลเทสไม่ได้');
  }
});

router.get('/api/chroma/runs/:id', auth, async (req, res) => {
  const id = asInt(req.params.id);
  const run = await pool.query(`SELECT * FROM ${T}.chroma_test_runs WHERE id = $1`, [id]).catch(() => null);
  if (!run?.rows[0]) return fail(res, 404, 'ไม่พบรอบเทส');
  const steps = await pool.query(`SELECT * FROM ${T}.chroma_test_steps WHERE run_id = $1 ORDER BY step_no`, [id]);
  res.json({ success: true, run: run.rows[0], steps: steps.rows });
});

router.get('/api/chroma/param-changes', auth, async (req, res) => {
  const r = rangeOf(req.query);
  if (!r) return fail(res, 400, `เลือกช่วงได้ไม่เกิน ${MAX_RANGE_DAYS} วัน`);
  const params = [r.from, r.to];
  let where = 'c.at >= $1 AND c.at < $2';
  if (asInt(req.query.station)) where += ` AND c.station_id = $${params.push(asInt(req.query.station))}`;
  try {
    const { rows } = await pool.query(
      `SELECT c.*, s.name AS station_name, u.name AS employee_name
       FROM ${T}.chroma_param_changes c
       LEFT JOIN ${T}.chroma_stations s ON s.id = c.station_id
       LEFT JOIN auth.users u ON u.employee_id::text = c.employee_id
       WHERE ${where} ORDER BY c.at DESC LIMIT 5000`,
      params
    );
    res.json({ success: true, changes: rows });
  } catch (err) {
    console.error('chroma param-changes:', err);
    fail(res, 500, 'อ่านประวัติการแก้ไม่ได้');
  }
});

router.get('/api/chroma/summary', auth, async (req, res) => {
  const r = rangeOf(req.query);
  if (!r) return fail(res, 400, `เลือกช่วงได้ไม่เกิน ${MAX_RANGE_DAYS} วัน`);
  const params = [r.from, r.to];
  let where = 'ended_at >= $1 AND ended_at < $2';
  if (asInt(req.query.station)) where += ` AND station_id = $${params.push(asInt(req.query.station))}`;
  try {
    const { rows } = await pool.query(
      `SELECT ended_at, result, fail_step, fail_code, fail_text, memory_no, memory_name FROM ${T}.chroma_test_runs WHERE ${where}`,
      params
    );
    const shiftFilter = req.query.shift === 'day' || req.query.shift === 'night' ? req.query.shift : null;
    const total = { total: 0, pass: 0, fail: 0, abort: 0 };
    const byDay = new Map();
    const byStep = new Map();
    const byMemory = new Map();
    for (const row of rows) {
      const ws = workShiftOf(row.ended_at);
      if (shiftFilter && ws.shift !== shiftFilter) continue;
      const k = row.result === 'PASS' ? 'pass' : row.result === 'FAIL' ? 'fail' : 'abort';
      total.total++;
      total[k]++;
      const dk = `${ws.date}|${ws.shift}`;
      const day = byDay.get(dk) || { date: ws.date, shift: ws.shift, total: 0, pass: 0, fail: 0, abort: 0 };
      day.total++;
      day[k]++;
      byDay.set(dk, day);
      const mk = `${row.memory_no ?? ''}`;
      const mem = byMemory.get(mk) || { memoryNo: row.memory_no, memoryName: row.memory_name, total: 0, pass: 0, fail: 0, abort: 0 };
      mem.total++;
      mem[k]++;
      byMemory.set(mk, mem);
      if (row.result === 'FAIL' && row.fail_step) {
        const sk = `${row.memory_no ?? ''}|${row.fail_step}`;
        const st = byStep.get(sk) || { memoryNo: row.memory_no, memoryName: row.memory_name, step: row.fail_step, count: 0, codes: {} };
        st.count++;
        const code = row.fail_code || '-';
        st.codes[code] = st.codes[code] || { count: 0, text: row.fail_text || '' };
        st.codes[code].count++;
        byStep.set(sk, st);
      }
    }
    res.json({
      success: true,
      total,
      days: [...byDay.values()].sort((a, b) => `${a.date}${a.shift}`.localeCompare(`${b.date}${b.shift}`)),
      failSteps: [...byStep.values()].sort((a, b) => b.count - a.count),
      memories: [...byMemory.values()].sort((a, b) => b.total - a.total),
    });
  } catch (err) {
    console.error('chroma summary:', err);
    fail(res, 500, 'สรุปผลไม่ได้');
  }
});

router.get('/api/chroma/oee', auth, async (req, res) => {
  const r = rangeOf(req.query);
  if (!r) return fail(res, 400, `เลือกช่วงได้ไม่เกิน ${MAX_RANGE_DAYS} วัน`);
  const station = asInt(req.query.station);
  if (!station) return fail(res, 400, 'เลือกเครื่อง');
  try {
    const { rows } = await pool.query(
      `SELECT * FROM ${T}.chroma_oee_minutes WHERE station_id = $1 AND minute >= $2 AND minute < $3 ORDER BY minute`,
      [station, r.from, r.to]
    );
    // รวมตามวัน / กะ → A = เวลาเดิน / เวลาตามแผน, P = (Ideal CT × ยอดรวม) / เวลาเดิน, Q = ดี / รวม
    const groups = new Map();
    for (const m of rows) {
      const ws = workShiftOf(m.minute);
      const k = `${ws.date}|${ws.shift}`;
      const g = groups.get(k) || { date: ws.date, shift: ws.shift, minutes: 0, runSec: 0, alarmSec: 0, plannedStopSec: 0, idealSec: 0, total: 0, ok: 0, ng: 0, testerPass: 0, testerFail: 0, alarms: {} };
      g.minutes++;
      g.runSec += m.run_sec;
      g.alarmSec += m.alarm_sec;
      g.plannedStopSec += m.planned_stop_sec;
      g.total += m.total_delta;
      g.ok += m.ok_delta;
      g.ng += m.ng_delta;
      g.testerPass += m.tester_pass;
      g.testerFail += m.tester_fail;
      if (m.ideal_ct_ms) g.idealSec += (m.ideal_ct_ms / 1000) * m.total_delta;
      for (const [code, sec] of Object.entries(m.alarm_codes || {})) g.alarms[code] = (g.alarms[code] || 0) + Number(sec || 0);
      groups.set(k, g);
    }
    const ratio = (a, b) => (b > 0 ? Math.min(1, a / b) : null);
    const out = [...groups.values()].map((g) => {
      const planned = g.minutes * 60 - g.plannedStopSec;
      const A = ratio(g.runSec, planned);
      const P = g.idealSec > 0 ? ratio(g.idealSec, g.runSec) : null;
      const Q = ratio(g.ok, g.total);
      return { ...g, plannedSec: planned, availability: A, performance: P, quality: Q, oee: A !== null && P !== null && Q !== null ? A * P * Q : null };
    });
    res.json({ success: true, groups: out });
  } catch (err) {
    console.error('chroma oee:', err);
    fail(res, 500, 'อ่านข้อมูล OEE ไม่ได้');
  }
});

export default router;
