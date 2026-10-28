import express from 'express';
import jwt from 'jsonwebtoken';
import { pool } from '../lib/db.js';
import { io } from '../lib/realtime.js';
import { JWT_SECRET } from '../lib/config.js';
import { getClientIp } from '../lib/clientIp.js';
import { recordAuditLog } from '../lib/audit.js';
import { getLineInfo, getMoList, buildRoutingRow, routingUpdate, MesError, ROUTING_RESULTS } from '../lib/mesClient.js';
import { readScan, validateModbusConfig } from '../lib/modbusReader.js';
import { findOperatorExams } from './operatorData.js';
import {
  authenticateToken,
  authenticateMesOperator,
  requireRoles,
  MES_OPERATOR_KIND,
} from '../middleware/auth.js';

const router = express.Router();

// ==========================================
// 🏭 MES Update
//  - operator login ด้วยรหัสพนักงาน (ต้องมีใน automation_lines.operators) token หมดอายุ 07:40 / 19:40
//  - ช่อง station: Line/Station จาก MES lineinfo, WO จาก MES molist, อ่าน QR จาก Keyence ผ่าน Modbus TCP
//  - อ่านได้ SN ใหม่ -> ยิง routing-update ไป MES
//  - แก้ Line / Station / Modbus ได้เฉพาะ ME และ admin (token dashboard)
// ==========================================

const STAFF_ROLES = ['admin', 'me'];
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

// รับได้ทั้ง token operator (MES) และ token dashboard (สำหรับ ME/admin ตอนตั้งค่า)
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

const requireStaff = [authenticateToken, requireRoles(...STAFF_ROLES)];

const sendMesError = (res, err, fallback) => {
  if (err instanceof MesError) {
    return res.status(502).json({ success: false, message: `MES: ${err.message}` });
  }
  console.error(fallback, err);
  return res.status(500).json({ success: false, message: fallback });
};

// route ของ ME/admin: แสดงสาเหตุจริงให้เห็นในหน้าเว็บ (คนตั้งค่าแก้ปัญหาเองได้ เช่น ตาราง/คอลัมน์ยังไม่ถูกสร้าง)
const staffErrorMessage = (msg, err) => `${msg}: ${err?.message || err}`;

const auditStaff = (req, action, target, details) =>
  recordAuditLog({
    employeeId: req.user.employee_id,
    userName: req.user.name,
    role: req.user.role,
    deviceId: req.user.device_id,
    action,
    target,
    details,
    ipAddress: getClientIp(req),
  });

// ------------------------------------------
// Operator login
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
    // ชื่อ: ใช้จาก DB ถ้ามี ไม่งั้นใช้จาก Excel
    const nameRes = await pool.query(
      `SELECT name FROM automation_lines.operators WHERE employee_id::text = $1
       UNION ALL SELECT name FROM auth.users WHERE employee_id::text = $1 LIMIT 1`,
      [employeeId]
    );
    const operator = { employee_id: employeeId, name: nameRes.rows[0]?.name || check.name || '' };
    const expiresAt = nextShiftCutoff();
    const expiresInSec = Math.max(60, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
    const token = jwt.sign(
      { kind: MES_OPERATOR_KIND, employee_id: String(operator.employee_id), name: operator.name || '' },
      JWT_SECRET,
      { expiresIn: expiresInSec }
    );

    await recordAuditLog({
      employeeId: operator.employee_id,
      userName: operator.name,
      role: 'operator',
      deviceId: req.body?.device_id || null,
      action: 'MES_OPERATOR_LOGIN',
      target: 'MES Update',
      details: `Operator #${operator.employee_id} เข้าใช้หน้า MES Update (ข้อสอบที่พบ: ${check.exams.map((e) => e.exam_name).join(', ')}; หมดอายุ ${expiresAt.toISOString()})`,
      ipAddress: getClientIp(req),
    });

    res.json({
      success: true,
      token,
      expires_at: expiresAt.toISOString(),
      operator,
    });
  } catch (err) {
    console.error('MES Operator Login Error:', err);
    res.status(500).json({ success: false, message: 'เข้าสู่ระบบไม่สำเร็จ' });
  }
});

router.get('/api/mes/operator/me', authenticateMesOperator, (req, res) => {
  res.json({ success: true, operator: req.mesOperator });
});

