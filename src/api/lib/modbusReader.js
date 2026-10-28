import ModbusRTU from 'modbus-serial';

// ==========================================
// 📟 อ่าน QR / Serial จากเครื่องสแกน Keyence ผ่าน Modbus TCP
//  ค่าเก็บเป็น ASCII ใน register ต่อกัน (1 word = 2 ตัวอักษร)
//  ตั้งค่าได้ต่อ station: host, port, unit_id, holding/input, address เริ่ม, จำนวน word, ลำดับ byte
// ==========================================

const TIMEOUT_MS = 2000;
const MAX_WORDS = 125; // ข้อจำกัดของ Modbus ต่อ 1 request

const clients = new Map(); // `${host}:${port}` -> { client, busy: Promise }

const getClient = async (host, port) => {
  const key = `${host}:${port}`;
  let entry = clients.get(key);
  if (entry?.client.isOpen) return entry;

  if (entry) {
    try { entry.client.close(() => {}); } catch { /* ปิดไม่ได้ก็สร้างใหม่ */ }
  }
  const client = new ModbusRTU();
  client.setTimeout(TIMEOUT_MS);
  await client.connectTCP(host, { port });
  entry = { client, busy: Promise.resolve() };
  clients.set(key, entry);
  return entry;
};

// 1 connection ใช้ทีละ request (หลาย station อาจใช้เครื่องสแกนเดียวกัน)
const withClient = async (host, port, fn) => {
  const entry = await getClient(host, port);
  const run = entry.busy.then(() => fn(entry.client));
  entry.busy = run.catch(() => {});
  try {
    return await run;
  } catch (err) {
    // connection เสีย -> ทิ้งไปให้ต่อใหม่รอบหน้า
    try { entry.client.close(() => {}); } catch { /* ignore */ }
    clients.delete(`${host}:${port}`);
    throw err;
  }
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
  return Buffer.from(end === -1 ? bytes : bytes.slice(0, end))
    .toString('latin1')
    .replace(/[^\x20-\x7e]/g, '')
    .trim();
};

export const validateModbusConfig = (cfg) => {
  const host = String(cfg.modbus_host || '').trim();
  const port = Number(cfg.modbus_port || 502);
  const unitId = Number(cfg.unit_id ?? 1);
  const start = Number(cfg.start_address ?? 0);
  const count = Number(cfg.word_count ?? 0);
  if (!/^[\w.-]+$/.test(host)) return 'IP ของเครื่องสแกนไม่ถูกต้อง';
  if (!Number.isInteger(port) || port < 1 || port > 65535) return 'Port ไม่ถูกต้อง';
  if (!Number.isInteger(unitId) || unitId < 0 || unitId > 255) return 'Unit ID ต้องอยู่ระหว่าง 0-255';
  if (!Number.isInteger(start) || start < 0 || start > 65535) return 'Address เริ่มต้นไม่ถูกต้อง';
  if (!Number.isInteger(count) || count < 1 || count > MAX_WORDS) return `จำนวน word ต้องอยู่ระหว่าง 1-${MAX_WORDS}`;
  if (!['holding', 'input'].includes(cfg.register_type)) return 'ชนิด register ต้องเป็น holding หรือ input';
  if (!['BE', 'LE'].includes(cfg.byte_order)) return 'ลำดับ byte ต้องเป็น BE หรือ LE';
  return null;
};

// คืน { text, raw } — text ว่าง = ยังไม่มีการสแกน
export const readScan = async (cfg) => {
  const host = String(cfg.modbus_host).trim();
  const port = Number(cfg.modbus_port || 502);
  const start = Number(cfg.start_address);
  const count = Number(cfg.word_count);

  return withClient(host, port, async (client) => {
    client.setID(Number(cfg.unit_id ?? 1));
    const res = cfg.register_type === 'input'
      ? await client.readInputRegisters(start, count)
      : await client.readHoldingRegisters(start, count);
    const raw = res.data;
    const text = wordsToAscii(raw, cfg.byte_order);

    // อ่านแล้วล้าง register (holding เท่านั้น) กันอ่านค่าเดิมซ้ำ
    if (text && cfg.clear_after_read && cfg.register_type === 'holding') {
      await client.writeRegisters(start, new Array(count).fill(0));
    }
    return { text, raw };
  });
};
