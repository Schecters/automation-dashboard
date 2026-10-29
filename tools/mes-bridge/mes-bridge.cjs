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
//  ข้อความในหน้าต่าง console เป็นภาษาอังกฤษ (cmd บางเครื่องแสดงภาษาไทยไม่ได้)
//  ใช้แค่ Node.js (ไม่มี package ต้องติดตั้ง)  รัน: node mes-bridge.cjs
//
//  แชร์เครื่องสแกนให้ PC อื่น (Keyence ต่อแค่ 1 connection จาก PC1, PC อื่นอ่านผ่าน Bridge ของ PC1):
//   PC1 (ต่อ Keyence)  mes-bridge.config.json: { "shareTo": ["192.168.1.92"], "peerPort": 18081 }
//   PC2 (อ่านผ่าน PC1) mes-bridge.config.json: { "upstream": "192.168.1.91:18081" }
//
//  ตั้งค่าในไฟล์ mes-bridge.config.json (โฟลเดอร์เดียวกัน) หรือ environment variable:
//   port      / MES_BRIDGE_PORT       port ของหน้าเว็บบนเครื่องนี้ (default 18080, ฟังแค่ 127.0.0.1)
//   origins   / MES_BRIDGE_ORIGINS    เว็บที่อนุญาตให้เรียก (default https://10.204.206.1:5173)
//   shareTo   / MES_BRIDGE_SHARE_TO   IP ของ PC อื่นที่ให้อ่านผ่านเครื่องนี้ (ว่าง = ไม่แชร์)
//   peerPort  / MES_BRIDGE_PEER_PORT  port ที่เปิดให้ PC อื่น (default 18081)
//   upstream  / MES_BRIDGE_UPSTREAM   "IP:port" ของ Bridge ที่ต่อ Keyence อยู่ (ตั้ง = เครื่องนี้ไม่ต่อ Keyence เอง)
// ==========================================
const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');

const VERSION = '1.3.0';

const CONFIG_FILE = path.join(__dirname, 'mes-bridge.config.json');
let fileConfig = {};
if (fs.existsSync(CONFIG_FILE)) {
  try {
    fileConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8').replace(/^﻿/, ''));
  } catch (err) {
    console.error(`[ERROR] Cannot read ${CONFIG_FILE}: ${err.message}`);
    process.exit(1);
  }
}
const listOf = (v) => (Array.isArray(v) ? v : String(v || '').split(',')).map((s) => String(s).trim()).filter(Boolean);

const PORT = Number(process.env.MES_BRIDGE_PORT || fileConfig.port || 18080);
const ALLOWED_ORIGINS = listOf(process.env.MES_BRIDGE_ORIGINS || fileConfig.origins ||
  'https://10.204.206.1:5173,https://localhost:5173,http://localhost:5173');
const SHARE_TO = listOf(process.env.MES_BRIDGE_SHARE_TO || fileConfig.shareTo);
const PEER_PORT = Number(process.env.MES_BRIDGE_PEER_PORT || fileConfig.peerPort || 18081);
const UPSTREAM = String(process.env.MES_BRIDGE_UPSTREAM || fileConfig.upstream || '').trim();
// relay: เครื่องนี้ต่อ Keyence (TCP data port) ค้างไว้ แล้วทำตัวเป็น Keyence ให้ application เครื่องอื่นต่อแทน
//  "relay": { "scanner": "192.168.1.49:9004", "listenPort": 9005, "allow": ["192.168.1.92"] }
//  listenPort = port ที่เครื่องนี้เปิดรอให้ application ต่อ (default 9005)
const RELAY = fileConfig.relay || {};
const RELAY_SCANNER = String(process.env.MES_BRIDGE_RELAY_SCANNER || RELAY.scanner || '').trim();
const RELAY_ALLOW = listOf(process.env.MES_BRIDGE_RELAY_ALLOW || RELAY.allow);
const RELAY_PORT = Number(process.env.MES_BRIDGE_RELAY_PORT || RELAY.listenPort || 9005);
//  holdUntilWeb (default true) = ถ้าหน้าเว็บ /MES กำลัง Lock อยู่ ให้รอหน้าเว็บส่ง MES เสร็จก่อน แล้วค่อยส่ง QR ต่อให้ application
//  holdTimeoutMs (default 30000) = หน้าเว็บไม่ตอบเกินเวลานี้ ส่งต่อให้ application เลย (กันค้าง)
const RELAY_HOLD = RELAY.holdUntilWeb !== false;
const RELAY_HOLD_TIMEOUT_MS = Math.max(1000, Number(RELAY.holdTimeoutMs) || 30000);

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
const TCP_IDLE_CLOSE_MS = 15 * 1000; // หน้าเว็บเลิกถามเกินนี้ -> ปิด ให้เครื่องอื่นต่อได้
const TCP_CONNECT_TIMEOUT_MS = 3000;
const tcpReaders = new Map();

