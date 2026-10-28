import express from 'express';
import jwt from 'jsonwebtoken';
import { io } from '../lib/realtime.js';
import { JWT_SECRET } from '../lib/config.js';
import { getClientIp } from '../lib/clientIp.js';
import { getLineInfo, getMoList, buildRoutingRow, routingUpdate, MesError, ROUTING_RESULTS } from '../lib/mesClient.js';
import { readScan, validateModbusConfig } from '../lib/modbusReader.js';
import { pollTcpScans } from '../lib/tcpScanReader.js';
import { appendRouteLog, appendLoginLog, readRouteLogs } from '../lib/mesLog.js';
import { findOperatorExams } from './operatorData.js';
import { authenticateToken, authenticateMesOperator, MES_OPERATOR_KIND } from '../middleware/auth.js';

const router = express.Router();

// ==========================================
// 🏭 MES Update (หน้า /MES) — ไม่ใช้ Database
//  - operator login ด้วยรหัสพนักงาน ต้องเคยทำข้อสอบ (Excel) token หมดอายุ 07:40 / 19:40
//  - การตั้งค่าของแต่ละเครื่อง (ชื่อเครื่อง / Modbus / station) เก็บในเบราว์เซอร์ของเครื่องนั้น
//  - API นี้: ดึง Line/Station/WO จาก MES, อ่านเครื่องสแกนผ่าน Modbus TCP, ยิง routing-update
//  - ประวัติเขียนเป็นไฟล์ CSV ที่ MES_LOG_DIR (default D:\MES logs)
// ==========================================

const SHIFT_CUTOFFS = [7 * 60 + 40, 19 * 60 + 40]; // 07:40, 19:40 (นาทีของวัน เวลาไทย)
const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000; // ไทยไม่มี DST

// เวลาเปลี่ยนกะถัดไป (07:40 หรือ 19:40 เวลาไทย) ที่มาหลังเวลานี้
export const nextShiftCutoff = (now = new Date()) => {
  const bkk = new Date(now.getTime() + BANGKOK_OFFSET_MS); // อ่านค่า UTC ของ bkk = เวลาไทย
  const dayStartUtc = Date.UTC(bkk.getUTCFullYear(), bkk.getUTCMonth(), bkk.getUTCDate()) - BANGKOK_OFFSET_MS;
  for (const dayOffset of [0, 1]) {
    for (const minutes of SHIFT_CUTOFFS) {
      const t = dayStartUtc + dayOffset * 86400000 + minutes * 60000;
      if (t > now.getTime()) return new Date(t);
    }
  }
  return new Date(now.getTime() + 12 * 3600000); // ไม่ควรมาถึงตรงนี้
};

// รับได้ทั้ง token operator (MES) และ token dashboard (ME/admin ตอนตั้งค่า)
const authenticateMesOrStaff = (req, res, next) => {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const decoded = token ? jwt.decode(token) : null;
  if (decoded?.kind === MES_OPERATOR_KIND) {
    return authenticateMesOperator(req, res, () => {
      req.mesEmpNo = req.mesOperator.employee_id;
      next();
    });
  }
  return authenticateToken(req, res, () => {
    req.mesEmpNo = req.user.employee_id;
    next();
  });
};

const sendMesError = (res, err, fallback) => {
  if (err instanceof MesError) {
    return res.status(502).json({ success: false, message: `MES: ${err.message}` });
  }
  console.error(fallback, err);
  return res.status(500).json({ success: false, message: fallback });
};

const text = (v, max) => {
  const s = String(v ?? '').trim();
  return s ? s.slice(0, max) : null;
};

