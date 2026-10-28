import net from 'net';

// ==========================================
// 📟 รับค่าจากเครื่องสแกน Keyence ผ่าน TCP data port (เช่น 9004)
//  เครื่องสแกนส่งผลอ่านแต่ละครั้งมาเป็นบรรทัด (ปิดท้ายด้วย CR / LF)
//  server ต่อค้างไว้ 1 connection ต่อเครื่องสแกน แล้วเก็บรายการที่ได้รับไว้ (มีเลขลำดับ seq)
//  หน้าเว็บมาถามว่ามีอะไรใหม่หลัง seq ที่เคยได้ → สแกนชิ้นเดิมซ้ำก็นับเป็นการสแกนใหม่
// ==========================================

const MAX_ITEMS = 50;
const RECONNECT_MS = 3000;
const IDLE_CLOSE_MS = 5 * 60 * 1000; // ไม่มีหน้าเว็บมาถาม 5 นาที -> ปิด connection
const CONNECT_TIMEOUT_MS = 3000;

const readers = new Map(); // `${host}:${port}` -> reader

// ข้อความที่ไม่ใช่ผลอ่าน (Keyence ส่ง "ERROR" เมื่ออ่านไม่ได้)
const isReadError = (line) => /^ERROR$/i.test(line);

const createReader = (host, port) => {
  const reader = {
    host,
    port,
    socket: null,
    connected: false,
    lastError: null,
    buffer: '',
    seq: 0,
    items: [], // { seq, sn, at }
    lastPollAt: Date.now(),
    reconnectTimer: null,
    closed: false,
  };

  const connect = () => {
    if (reader.closed) return;
    const socket = net.createConnection({ host, port });
    reader.socket = socket;
    socket.setKeepAlive(true, 10000);
    socket.setTimeout(CONNECT_TIMEOUT_MS);

    socket.on('connect', () => {
      reader.connected = true;
      reader.lastError = null;
      socket.setTimeout(0);
    });
    socket.on('timeout', () => {
      if (!reader.connected) socket.destroy(new Error('เชื่อมต่อไม่ทันเวลา'));
    });
    socket.on('data', (chunk) => {
      reader.buffer += chunk.toString('latin1');
      const parts = reader.buffer.split(/\r\n|\r|\n/);
      reader.buffer = parts.pop(); // ส่วนท้ายที่ยังไม่จบบรรทัด
      for (const part of parts) {
        const line = part.replace(/[^\x20-\x7e]/g, '').trim();
        if (!line) continue;
        if (isReadError(line)) {
          reader.lastError = 'เครื่องสแกนอ่าน QR ไม่ได้ (ERROR)';
          continue;
        }
        reader.lastError = null;
        reader.seq += 1;
        reader.items.push({ seq: reader.seq, sn: line, at: new Date().toISOString() });
        if (reader.items.length > MAX_ITEMS) reader.items.shift();
      }
    });
    socket.on('error', (err) => {
      reader.lastError = err.message;
    });
    socket.on('close', () => {
      reader.connected = false;
      reader.socket = null;
      if (reader.closed) return;
      // หลุด -> ต่อใหม่อัตโนมัติ
      reader.reconnectTimer = setTimeout(connect, RECONNECT_MS);
    });
  };

  reader.close = () => {
    reader.closed = true;
    clearTimeout(reader.reconnectTimer);
    reader.socket?.destroy();
  };

  connect();
  return reader;
};

const getReader = (host, port) => {
  const key = `${host}:${port}`;
  let reader = readers.get(key);
  if (!reader) {
    reader = createReader(host, port);
    readers.set(key, reader);
  }
  reader.lastPollAt = Date.now();
  return reader;
};

// ปิด connection ที่ไม่มีใครใช้แล้ว
setInterval(() => {
  for (const [key, reader] of readers) {
    if (Date.now() - reader.lastPollAt > IDLE_CLOSE_MS) {
      reader.close();
      readers.delete(key);
    }
  }
}, 60000).unref();

const waitConnected = (reader, ms) =>
  new Promise((resolve) => {
    if (reader.connected) return resolve();
    const started = Date.now();
    const timer = setInterval(() => {
      if (reader.connected || Date.now() - started >= ms) {
        clearInterval(timer);
        resolve();
      }
    }, 50);
  });

// after = seq ล่าสุดที่หน้าเว็บได้รับไปแล้ว (null = เพิ่งเริ่ม ไม่ต้องส่งของเก่า)
// คืน { connected, error, seq, items }
export const pollTcpScans = async ({ host, port, after }) => {
  const reader = getReader(host, port);
  await waitConnected(reader, CONNECT_TIMEOUT_MS);
  const items = after === null || after === undefined ? [] : reader.items.filter((i) => i.seq > after);
  // seq ของ reader เริ่มใหม่ (server restart) แต่หน้าเว็บยังจำ seq เก่า -> ส่งทั้งหมดที่มี
  const reset = after !== null && after !== undefined && after > reader.seq;
  return {
    connected: reader.connected,
    error: reader.connected ? (reader.lastError && /ERROR/.test(reader.lastError) ? reader.lastError : null) : reader.lastError,
    seq: reader.seq,
    items: reset ? reader.items : items,
  };
};
