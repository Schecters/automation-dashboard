import express from 'express';
import { pool } from '../lib/db.js';
import { io } from '../lib/realtime.js';
import { getClientIp } from '../lib/clientIp.js';
import { recordAuditLog } from '../lib/audit.js';
import { authenticateToken, requireAdmin, requireRoles } from '../middleware/auth.js';

const router = express.Router();

// ==========================================
// 📋 Daily PM Checklist
//  - แม่แบบ (template): Line + Process + รายการเช็ค (ถูก/ผิด หรือ ตัวเลข) + ลำดับตำแหน่งผู้อนุมัติ
//  - ใบเช็คประจำวัน (record): กรอกผลตามแม่แบบ แล้วส่งอนุมัติทีละขั้นตามลำดับ
// ==========================================

// ตำแหน่งที่เลือกเป็นผู้อนุมัติได้
//  kind 'line' = ตำแหน่งประจำ Line (ตาราง line_owners.role_type ของ Line นั้น)
//  kind 'role' = role ของบัญชีผู้ใช้ (auth.users.role)
//  Admin อนุมัติแทนได้ทุกขั้น
export const PM_APPROVAL_POSITIONS = [
  { key: 'leader', label: 'Line Leader', kind: 'line' },
  { key: 'supervisor', label: 'Line Supervisor', kind: 'line' },
  { key: 'owner', label: 'Line Owner', kind: 'line' },
  { key: 'me', label: 'ME', kind: 'role' },
  { key: 'ie', label: 'IE', kind: 'role' },
  { key: 'q', label: 'QA (Q)', kind: 'role' },
  { key: 'pd', label: 'PD', kind: 'role' },
  { key: 'admin', label: 'Admin', kind: 'role' },
];
const POSITION_BY_KEY = Object.fromEntries(PM_APPROVAL_POSITIONS.map((p) => [p.key, p]));

const TEMPLATE_EDITOR_ROLES = ['admin', 'me'];
const MAX_APPROVAL_STEPS = 6;
const MAX_ITEMS = 200;

const normLine = (lineId) => String(lineId || '').trim().toLowerCase();

const toNumberOrNull = (v) => {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};

// ตำแหน่งประจำ Line ของผู้ใช้: Map<lineId(lowercase), Set<role_type>>
const getUserLinePositions = async (employeeId) => {
  const result = await pool.query(
    `SELECT line_id, COALESCE(role_type, 'owner') AS role_type
     FROM automation_lines.line_owners
     WHERE employee_id::text = $1::text`,
    [employeeId]
  );
  const map = new Map();
  for (const row of result.rows) {
    const key = normLine(row.line_id);
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(String(row.role_type).toLowerCase());
  }
  return map;
};

const canApprovePosition = (user, linePositions, lineId, positionKey) => {
  if (user.role === 'admin') return true;
  const position = POSITION_BY_KEY[positionKey];
  if (!position) return false;
  if (position.kind === 'role') return user.role === positionKey;
  return Boolean(linePositions.get(normLine(lineId))?.has(positionKey));
};

const pendingPositionOf = (record) => {
  if (record.status !== 'pending') return null;
  const steps = Array.isArray(record.approval_steps) ? record.approval_steps : [];
  return steps[record.current_step] || null;
};

// ตัดสิน OK / NG ของแต่ละหัวข้อ
const judgeItem = (item, valueBool, valueNumber) => {
  if (item.check_type === 'pass_fail') {
    if (valueBool === null) return null;
    return valueBool ? 'OK' : 'NG';
  }
  if (valueNumber === null) return null;
  const min = item.min_value === null ? null : Number(item.min_value);
  const max = item.max_value === null ? null : Number(item.max_value);
  if (min !== null && valueNumber < min) return 'NG';
  if (max !== null && valueNumber > max) return 'NG';
  return 'OK';
};