// ------------------------------------------
// ข้อมูลจาก MES
// ------------------------------------------
router.get('/api/mes/lineinfo', authenticateMesOrStaff, async (req, res) => {
  const line = req.query.line ? String(req.query.line).trim() : 'ALL';
  try {
    const rows = await getLineInfo(req.mesEmpNo, line);
    res.json({
      success: true,
      data: rows.map((r) => ({
        line: r.LINE_NAME,
        section: r.SECTION_NAME,
        group: r.GROUP_NAME,
        station: r.STATION_NAME,
      })),
    });
  } catch (err) {
    sendMesError(res, err, 'ดึงข้อมูล Line / Station จาก MES ไม่สำเร็จ');
  }
});

router.get('/api/mes/molist', authenticateMesOrStaff, async (req, res) => {
  const line = String(req.query.line || '').trim();
  if (!line) return res.status(400).json({ success: false, message: 'กรุณาระบุ Line' });
  try {
    const rows = await getMoList(req.mesEmpNo, line);
    res.json({
      success: true,
      data: rows.map((r) => ({ mo: r.MO_NUMBER, model: r.MODEL_NAME, line: r.LINE_NAME })),
    });
  } catch (err) {
    sendMesError(res, err, 'ดึงรายการ WO จาก MES ไม่สำเร็จ');
  }
});

// ------------------------------------------
// ช่อง station
// ------------------------------------------
const STATION_COLUMNS = `id, terminal, sort_order, label, line, section_name, group_name, station, mo, model_name,
  modbus_host, modbus_port, unit_id, register_type, start_address, word_count, byte_order,
  clear_after_read, updated_by, updated_at`;

const getStation = async (id) => {
  const r = await pool.query(
    `SELECT ${STATION_COLUMNS} FROM automation_lines.mes_stations WHERE id = $1 AND is_active = TRUE`,
    [id]
  );
  return r.rows[0] || null;
};

const emitStations = (type, id) => io.emit('mes_stations_updated', { type, id });

const text = (v, max) => {
  const s = String(v ?? '').trim();
  return s ? s.slice(0, max) : null;
};

// ชื่อเครื่อง: แต่ละเครื่องหน้าไลน์มีชุด station ของตัวเอง (ชื่อเก็บใน localStorage ของเครื่องนั้น)
const parseTerminal = (v) => text(v, 100);

// station ของเครื่องที่ระบุ ?terminal=
router.get('/api/mes/stations', authenticateMesOrStaff, async (req, res) => {
  const terminal = parseTerminal(req.query.terminal);
  if (!terminal) return res.json({ success: true, data: [] });
  try {
    const r = await pool.query(
      `SELECT ${STATION_COLUMNS} FROM automation_lines.mes_stations
       WHERE is_active = TRUE AND terminal = $1 ORDER BY sort_order ASC, id ASC`,
      [terminal]
    );
    res.json({ success: true, data: r.rows });
  } catch (err) {
    console.error('Fetch MES Stations Error:', err);
    res.status(500).json({ success: false, message: 'ดึงรายการ station ไม่สำเร็จ' });
  }
});

