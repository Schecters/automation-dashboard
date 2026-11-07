import express from 'express';
import { pool } from '../lib/db.js';
import { getClientIp } from '../lib/clientIp.js';
import { recordAuditLog } from '../lib/audit.js';
import { requireInternal } from '../lib/internalKey.js';
import { authenticateToken, requireRoles } from '../middleware/auth.js';

// ==========================================
// 🧯 Defect Code (อาการงานเสีย) + ประวัติงานเสีย — อยู่ใน service data (port 5000) เพราะใช้ Database
//  - automation_lines.defect_codes : อาการของแต่ละ Station ของ MES (station_name + defect_code + description)
//  - automation_lines.defect_logs  : ทุกครั้งที่หน้า /MES ส่งงานเสีย
//  - service mes (ไม่ใช้ DB เอง) เรียกผ่าน /internal/* (เฉพาะในเครื่อง + key)
// ==========================================
const router = express.Router();
const EDIT_ROLES = ['admin', 'me', 'q'];

// "[", "]", ";" เป็นตัวคั่นใน testData ของ MES ห้ามอยู่ในค่า
const clean = (v, max) => String(v ?? '').replace(/[[\];}\r\n\t]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

const listCodes = async ({ station, activeOnly }) => {
  const where = [];
  const params = [];
  if (station) {
    params.push(station);
    where.push(`station_name = $${params.length}`);
  }
  if (activeOnly) where.push('is_active = TRUE');
  const { rows } = await pool.query(
    `SELECT id, station_name, defect_code, description, is_active, created_by, created_at, updated_at
       FROM automation_lines.defect_codes
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY station_name, defect_code`,
    params
  );
  return rows;
};

const audit = (req, action, details) =>
  recordAuditLog({
    employeeId: req.user.employee_id,
    userName: req.user.name,
    role: req.user.role,
    deviceId: req.user.device_id,
    action,
    target: 'defect_codes',
    details,
    ipAddress: getClientIp(req),
  });

// ---------- Defect Code ----------
router.get('/api/defect-codes', authenticateToken, async (req, res) => {
  try {
    const station = clean(req.query.station, 100) || null;
    res.json({ success: true, data: await listCodes({ station, activeOnly: req.query.active === '1' }) });
  } catch (err) {
    console.error('List defect codes error:', err);
    res.status(500).json({ success: false, message: 'โหลดรายการอาการเสียไม่สำเร็จ' });
  }
});

const readBody = (body) => ({
  station_name: clean(body?.station_name, 100),
  defect_code: clean(body?.defect_code, 50),
  description: clean(body?.description, 200),
  is_active: body?.is_active !== false,
});

const sendSaveError = (res, err) => {
  if (err.code === '23505') return res.status(409).json({ success: false, message: 'รหัสอาการนี้มีอยู่แล้วใน Station นี้' });
  console.error('Save defect code error:', err);
  return res.status(500).json({ success: false, message: 'บันทึกไม่สำเร็จ' });
};

router.post('/api/defect-codes', authenticateToken, requireRoles(...EDIT_ROLES), async (req, res) => {
  const d = readBody(req.body);
  if (!d.station_name || !d.defect_code || !d.description) {
    return res.status(400).json({ success: false, message: 'กรอก Station, รหัสอาการ และคำอธิบายให้ครบ' });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO automation_lines.defect_codes (station_name, defect_code, description, is_active, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [d.station_name, d.defect_code, d.description, d.is_active, req.user.employee_id]
    );
    audit(req, 'CREATE_DEFECT_CODE', `${d.station_name} ${d.defect_code} ${d.description}`);
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    sendSaveError(res, err);
  }
});

router.put('/api/defect-codes/:id', authenticateToken, requireRoles(...EDIT_ROLES), async (req, res) => {
  const id = Number(req.params.id);
  const d = readBody(req.body);
  if (!Number.isInteger(id) || !d.station_name || !d.defect_code || !d.description) {
    return res.status(400).json({ success: false, message: 'กรอก Station, รหัสอาการ และคำอธิบายให้ครบ' });
  }
  try {
    const { rows } = await pool.query(
      `UPDATE automation_lines.defect_codes
          SET station_name = $1, defect_code = $2, description = $3, is_active = $4, updated_at = NOW()
        WHERE id = $5 RETURNING *`,
      [d.station_name, d.defect_code, d.description, d.is_active, id]
    );
    if (!rows[0]) return res.status(404).json({ success: false, message: 'ไม่พบรายการนี้' });
    audit(req, 'UPDATE_DEFECT_CODE', `${d.station_name} ${d.defect_code} ${d.description}${d.is_active ? '' : ' (ปิดใช้งาน)'}`);
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    sendSaveError(res, err);
  }
});

