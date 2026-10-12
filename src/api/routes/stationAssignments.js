import express from 'express';
import { pool } from '../lib/db.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

router.get('/api/station-assignments/:lineId', async (req, res) => {
  const { lineId } = req.params;
  const { shift } = req.query;
  try {
    let query = `SELECT * FROM automation_lines.station_assignments WHERE line_id = $1`;
    const params = [lineId];

    if (shift) {
      const cleanShift = (shift === 'b' || shift === 'night') ? 'b' : 'a';
      params.push(cleanShift);
      query += ` AND shift = $2`;
    }

    const result = await pool.query(query, params);

    // คงโครงสร้างเดิม { success: true, data: [...] } 100% พร้อมจัด Pretty-Print 2 spaces
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.send(JSON.stringify({ success: true, data: result.rows }, null, 2));
  } catch (err) {
    console.error('Fetch Assignments Error:', err);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(500).send(JSON.stringify({ success: false, error: 'ดึงข้อมูลการมอบหมายงานไม่สำเร็จ' }, null, 2));
  }
});

router.post('/api/station-assignments', authenticateToken, async (req, res) => {
  const { line_id, station_id, element_id, shift, operator_id, operator_name } = req.body;
  const userEmpId = Number(req.user?.employee_id);
  const userRole = String(req.user?.role || '').toLowerCase().trim();

  // 🟢 ตรวจสอบสิทธิ์: Admin หรือ ผู้ที่มีชื่อใน line_owners ของ line_id นี้ (Owner, Leader, Supervisor)
  if (userRole !== 'admin') {
    const ownerCheck = await pool.query(
      'SELECT 1 FROM automation_lines.line_owners WHERE TRIM(line_id) ILIKE TRIM($1) AND employee_id::text = $2::text',
      [line_id, userEmpId]
    );
    if (ownerCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        error: 'คุณไม่มีสิทธิ์จัดพนักงานใน Line นี้ (เฉพาะ Admin หรือ Owner / Leader / Supervisor ของ Line นี้เท่านั้น)'
      });
    }
  }

  const cleanLineId = line_id ? String(line_id).trim() : '';
  const cleanElementId = element_id ? String(element_id).trim() : '';
  const targetShift = (shift === 'b' || shift === 'night') ? 'b' : 'a';
  const cleanOpId = (operator_id && String(operator_id).trim() !== '-' && String(operator_id).trim() !== '')
    ? String(operator_id).trim() 
    : (operator_name ? String(operator_name).trim() : '');

  if (!cleanLineId || !cleanElementId || !cleanOpId) {
    return res.status(400).json({ 
      success: false, 
      error: 'ข้อมูลไม่ถูกต้อง: กรุณาระบุ Line, Element, Shift และพนักงานให้ครบถ้วน' 
    });
  }

  try {
    let validStationId = (station_id && station_id !== 'UNKNOWN' && String(station_id).trim() !== '') 
      ? String(station_id).trim() 
      : null;

    if (validStationId) {
      const stCheck = await pool.query('SELECT id FROM automation_lines.station WHERE id = $1', [validStationId]);
      if (stCheck.rows.length === 0) validStationId = null;
    }

    const query = `
      INSERT INTO automation_lines.station_assignments 
        (line_id, station_id, element_id, shift, operator_id, operator_name, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
      ON CONFLICT (line_id, element_id, shift) DO UPDATE
      SET 
        station_id = EXCLUDED.station_id,
        operator_id = EXCLUDED.operator_id,
        operator_name = EXCLUDED.operator_name,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *;
    `;

    const result = await pool.query(query, [
      cleanLineId,
      validStationId,
      cleanElementId,
      targetShift,
      cleanOpId,
      operator_name ? String(operator_name).trim() : cleanOpId
    ]);

    res.json({ success: true, message: 'บันทึกข้อมูลสำเร็จ', data: result.rows[0] });
  } catch (err) {
    console.error('Save Assignment Database Error:', err);
    res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาดในการบันทึกข้อมูลลงฐานข้อมูล' });
  }
});