// ตรวจและจัดรูปข้อมูลแม่แบบที่ส่งมา คืน { error } หรือ { data }
const parseTemplateBody = (body) => {
  const name = String(body?.name || '').trim();
  const lineId = String(body?.line_id || '').trim();
  const process = String(body?.process || '').trim();
  const description = String(body?.description || '').trim() || null;

  if (!name || !lineId || !process) {
    return { error: 'กรุณาระบุ ชื่อเช็คลิสต์, Line และ Process ให้ครบ' };
  }

  const rawSteps = Array.isArray(body?.approval_steps) ? body.approval_steps : [];
  const approvalSteps = rawSteps.map((s) => String(s).trim().toLowerCase());
  if (approvalSteps.length > MAX_APPROVAL_STEPS) {
    return { error: `กำหนดผู้อนุมัติได้ไม่เกิน ${MAX_APPROVAL_STEPS} ขั้น` };
  }
  if (approvalSteps.some((s) => !POSITION_BY_KEY[s])) {
    return { error: 'มีตำแหน่งผู้อนุมัติที่ระบบไม่รู้จัก' };
  }
  if (new Set(approvalSteps).size !== approvalSteps.length) {
    return { error: 'ตำแหน่งผู้อนุมัติซ้ำกัน กรุณาเลือกแต่ละตำแหน่งได้ครั้งเดียว' };
  }

  const rawItems = Array.isArray(body?.items) ? body.items : [];
  if (rawItems.length === 0) return { error: 'กรุณาเพิ่มรายการที่ต้องเช็คอย่างน้อย 1 รายการ' };
  if (rawItems.length > MAX_ITEMS) return { error: `รายการเช็คได้ไม่เกิน ${MAX_ITEMS} รายการ` };

  const items = [];
  for (let i = 0; i < rawItems.length; i++) {
    const it = rawItems[i] || {};
    const label = String(it.label || '').trim();
    const description = String(it.description || '').trim() || null;
    const checkType = ['number', 'section'].includes(it.check_type) ? it.check_type : 'pass_fail';

    // หัวข้อย่อย: ไว้จัดกลุ่ม/อธิบายรายการด้านล่าง ไม่ต้องเช็ค
    if (checkType === 'section') {
      if (!label) return { error: `แถวที่ ${i + 1}: กรุณาระบุชื่อหัวข้อย่อย` };
      items.push({
        seq: i + 1, label, description, check_type: 'section',
        unit: null, min_value: null, max_value: null, is_required: false,
      });
      continue;
    }

    if (!label) return { error: `รายการที่ ${i + 1}: กรุณาระบุสิ่งที่ต้องเช็ค` };

    let unit = null;
    let minValue = null;
    let maxValue = null;
    if (checkType === 'number') {
      unit = String(it.unit || '').trim().slice(0, 30) || null;
      minValue = toNumberOrNull(it.min_value);
      maxValue = toNumberOrNull(it.max_value);
      if (Number.isNaN(minValue) || Number.isNaN(maxValue)) {
        return { error: `รายการที่ ${i + 1} (${label}): ค่า Min/Max ต้องเป็นตัวเลข` };
      }
      if (minValue !== null && maxValue !== null && minValue > maxValue) {
        return { error: `รายการที่ ${i + 1} (${label}): ค่า Min ต้องไม่มากกว่า Max` };
      }
    }

    items.push({
      seq: i + 1,
      label,
      description,
      check_type: checkType,
      unit,
      min_value: minValue,
      max_value: maxValue,
      is_required: it.is_required !== false,
    });
  }

  if (!items.some((it) => it.check_type !== 'section')) {
    return { error: 'กรุณาเพิ่มรายการที่ต้องเช็คอย่างน้อย 1 รายการ (นอกจากหัวข้อย่อย)' };
  }

  return { data: { name, lineId, process, description, approvalSteps, items } };
};

const TEMPLATE_SELECT = `
  SELECT
    t.id, t.name, t.line_id, t.process, t.description, t.approval_steps, t.is_active,
    t.created_by, t.created_at, t.updated_at,
    COALESCE((
      SELECT JSON_AGG(JSON_BUILD_OBJECT(
        'id', i.id, 'seq', i.seq, 'label', i.label, 'description', i.description, 'check_type', i.check_type, 'unit', i.unit,
        'min_value', i.min_value::float8, 'max_value', i.max_value::float8, 'is_required', i.is_required
      ) ORDER BY i.seq, i.id)
      FROM automation_lines.pm_template_items i
      WHERE i.template_id = t.id
    ), '[]'::json) AS items
  FROM automation_lines.pm_templates t
`;

