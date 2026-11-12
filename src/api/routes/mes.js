import express from 'express';
import jwt from 'jsonwebtoken';
import { io } from '../lib/realtime.js';
import { JWT_SECRET, MES_QUERY_EMP_NO } from '../lib/config.js';
import { getClientIp } from '../lib/clientIp.js';
import { getLineInfo, getMoList, buildRoutingRow, routingCheck, routingUpdate, buildInputPayload, inputUpdate, buildDefectTestData, buildRoutingInputPayload, routingInput, MesError, ROUTING_RESULTS } from '../lib/mesClient.js';
import { internalFetch, InternalServiceError } from '../lib/internalKey.js';
import { appendRouteLog, appendLoginLog, readRouteLogs, readShiftSummary } from '../lib/mesLog.js';
import { findOperatorExams, checkOperatorQualification } from '../lib/operatorExams.js';
import { getWorkOrderProgress, WmsError } from '../lib/wmsClient.js';
import { authenticateToken, authenticateMesOperator, MES_OPERATOR_KIND } from '../middleware/auth.js';

const router = express.Router();

// ==========================================
// 🏭 MES Update (หน้า /MES) — ไม่ใช้ Database เอง
//  (อาการงานเสีย / ประวัติงานเสีย อยู่ใน DB ของ service data — เรียกผ่าน internalFetch('data', '/internal/...')
//   data ปิด = ส่งงานเสียไม่ได้ แต่ส่ง PASS / INPUT ปกติยังได้)
//  - operator login ด้วยรหัสพนักงาน ต้องเคยทำข้อสอบ (Excel) token หมดอายุ 07:40 / 19:40
//  - การตั้งค่าของแต่ละเครื่อง (ชื่อเครื่อง / Modbus / station) เก็บในเบราว์เซอร์ของเครื่องนั้น
//  - API นี้: ดึง Line/Station/WO จาก MES, ยิง routing-update (อ่านเครื่องสแกนทำที่ MES Bridge บน PC หน้าไลน์)
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
const EXCEL_UNAVAILABLE_MESSAGE = 'อ่านไฟล์ Excel คะแนนสอบไม่ได้ กรุณาติดต่อ Admin (ตรวจสอบการเชื่อมต่อ Microsoft Graph)';
const MAX_QUAL_STATIONS = 20;

// เกณฑ์ความสามารถที่ตั้งไว้ในเครื่องนั้น [{ line, station }] (ตัดค่าว่าง / ซ้ำ)
const parseQualStations = (raw) => {
  const seen = new Set();
  const list = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    const line = text(item?.line, 100);
    const station = text(item?.station, 100);
    const key = `${line}|${station}`;
    if (!line || !station || seen.has(key)) continue;
    seen.add(key);
    list.push({ line, station });
    if (list.length >= MAX_QUAL_STATIONS) break;
  }
  return list;
};

const describeExamFail = (e) =>
  e.status === 'FAIL'
    ? `${e.exam_name} ได้ ${e.score} (ต้อง ≥ ${e.min_score})`
    : e.status === 'UNREADABLE'
      ? `${e.exam_name} อ่านไฟล์ไม่ได้`
      : `${e.exam_name} ไม่มีคะแนน`;

