import { MES_API_BASE, MES_INPUT_UPDATE_PATH } from './config.js';

// ==========================================
// 🏭 เรียก MES API (http://10.204.212.22:5207)
//  - lineinfo : [{ LINE_NAME, SECTION_NAME, GROUP_NAME, STATION_NAME }]
//  - molist   : [{ MO_NUMBER, MODEL_NAME, LINE_NAME }] (พารามิเตอร์ line ของ MES ไม่กรอง ต้องกรองเอง)
//  - routing-update : POST /api/mes/tdc/typed/routing-update
//                     { routingData: ["SN}MO}MODEL}LINE}SECTION}GROUP}STATION}}PASS|FAIL}EMPNO}1"], testData: "" }
//  - input-update   : POST MES_INPUT_UPDATE_PATH (default /api/mes/tdc/input-update)
// ==========================================

const MES_TIMEOUT_MS = 10000;

export class MesError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

const mesFetch = async (pathAndQuery, options = {}) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MES_TIMEOUT_MS);
  try {
    const res = await fetch(`${MES_API_BASE}${pathAndQuery}`, { ...options, signal: controller.signal });
    const text = await res.text();
    let body = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      // MES ตอบเป็นข้อความธรรมดา
    }
    if (!res.ok) {
      // MES ตอบ error เป็น { message } หรือข้อความธรรมดา (เช่น "routingData is required")
      // หรือ { error, raw: { result, description } }
      const detail = body && typeof body === 'object'
        ? body.message || body.raw?.description || body.error || ''
        : typeof body === 'string' ? body.trim().slice(0, 300) : '';
      const msg = detail ? `MES ตอบกลับ HTTP ${res.status}: ${detail}` : `MES ตอบกลับ HTTP ${res.status}`;
      throw new MesError(msg, res.status, body);
    }
    return { status: res.status, body, text };
  } catch (err) {
    if (err instanceof MesError) throw err;
    if (err.name === 'AbortError') throw new MesError('MES ไม่ตอบกลับภายในเวลาที่กำหนด', 504);
    throw new MesError(`เชื่อมต่อ MES ไม่ได้: ${err.message}`, 502);
  } finally {
    clearTimeout(timer);
  }
};

export const getLineInfo = async (empNo, line = 'ALL') => {
  const qs = new URLSearchParams({ empNo, line: line || 'ALL' });
  const { body } = await mesFetch(`/api/mes/query/lineinfo?${qs}`);
  return Array.isArray(body) ? body : [];
};

export const getMoList = async (empNo, line) => {
  const qs = new URLSearchParams({ empNo, mode: '0', moType: '0', line: '0' });
  const { body } = await mesFetch(`/api/mes/query/molist?${qs}`);
  const rows = Array.isArray(body) ? body : [];
  return line ? rows.filter((r) => String(r.LINE_NAME) === String(line)) : rows;
};

// "}" เป็นตัวคั่นของ MES ห้ามอยู่ในค่า
const cleanField = (v) => String(v ?? '').replace(/[}\r\n\t]/g, '').trim();

export const ROUTING_RESULTS = ['PASS', 'FAIL'];

// SN}MO}MODEL}LINE}SECTION}GROUP}STATION}}PASS|FAIL}EMPNO}1  (ตามตัวอย่างจาก MES)
export const buildRoutingRow = ({ sn, mo, model, line, section, group, station, empNo, result = 'PASS' }) =>
  [
    cleanField(sn),
    cleanField(mo),
    cleanField(model),
    cleanField(line),
    cleanField(section),
    cleanField(group),
    cleanField(station),
    '',
    ROUTING_RESULTS.includes(result) ? result : 'PASS',
    cleanField(empNo),
    '1',
  ].join('}');

// ตรวจ / check-in SN ที่ station ก่อน update (ตามโปรแกรม Themister ของไลน์)
// ไม่ check ก่อน -> routing-update ตอบ "SN NOT INPUT"
// คืน { ok, result, description, text }
export const routingCheck = async ({ sn, mo, model, line, section, group, station }) => {
  const payload = {
    sn: cleanField(sn),
    mo: cleanField(mo),
    model: cleanField(model),
    line: cleanField(line),
    section: cleanField(section),
    group: cleanField(group),
    station: cleanField(station),
    testSubProgram: '',
    testSubVersion: '',
    testData: '',
  };
  const { body, text } = await mesFetch('/api/mes/tdc/routing-check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const result = body && typeof body === 'object' ? String(body.result || '') : '';
  const description = body && typeof body === 'object' ? String(body.description || '') : String(text || '');
  return { ok: result.toUpperCase() === 'OK', result, description, text };
};

export const routingUpdate = async (rows) => {
  // testData เป็นข้อความว่าง "" ตามตัวอย่างจาก MES (ไม่ใช่ [])
  const payload = { routingData: rows, testData: '' };
  // path ต้องมี / เดียว (แบบ //tdc ได้ 404)
  const result = await mesFetch('/api/mes/tdc/typed/routing-update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return { ...result, payload };
};

// input-update (station แบบ input เช่นจุดแรกที่ SN เข้า WO) — ไม่ต้อง routing-check ก่อน
// { sn, mo, model, line, section, group, station, employeeId, barcodePrefix, barcodeLength, testData: "" }
export const buildInputPayload = ({ sn, mo, model, line, section, group, station, empNo, barcodePrefix, barcodeLength }) => ({
  sn: cleanField(sn),
  mo: cleanField(mo),
  model: cleanField(model),
  line: cleanField(line),
  section: cleanField(section),
  group: cleanField(group),
  station: cleanField(station),
  employeeId: cleanField(empNo),
  barcodePrefix: cleanField(barcodePrefix),
  barcodeLength: Math.max(0, Math.floor(Number(barcodeLength) || 0)),
  testData: '',
});

export const inputUpdate = async (payload) => {
  const result = await mesFetch(MES_INPUT_UPDATE_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return { ...result, payload };
};