const insertTemplateItems = async (client, templateId, items) => {
  for (const it of items) {
    await client.query(
      `INSERT INTO automation_lines.pm_template_items
         (template_id, seq, label, description, check_type, unit, min_value, max_value, is_required)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [templateId, it.seq, it.label, it.description, it.check_type, it.unit, it.min_value, it.max_value, it.is_required]
    );
  }
};

const auditPm = (req, action, target, details) =>
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
// ตำแหน่งผู้อนุมัติที่เลือกได้
// ------------------------------------------
router.get('/api/pm/positions', authenticateToken, (req, res) => {
  res.json({ success: true, data: PM_APPROVAL_POSITIONS });
});

// ------------------------------------------
// แม่แบบเช็คลิสต์ (Create Daily PM Checklist)
// ------------------------------------------
router.get('/api/pm/templates', authenticateToken, async (req, res) => {
  const line = req.query.line ? String(req.query.line).trim() : null;
  try {
    const result = await pool.query(
      `${TEMPLATE_SELECT}
       WHERE t.is_active = TRUE AND ($1::text IS NULL OR t.line_id = $1::text)
       ORDER BY t.line_id ASC, t.process ASC, t.name ASC`,
      [line]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('Fetch PM Templates Error:', err);
    res.status(500).json({ success: false, message: 'ไม่สามารถดึงแม่แบบเช็คลิสต์ได้' });
  }
});

router.post('/api/pm/templates', authenticateToken, requireRoles(...TEMPLATE_EDITOR_ROLES), async (req, res) => {
  const parsed = parseTemplateBody(req.body);
  if (parsed.error) return res.status(400).json({ success: false, message: parsed.error });
  const { name, lineId, process, description, approvalSteps, items } = parsed.data;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const inserted = await client.query(
      `INSERT INTO automation_lines.pm_templates (name, line_id, process, description, approval_steps, created_by)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)
       RETURNING id`,
      [name, lineId, process, description, JSON.stringify(approvalSteps), Number(req.user.employee_id)]
    );
    const templateId = inserted.rows[0].id;
    await insertTemplateItems(client, templateId, items);
    await client.query('COMMIT');

    const full = await pool.query(`${TEMPLATE_SELECT} WHERE t.id = $1`, [templateId]);
    await auditPm(req, 'PM_TEMPLATE_CREATE', `PM Template #${templateId}`,
      `Created "${name}" (Line ${lineId} / ${process}) with ${items.length} item(s), approval: [${approvalSteps.join(' > ') || '-'}]`);
    io.emit('pm_updated', { type: 'template', id: templateId });

    res.json({ success: true, message: 'สร้างแม่แบบเช็คลิสต์สำเร็จ', data: full.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Create PM Template Error:', err);
    res.status(500).json({ success: false, message: 'สร้างแม่แบบเช็คลิสต์ไม่สำเร็จ' });
  } finally {
    client.release();
  }
});

// แก้แม่แบบ: ใบเช็คที่บันทึกไปแล้วไม่เปลี่ยนตาม (เก็บสำเนาหัวข้อไว้ในใบแล้ว)
router.put('/api/pm/templates/:id', authenticateToken, requireRoles(...TEMPLATE_EDITOR_ROLES), async (req, res) => {
  const templateId = Number(req.params.id);
  const parsed = parseTemplateBody(req.body);
  if (parsed.error) return res.status(400).json({ success: false, message: parsed.error });
  const { name, lineId, process, description, approvalSteps, items } = parsed.data;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const updated = await client.query(
      `UPDATE automation_lines.pm_templates
       SET name = $1, line_id = $2, process = $3, description = $4, approval_steps = $5::jsonb, updated_at = CURRENT_TIMESTAMP
       WHERE id = $6 AND is_active = TRUE
       RETURNING id`,
      [name, lineId, process, description, JSON.stringify(approvalSteps), templateId]
    );
    if (updated.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'ไม่พบแม่แบบเช็คลิสต์นี้' });
    }
    await client.query('DELETE FROM automation_lines.pm_template_items WHERE template_id = $1', [templateId]);
    await insertTemplateItems(client, templateId, items);
    await client.query('COMMIT');

    const full = await pool.query(`${TEMPLATE_SELECT} WHERE t.id = $1`, [templateId]);
    await auditPm(req, 'PM_TEMPLATE_UPDATE', `PM Template #${templateId}`,
      `Updated "${name}" (Line ${lineId} / ${process}) with ${items.length} item(s), approval: [${approvalSteps.join(' > ') || '-'}]`);
    io.emit('pm_updated', { type: 'template', id: templateId });

    res.json({ success: true, message: 'บันทึกการแก้ไขแม่แบบสำเร็จ', data: full.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Update PM Template Error:', err);
    res.status(500).json({ success: false, message: 'แก้ไขแม่แบบเช็คลิสต์ไม่สำเร็จ' });
  } finally {
    client.release();
  }
});