router.post('/api/mes/operator-login', async (req, res) => {
  const employeeId = String(req.body?.employee_id || '').trim();
  if (!/^[\w-]{1,30}$/.test(employeeId)) {
    return res.status(400).json({ success: false, message: 'กรุณากรอกรหัสพนักงานให้ถูกต้อง' });
  }
  const qualStations = parseQualStations(req.body?.qual_stations);
  try {
    let name = '';
    let examsSummary = '';
    if (qualStations.length > 0) {
      // เครื่องนี้ตั้งเกณฑ์ไว้ -> ต้องผ่านข้อสอบบังคับของทุก Line + Station ที่ตั้ง
      const qual = await checkOperatorQualification(employeeId, qualStations);
      if (qual.unavailable) return res.status(503).json({ success: false, message: EXCEL_UNAVAILABLE_MESSAGE });
      if (!qual.passed) {
        const reasons = qual.results
          .filter((r) => !r.passed)
          .map((r) => `${r.line} / ${r.station}: ${r.exams.filter((e) => e.status !== 'PASS').map(describeExamFail).join(', ')}`);
        return res.status(401).json({ success: false, message: `ไม่ผ่านเกณฑ์ ${reasons.join(' | ')}` });
      }
      name = qual.name;
      examsSummary = qual.results.map((r) => `${r.line}/${r.station} ผ่าน`).join(' / ');
    } else {
      // ยังไม่ตั้งเกณฑ์: แค่ต้องเคยทำข้อสอบ (มีรหัสในไฟล์ Excel คะแนนสอบไฟล์ใดไฟล์หนึ่ง)
      const check = await findOperatorExams(employeeId);
      if (!check.found) {
        const unavailable = check.checked > 0 && check.failed === check.checked;
        return res.status(unavailable ? 503 : 401).json({
          success: false,
          message: unavailable ? EXCEL_UNAVAILABLE_MESSAGE : 'ไม่พบประวัติการทำข้อสอบของรหัสพนักงานนี้',
        });
      }
      name = check.name;
      examsSummary = check.exams.map((e) => e.exam_name).join(' / ');
    }
    const operator = { employee_id: employeeId, name: name || '' };
    const expiresAt = nextShiftCutoff();
    const expiresInSec = Math.max(60, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
    const token = jwt.sign({ kind: MES_OPERATOR_KIND, ...operator }, JWT_SECRET, { expiresIn: expiresInSec });

    await appendLoginLog({
      emp_no: operator.employee_id,
      emp_name: operator.name,
      terminal: text(req.body?.terminal, 100) || '',
      ip: getClientIp(req),
      exams: examsSummary,
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

// ดู Line / Station / WO จาก MES ด้วยรหัสกลาง MES_QUERY_EMP_NO เสมอ
const cachedLineInfo = async (line) => {
  const hit = lineInfoCache.get(line);
  if (hit && Date.now() - hit.at < LINEINFO_TTL_MS) return hit.rows;
  const rows = await getLineInfo(MES_QUERY_EMP_NO, line);
  lineInfoCache.set(line, { at: Date.now(), rows });
  return rows;
};

const cachedMoList = async (line, { fresh = false } = {}) => {
  if (fresh || !moListCache || Date.now() - moListCache.at >= MOLIST_TTL_MS) {
    moListCache = { at: Date.now(), rows: await getMoList(MES_QUERY_EMP_NO) };
  }
  return moListCache.rows.filter((r) => String(r.LINE_NAME) === String(line));
};

router.get('/api/mes/lineinfo', authenticateMesOrStaff, async (req, res) => {
  const line = req.query.line ? String(req.query.line).trim() : 'ALL';
  try {
    const rows = await getLineInfo(MES_QUERY_EMP_NO, line);
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
    const rows = await cachedMoList(line, { fresh: true });
    res.json({ success: true, data: rows.map((r) => ({ mo: r.MO_NUMBER, model: r.MODEL_NAME, line: r.LINE_NAME })) });
  } catch (err) {
    sendMesError(res, err, 'ดึงรายการ WO จาก MES ไม่สำเร็จ');
  }
});

// การอ่านเครื่องสแกน (TCP data port / Modbus TCP) ทำบน PC หน้าไลน์ผ่านโปรแกรม MES Bridge
// (tools/mes-bridge) เพราะเครื่องสแกนอยู่ใน network ของ PC นั้น server เข้าไม่ถึง

// ------------------------------------------
// ยิง routing-update ให้ 1 station (หน้าเว็บเรียกทีละ station ตามลำดับบนลงล่าง)
// ------------------------------------------
const lastSent = new Map(); // `${line}|${station}` -> { sn, result } กันส่งซ้ำ

router.post('/api/mes/update-route', authenticateMesOperator, async (req, res) => {
  // SN ส่งตามที่สแกนได้ทั้งหมด (บาง model มีช่องว่างใน SN เช่น "... Y" ห้ามตัด)
  // ตัดแค่ Enter/บรรทัดใหม่ท้ายผลอ่าน และ "}" ที่เป็นตัวคั่นของ MES
  const sn = text(String(req.body?.sn ?? '').replace(/[}\r\n]/g, '').trim(), 200);
  // mode: 'routing' (routing-check -> routing-update) หรือ 'input' (input-update อย่างเดียว ไม่มี PASS/FAIL)
  const mode = req.body?.mode === 'input' ? 'input' : 'routing';
  const result = mode === 'input' ? 'INPUT' : String(req.body?.result || 'PASS').toUpperCase();
  const line = text(req.body?.line, 100);
  const stationName = text(req.body?.station, 100);
  const mo = text(req.body?.mo, 50);
  const terminal = text(req.body?.terminal, 100) || '';
  const defectId = Number(req.body?.defect_id) || null; // งานเสีย: id ของอาการใน Defect Code
  if (!sn) return res.status(400).json({ success: false, message: 'ไม่มี Serial Number' });
  if (defectId && (mode !== 'routing' || result !== 'FAIL')) {
    return res.status(400).json({ success: false, message: 'อาการงานเสียใช้กับการส่ง FAIL เท่านั้น' });
  }
  if (mode === 'routing' && !ROUTING_RESULTS.includes(result)) return res.status(400).json({ success: false, message: 'ผลต้องเป็น PASS หรือ FAIL' });
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
    const st = (await cachedLineInfo(line)).find(
      (r) => r.STATION_NAME === stationName && (!req.body?.group || r.GROUP_NAME === req.body.group)
    );
    if (!st) return res.status(400).json({ success: false, message: `ไม่พบ Station ${stationName} ของ Line ${line} ใน MES` });
    let moRow = (await cachedMoList(line)).find((r) => String(r.MO_NUMBER) === mo);
    if (!moRow) moRow = (await cachedMoList(line, { fresh: true })).find((r) => String(r.MO_NUMBER) === mo);
    if (!moRow) return res.status(400).json({ success: false, message: `ไม่พบ WO ${mo} ของ Line ${line} ใน MES` });

    const fields = {
      sn,
      mo,
      model: moRow.MODEL_NAME,
      line,
      section: st.SECTION_NAME,
      group: st.GROUP_NAME,
      station: st.STATION_NAME,
      empNo,
    };
    const inputPayload =
      mode === 'input'
        ? buildInputPayload({ ...fields, barcodePrefix: req.body?.barcode_prefix, barcodeLength: req.body?.barcode_length })
        : null;

    // งานเสีย: อ่านอาการจาก Defect Code (ต้องเป็นของ Station นี้และยังเปิดใช้งาน)
    let defect = null;
    let testData = '';
    if (defectId) {
      const { status, body } = await internalFetch('data', `/internal/defect-codes?id=${defectId}`);
      if (status !== 200 || !body.success) {
        return res.status(503).json({ success: false, message: `อ่านรายการอาการเสียไม่ได้ (${body.message || `HTTP ${status}`})` });
      }
      defect = body.data;
      if (!defect || !defect.is_active || defect.station_name !== st.STATION_NAME) {
        return res.status(400).json({ success: false, message: `อาการนี้ไม่ใช่ของ Station ${st.STATION_NAME} หรือถูกปิดใช้งานแล้ว` });
      }
      testData = buildDefectTestData({ sn, defectCode: defect.defect_code, description: defect.description, empNo });
    }
    // FAIL ของ station แบบ input ส่งที่ routing-input (MES check-in SN เอง ไม่ต้อง routing-check)
    // FAIL ของ station แบบ routing ใช้ routing-check -> routing-update (FAIL + testData) แบบเดิม
    const failPayload =
      mode === 'routing' && result === 'FAIL' && req.body?.fail_via_input === true
        ? buildRoutingInputPayload({
            ...fields,
            result,
            errorCode: defect?.defect_code || '',
            barcodePrefix: req.body?.barcode_prefix,
            barcodeLength: req.body?.barcode_length,
            testData,
          })
        : null;
    const row = inputPayload || failPayload ? JSON.stringify(inputPayload || failPayload) : buildRoutingRow({ ...fields, result });

    let success = false;
    let responseText = '';
    let message = '';
    try {
      if (inputPayload) {
        // input-update อย่างเดียว (SN ยังไม่เข้า routing จึงไม่ต้อง routing-check)
        const mesRes = await inputUpdate(inputPayload);
        success = true;
        responseText = `INPUT: ${mesRes.text}`;
        message = 'Input สำเร็จ';
        lastSent.set(key, { sn, result });
      } else if (failPayload) {
        const mesRes = await routingInput(failPayload);
        success = true;
        responseText = `ROUTING-INPUT: ${mesRes.text}`;
        message = defect ? `ส่งงานเสียสำเร็จ (${defect.defect_code} ${defect.description})` : 'ส่ง FAIL สำเร็จ';
        lastSent.set(key, { sn, result });
      } else {
        // 1) routing-check ก่อน (check-in SN ที่ station) — ไม่ OK ไม่ต้อง update
        const check = await routingCheck(fields);
        if (!check.ok) {
          responseText = `CHECK: ${check.text}`;
          message = `Routing ไม่ผ่าน: ${check.description || check.result || 'MES ไม่ตอบ OK'}`;
        } else {
          // 2) routing-update
          const mesRes = await routingUpdate([row], testData);
          success = true;
          responseText = `CHECK OK; UPDATE: ${mesRes.text}`;
          message = defect ? `ส่งงานเสียสำเร็จ (${defect.defect_code} ${defect.description})` : `ส่ง ${result} สำเร็จ`;
          lastSent.set(key, { sn, result });
        }
      }
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
      mes_response: `${row}${testData && !failPayload ? ` | testData ${testData}` : ''} => ${responseText}`.slice(0, 2000),
    });
    io.emit('mes_updated', { terminal, success });

    // ประวัติงานเสียลง Database (ผ่าน service data) — บันทึกไม่ได้ไม่ทำให้การส่ง MES ล้ม
    if (defect) {
      internalFetch('data', '/internal/defect-logs', {
        method: 'POST',
        body: {
          terminal, line, section: st.SECTION_NAME, group: st.GROUP_NAME, station: st.STATION_NAME,
          mo, model: moRow.MODEL_NAME, sn, defect_id: defect.id, defect_code: defect.defect_code,
          description: defect.description, emp_no: empNo, emp_name: req.mesOperator.name, success,
          mes_response: `${testData} => ${responseText}`,
        },
      })
        .then(({ status, body }) => {
          if (status !== 200 || !body.success) console.warn('⚠️ บันทึกประวัติงานเสียไม่ได้:', body.message || status);
        })
        .catch((err) => console.warn('⚠️ บันทึกประวัติงานเสียไม่ได้:', err.message));
    }

    res.status(success ? 200 : 502).json({
      success,
      result,
      message: log.ok ? message : `${message} (แต่เขียนไฟล์ log ไม่ได้: ${log.error})`,
      mes_response: responseText,
    });
  } catch (err) {
    if (err instanceof InternalServiceError) return res.status(err.status).json({ success: false, message: err.message });
    sendMesError(res, err, 'Update route ไม่สำเร็จ');
  }
});

// อาการงานเสียของ Station นี้ (จาก Defect Code ใน dashboard) ให้ popup งานเสียหน้า /MES
router.get('/api/mes/defect-codes', authenticateMesOrStaff, async (req, res) => {
  const station = text(req.query.station, 100);
  if (!station) return res.status(400).json({ success: false, message: 'ไม่มี Station' });
  try {
    const { status, body } = await internalFetch('data', `/internal/defect-codes?station=${encodeURIComponent(station)}`);
    if (status !== 200 || !body.success) {
      return res.status(503).json({ success: false, message: `โหลดรายการอาการเสียไม่ได้ (${body.message || `HTTP ${status}`})` });
    }
    res.json({ success: true, data: body.data.map(({ id, defect_code, description }) => ({ id, defect_code, description })) });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
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

// ความคืบหน้าของ WO จาก WMS (Output / Target) — server login WMS เองด้วยบัญชีใน .env
router.get('/api/mes/wo-progress', authenticateMesOrStaff, async (req, res) => {
  const mo = text(req.query.mo, 50);
  if (!/^[A-Za-z0-9_-]+$/.test(mo)) return res.status(400).json({ success: false, message: 'เลข WO ไม่ถูกต้อง' });
  try {
    res.json({ success: true, data: await getWorkOrderProgress(mo) });
  } catch (err) {
    res.status(err instanceof WmsError ? err.status : 500).json({ success: false, message: err.message });
  }
});

// ยอด OK / NG ของเครื่องในกะปัจจุบัน (กะเช้า 07:40-19:40 / กะดึก 19:40-07:40 เวลาไทย)
router.get('/api/mes/shift-summary', authenticateMesOrStaff, async (req, res) => {
  const terminal = text(req.query.terminal, 100);
  const end = nextShiftCutoff();
  const start = new Date(end.getTime() - 12 * 3600000);
  // กะที่จบ 19:40 = กะเช้า (UTC 12:40)
  const shift = end.getUTCHours() === 12 ? 'day' : 'night';
  try {
    const summary = await readShiftSummary({ terminal, since: start });
    res.json({ success: true, data: { shift, start: start.toISOString(), end: end.toISOString(), ...summary } });
  } catch (err) {
    console.error('Read MES Shift Summary Error:', err);
    res.status(500).json({ success: false, message: 'อ่านยอดกะนี้ไม่สำเร็จ' });
  }
});

export default router;