router.delete('/api/station-assignments/:lineId/:elementId', authenticateToken, async (req, res) => {
  const { lineId, elementId } = req.params;
  const { shift } = req.query;
  const targetShift = (shift === 'b' || shift === 'night') ? 'b' : 'a';
  const userEmpId = Number(req.user?.employee_id);
  const userRole = String(req.user?.role || '').toLowerCase().trim();

  // 🟢 ตรวจสอบสิทธิ์: Admin หรือ ผู้ที่มีชื่อใน line_owners ของ lineId นี้
  if (userRole !== 'admin') {
    const ownerCheck = await pool.query(
      'SELECT 1 FROM automation_lines.line_owners WHERE TRIM(line_id) ILIKE TRIM($1) AND employee_id::text = $2::text',
      [lineId, userEmpId]
    );
    if (ownerCheck.rows.length === 0) {
      return res.status(403).json({ 
        success: false, 
        error: 'คุณไม่มีสิทธิ์ยกเลิกการมอบหมายงานใน Line นี้' 
      });
    }
  }

  try {
    await pool.query(
      `DELETE FROM automation_lines.station_assignments WHERE line_id = $1 AND element_id = $2 AND shift = $3`,
      [lineId, elementId, targetShift]
    );

    res.json({ success: true, message: `ยกเลิกการมอบหมายงานกะ ${targetShift.toUpperCase()} สำเร็จ` });
  } catch (err) {
    console.error('Delete Assignment Error:', err);
    res.status(500).json({ success: false, error: 'ลบข้อมูลไม่สำเร็จ' });
  }
});

router.post('/api/station-assignments/check-or-move', authenticateToken, async (req, res) => {
  const { line_id, station_id, element_id, shift, operator_id, operator_name, force_move } = req.body;
  const userEmpId = Number(req.user?.employee_id);
  const userRole = String(req.user?.role || '').toLowerCase().trim();

  // 🟢 ตรวจสอบสิทธิ์: Admin หรือ ผู้ที่มีชื่อใน line_owners ของ line_id นี้ (Owner, Leader, Supervisor)
  if (userRole !== 'admin') {
    const ownerCheck = await pool.query(
      'SELECT 1 FROM automation_lines.line_owners WHERE TRIM(line_id) ILIKE TRIM($1) AND employee_id::text = $2::text',
      [line_id, userEmpId]
    );
    if (ownerCheck.rows.length === 0) {
      return res.status(403).json({ 
        success: false, 
        error: 'คุณไม่มีสิทธิ์จัดพนักงานใน Line นี้ (เฉพาะ Admin หรือ Owner / Leader / Supervisor ของ Line นี้เท่านั้น)' 
      });
    }
  }

  const cleanLineId = line_id ? String(line_id).trim() : '';
  const cleanElementId = element_id ? String(element_id).trim() : '';
  const targetShift = (shift === 'b' || shift === 'night') ? 'b' : 'a';
  const cleanOpId = operator_id ? String(operator_id).trim() : '';
  const cleanOpName = operator_name ? String(operator_name).trim() : cleanOpId;

  if (!cleanLineId || !cleanElementId || !cleanOpId) {
    return res.status(400).json({ success: false, error: 'ข้อมูลไม่ครบถ้วน' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existingCheck = await client.query(
      `SELECT * FROM automation_lines.station_assignments 
       WHERE (operator_id = $1 OR operator_name = $2)
         AND shift = $3 
         AND (line_id != $4 OR element_id != $5)`,
      [cleanOpId, cleanOpName, targetShift, cleanLineId, cleanElementId]
    );

    if (existingCheck.rows.length > 0 && !force_move) {
      await client.query('ROLLBACK');
      const conflict = existingCheck.rows[0];
      return res.json({
        success: false,
        requiresConfirmation: true,
        currentAssignment: {
          line_id: conflict.line_id,
          station_id: conflict.station_id,
          element_id: conflict.element_id,
          shift: conflict.shift
        },
        message: `พนักงาน #${cleanOpId} ถูกมอบหมายงานอยู่ที่ Line: ${conflict.line_id} (Station: ${conflict.station_id || conflict.element_id}) ในกะ ${targetShift.toUpperCase()} แล้ว`
      });
    }

    await client.query(
      `DELETE FROM automation_lines.station_assignments 
       WHERE (operator_id = $1 OR operator_name = $2) 
         AND shift = $3`,
      [cleanOpId, cleanOpName, targetShift]
    );

    let validStationId = (station_id && station_id !== 'UNKNOWN' && String(station_id).trim() !== '') 
      ? String(station_id).trim() 
      : null;

    const upsertQuery = `
      INSERT INTO automation_lines.station_assignments 
        (line_id, station_id, element_id, shift, operator_id, operator_name, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
      ON CONFLICT (line_id, element_id, shift) DO UPDATE
      SET 
        station_id = EXCLUDED.station_id,
        operator_id = EXCLUDED.operator_id,
        operator_name = EXCLUDED.operator_name,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *;
    `;

    const result = await client.query(upsertQuery, [
      cleanLineId,
      validStationId,
      cleanElementId,
      targetShift,
      cleanOpId,
      cleanOpName
    ]);

    await client.query('COMMIT');
    res.json({ success: true, message: 'บันทึกการมอบหมายงานสำเร็จ', data: result.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Check/Move Assignment Error:', err);
    res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาดในการบันทึกข้อมูล' });
  } finally {
    client.release();
  }
});


export default router;

