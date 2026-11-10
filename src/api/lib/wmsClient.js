import { WMS_AUTH_BASE, WMS_API_BASE, WMS_API_USER, WMS_API_PASSWORD } from './config.js';

// ==========================================
// 📦 เรียก WMS (http://10.204.212.28:5207) — ต้องมี token จาก login ที่ 15000
//  - login อัตโนมัติด้วยบัญชีใน .env (WMS_API_USER / WMS_API_PASSWORD) แล้วจำ token ไว้ในหน่วยความจำ
//  - token ใกล้หมด (เหลือ < 2 นาที) หรือ WMS ตอบ 401 -> login ใหม่ทันทีแล้วลองอีกครั้ง
//  - หลาย request พร้อมกันตอน token หมด -> login ครั้งเดียว (ใช้ promise ร่วมกัน)
// ==========================================
const TIMEOUT_MS = 15000;
const REFRESH_BEFORE_MS = 2 * 60 * 1000;

export class WmsError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

let cached = null; // { token, expiresAt }
let loginPromise = null;

const jwtExpiry = (token) => {
  try {
    const payload = JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString('utf8'));
    return payload.exp ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
};

const login = async () => {
  if (!WMS_API_USER || !WMS_API_PASSWORD) {
    throw new WmsError('ยังไม่ได้ตั้งบัญชี WMS (WMS_API_USER / WMS_API_PASSWORD ใน .env ของ server)', 503);
  }
  let res;
  try {
    res = await fetch(`${WMS_AUTH_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: WMS_API_USER, password: WMS_API_PASSWORD }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new WmsError(`ต่อระบบ login WMS ไม่ได้: ${err.message}`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.token) {
    throw new WmsError(`login WMS ไม่สำเร็จ (HTTP ${res.status}) — ตรวจสอบ WMS_API_USER / WMS_API_PASSWORD`, 502);
  }
  // ไม่มี exp ใน token -> ถือว่าใช้ได้ 30 นาที
  cached = { token: data.token, expiresAt: jwtExpiry(data.token) || Date.now() + 30 * 60 * 1000 };
  console.log(`🔑 login WMS สำเร็จ (token หมดอายุ ${new Date(cached.expiresAt).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })})`);
  return cached.token;
};

const getToken = async (force = false) => {
  if (!force && cached && cached.expiresAt - Date.now() > REFRESH_BEFORE_MS) return cached.token;
  if (!loginPromise) {
    loginPromise = login().finally(() => {
      loginPromise = null;
    });
  }
  return loginPromise;
};

// GET JSON จาก WMS (401 -> login ใหม่แล้วลองอีก 1 ครั้ง)
export const wmsGet = async (pathAndQuery) => {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await getToken(attempt > 0);
    let res;
    try {
      res = await fetch(`${WMS_API_BASE}${pathAndQuery}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      throw new WmsError(`ต่อ WMS ไม่ได้: ${err.message}`);
    }
    if (res.status === 401 && attempt === 0) {
      cached = null; // token ใช้ไม่ได้แล้ว (หมดอายุ / ถูกยกเลิก)
      continue;
    }
    if (!res.ok) {
      // แนบข้อความจาก WMS ด้วย (เช่น WMS ตอบ 404 แต่ข้างในคือ "...status code ... 403" = ระบบหลังบ้านของ WMS ปฏิเสธ ไม่ใช่ไม่มี WO)
      const body = await res.json().catch(() => null);
      const detail = body?.message ? ` — ${String(body.message).slice(0, 200)}` : '';
      if (res.status === 404 && !/status code/i.test(detail)) throw new WmsError(`ไม่พบข้อมูลใน WMS${detail}`, 404);
      throw new WmsError(`WMS ตอบ HTTP ${res.status}${detail}`, 502);
    }
    return res.json();
  }
  throw new WmsError('WMS ไม่ยอมรับ token (login ใหม่แล้วยังได้ 401)');
};

// หา WO ใน tree (WO หลัก + WO ลูก)
const findInTree = (nodes, mo) => {
  for (const n of Array.isArray(nodes) ? nodes : []) {
    if (String(n.moNumber) === String(mo)) return n;
    const found = findInTree(n.children, mo);
    if (found) return found;
  }
  return null;
};

// ความคืบหน้าของ WO (ส่งเฉพาะที่หน้าเว็บใช้ ไม่ส่งรายการวัตถุดิบ)
//  ใช้ /workorder/tree/<WO> เป็นหลัก (target / input / output / fail / scrap — ไม่มี line และวันที่)
//  ไม่พบ WO ใน tree -> ลอง /workorder/<WO>/detail
//  (10/11/2026 /detail ตอบ 404 "...403" ทุก WO เป็นปัญหาฝั่ง WMS จึงเปลี่ยนมาใช้ tree)
export const getWorkOrderProgress = async (mo) => {
  const path = encodeURIComponent(mo);
  let d = null;
  let treeErr = null;
  try {
    d = findInTree((await wmsGet(`/workorder/tree/${path}`))?.data, mo);
  } catch (err) {
    if (!(err instanceof WmsError) || err.status === 503) throw err; // ยังไม่ตั้งบัญชี / login ไม่ได้ -> ไม่ต้องลองอีกทาง
    treeErr = err;
  }
  if (!d) {
    try {
      d = await wmsGet(`/workorder/${path}/detail`);
    } catch (err) {
      throw treeErr && err.status === 404 && !/WorkOrder not found/i.test(err.message) ? treeErr : err;
    }
  }
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  return {
    mo: String(d.moNumber || mo),
    model: d.modelName || '',
    line: d.lineName || '',
    status: d.status ?? null,
    target_qty: num(d.targetQty),
    input_qty: num(d.inputQty),
    output_qty: num(d.outputQty),
    fail_qty: num(d.failQty),
    scrap_qty: num(d.scrapQty),
    schedule_date: d.sceheduleDate || null,
    target_date: d.targetDate || null,
    updated_at: d.updateDate || null,
  };
};