// ------------------------------------------
// Operator login (เช็คจาก Excel คะแนนสอบ)
// ------------------------------------------
router.post('/api/mes/operator-login', async (req, res) => {
  const employeeId = String(req.body?.employee_id || '').trim();
  if (!/^[\w-]{1,30}$/.test(employeeId)) {
    return res.status(400).json({ success: false, message: 'กรุณากรอกรหัสพนักงานให้ถูกต้อง' });
  }
  try {
    // ต้องเคยทำข้อสอบ (มีรหัสในไฟล์ Excel คะแนนสอบไฟล์ใดไฟล์หนึ่ง) ไม่ต้องระบุ Line / Station
    const check = await findOperatorExams(employeeId);
    if (!check.found) {
      const unavailable = check.checked > 0 && check.failed === check.checked;
      return res.status(unavailable ? 503 : 401).json({
        success: false,
        message: unavailable
          ? 'อ่านไฟล์ Excel คะแนนสอบไม่ได้ กรุณาติดต่อ Admin (ตรวจสอบการเชื่อมต่อ Microsoft Graph)'
          : 'ไม่พบประวัติการทำข้อสอบของรหัสพนักงานนี้',
      });
    }
    const operator = { employee_id: employeeId, name: check.name || '' };
    const expiresAt = nextShiftCutoff();
    const expiresInSec = Math.max(60, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
    const token = jwt.sign({ kind: MES_OPERATOR_KIND, ...operator }, JWT_SECRET, { expiresIn: expiresInSec });

    await appendLoginLog({
      emp_no: operator.employee_id,
      emp_name: operator.name,
      terminal: text(req.body?.terminal, 100) || '',
      ip: getClientIp(req),
      exams: check.exams.map((e) => e.exam_name).join(' / '),
    });

    res.json({ success: true, token, expires_at: expiresAt.toISOString(), operator });
  } catch (err) {
    console.error('MES Operator Login Error:', err);
    res.status(500).json({ success: false, message: 'เข้าสู่ระบบไม่สำเร็จ' });
  }
});

router.get('/api/mes/operator/me', authenticateMesOperator, (req, res) => {
  res.json({ success: true, operator: req.mesOperator });
});

// ------------------------------------------
// ข้อมูลจาก MES (มี cache สั้น ๆ ไว้ตรวจค่าตอนส่ง)
// ------------------------------------------
const LINEINFO_TTL_MS = 5 * 60 * 1000;
const MOLIST_TTL_MS = 60 * 1000;
const lineInfoCache = new Map(); // line -> { at, rows }
let moListCache = null; // { at, rows }

const cachedLineInfo = async (empNo, line) => {
  const hit = lineInfoCache.get(line);
  if (hit && Date.now() - hit.at < LINEINFO_TTL_MS) return hit.rows;
  const rows = await getLineInfo(empNo, line);
  lineInfoCache.set(line, { at: Date.now(), rows });
  return rows;
};

const cachedMoList = async (empNo, line, { fresh = false } = {}) => {
  if (fresh || !moListCache || Date.now() - moListCache.at >= MOLIST_TTL_MS) {
    moListCache = { at: Date.now(), rows: await getMoList(empNo) };
  }
  return moListCache.rows.filter((r) => String(r.LINE_NAME) === String(line));
};

router.get('/api/mes/lineinfo', authenticateMesOrStaff, async (req, res) => {
  const line = req.query.line ? String(req.query.line).trim() : 'ALL';
  try {
    const rows = await getLineInfo(req.mesEmpNo, line);
    res.json({
      success: true,
      data: rows.map((r) => ({ line: r.LINE_NAME, section: r.SECTION_NAME, group: r.GROUP_NAME, station: r.STATION_NAME })),
    });
  } catch (err) {
    sendMesError(res, err, 'ดึงข้อมูล Line / Station จาก MES ไม่สำเร็จ');
  }
});

router.get('/api/mes/molist', authenticateMesOrStaff, async (req, res) => {
  const line = String(req.query.line || '').trim();
  if (!line) return res.status(400).json({ success: false, message: 'กรุณาระบุ Line' });
  try {
    const rows = await cachedMoList(req.mesEmpNo, line, { fresh: true });
    res.json({ success: true, data: rows.map((r) => ({ mo: r.MO_NUMBER, model: r.MODEL_NAME, line: r.LINE_NAME })) });
  } catch (err) {
    sendMesError(res, err, 'ดึงรายการ WO จาก MES ไม่สำเร็จ');
  }
});

// ------------------------------------------
// อ่านเครื่องสแกนผ่าน Modbus TCP — ค่าตั้งส่งมาจากหน้าเว็บ (เก็บในเครื่องนั้น)
// ------------------------------------------
// อนุญาตเฉพาะ IP ภายในโรงงาน (กันใช้ server ไปเชื่อมต่อที่อื่น)
const isPrivateIPv4 = (host) => {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (m.slice(1).some((x) => Number(x) > 255)) return false;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a === 127;
};

const parseModbusBody = (body) => {
  const cfg = {
    modbus_host: text(body?.modbus_host, 100),
    modbus_port: Number(body?.modbus_port ?? 502),
    unit_id: Number(body?.unit_id ?? 1),
    register_type: body?.register_type === 'input' ? 'input' : 'holding',
    start_address: Number(body?.start_address ?? 0),
    word_count: Number(body?.word_count ?? 20),
    byte_order: body?.byte_order === 'LE' ? 'LE' : 'BE',
    clear_after_read: Boolean(body?.clear_after_read),
  };
  const err = validateModbusConfig(cfg);
  if (err) return { error: err };
  if (!isPrivateIPv4(cfg.modbus_host)) return { error: 'IP เครื่องสแกนต้องเป็น IP ภายใน (10.x / 172.16-31.x / 192.168.x)' };
  return { cfg };
};

// operator: อ่านจริง (ล้าง register ตามที่ตั้ง) / ME-admin: ทดสอบ (ไม่ล้าง)
router.post('/api/mes/modbus/read', authenticateMesOrStaff, async (req, res) => {
  const { error, cfg } = parseModbusBody(req.body);
  if (error) return res.status(400).json({ success: false, message: error });
  if (!req.mesOperator) cfg.clear_after_read = false;
  try {
    const { text: sn, raw } = await readScan(cfg);
    res.json({ success: true, sn, raw });
  } catch (err) {
    res.status(502).json({ success: false, message: `อ่าน Modbus ไม่ได้: ${err.message}` });
  }
});

// ------------------------------------------
// รับค่าจากเครื่องสแกนผ่าน TCP data port (Keyence ส่งผลอ่านมาเอง เช่น port 9004)
// body { host, port, after } -> { connected, error, seq, items: [{ seq, sn, at }] }
// ------------------------------------------
router.post('/api/mes/tcp/read', authenticateMesOrStaff, async (req, res) => {
  const host = text(req.body?.host, 100);
  const port = Number(req.body?.port ?? 9004);
  const after = req.body?.after === null || req.body?.after === undefined ? null : Number(req.body.after);
  if (!host || !isPrivateIPv4(host)) {
    return res.status(400).json({ success: false, message: 'IP เครื่องสแกนต้องเป็น IP ภายใน (10.x / 172.16-31.x / 192.168.x)' });
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return res.status(400).json({ success: false, message: 'Port ไม่ถูกต้อง' });
  }
  if (after !== null && !Number.isInteger(after)) return res.status(400).json({ success: false, message: 'after ไม่ถูกต้อง' });
  try {
    const r = await pollTcpScans({ host, port, after });
    if (!r.connected) {
      return res.status(502).json({ success: false, message: `เชื่อมต่อเครื่องสแกน ${host}:${port} ไม่ได้${r.error ? `: ${r.error}` : ''}` });
    }
    res.json({ success: true, ...r });
  } catch (err) {
    res.status(502).json({ success: false, message: `อ่านเครื่องสแกนไม่ได้: ${err.message}` });
  }
});

// ------------------------------------------
// ยิง routing-update ให้ 1 station (หน้าเว็บเรียกทีละ station ตามลำดับบนลงล่าง)
// ------------------------------------------
const lastSent = new Map(); // `${line}|${station}` -> { sn, result } กันส่งซ้ำ

router.post('/api/mes/update-route', authenticateMesOperator, async (req, res) => {
  const sn = text(String(req.body?.sn ?? '').replace(/[}\r\n\t]/g, ''), 200);
  const result = String(req.body?.result || 'PASS').toUpperCase();
  const line = text(req.body?.line, 100);
  const stationName = text(req.body?.station, 100);
  const mo = text(req.body?.mo, 50);
  const terminal = text(req.body?.terminal, 100) || '';
  if (!sn) return res.status(400).json({ success: false, message: 'ไม่มี Serial Number' });
  if (!ROUTING_RESULTS.includes(result)) return res.status(400).json({ success: false, message: 'ผลต้องเป็น PASS หรือ FAIL' });
  if (!line || !stationName) return res.status(400).json({ success: false, message: 'ไม่มี Line / Station' });
  if (!mo) return res.status(400).json({ success: false, message: 'กรุณาเลือก WO ของ station นี้ก่อน' });

  const key = `${line}|${stationName}`;
  const prev = lastSent.get(key);
  if (prev?.sn === sn && prev?.result === result) {
    return res.json({ success: true, skipped: true, result, message: `SN นี้ส่ง ${result} ไปแล้ว` });
  }

  try {
    // ยืนยัน Station / WO กับ MES และใช้ SECTION / GROUP / MODEL จาก MES (ไม่เชื่อค่าจากหน้าเว็บ)
    const empNo = req.mesOperator.employee_id;
    const st = (await cachedLineInfo(empNo, line)).find(
      (r) => r.STATION_NAME === stationName && (!req.body?.group || r.GROUP_NAME === req.body.group)
    );
    if (!st) return res.status(400).json({ success: false, message: `ไม่พบ Station ${stationName} ของ Line ${line} ใน MES` });
    let moRow = (await cachedMoList(empNo, line)).find((r) => String(r.MO_NUMBER) === mo);
    if (!moRow) moRow = (await cachedMoList(empNo, line, { fresh: true })).find((r) => String(r.MO_NUMBER) === mo);
    if (!moRow) return res.status(400).json({ success: false, message: `ไม่พบ WO ${mo} ของ Line ${line} ใน MES` });

    const row = buildRoutingRow({
      sn,
      mo,
      model: moRow.MODEL_NAME,
      line,
      section: st.SECTION_NAME,
      group: st.GROUP_NAME,
      station: st.STATION_NAME,
      empNo,
      result,
    });

    let success = false;
    let responseText = '';
    let message = '';
    try {
      const mesRes = await routingUpdate([row]);
      success = true;
      responseText = mesRes.text;
      message = `ส่ง ${result} สำเร็จ`;
      lastSent.set(key, { sn, result });
    } catch (err) {
      responseText = err.body ? JSON.stringify(err.body) : err.message;
      message = err.message;
    }

    const log = await appendRouteLog({
      terminal,
      emp_no: empNo,
      emp_name: req.mesOperator.name,
      line,
      section: st.SECTION_NAME,
      group: st.GROUP_NAME,
      station: st.STATION_NAME,
      mo,
      model: moRow.MODEL_NAME,
      sn,
      result,
      success,
      mes_response: `${row} => ${responseText}`.slice(0, 2000),
    });
    io.emit('mes_updated', { terminal, success });

    res.status(success ? 200 : 502).json({
      success,
      result,
      message: log.ok ? message : `${message} (แต่เขียนไฟล์ log ไม่ได้: ${log.error})`,
      mes_response: responseText,
    });
  } catch (err) {
    sendMesError(res, err, 'Update route ไม่สำเร็จ');
  }
});

// ประวัติล่าสุดของเครื่อง (จากไฟล์ CSV วันนี้ + เมื่อวาน)
router.get('/api/mes/logs', authenticateMesOrStaff, async (req, res) => {
  const terminal = text(req.query.terminal, 100);
  const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 200);
  try {
    res.json({ success: true, data: await readRouteLogs({ terminal, limit }) });
  } catch (err) {
    console.error('Read MES Logs Error:', err);
    res.status(500).json({ success: false, message: 'อ่านประวัติไม่สำเร็จ' });
  }
});

export default router;