// persistent = ต่อค้างตลอด ไม่ปิดเมื่อหน้าเว็บเลิกใช้ (ใช้กับ relay ที่ application เครื่องอื่นต่ออยู่)
// onRaw = รับข้อมูลดิบจากเครื่องสแกนทุก byte (relay ส่งต่อให้ application ตามเดิมทุกตัวอักษร)
// onLine(raw, seq) = รับทีละบรรทัด (ข้อมูลดิบรวมตัวขึ้นบรรทัด) seq = ลำดับ SN หรือ null ถ้าไม่ใช่ SN (ERROR / บรรทัดว่าง)
const createTcpReader = (host, port, { persistent = false, onRaw = null, onLine = null } = {}) => {
  const r = { host, port, socket: null, connected: false, lastError: null, readError: null, buffer: '',
    seq: 0, items: [], lastPollAt: Date.now(), timer: null, closed: false, persistent };

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
      log(`[OK] TCP connected ${host}:${port}`);
    });
    socket.on('timeout', () => {
      if (!r.connected) socket.destroy(new Error('เชื่อมต่อไม่ทันเวลา'));
    });
    socket.on('data', (chunk) => {
      if (onRaw) onRaw(chunk);
      r.buffer += chunk.toString('latin1'); // latin1 = เก็บทุก byte ตามเดิม
      const re = /\r\n|\r|\n/g;
      let start = 0;
      let m;
      while ((m = re.exec(r.buffer))) {
        const raw = r.buffer.slice(start, re.lastIndex);
        const line = r.buffer.slice(start, m.index).replace(/[^\x20-\x7e]/g, '').trim();
        start = re.lastIndex;
        let seq = null;
        if (/^ERROR$/i.test(line)) {
          r.readError = 'เครื่องสแกนอ่าน QR ไม่ได้ (ERROR)';
        } else if (line) {
          r.readError = null;
          r.seq += 1;
          seq = r.seq;
          r.items.push({ seq, sn: line, at: new Date().toISOString() });
          if (r.items.length > TCP_MAX_ITEMS) r.items.shift();
          log(`[SCAN] ${host}:${port} -> ${line}`);
        }
        if (onLine) onLine(raw, seq);
      }
      r.buffer = r.buffer.slice(start);
    });
    socket.on('error', (err) => {
      r.lastError = err.message;
    });
    socket.on('close', () => {
      if (r.connected) log(`[WARN] TCP ${host}:${port} disconnected, reconnecting...`);
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

const closeTcpReader = (key, reason) => {
  const r = tcpReaders.get(key);
  if (!r || r.persistent) return false; // relay ต้องต่อค้างไว้ให้ application
  r.close();
  tcpReaders.delete(key);
  log(`[INFO] TCP ${key} disconnected (${reason})`);
  return true;
};

setInterval(() => {
  for (const [key, r] of tcpReaders) {
    if (!r.persistent && Date.now() - r.lastPollAt > TCP_IDLE_CLOSE_MS) closeTcpReader(key, 'idle');
  }
}, 5000).unref();

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
  if (r.onPoll) r.onPoll(after, items);
  return { connected: true, error: r.readError, seq: r.seq, items };
};

// หน้าเว็บส่ง MES ของ SN ลำดับ seq เสร็จแล้ว (สำเร็จหรือไม่ก็ตาม) -> relay ส่ง QR นั้นต่อให้ application
const tcpRelease = ({ host, port, seq }) => {
  const r = tcpReaders.get(`${host}:${port}`);
  if (r) r.lastPollAt = Date.now();
  return { released: r?.onRelease ? r.onRelease(seq) : 0 };
};

// ------------------------------------------
// Modbus TCP (FC3 / FC4 อ่าน, FC16 เขียนล้าง) — 1 connection ต่อ host:port ใช้ทีละ request
// ------------------------------------------
const MODBUS_TIMEOUT_MS = 2000;
// Keyence รับ Modbus client ได้จำกัด (มักแค่ 1) -> ไม่ใช้งานเกินนี้ปิด connection ทันที ให้เครื่องอื่นต่อได้
// (หน้าเว็บอ่านทุก ~0.7 วินาที ระหว่าง Lock จึงยังต่อค้างไว้)
const MODBUS_IDLE_CLOSE_MS = 3000;
const modbusConns = new Map(); // key -> conn ที่ต่อแล้ว
const modbusConnecting = new Map(); // key -> Promise<conn> กันเปิดหลาย connection พร้อมกัน

const closeModbusConn = (key, reason) => {
  const conn = modbusConns.get(key);
  if (!conn) return false;
  modbusConns.delete(key);
  clearTimeout(conn.idleTimer);
  // ปิดแบบสุภาพ (FIN) ให้เครื่องสแกนรู้ว่าเลิกใช้แล้ว ถ้าไม่ปิดเองใน 1 วินาทีค่อยตัดทิ้ง
  conn.socket.end();
  setTimeout(() => conn.socket.destroy(), 1000).unref();
  log(`[INFO] Modbus ${key} disconnected (${reason})`);
  return true;
};

const touchModbusConn = (key, conn) => {
  clearTimeout(conn.idleTimer);
  conn.idleTimer = setTimeout(() => closeModbusConn(key, 'idle'), MODBUS_IDLE_CLOSE_MS);
};

const getModbusConn = (host, port) => {
  const key = `${host}:${port}`;
  const existing = modbusConns.get(key);
  if (existing && !existing.socket.destroyed && existing.ready) return Promise.resolve(existing);
  if (modbusConnecting.has(key)) return modbusConnecting.get(key);
  const promise = new Promise((resolve, reject) => {
    const conn = { socket: null, buffer: Buffer.alloc(0), pending: null, queue: Promise.resolve(), tid: 0, ready: false, idleTimer: null };
    const socket = net.createConnection({ host, port });
    conn.socket = socket;
    socket.setTimeout(MODBUS_TIMEOUT_MS);
    socket.once('connect', () => {
      conn.ready = true;
      socket.setTimeout(0);
      modbusConns.set(key, conn);
      log(`[OK] Modbus connected ${key}`);
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
      clearTimeout(conn.idleTimer);
      if (modbusConns.get(key) === conn) modbusConns.delete(key);
      if (conn.pending) {
        clearTimeout(conn.pending.timer);
        conn.pending.reject(new Error('connection ถูกปิด'));
        conn.pending = null;
      }
    });
  });
  modbusConnecting.set(key, promise);
  const clear = () => modbusConnecting.delete(key);
  promise.then(clear, clear);
  return promise;
};

const MODBUS_EXCEPTIONS = { 1: 'Illegal function', 2: 'Illegal data address', 3: 'Illegal data value', 4: 'Device failure' };

const modbusRequest = async (host, port, unitId, pdu) => {
  const conn = await getModbusConn(host, port);
  clearTimeout(conn.idleTimer); // กำลังใช้งาน ห้ามปิดกลางคัน
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
  const res = await run.finally(() => touchModbusConn(`${host}:${port}`, conn));
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

// ------------------------------------------
// อ่านเครื่องสแกน (ใช้ทั้งหน้าเว็บบนเครื่องนี้ และ PC อื่นที่อ่านผ่านเครื่องนี้)
// ------------------------------------------
const SCANNER_PATHS = ['/tcp/read', '/tcp/release', '/modbus/read'];
const readScanner = async (pathname, b) => {
  if (pathname === '/tcp/read' || pathname === '/tcp/release') {
    const host = String(b.host || '').trim();
    const port = Number(b.port ?? 9004);
    const after = b.after === null || b.after === undefined ? null : Number(b.after);
    if (!isPrivateIPv4(host)) throw new Error('IP เครื่องสแกนต้องเป็น IP ภายใน (10.x / 172.16-31.x / 192.168.x)');
    if (!validPort(port)) throw new Error('Port ไม่ถูกต้อง');
    if (after !== null && !Number.isInteger(after)) throw new Error('after ไม่ถูกต้อง');
    if (pathname === '/tcp/release') {
      const seq = Number(b.seq);
      if (!Number.isInteger(seq)) throw new Error('seq ไม่ถูกต้อง');
      return tcpRelease({ host, port, seq });
    }
    return tcpRead({ host, port, after });
  }
  // /modbus/read
  const cfg = parseModbusCfg(b);
  try {
    return await modbusRead(cfg);
  } finally {
    // ทดสอบจากหน้าตั้งค่า: อ่านเสร็จปิดทันที ไม่ถือ connection ไว้
    if (b.close) closeModbusConn(`${cfg.host}:${cfg.port}`, 'test done');
  }
};

// เครื่องนี้ตั้ง upstream: ส่งคำขอต่อไปให้ Bridge ของ PC ที่ต่อ Keyence (ไม่ต่อ Keyence เอง)
const UPSTREAM_TIMEOUT_MS = 6000;
const forwardUpstream = (pathname, body) =>
  new Promise((resolve, reject) => {
    const [upHost, upPort] = UPSTREAM.split(':');
    const data = JSON.stringify(body);
    const req = http.request(
      {
        host: upHost,
        port: Number(upPort || 18081),
        path: pathname,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
        timeout: UPSTREAM_TIMEOUT_MS,
      },
      (res) => {
        let out = '';
        res.on('data', (c) => {
          out += c;
        });
        res.on('end', () => {
          try {
            const j = JSON.parse(out);
            if (!j.success) return reject(new Error(`[${UPSTREAM}] ${j.message}`));
            resolve(j);
          } catch {
            reject(new Error(`Bridge ${UPSTREAM} ตอบกลับไม่ถูกต้อง`));
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('ไม่ตอบภายในเวลาที่กำหนด')));
    req.on('error', (err) => reject(new Error(`ต่อ Bridge ของ PC ที่ต่อเครื่องสแกน (${UPSTREAM}) ไม่ได้: ${err.message}`)));
    req.end(data);
  });

const handleRead = async (pathname, body) => {
  if (UPSTREAM) {
    const { success, ...rest } = await forwardUpstream(pathname, { ...body, close: false });
    return rest;
  }
  return readScanner(pathname, body);
};

// ------------------------------------------
// HTTP สำหรับหน้าเว็บบนเครื่องนี้ (ฟังแค่ 127.0.0.1)
// ------------------------------------------
const server = http.createServer(async (req, res) => {
  setCors(req, res);
  const origin = req.headers.origin;
  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    return sendJson(res, 403, { success: false, message: `ไม่อนุญาตเว็บ ${origin} (ตั้งใน origins ของ mes-bridge.config.json)` });
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }
  const url = new URL(req.url, 'http://127.0.0.1');
  try {
    if (req.method === 'GET' && url.pathname === '/health') {
      return sendJson(res, 200, { success: true, name: 'mes-bridge', version: VERSION, upstream: UPSTREAM || null });
    }
    if (req.method === 'POST' && SCANNER_PATHS.includes(url.pathname)) {
      const body = await readBody(req);
      return sendJson(res, 200, { success: true, ...(await handleRead(url.pathname, body)) });
    }
    // หน้าเว็บเลิกใช้ (Unlock / ปิดหน้า / เปลี่ยนการตั้งค่า) -> ปิด connection ทันที ให้เครื่องอื่นต่อได้
    // body { host, port } หรือ {} = ปิดทั้งหมด
    // (เครื่องที่ใช้ upstream ไม่ปิดฝั่ง PC1 เพราะหน้าเว็บของ PC1 อาจยังใช้อยู่ — PC1 ปิดเองเมื่อไม่มีใครถาม)
    if (req.method === 'POST' && url.pathname === '/disconnect') {
      const b = await readBody(req);
      const host = String(b.host || '').trim();
      const closed = [];
      const match = (key) => !host || key === `${host}:${Number(b.port)}`;
      for (const key of [...modbusConns.keys()]) if (match(key) && closeModbusConn(key, 'web page')) closed.push(`modbus ${key}`);
      for (const key of [...tcpReaders.keys()]) if (match(key) && closeTcpReader(key, 'web page')) closed.push(`tcp ${key}`);
      return sendJson(res, 200, { success: true, closed });
    }
    return sendJson(res, 404, { success: false, message: 'ไม่พบ endpoint' });
  } catch (err) {
    return sendJson(res, 502, { success: false, message: err.message });
  }
});

// ------------------------------------------
// HTTP สำหรับ PC อื่นที่อ่านเครื่องสแกนผ่านเครื่องนี้ (เปิดเมื่อตั้ง shareTo, รับเฉพาะ IP ที่ระบุ)
// ------------------------------------------
const remoteIp = (req) => String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');

const peerServer = SHARE_TO.length
  ? http.createServer(async (req, res) => {
      const ip = remoteIp(req);
      if (!SHARE_TO.includes(ip)) {
        log(`[WARN] Rejected peer ${ip} (not in shareTo)`);
        return sendJson(res, 403, { success: false, message: `PC ${ip} ไม่ได้รับอนุญาต (เพิ่มใน shareTo ของ PC ที่ต่อเครื่องสแกน)` });
      }
      const url = new URL(req.url, 'http://127.0.0.1');
      try {
        if (req.method === 'GET' && url.pathname === '/health') {
          return sendJson(res, 200, { success: true, name: 'mes-bridge', version: VERSION });
        }
        if (req.method === 'POST' && SCANNER_PATHS.includes(url.pathname)) {
          const body = await readBody(req);
          // PC อื่นอ่านอย่างเดียว: ไม่ล้าง register (กันหน้าเว็บของเครื่องนี้พลาดค่า) และไม่สั่งปิด connection
          return sendJson(res, 200, { success: true, ...(await readScanner(url.pathname, { ...body, clear_after_read: false, close: false })) });
        }
        return sendJson(res, 404, { success: false, message: 'ไม่พบ endpoint' });
      } catch (err) {
        return sendJson(res, 502, { success: false, message: err.message });
      }
    })
  : null;

// error ที่ไม่ได้คาดไว้: บันทึกสาเหตุให้เห็นในหน้าต่างก่อนปิด (start-mes-bridge.bat จะเปิดใหม่เอง)
process.on('uncaughtException', (err) => {
  console.error(`${new Date().toLocaleString('sv-SE')} [ERROR] MES Bridge crashed: ${err.stack || err.message}`);
  process.exit(1);
});
process.on('unhandledRejection', (err) => {
  console.error(`${new Date().toLocaleString('sv-SE')} [ERROR] Unhandled: ${err?.stack || err}`);
});

const exitOnListenError = (port) => (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[ERROR] Port ${port} is already in use (MES Bridge already running?)`);
  } else {
    console.error('[ERROR]', err.message);
  }
  process.exit(1);
};

server.on('error', exitOnListenError(PORT));
server.listen(PORT, '127.0.0.1', () => {
  log(`[OK] MES Bridge ${VERSION} is running at http://127.0.0.1:${PORT}`);
  log(`     Allowed web: ${ALLOWED_ORIGINS.join(', ')}`);
  if (UPSTREAM) log(`     Reading scanner through Bridge at ${UPSTREAM} (this PC does not connect to the scanner)`);
  log('     Keep this window open while using the MES Update page.');
});

if (peerServer) {
  peerServer.on('error', exitOnListenError(PEER_PORT));
  peerServer.listen(PEER_PORT, '0.0.0.0', () => {
    log(`[OK] Sharing scanner to other PCs on port ${PEER_PORT}: ${SHARE_TO.join(', ')}`);
    log('     (Windows Firewall must allow inbound TCP port ' + PEER_PORT + ')');
  });
}

// ------------------------------------------
// Relay: ต่อ Keyence (TCP data port) จากเครื่องนี้ครั้งเดียว แล้วเปิด port ให้ application เครื่องอื่นต่อเหมือนต่อ Keyence
//  - ข้อมูลจาก Keyence ส่งต่อให้ทุก application ตามเดิมทุก byte และหน้าเว็บบนเครื่องนี้ก็ได้ค่าเดียวกัน
//  - ข้อมูลจาก application (เช่นคำสั่ง) ส่งต่อไปที่ Keyence
//  - รับเฉพาะ IP ใน allow
// ------------------------------------------
if (RELAY_SCANNER) {
  const [scanHost, scanPortText] = RELAY_SCANNER.split(':');
  const scanPort = Number(scanPortText || 9004);
  if (!isPrivateIPv4(scanHost) || !validPort(scanPort)) {
    console.error(`[ERROR] relay.scanner must be "IP:port" of the scanner (got "${RELAY_SCANNER}")`);
    process.exit(1);
  }
  if (!RELAY_ALLOW.length) {
    console.error('[ERROR] relay.allow is empty: list the IP of each PC whose application connects to this relay');
    process.exit(1);
  }

  const relayClients = new Set();
  const key = `${scanHost}:${scanPort}`;
  const sendToClients = (buf) => {
    for (const c of relayClients) if (!c.destroyed) c.write(buf);
  };

  // คิว QR ที่รอหน้าเว็บส่ง MES เสร็จ (ส่งต่อตามลำดับเสมอ ตัวหน้ายังไม่ปล่อย ตัวหลังก็รอ)
  //  taken    = หน้าเว็บรับ SN นี้ไปแล้ว รอ /tcp/release
  //  released = ส่งต่อได้
  const WEB_ACTIVE_MS = 3000; // หน้าเว็บถามเครื่องสแกนทุก ~0.7 วิ เงียบเกินนี้ = ไม่ได้ Lock / ปิดหน้าไปแล้ว
  const queue = [];
  const webActive = () => Date.now() - reader.lastPollAt < WEB_ACTIVE_MS;
  const flush = () => {
    const active = webActive();
    while (queue.length) {
      const q = queue[0];
      if (!q.released) {
        if (q.taken && Date.now() - q.takenAt >= RELAY_HOLD_TIMEOUT_MS) {
          log(`[WARN] Relay: web page did not finish seq ${q.seq} in ${RELAY_HOLD_TIMEOUT_MS} ms, forwarding anyway`);
        } else if (q.taken || active) {
          break;
        }
      }
      queue.shift();
      sendToClients(Buffer.from(q.raw, 'latin1'));
      if (q.seq !== null && q.waited) log(`[INFO] Relay: forwarded seq ${q.seq} to application`);
    }
  };

  const reader = createTcpReader(scanHost, scanPort, {
    persistent: true,
    ...(RELAY_HOLD
      ? {
          onLine: (raw, seq) => {
            queue.push({ raw, seq, released: seq === null, taken: false, takenAt: 0, waited: webActive() });
            flush();
          },
        }
      : { onRaw: sendToClients }),
  });
  reader.lastPollAt = 0; // ยังไม่มีหน้าเว็บถาม
  if (RELAY_HOLD) {
    reader.onPoll = (after, items) => {
      // after = null: หน้าเว็บเพิ่งเริ่ม ไม่ส่ง SN ที่สแกนไว้ก่อนหน้า / SN ที่หน้าเว็บข้ามไป -> ส่งต่อเลย
      for (const q of queue) {
        if (q.seq === null || q.taken) continue;
        if (after === null || q.seq <= after) q.released = true;
      }
      const seqs = new Set(items.map((i) => i.seq));
      for (const q of queue) {
        if (seqs.has(q.seq) && !q.taken) {
          q.taken = true;
          q.takenAt = Date.now();
        }
      }
      flush();
    };
    reader.onRelease = (seq) => {
      let n = 0;
      for (const q of queue) {
        if (q.seq !== null && q.seq <= seq && !q.released) {
          q.released = true;
          n += 1;
        }
      }
      flush();
      return n;
    };
    setInterval(flush, 200).unref();
  }
  tcpReaders.set(key, reader); // หน้าเว็บบนเครื่องนี้ที่ตั้งเครื่องสแกนเดียวกัน ใช้ connection นี้ร่วม

  const relayServer = net.createServer((sock) => {
    const ip = String(sock.remoteAddress || '').replace(/^::ffff:/, '');
    if (!RELAY_ALLOW.includes(ip)) {
      log(`[WARN] Relay rejected ${ip} (not in relay.allow)`);
      sock.destroy();
      return;
    }
    relayClients.add(sock);
    log(`[OK] Relay client connected ${ip} (${relayClients.size} connected)`);
    sock.setKeepAlive(true, 10000);
    sock.on('data', (chunk) => {
      // คำสั่งจาก application ส่งต่อไปที่ Keyence
      if (reader.socket && reader.connected) reader.socket.write(chunk);
    });
    let lastError = '';
    sock.on('error', (err) => {
      lastError = err.message;
    });
    sock.on('end', () => {
      lastError = lastError || 'closed by the application';
    });
    sock.on('close', () => {
      relayClients.delete(sock);
      log(`[INFO] Relay client disconnected ${ip}: ${lastError || 'connection closed'} (${relayClients.size} connected)`);
    });
  });
  relayServer.on('error', exitOnListenError(RELAY_PORT));
  relayServer.listen(RELAY_PORT, '0.0.0.0', () => {
    log(`[OK] Relay: scanner ${key} -> port ${RELAY_PORT} for ${RELAY_ALLOW.join(', ')}`);
    if (RELAY_HOLD) log('     While the MES page is locked, each QR is forwarded after the page finishes sending to MES');
    log(`     Set the application on those PCs to connect to THIS PC's IP, port ${RELAY_PORT}`);
    log(`     (Windows Firewall must allow inbound TCP port ${RELAY_PORT})`);
  });
}
