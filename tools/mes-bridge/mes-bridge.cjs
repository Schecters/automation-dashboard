#!/usr/bin/env node
// ==========================================
// 🔌 MES Bridge — รันบน PC หน้าไลน์ที่ต่อเครื่องสแกน Keyence
//  หน้าเว็บ /MES (เปิดบน PC เครื่องนี้) อ่านค่าเครื่องสแกนผ่าน http://127.0.0.1:18080
//  เพราะเบราว์เซอร์ต่อ TCP / Modbus เองไม่ได้ และ server เข้าถึง network ของเครื่องสแกนไม่ได้
//
//  รองรับ 2 แบบ:
//   - TCP data port (เช่น Keyence 9004): ต่อค้างไว้ รับผลอ่านทุกครั้งที่สแกน (ชิ้นเดิมซ้ำก็นับ)
//   - Modbus TCP: อ่าน holding / input register ที่เก็บ QR เป็น ASCII
//
//  ใช้แค่ Node.js (ไม่มี package ต้องติดตั้ง)  รัน: node mes-bridge.cjs
//  ตั้งค่าเพิ่มได้ด้วย environment variable:
//   MES_BRIDGE_PORT     (default 18080)
//   MES_BRIDGE_ORIGINS  เว็บที่อนุญาตให้เรียก คั่นด้วย , (default https://10.204.206.1:5173)
// ==========================================
const http = require('http');
const net = require('net');

const VERSION = '1.0.0';
const PORT = Number(process.env.MES_BRIDGE_PORT || 18080);
const ALLOWED_ORIGINS = (process.env.MES_BRIDGE_ORIGINS ||
  'https://10.204.206.1:5173,https://localhost:5173,http://localhost:5173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const log = (...args) => console.log(new Date().toLocaleString('sv-SE'), ...args);

// เครื่องสแกนต้องอยู่ใน network ภายใน (กันเว็บอื่นสั่งให้เครื่องนี้ไปต่อที่อื่น)
const isPrivateIPv4 = (host) => {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(host || ''));
  if (!m || m.slice(1).some((x) => Number(x) > 255)) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a === 127;
};
const validPort = (p) => Number.isInteger(p) && p >= 1 && p <= 65535;

// ------------------------------------------
// TCP data port
// ------------------------------------------
const TCP_MAX_ITEMS = 50;
const TCP_RECONNECT_MS = 3000;
const TCP_IDLE_CLOSE_MS = 5 * 60 * 1000;
const TCP_CONNECT_TIMEOUT_MS = 3000;
const tcpReaders = new Map();

const createTcpReader = (host, port) => {
  const r = { host, port, socket: null, connected: false, lastError: null, readError: null, buffer: '',
    seq: 0, items: [], lastPollAt: Date.now(), timer: null, closed: false };

  const connect = () => {
    if (r.closed) return;
    const socket = net.createConnection({ host, port });
    r.socket = socket;
    socket.setKeepAlive(true, 10000);
    socket.setTimeout(TCP_CONNECT_TIMEOUT_MS);
    socket.on('connect', () => {
      r.connected = true;
      r.lastError = null;
      socket.setTimeout(0);
      log(`TCP ต่อ ${host}:${port} แล้ว`);
    });
    socket.on('timeout', () => {
      if (!r.connected) socket.destroy(new Error('เชื่อมต่อไม่ทันเวลา'));
    });
    socket.on('data', (chunk) => {
      r.buffer += chunk.toString('latin1');
      const parts = r.buffer.split(/\r\n|\r|\n/);
      r.buffer = parts.pop();
      for (const part of parts) {
        const line = part.replace(/[^\x20-\x7e]/g, '').trim();
        if (!line) continue;
        if (/^ERROR$/i.test(line)) {
          r.readError = 'เครื่องสแกนอ่าน QR ไม่ได้ (ERROR)';
          continue;
        }
        r.readError = null;
        r.seq += 1;
        r.items.push({ seq: r.seq, sn: line, at: new Date().toISOString() });
        if (r.items.length > TCP_MAX_ITEMS) r.items.shift();
        log(`สแกน ${host}:${port} -> ${line}`);
      }
    });
    socket.on('error', (err) => {
      r.lastError = err.message;
    });
    socket.on('close', () => {
      if (r.connected) log(`TCP ${host}:${port} หลุด จะต่อใหม่`);
      r.connected = false;
      r.socket = null;
      if (!r.closed) r.timer = setTimeout(connect, TCP_RECONNECT_MS);
    });
  };

  r.close = () => {
    r.closed = true;
    clearTimeout(r.timer);
    if (r.socket) r.socket.destroy();
  };
  connect();
  return r;
};

setInterval(() => {
  for (const [key, r] of tcpReaders) {
    if (Date.now() - r.lastPollAt > TCP_IDLE_CLOSE_MS) {
      r.close();
      tcpReaders.delete(key);
      log(`ปิด TCP ${key} (ไม่มีหน้าเว็บใช้)`);
    }
  }
}, 60000).unref();