// คัดลอกอาการ (ทั้งหมด หรือเฉพาะ ids) จาก Station หนึ่ง ไปหลาย Station — รหัสที่ปลายทางมีอยู่แล้วข้าม (ไม่ทับ)
router.post('/api/defect-codes/copy', authenticateToken, requireRoles(...EDIT_ROLES), async (req, res) => {
  const from = clean(req.body?.from_station, 100);
  const targets = [...new Set((Array.isArray(req.body?.to_stations) ? req.body.to_stations : []).map((s) => clean(s, 100)))]
    .filter((s) => s && s !== from)
    .slice(0, 200);
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isInteger) : null;
  if (!from || targets.length === 0) {
    return res.status(400).json({ success: false, message: 'เลือก Station ต้นทาง และ Station ปลายทางอย่างน้อย 1 Station' });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO automation_lines.defect_codes (station_name, defect_code, description, is_active, created_by)
       SELECT t.station, c.defect_code, c.description, c.is_active, $3
         FROM automation_lines.defect_codes c
        CROSS JOIN UNNEST($2::text[]) AS t(station)
        WHERE c.station_name = $1 AND ($4::int[] IS NULL OR c.id = ANY($4::int[]))
       ON CONFLICT (station_name, defect_code) DO NOTHING
       RETURNING station_name`,
      [from, targets, req.user.employee_id, ids]
    );
    audit(req, 'COPY_DEFECT_CODE', `${from} -> ${targets.join(', ')} (${rows.length} รายการ)`);
    res.json({ success: true, inserted: rows.length, stations: targets.length });
  } catch (err) {
    console.error('Copy defect codes error:', err);
    res.status(500).json({ success: false, message: 'คัดลอกไม่สำเร็จ' });
  }
});

router.delete('/api/defect-codes/:id', authenticateToken, requireRoles(...EDIT_ROLES), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ success: false, message: 'id ไม่ถูกต้อง' });
  try {
    const { rows } = await pool.query('DELETE FROM automation_lines.defect_codes WHERE id = $1 RETURNING *', [id]);
    if (!rows[0]) return res.status(404).json({ success: false, message: 'ไม่พบรายการนี้' });
    audit(req, 'DELETE_DEFECT_CODE', `${rows[0].station_name} ${rows[0].defect_code} ${rows[0].description}`);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete defect code error:', err);
    res.status(500).json({ success: false, message: 'ลบไม่สำเร็จ' });
  }
});

// ---------- ประวัติงานเสีย ----------
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

router.get('/api/defect-logs', authenticateToken, async (req, res) => {
  const where = [];
  const params = [];
  const add = (sql, v) => {
    params.push(v);
    where.push(sql.replace('?', `$${params.length}`));
  };
  // วันที่ตามเวลาไทย (from / to รวมทั้งวัน)
  if (DATE_RE.test(String(req.query.from || ''))) add(`created_at >= (?::date::timestamp AT TIME ZONE 'Asia/Bangkok')`, req.query.from);
  if (DATE_RE.test(String(req.query.to || ''))) add(`created_at < ((?::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok')`, req.query.to);
  const line = clean(req.query.line, 100);
  const station = clean(req.query.station, 100);
  const sn = clean(req.query.sn, 200);
  const mo = clean(req.query.mo, 50);
  if (line) add('line = ?', line);
  if (station) add('station = ?', station);
  if (mo) add('mo = ?', mo);
  if (sn) add('sn ILIKE ?', `%${sn.replace(/[%_\\]/g, '\\$&')}%`);
  if (req.query.success === '1') where.push('success = TRUE');
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limit = Math.min(Math.max(Number(req.query.limit) || 300, 1), 2000);

  try {
    const [list, summary] = await Promise.all([
      pool.query(
        `SELECT * FROM automation_lines.defect_logs ${whereSql} ORDER BY created_at DESC LIMIT ${limit}`,
        params
      ),
      pool.query(
        `SELECT station, defect_code, description, COUNT(*)::int AS qty
           FROM automation_lines.defect_logs ${whereSql}${where.length ? ' AND' : ' WHERE'} success = TRUE
          GROUP BY station, defect_code, description
          ORDER BY qty DESC, station, defect_code`,
        params
      ),
    ]);
    res.json({ success: true, data: list.rows, summary: summary.rows });
  } catch (err) {
    console.error('List defect logs error:', err);
    res.status(500).json({ success: false, message: 'โหลดประวัติงานเสียไม่สำเร็จ' });
  }
});

// ---------- ภายในเครื่อง (service mes เรียก) ----------
router.get('/internal/defect-codes', requireInternal, async (req, res) => {
  try {
    const id = Number(req.query.id);
    if (Number.isInteger(id) && id > 0) {
      const { rows } = await pool.query('SELECT * FROM automation_lines.defect_codes WHERE id = $1', [id]);
      return res.json({ success: true, data: rows[0] || null });
    }
    const station = clean(req.query.station, 100);
    res.json({ success: true, data: await listCodes({ station, activeOnly: true }) });
  } catch (err) {
    console.error('Internal defect codes error:', err);
    res.status(500).json({ success: false, message: 'อ่าน Database ไม่สำเร็จ' });
  }
});

router.post('/internal/defect-logs', requireInternal, async (req, res) => {
  const b = req.body || {};
  const t = (v, max) => String(v ?? '').slice(0, max);
  try {
    await pool.query(
      `INSERT INTO automation_lines.defect_logs
        (terminal, line, section, group_name, station, mo, model, sn, defect_id, defect_code, description, emp_no, emp_name, success, mes_response)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        t(b.terminal, 100), t(b.line, 100), t(b.section, 100), t(b.group, 100), t(b.station, 100),
        t(b.mo, 50), t(b.model, 100), t(b.sn, 200), Number.isInteger(b.defect_id) ? b.defect_id : null,
        t(b.defect_code, 50), t(b.description, 200), t(b.emp_no, 30), t(b.emp_name, 100),
        b.success === true, t(b.mes_response, 2000),
      ]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Insert defect log error:', err);
    res.status(500).json({ success: false, message: 'บันทึกประวัติงานเสียไม่สำเร็จ' });
  }
});

export default router;