// รายชื่อเครื่องที่มีอยู่ (ไว้เลือกตอนตั้งค่าเครื่องใหม่ / เครื่องที่ล้างข้อมูลเบราว์เซอร์)
router.get('/api/mes/terminals', authenticateMesOrStaff, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT terminal, COUNT(*)::int AS station_count, STRING_AGG(DISTINCT line, ', ') AS lines
       FROM automation_lines.mes_stations WHERE is_active = TRUE
       GROUP BY terminal ORDER BY terminal`
    );
    res.json({ success: true, data: r.rows });
  } catch (err) {
    console.error('Fetch MES Terminals Error:', err);
    res.status(500).json({ success: false, message: 'ดึงรายชื่อเครื่องไม่สำเร็จ' });
  }
});

const parseStationBody = (body) => {
  const data = {
    label: text(body?.label, 100),
    line: text(body?.line, 100),
    section_name: text(body?.section_name, 100),
    group_name: text(body?.group_name, 100),
    station: text(body?.station, 100),
    modbus_host: text(body?.modbus_host, 100),
    modbus_port: Number(body?.modbus_port ?? 502),
    unit_id: Number(body?.unit_id ?? 1),
    register_type: body?.register_type === 'input' ? 'input' : 'holding',
    start_address: Number(body?.start_address ?? 0),
    word_count: Number(body?.word_count ?? 20),
    byte_order: body?.byte_order === 'LE' ? 'LE' : 'BE',
    clear_after_read: Boolean(body?.clear_after_read),
  };
  if (!data.line || !data.station) return { error: 'กรุณาเลือก Line และ Station' };
  const modbusError = validateModbusConfig(data);
  if (modbusError) return { error: modbusError };
  return { data };
};

router.post('/api/mes/stations', ...requireStaff, async (req, res) => {
  const { error, data } = parseStationBody(req.body);
  if (error) return res.status(400).json({ success: false, message: error });
  const terminal = parseTerminal(req.body?.terminal);
  if (!terminal) return res.status(400).json({ success: false, message: 'กรุณาตั้งชื่อเครื่องนี้ก่อนเพิ่ม station' });
  try {
    const r = await pool.query(
      `INSERT INTO automation_lines.mes_stations
         (terminal, sort_order, label, line, section_name, group_name, station, modbus_host, modbus_port, unit_id,
          register_type, start_address, word_count, byte_order, clear_after_read, updated_by)
       VALUES (
         $15::varchar,
         (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM automation_lines.mes_stations
          WHERE is_active = TRUE AND terminal = $15::varchar),
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING ${STATION_COLUMNS}`,
      [data.label, data.line, data.section_name, data.group_name, data.station, data.modbus_host, data.modbus_port,
        data.unit_id, data.register_type, data.start_address, data.word_count, data.byte_order,
        data.clear_after_read, req.user.employee_id, terminal]
    );
    const row = r.rows[0];
    await auditStaff(req, 'MES_STATION_CREATE', `MES Station #${row.id}`,
      `[${terminal}] ${row.line} / ${row.station} -> ${row.modbus_host}:${row.modbus_port}`);
    emitStations('create', row.id);
    res.json({ success: true, data: row });
  } catch (err) {
    console.error('Create MES Station Error:', err);
    res.status(500).json({ success: false, message: staffErrorMessage('เพิ่ม station ไม่สำเร็จ', err) });
  }
});

// เรียงลำดับบนลงล่าง: body { ids: [3, 1, 2] }
router.put('/api/mes/stations/order', ...requireStaff, async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isInteger) : [];
  if (ids.length === 0) return res.status(400).json({ success: false, message: 'ไม่มีลำดับที่จะบันทึก' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (let i = 0; i < ids.length; i++) {
      await client.query('UPDATE automation_lines.mes_stations SET sort_order = $1 WHERE id = $2', [i + 1, ids[i]]);
    }
    await client.query('COMMIT');
    emitStations('order', null);
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Order MES Stations Error:', err);
    res.status(500).json({ success: false, message: staffErrorMessage('บันทึกลำดับไม่สำเร็จ', err) });
  } finally {
    client.release();
  }
});

router.put('/api/mes/stations/:id', ...requireStaff, async (req, res) => {
  const id = Number(req.params.id);
  const { error, data } = parseStationBody(req.body);
  if (error) return res.status(400).json({ success: false, message: error });
  try {
    const before = await getStation(id);
    if (!before) return res.status(404).json({ success: false, message: 'ไม่พบ station นี้' });
    // เปลี่ยน Line แล้ว WO เดิมใช้ไม่ได้
    const lineChanged = before.line !== data.line;
    const r = await pool.query(
      `UPDATE automation_lines.mes_stations SET
         label = $1, line = $2, section_name = $3, group_name = $4, station = $5, modbus_host = $6, modbus_port = $7,
         unit_id = $8, register_type = $9, start_address = $10, word_count = $11, byte_order = $12,
         clear_after_read = $13, updated_by = $14, updated_at = NOW(),
         mo = CASE WHEN $15::boolean THEN NULL ELSE mo END,
         model_name = CASE WHEN $15::boolean THEN NULL ELSE model_name END
       WHERE id = $16 RETURNING ${STATION_COLUMNS}`,
      [data.label, data.line, data.section_name, data.group_name, data.station, data.modbus_host, data.modbus_port,
        data.unit_id, data.register_type, data.start_address, data.word_count, data.byte_order,
        data.clear_after_read, req.user.employee_id, lineChanged, id]
    );
    const row = r.rows[0];
    await auditStaff(req, 'MES_STATION_UPDATE', `MES Station #${id}`,
      `${before.line}/${before.station} ${before.modbus_host}:${before.modbus_port} -> ` +
      `${row.line}/${row.station} ${row.modbus_host}:${row.modbus_port}`);
    emitStations('update', id);
    res.json({ success: true, data: row });
  } catch (err) {
    console.error('Update MES Station Error:', err);
    res.status(500).json({ success: false, message: staffErrorMessage('แก้ไข station ไม่สำเร็จ', err) });
  }
});