const waitUntil = (fn, ms) =>
  new Promise((resolve) => {
    if (fn()) return resolve();
    const started = Date.now();
    const t = setInterval(() => {
      if (fn() || Date.now() - started >= ms) {
        clearInterval(t);
        resolve();
      }
    }, 50);
  });

const tcpRead = async ({ host, port, after }) => {
  const key = `${host}:${port}`;
  let r = tcpReaders.get(key);
  if (!r) {
    r = createTcpReader(host, port);
    tcpReaders.set(key, r);
  }
  r.lastPollAt = Date.now();
  await waitUntil(() => r.connected, TCP_CONNECT_TIMEOUT_MS);
  if (!r.connected) {
    throw new Error(`เชื่อมต่อเครื่องสแกน ${host}:${port} ไม่ได้${r.lastError ? `: ${r.lastError}` : ''}`);
  }
  let items = [];
  if (after !== null) items = after > r.seq ? r.items : r.items.filter((i) => i.seq > after);
  return { connected: true, error: r.readError, seq: r.seq, items };
};

// ------------------------------------------
// Modbus TCP (FC3 / FC4 อ่าน, FC16 เขียนล้าง) — 1 connection ต่อ host:port ใช้ทีละ request
// ------------------------------------------
const MODBUS_TIMEOUT_MS = 2000;
const modbusConns = new Map(); // key -> { socket, buffer, pending, queue, tid }

const getModbusConn = (host, port) =>
  new Promise((resolve, reject) => {
    const key = `${host}:${port}`;
    const existing = modbusConns.get(key);
    if (existing && !existing.socket.destroyed && existing.ready) return resolve(existing);
    const conn = { socket: null, buffer: Buffer.alloc(0), pending: null, queue: Promise.resolve(), tid: 0, ready: false };
    const socket = net.createConnection({ host, port });
    conn.socket = socket;
    socket.setTimeout(MODBUS_TIMEOUT_MS);
    socket.once('connect', () => {
      conn.ready = true;
      socket.setTimeout(0);
      modbusConns.set(key, conn);
      resolve(conn);
    });
    socket.on('timeout', () => socket.destroy(new Error('เชื่อมต่อไม่ทันเวลา')));
    socket.on('data', (chunk) => {
      conn.buffer = Buffer.concat([conn.buffer, chunk]);
      while (conn.buffer.length >= 7) {
        const len = conn.buffer.readUInt16BE(4);
        if (conn.buffer.length < 6 + len) break;
        const frame = conn.buffer.subarray(0, 6 + len);
        conn.buffer = conn.buffer.subarray(6 + len);
        const p = conn.pending;
        if (p && frame.readUInt16BE(0) === p.tid) {
          conn.pending = null;
          clearTimeout(p.timer);
          p.resolve(frame.subarray(7)); // PDU
        }
      }
    });
    socket.on('error', (err) => {
      if (!conn.ready) reject(err);
      if (conn.pending) {
        clearTimeout(conn.pending.timer);
        conn.pending.reject(err);
        conn.pending = null;
      }
    });
    socket.on('close', () => {
      modbusConns.delete(key);
      if (conn.pending) {
        clearTimeout(conn.pending.timer);
        conn.pending.reject(new Error('connection ถูกปิด'));
        conn.pending = null;
      }
    });
  });

const MODBUS_EXCEPTIONS = { 1: 'Illegal function', 2: 'Illegal data address', 3: 'Illegal data value', 4: 'Device failure' };

const modbusRequest = async (host, port, unitId, pdu) => {
  const conn = await getModbusConn(host, port);
  const run = conn.queue.then(
    () =>
      new Promise((resolve, reject) => {
        conn.tid = (conn.tid + 1) & 0xffff;
        const header = Buffer.alloc(7);
        header.writeUInt16BE(conn.tid, 0);
        header.writeUInt16BE(0, 2);
        header.writeUInt16BE(pdu.length + 1, 4);
        header[6] = unitId;
        const timer = setTimeout(() => {
          conn.pending = null;
          conn.socket.destroy();
          reject(new Error('เครื่องสแกนไม่ตอบ (timeout)'));
        }, MODBUS_TIMEOUT_MS);
        conn.pending = { tid: conn.tid, resolve, reject, timer };
        conn.socket.write(Buffer.concat([header, pdu]));
      })
  );
  conn.queue = run.catch(() => {});
  const res = await run;
  if (res[0] & 0x80) throw new Error(`Modbus exception: ${MODBUS_EXCEPTIONS[res[1]] || res[1]}`);
  return res;
};

const wordsToAscii = (words, byteOrder) => {
  const bytes = [];
  for (const w of words) {
    const hi = (w >> 8) & 0xff;
    const lo = w & 0xff;
    if (byteOrder === 'LE') bytes.push(lo, hi);
    else bytes.push(hi, lo);
  }
  const end = bytes.indexOf(0);
  return Buffer.from(end === -1 ? bytes : bytes.slice(0, end)).toString('latin1').replace(/[^\x20-\x7e]/g, '').trim();
};

