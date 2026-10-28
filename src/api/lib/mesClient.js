import { MES_API_BASE } from './config.js';

// ==========================================
// 🏭 เรียก MES API (http://10.204.212.22:5207)
//  - lineinfo : [{ LINE_NAME, SECTION_NAME, GROUP_NAME, STATION_NAME }]
//  - molist   : [{ MO_NUMBER, MODEL_NAME, LINE_NAME }] (พารามิเตอร์ line ของ MES ไม่กรอง ต้องกรองเอง)
//  - routing-update : { routingData: ["SN}MO}MODEL}LINE}SECTION}GROUP}STATION}}PASS}EMPNO}1"], testData: [] }
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
      const msg = (body && typeof body === 'object' && body.message) || `MES ตอบกลับ HTTP ${res.status}`;
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

// SN}MO}MODEL}LINE}SECTION}GROUP}STATION}}PASS}EMPNO}1  (ตามตัวอย่างจาก MES)
export const buildRoutingRow = ({ sn, mo, model, line, section, group, station, empNo }) =>
  [
    cleanField(sn),
    cleanField(mo),
    cleanField(model),
    cleanField(line),
    cleanField(section),
    cleanField(group),
    cleanField(station),
    '',
    'PASS',
    cleanField(empNo),
    '1',
  ].join('}');

export const routingUpdate = async (rows) => {
  const payload = { routingData: rows, testData: [] };
  const result = await mesFetch('/api/mes//tdc/typed/routing-update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return { ...result, payload };
};