router.delete('/api/mes/stations/:id', ...requireStaff, async (req, res) => {
  const id = Number(req.params.id);
  try {
    const r = await pool.query(
      `UPDATE automation_lines.mes_stations SET is_active = FALSE, updated_by = $1, updated_at = NOW()
       WHERE id = $2 AND is_active = TRUE RETURNING line, station`,
      [req.user.employee_id, id]
    );
    if (r.rowCount === 0) return res.status(404).json({ success: false, message: 'ไม่พบ station นี้' });
    await auditStaff(req, 'MES_STATION_DELETE', `MES Station #${id}`, `${r.rows[0].line} / ${r.rows[0].station}`);
    emitStations('delete', id);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete MES Station Error:', err);
    res.status(500).json({ success: false, message: staffErrorMessage('ลบ station ไม่สำเร็จ', err) });
  }
});

// ทดลองอ่านเครื่องสแกนด้วยค่าที่กรอกในฟอร์ม (ยังไม่บันทึก)
router.post('/api/mes/modbus/test', ...requireStaff, async (req, res) => {
  const cfg = {
    modbus_host: text(req.body?.modbus_host, 100),
    modbus_port: Number(req.body?.modbus_port ?? 502),
    unit_id: Number(req.body?.unit_id ?? 1),
    register_type: req.body?.register_type === 'input' ? 'input' : 'holding',
    start_address: Number(req.body?.start_address ?? 0),
    word_count: Number(req.body?.word_count ?? 20),
    byte_order: req.body?.byte_order === 'LE' ? 'LE' : 'BE',
    clear_after_read: false,
  };
  const modbusError = validateModbusConfig(cfg);
  if (modbusError) return res.status(400).json({ success: false, message: modbusError });
  try {
    const { text: value, raw } = await readScan(cfg);
    res.json({ success: true, value, raw });
  } catch (err) {
    res.status(502).json({ success: false, message: `อ่าน Modbus ไม่ได้: ${err.message}` });
  }
});

// ------------------------------------------
// Operator: เลือก WO / อ่านสแกน / ยิง routing-update
// ------------------------------------------
router.patch('/api/mes/stations/:id/mo', authenticateMesOrStaff, async (req, res) => {
  const id = Number(req.params.id);
  const mo = text(req.body?.mo, 50);
  try {
    const st = await getStation(id);
    if (!st) return res.status(404).json({ success: false, message: 'ไม่พบ station นี้' });

    let modelName = null;
    if (mo) {
      // ยืนยันกับ MES ว่า WO นี้มีอยู่จริงใน Line นี้ และใช้ MODEL_NAME จาก MES
      const list = await getMoList(req.mesEmpNo, st.line);
      const found = list.find((r) => String(r.MO_NUMBER) === mo);
      if (!found) return res.status(400).json({ success: false, message: `ไม่พบ WO ${mo} ของ Line ${st.line} ใน MES` });
      modelName = found.MODEL_NAME || null;
    }
    const r = await pool.query(
      `UPDATE automation_lines.mes_stations SET mo = $1, model_name = $2, updated_by = $3, updated_at = NOW()
       WHERE id = $4 RETURNING ${STATION_COLUMNS}`,
      [mo, modelName, req.mesEmpNo, id]
    );
    emitStations('mo', id);
    res.json({ success: true, data: r.rows[0] });
  } catch (err) {
    sendMesError(res, err, 'เปลี่ยน WO ไม่สำเร็จ');
  }
});

router.post('/api/mes/stations/:id/read', authenticateMesOperator, async (req, res) => {
  try {
    const st = await getStation(Number(req.params.id));
    if (!st) return res.status(404).json({ success: false, message: 'ไม่พบ station นี้' });
    const { text: sn } = await readScan(st);
    res.json({ success: true, sn });
  } catch (err) {
    res.status(502).json({ success: false, message: `อ่านเครื่องสแกนไม่ได้: ${err.message}` });
  }
});