const modbusRead = async (cfg) => {
  const fc = cfg.register_type === 'input' ? 4 : 3;
  const pdu = Buffer.alloc(5);
  pdu[0] = fc;
  pdu.writeUInt16BE(cfg.start_address, 1);
  pdu.writeUInt16BE(cfg.word_count, 3);
  const res = await modbusRequest(cfg.host, cfg.port, cfg.unit_id, pdu);
  const raw = [];
  for (let i = 0; i < res[1] / 2; i++) raw.push(res.readUInt16BE(2 + i * 2));
  const sn = wordsToAscii(raw, cfg.byte_order);

  // อ่านแล้วล้าง register (holding เท่านั้น) กันอ่านค่าเดิมซ้ำ
  if (sn && cfg.clear_after_read && fc === 3) {
    const w = Buffer.alloc(6 + cfg.word_count * 2);
    w[0] = 16;
    w.writeUInt16BE(cfg.start_address, 1);
    w.writeUInt16BE(cfg.word_count, 3);
    w[5] = cfg.word_count * 2;
    await modbusRequest(cfg.host, cfg.port, cfg.unit_id, w);
  }
  return { sn, raw };
};

const parseModbusCfg = (b) => {
  const cfg = {
    host: String(b.modbus_host || b.host || '').trim(),
    port: Number(b.modbus_port ?? b.port ?? 502),
    unit_id: Number(b.unit_id ?? 1),
    register_type: b.register_type === 'input' ? 'input' : 'holding',
    start_address: Number(b.start_address ?? 0),
    word_count: Number(b.word_count ?? 20),
    byte_order: b.byte_order === 'LE' ? 'LE' : 'BE',
    clear_after_read: Boolean(b.clear_after_read),
  };
  if (!isPrivateIPv4(cfg.host)) throw new Error('IP เครื่องสแกนต้องเป็น IP ภายใน (10.x / 172.16-31.x / 192.168.x)');
  if (!validPort(cfg.port)) throw new Error('Port ไม่ถูกต้อง');
  if (!Number.isInteger(cfg.unit_id) || cfg.unit_id < 0 || cfg.unit_id > 255) throw new Error('Unit ID ต้องอยู่ระหว่าง 0-255');
  if (!Number.isInteger(cfg.start_address) || cfg.start_address < 0 || cfg.start_address > 65535) throw new Error('Address เริ่มต้นไม่ถูกต้อง');
  if (!Number.isInteger(cfg.word_count) || cfg.word_count < 1 || cfg.word_count > 123) throw new Error('จำนวน word ต้องอยู่ระหว่าง 1-123');
  return cfg;
};

// ------------------------------------------
// HTTP (เฉพาะ 127.0.0.1)
// ------------------------------------------
const setCors = (req, res) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    // Chrome / Edge: หน้าเว็บใน network ภายในเรียก localhost ต้องมี header นี้
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
  }
};

const sendJson = (res, status, data) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
};

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 10000) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error('JSON ไม่ถูกต้อง'));
      }
    });
    req.on('error', reject);
  });

const server = http.createServer(async (req, res) => {
  setCors(req, res);
  const origin = req.headers.origin;
  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    return sendJson(res, 403, { success: false, message: `ไม่อนุญาตเว็บ ${origin} (ตั้งใน MES_BRIDGE_ORIGINS)` });
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }
  const url = new URL(req.url, 'http://127.0.0.1');
  try {
    if (req.method === 'GET' && url.pathname === '/health') {
      return sendJson(res, 200, { success: true, name: 'mes-bridge', version: VERSION });
    }
    if (req.method === 'POST' && url.pathname === '/tcp/read') {
      const b = await readBody(req);
      const host = String(b.host || '').trim();
      const port = Number(b.port ?? 9004);
      const after = b.after === null || b.after === undefined ? null : Number(b.after);
      if (!isPrivateIPv4(host)) throw new Error('IP เครื่องสแกนต้องเป็น IP ภายใน (10.x / 172.16-31.x / 192.168.x)');
      if (!validPort(port)) throw new Error('Port ไม่ถูกต้อง');
      if (after !== null && !Number.isInteger(after)) throw new Error('after ไม่ถูกต้อง');
      return sendJson(res, 200, { success: true, ...(await tcpRead({ host, port, after })) });
    }
    if (req.method === 'POST' && url.pathname === '/modbus/read') {
      const cfg = parseModbusCfg(await readBody(req));
      return sendJson(res, 200, { success: true, ...(await modbusRead(cfg)) });
    }
    return sendJson(res, 404, { success: false, message: 'ไม่พบ endpoint' });
  } catch (err) {
    return sendJson(res, 502, { success: false, message: err.message });
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`❌ Port ${PORT} ถูกใช้อยู่ (เปิด MES Bridge ซ้ำอยู่แล้ว?)`);
  } else {
    console.error('❌', err.message);
  }
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  log(`✅ MES Bridge ${VERSION} พร้อมที่ http://127.0.0.1:${PORT}`);
  log(`   อนุญาตเว็บ: ${ALLOWED_ORIGINS.join(', ')}`);
  log('   เปิดหน้าต่างนี้ค้างไว้ระหว่างใช้หน้า MES Update');
});