// ลบแบบซ่อน (is_active = false) เพื่อให้ประวัติใบเช็คเดิมยังอยู่ครบ
router.delete('/api/pm/templates/:id', authenticateToken, requireRoles(...TEMPLATE_EDITOR_ROLES), async (req, res) => {
  const templateId = Number(req.params.id);
  try {
    const result = await pool.query(
      `UPDATE automation_lines.pm_templates SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND is_active = TRUE RETURNING name`,
      [templateId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'ไม่พบแม่แบบเช็คลิสต์นี้' });
    }
    await auditPm(req, 'PM_TEMPLATE_DELETE', `PM Template #${templateId}`, `Deleted "${result.rows[0].name}"`);
    io.emit('pm_updated', { type: 'template', id: templateId });
    res.json({ success: true, message: 'ลบแม่แบบเช็คลิสต์เรียบร้อย (ประวัติใบเช็คเดิมยังอยู่)' });
  } catch (err) {
    console.error('Delete PM Template Error:', err);
    res.status(500).json({ success: false, message: 'ลบแม่แบบเช็คลิสต์ไม่สำเร็จ' });
  }
});

// ------------------------------------------
// ใบเช็คประจำวัน (Daily PM Checklist)
// ------------------------------------------
const RECORD_SELECT = `
  SELECT
    r.id, r.template_id, r.template_name, r.line_id, r.process,
    TO_CHAR(r.check_date, 'YYYY-MM-DD') AS check_date,
    r.approval_steps, r.current_step, r.status, r.overall_result, r.note,
    r.checked_by, r.checked_by_name, r.created_at, r.updated_at,
    (SELECT COUNT(*) FROM automation_lines.pm_record_values v WHERE v.record_id = r.id AND v.check_type <> 'section')::int AS item_count,
    (SELECT COUNT(*) FROM automation_lines.pm_record_values v WHERE v.record_id = r.id AND v.result = 'NG')::int AS ng_count
  FROM automation_lines.pm_records r
`;

const withApprovalInfo = (record, user, linePositions) => {
  const pendingPosition = pendingPositionOf(record);
  return {
    ...record,
    pending_position: pendingPosition,
    can_approve: Boolean(pendingPosition) && canApprovePosition(user, linePositions, record.line_id, pendingPosition),
  };
};

router.get('/api/pm/records', authenticateToken, async (req, res) => {
  const dateFrom = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date_from || '') ? req.query.date_from : null;
  const dateTo = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date_to || '') ? req.query.date_to : null;
  const line = req.query.line ? String(req.query.line).trim() : null;
  const status = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : null;

  try {
    const result = await pool.query(
      `${RECORD_SELECT}
       WHERE ($1::date IS NULL OR r.check_date >= $1::date)
         AND ($2::date IS NULL OR r.check_date <= $2::date)
         AND ($3::text IS NULL OR r.line_id = $3::text)
         AND ($4::text IS NULL OR r.status = $4::text)
       ORDER BY r.check_date DESC, r.created_at DESC
       LIMIT 500`,
      [dateFrom, dateTo, line, status]
    );
    const linePositions = await getUserLinePositions(req.user.employee_id);
    res.json({ success: true, data: result.rows.map((r) => withApprovalInfo(r, req.user, linePositions)) });
  } catch (err) {
    console.error('Fetch PM Records Error:', err);
    res.status(500).json({ success: false, message: 'ไม่สามารถดึงประวัติเช็คลิสต์ได้' });
  }
});

// ------------------------------------------
// Export CSV (1 แถว = 1 รายการเช็ค) เลือกช่วงวันที่ได้ + กรอง Line / สถานะ
// ------------------------------------------
const MAX_EXPORT_DAYS = 366;

// แปลง key ตำแหน่ง -> ชื่อที่อ่านได้ ใน SQL (ค่ามาจากค่าคงที่ในโค้ด ไม่ใช่ input ผู้ใช้)
const POSITION_LABEL_SQL = `CASE a.position ${PM_APPROVAL_POSITIONS
  .map((p) => `WHEN '${p.key}' THEN '${p.label}'`)
  .join(' ')} ELSE a.position END`;