router.post('/api/mes/stations/:id/update-route', authenticateMesOperator, async (req, res) => {
  const id = Number(req.params.id);
  // "}" เป็นตัวคั่นของ MES -> ตัดออกตั้งแต่ต้น ให้ SN ใน log / การกันซ้ำ ตรงกับที่ส่งไปจริง
  const sn = text(String(req.body?.sn ?? '').replace(/[}\r\n\t]/g, ''), 200);
  if (!sn) return res.status(400).json({ success: false, message: 'ไม่มี Serial Number' });
  // ผลของชิ้นงาน: ปกติ PASS, กดปุ่ม FAIL ในหน้าเว็บแล้วสแกน = FAIL
  const result = String(req.body?.result || 'PASS').toUpperCase();
  if (!ROUTING_RESULTS.includes(result)) return res.status(400).json({ success: false, message: 'ผลต้องเป็น PASS หรือ FAIL' });

  try {
    const st = await getStation(id);
    if (!st) return res.status(404).json({ success: false, message: 'ไม่พบ station นี้' });
    if (!st.mo) return res.status(400).json({ success: false, message: 'กรุณาเลือก WO ของ station นี้ก่อน' });

    // กันยิงซ้ำ: SN + ผลเดิม ที่เพิ่ง update สำเร็จที่ station นี้ (PASS แล้วสแกนซ้ำเป็น FAIL ได้)
    const last = await pool.query(
      `SELECT sn, COALESCE(result, 'PASS') AS result FROM automation_lines.mes_update_logs
       WHERE mes_station_id = $1 AND success = TRUE ORDER BY created_at DESC, id DESC LIMIT 1`,
      [id]
    );
    if (last.rows[0]?.sn === sn && last.rows[0]?.result === result) {
      return res.json({ success: true, skipped: true, result, message: `SN นี้ส่ง ${result} ไปแล้ว` });
    }

    const row = buildRoutingRow({
      sn,
      mo: st.mo,
      model: st.model_name,
      line: st.line,
      section: st.section_name,
      group: st.group_name,
      station: st.station,
      empNo: req.mesOperator.employee_id,
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
    } catch (err) {
      responseText = err.body ? JSON.stringify(err.body) : err.message;
      message = err.message;
    }

    const log = await pool.query(
      `INSERT INTO automation_lines.mes_update_logs (mes_station_id, emp_no, emp_name, line, station, mo, sn, result, success, mes_response)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [id, req.mesOperator.employee_id, req.mesOperator.name || null, st.line, st.station, st.mo, sn, result, success,
        `${row}\n=> ${responseText}`.slice(0, 4000)]
    );
    io.emit('mes_updated', { station_id: id, success });

    res.status(success ? 200 : 502).json({
      success,
      result,
      message,
      mes_response: responseText,
      log: log.rows[0],
    });
  } catch (err) {
    console.error('MES Update Route Error:', err);
    res.status(500).json({ success: false, message: 'Update route ไม่สำเร็จ' });
  }
});

router.get('/api/mes/logs', authenticateMesOrStaff, async (req, res) => {
  const stationId = req.query.station_id ? Number(req.query.station_id) : null;
  const terminal = parseTerminal(req.query.terminal);
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 500);
  try {
    const r = await pool.query(
      `SELECT l.id, l.mes_station_id, l.emp_no, l.emp_name, l.line, l.station, l.mo, l.sn, COALESCE(l.result, 'PASS') AS result, l.success,
              l.mes_response, l.created_at
       FROM automation_lines.mes_update_logs l
       LEFT JOIN automation_lines.mes_stations s ON s.id = l.mes_station_id
       WHERE ($1::int IS NULL OR l.mes_station_id = $1::int)
         AND ($3::text IS NULL OR s.terminal = $3::text)
       ORDER BY l.created_at DESC, l.id DESC
       LIMIT $2`,
      [stationId, limit, terminal]
    );
    res.json({ success: true, data: r.rows });
  } catch (err) {
    console.error('Fetch MES Logs Error:', err);
    res.status(500).json({ success: false, message: 'ดึงประวัติไม่สำเร็จ' });
  }
});

export default router;