// ใส่ "..." ทุกช่อง และกันสูตร Excel (ช่องข้อความที่ขึ้นต้นด้วย = + - @ ให้เติม ' นำหน้า)
const csvCell = (value, { isText = true } = {}) => {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (isText && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};

const formatBangkok = (v) =>
  v
    ? new Date(v).toLocaleString('sv-SE', { timeZone: 'Asia/Bangkok', hour12: false }).slice(0, 16)
    : '';

router.get('/api/pm/export.csv', authenticateToken, async (req, res) => {
  const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
  const dateFrom = req.query.date_from;
  const dateTo = req.query.date_to;
  const line = req.query.line ? String(req.query.line).trim() : null;
  const status = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : null;

  if (!isDate(dateFrom) || !isDate(dateTo)) {
    return res.status(400).json({ success: false, message: 'กรุณาเลือกช่วงวันที่ (ตั้งแต่ - ถึง) ให้ถูกต้อง' });
  }
  const days = (new Date(dateTo) - new Date(dateFrom)) / 86400000;
  if (days < 0) return res.status(400).json({ success: false, message: 'วันที่เริ่มต้นต้องไม่มากกว่าวันที่สิ้นสุด' });
  if (days > MAX_EXPORT_DAYS) {
    return res.status(400).json({ success: false, message: `Export ได้ครั้งละไม่เกิน ${MAX_EXPORT_DAYS} วัน` });
  }

  try {
    const result = await pool.query(
      `SELECT
         r.id AS record_id, TO_CHAR(r.check_date, 'YYYY-MM-DD') AS check_date, r.line_id, r.process, r.template_name,
         r.overall_result, r.status, r.approval_steps, r.current_step, r.checked_by, r.checked_by_name, r.created_at, r.note,
         v.seq, v.label, v.description, v.check_type, v.unit,
         v.min_value::float8 AS min_value, v.max_value::float8 AS max_value,
         v.value_bool, v.value_number::float8 AS value_number, v.result, v.remark,
         COALESCE((
           SELECT STRING_AGG(
             ${POSITION_LABEL_SQL} || ': ' || CASE WHEN a.action = 'approve' THEN 'อนุมัติ' ELSE 'ไม่อนุมัติ' END
               || ' โดย ' || COALESCE(a.approver_name, '#' || a.approved_by::text)
               || ' (' || TO_CHAR(a.created_at AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD HH24:MI') || ')'
               || COALESCE(' "' || a.comment || '"', ''),
             ' | ' ORDER BY a.created_at, a.id)
           FROM automation_lines.pm_approvals a WHERE a.record_id = r.id
         ), '') AS approvals
       FROM automation_lines.pm_records r
       JOIN automation_lines.pm_record_values v ON v.record_id = r.id
       WHERE r.check_date BETWEEN $1::date AND $2::date
         AND ($3::text IS NULL OR r.line_id = $3::text)
         AND ($4::text IS NULL OR r.status = $4::text)
       ORDER BY r.check_date ASC, r.line_id ASC, r.process ASC, r.template_name ASC, r.id ASC, v.seq ASC, v.id ASC`,
      [dateFrom, dateTo, line, status]
    );

    const statusText = { pending: 'รออนุมัติ', approved: 'อนุมัติแล้ว', rejected: 'ไม่อนุมัติ' };
    const header = [
      'วันที่เช็ค', 'Line', 'Process', 'เช็คลิสต์', 'เลขใบ', 'หัวข้อย่อย', 'ข้อ', 'รายการที่เช็ค', 'คำอธิบาย',
      'ชนิด', 'ค่าที่วัด', 'หน่วย', 'Min', 'Max', 'ผลรายข้อ', 'หมายเหตุรายข้อ',
      'ผลรวมทั้งใบ', 'สถานะ', 'ผู้เช็ค', 'เวลาบันทึก', 'หมายเหตุรวม', 'ประวัติการอนุมัติ',
    ];
    const lines = [header.map((h) => csvCell(h)).join(',')];

    // แถวหัวข้อย่อยไม่ออกเป็นแถว แต่ใส่เป็นคอลัมน์ "หัวข้อย่อย" ให้รายการที่อยู่ใต้หัวข้อนั้น
    let currentRecord = null;
    let currentSection = '';
    let itemNo = 0;
    for (const row of result.rows) {
      if (row.record_id !== currentRecord) {
        currentRecord = row.record_id;
        currentSection = '';
        itemNo = 0;
      }
      if (row.check_type === 'section') {
        currentSection = row.label;
        continue;
      }
      itemNo++;

      const measured = row.check_type === 'pass_fail'
        ? (row.value_bool === true ? 'OK' : row.value_bool === false ? 'NG' : '')
        : row.value_number;
      const pendingPos = row.status === 'pending' ? row.approval_steps?.[row.current_step] : null;

      lines.push([
        csvCell(row.check_date),
        csvCell(row.line_id),
        csvCell(row.process),
        csvCell(row.template_name),
        csvCell(row.record_id, { isText: false }),
        csvCell(currentSection),
        csvCell(itemNo, { isText: false }),
        csvCell(row.label),
        csvCell(row.description),
        csvCell(row.check_type === 'number' ? 'ตัวเลข' : 'OK/NG'),
        csvCell(measured, { isText: row.check_type !== 'number' }),
        csvCell(row.unit),
        csvCell(row.min_value, { isText: false }),
        csvCell(row.max_value, { isText: false }),
        csvCell(row.result),
        csvCell(row.remark),
        csvCell(row.overall_result),
        csvCell(`${statusText[row.status] || row.status}${pendingPos ? ` (รอ ${POSITION_BY_KEY[pendingPos]?.label || pendingPos})` : ''}`),
        csvCell(row.checked_by_name || (row.checked_by ? `#${row.checked_by}` : '')),
        csvCell(formatBangkok(row.created_at)),
        csvCell(row.note),
        csvCell(row.approvals),
      ].join(','));
    }

    const fileName = `PM_Checklist_${dateFrom}_to_${dateTo}${line ? `_${line.replace(/[^\w-]/g, '_')}` : ''}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    // ﻿ (BOM) ทำให้ Excel อ่านภาษาไทยถูก
    res.send(`﻿${lines.join('\r\n')}`);
  } catch (err) {
    console.error('Export PM CSV Error:', err);
    res.status(500).json({ success: false, message: 'Export CSV ไม่สำเร็จ' });
  }
});

router.get('/api/pm/records/:id', authenticateToken, async (req, res) => {
  const recordId = Number(req.params.id);
  try {
    const recordResult = await pool.query(`${RECORD_SELECT} WHERE r.id = $1`, [recordId]);
    if (recordResult.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'ไม่พบใบเช็คลิสต์นี้' });
    }
    const [values, approvals, linePositions] = await Promise.all([
      pool.query(
        `SELECT id, item_id, seq, label, description, check_type, unit, min_value::float8 AS min_value, max_value::float8 AS max_value,
                value_bool, value_number::float8 AS value_number, result, remark
         FROM automation_lines.pm_record_values WHERE record_id = $1 ORDER BY seq, id`,
        [recordId]
      ),
      pool.query(
        `SELECT id, step_index, position, action, approved_by, approver_name, comment, created_at
         FROM automation_lines.pm_approvals WHERE record_id = $1 ORDER BY created_at ASC, id ASC`,
        [recordId]
      ),
      getUserLinePositions(req.user.employee_id),
    ]);

    res.json({
      success: true,
      data: {
        ...withApprovalInfo(recordResult.rows[0], req.user, linePositions),
        values: values.rows,
        approvals: approvals.rows,
      },
    });
  } catch (err) {
    console.error('Fetch PM Record Error:', err);
    res.status(500).json({ success: false, message: 'ไม่สามารถดึงข้อมูลใบเช็คลิสต์ได้' });
  }
});

// บันทึกผลการเช็คประจำวัน (ทุก role ยกเว้น view)
router.post('/api/pm/records', authenticateToken, async (req, res) => {
  if (!req.user.role || req.user.role === 'view') {
    return res.status(403).json({ success: false, message: 'บัญชีสิทธิ์ View ไม่สามารถบันทึกเช็คลิสต์ได้' });
  }

  const templateId = Number(req.body?.template_id);
  const checkDate = String(req.body?.check_date || '');
  const note = String(req.body?.note || '').trim() || null;
  const inputValues = Array.isArray(req.body?.values) ? req.body.values : [];

  if (!templateId || !/^\d{4}-\d{2}-\d{2}$/.test(checkDate)) {
    return res.status(400).json({ success: false, message: 'กรุณาเลือกเช็คลิสต์และวันที่ให้ถูกต้อง' });
  }

  const client = await pool.connect();
  try {
    const templateResult = await client.query(`${TEMPLATE_SELECT} WHERE t.id = $1 AND t.is_active = TRUE`, [templateId]);
    if (templateResult.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'ไม่พบแม่แบบเช็คลิสต์นี้ (อาจถูกลบไปแล้ว)' });
    }
    const template = templateResult.rows[0];

    // 1 แม่แบบ / 1 วัน ได้ใบเดียว (ใบที่ถูก Reject ทำใหม่ได้)
    const duplicate = await client.query(
      `SELECT 1 FROM automation_lines.pm_records
       WHERE template_id = $1 AND check_date = $2::date AND status <> 'rejected' LIMIT 1`,
      [templateId, checkDate]
    );
    if (duplicate.rowCount > 0) {
      return res.status(409).json({
        success: false,
        message: `เช็คลิสต์นี้ของวันที่ ${checkDate} ถูกบันทึกไปแล้ว (ถ้าถูก Reject จึงจะบันทึกใหม่ได้)`,
      });
    }

    const valueByItem = new Map(inputValues.map((v) => [Number(v?.item_id), v]));

    const rows = [];
    for (const item of template.items) {
      if (item.check_type === 'section') {
        rows.push({ item, valueBool: null, valueNumber: null, result: null, remark: null });
        continue;
      }
      const input = valueByItem.get(Number(item.id)) || {};
      let valueBool = null;
      let valueNumber = null;

      if (item.check_type === 'pass_fail') {
        if (input.value_bool === true || input.value_bool === false) valueBool = input.value_bool;
      } else {
        valueNumber = toNumberOrNull(input.value_number);
        if (Number.isNaN(valueNumber)) {
          return res.status(400).json({ success: false, message: `"${item.label}" ต้องกรอกเป็นตัวเลข` });
        }
      }

      if (item.is_required && valueBool === null && valueNumber === null) {
        return res.status(400).json({ success: false, message: `กรุณาเช็ค "${item.label}" ให้ครบ` });
      }

      rows.push({
        item,
        valueBool,
        valueNumber,
        result: judgeItem(item, valueBool, valueNumber),
        remark: String(input.remark || '').trim() || null,
      });
    }

    const overallResult = rows.some((r) => r.result === 'NG') ? 'NG' : 'OK';
    const approvalSteps = Array.isArray(template.approval_steps) ? template.approval_steps : [];
    // ไม่มีขั้นอนุมัติ -> ถือว่าอนุมัติทันที
    const status = approvalSteps.length === 0 ? 'approved' : 'pending';

    await client.query('BEGIN');
    const inserted = await client.query(
      `INSERT INTO automation_lines.pm_records
         (template_id, template_name, line_id, process, check_date, approval_steps, status, overall_result, note, checked_by, checked_by_name)
       VALUES ($1, $2, $3, $4, $5::date, $6::jsonb, $7, $8, $9, $10, $11)
       RETURNING id`,
      [
        template.id, template.name, template.line_id, template.process, checkDate,
        JSON.stringify(approvalSteps), status, overallResult, note,
        Number(req.user.employee_id), req.user.name || null,
      ]
    );
    const recordId = inserted.rows[0].id;

    for (const r of rows) {
      await client.query(
        `INSERT INTO automation_lines.pm_record_values
           (record_id, item_id, seq, label, description, check_type, unit, min_value, max_value, value_bool, value_number, result, remark)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          recordId, r.item.id, r.item.seq, r.item.label, r.item.description, r.item.check_type, r.item.unit,
          r.item.min_value, r.item.max_value, r.valueBool, r.valueNumber, r.result, r.remark,
        ]
      );
    }
    await client.query('COMMIT');

    await auditPm(req, 'PM_RECORD_SUBMIT', `PM Record #${recordId}`,
      `Submitted "${template.name}" (Line ${template.line_id} / ${template.process}) ${checkDate} result ${overallResult}`);
    io.emit('pm_updated', { type: 'record', id: recordId });

    res.json({
      success: true,
      message: status === 'approved' ? 'บันทึกเช็คลิสต์เรียบร้อย (ไม่ต้องอนุมัติ)' : 'บันทึกเช็คลิสต์เรียบร้อย ส่งให้ผู้อนุมัติแล้ว',
      data: { id: recordId, status, overall_result: overallResult },
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') {
      return res.status(409).json({
        success: false,
        message: `เช็คลิสต์นี้ของวันที่ ${checkDate} ถูกบันทึกไปแล้ว (ถ้าถูก Reject จึงจะบันทึกใหม่ได้)`,
      });
    }
    console.error('Submit PM Record Error:', err);
    res.status(500).json({ success: false, message: 'บันทึกเช็คลิสต์ไม่สำเร็จ' });
  } finally {
    client.release();
  }
});

// อนุมัติ / ไม่อนุมัติ ทีละขั้นตามลำดับที่ตั้งไว้ในแม่แบบ
router.post('/api/pm/records/:id/review', authenticateToken, async (req, res) => {
  const recordId = Number(req.params.id);
  const action = req.body?.action === 'reject' ? 'reject' : req.body?.action === 'approve' ? 'approve' : null;
  const comment = String(req.body?.comment || '').trim() || null;

  if (!action) return res.status(400).json({ success: false, message: 'action ต้องเป็น approve หรือ reject' });
  if (action === 'reject' && !comment) {
    return res.status(400).json({ success: false, message: 'กรุณาระบุเหตุผลที่ไม่อนุมัติ' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const recordResult = await client.query(
      `SELECT id, template_name, line_id, approval_steps, current_step, status
       FROM automation_lines.pm_records WHERE id = $1 FOR UPDATE`,
      [recordId]
    );
    if (recordResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'ไม่พบใบเช็คลิสต์นี้' });
    }
    const record = recordResult.rows[0];
    const position = pendingPositionOf(record);
    if (!position) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'ใบเช็คลิสต์นี้ไม่ได้อยู่ในสถานะรออนุมัติแล้ว' });
    }

    const linePositions = await getUserLinePositions(req.user.employee_id);
    if (!canApprovePosition(req.user, linePositions, record.line_id, position)) {
      await client.query('ROLLBACK');
      return res.status(403).json({
        success: false,
        message: `ขั้นนี้ต้องอนุมัติโดย ${POSITION_BY_KEY[position]?.label || position} ของ Line ${record.line_id}`,
      });
    }

    await client.query(
      `INSERT INTO automation_lines.pm_approvals (record_id, step_index, position, action, approved_by, approver_name, comment)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [recordId, record.current_step, position, action, Number(req.user.employee_id), req.user.name || null, comment]
    );

    const totalSteps = record.approval_steps.length;
    const nextStep = action === 'approve' ? record.current_step + 1 : record.current_step;
    const newStatus = action === 'reject' ? 'rejected' : nextStep >= totalSteps ? 'approved' : 'pending';

    await client.query(
      `UPDATE automation_lines.pm_records
       SET current_step = $1, status = $2, updated_at = CURRENT_TIMESTAMP
       WHERE id = $3`,
      [nextStep, newStatus, recordId]
    );
    await client.query('COMMIT');

    await auditPm(req, action === 'approve' ? 'PM_RECORD_APPROVE' : 'PM_RECORD_REJECT', `PM Record #${recordId}`,
      `${action === 'approve' ? 'Approved' : 'Rejected'} step ${record.current_step + 1}/${totalSteps} (${position}) of "${record.template_name}"${comment ? `: ${comment}` : ''}`);
    io.emit('pm_updated', { type: 'record', id: recordId });

    res.json({
      success: true,
      message: action === 'reject'
        ? 'ไม่อนุมัติใบเช็คลิสต์นี้แล้ว'
        : newStatus === 'approved' ? 'อนุมัติครบทุกขั้นแล้ว' : 'อนุมัติขั้นนี้แล้ว ส่งต่อให้ผู้อนุมัติขั้นถัดไป',
      data: { status: newStatus, current_step: nextStep },
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Review PM Record Error:', err);
    res.status(500).json({ success: false, message: 'บันทึกการอนุมัติไม่สำเร็จ' });
  } finally {
    client.release();
  }
});

// ลบใบเช็ค (เฉพาะ Admin กรณีบันทึกผิด)
router.delete('/api/pm/records/:id', authenticateToken, requireAdmin, async (req, res) => {
  const recordId = Number(req.params.id);
  try {
    const result = await pool.query(
      `DELETE FROM automation_lines.pm_records WHERE id = $1
       RETURNING template_name, TO_CHAR(check_date, 'YYYY-MM-DD') AS check_date`,
      [recordId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'ไม่พบใบเช็คลิสต์นี้' });
    }
    const r = result.rows[0];
    await auditPm(req, 'PM_RECORD_DELETE', `PM Record #${recordId}`,
      `Deleted "${r.template_name}" ${r.check_date}`);
    io.emit('pm_updated', { type: 'record', id: recordId });
    res.json({ success: true, message: 'ลบใบเช็คลิสต์เรียบร้อย' });
  } catch (err) {
    console.error('Delete PM Record Error:', err);
    res.status(500).json({ success: false, message: 'ลบใบเช็คลิสต์ไม่สำเร็จ' });
  }
});

export default router;
