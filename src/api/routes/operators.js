import express from 'express';
import path from 'path';
import fs from 'fs';
import { pool } from '../lib/db.js';
import { io } from '../lib/realtime.js';
import { getClientIp } from '../lib/clientIp.js';
import { recordAuditLog } from '../lib/audit.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

router.get('/api/operators', authenticateToken, async (req, res) => {
  const { line } = req.query;
  try {
    let query = `
      SELECT employee_id, name, lines, station, updated_at 
      FROM automation_lines.operators
    `;
    const params = [];

    if (line) {
      query += ` WHERE lines = $1`;
      params.push(line);
    }
    query += ` ORDER BY employee_id ASC;`;

    const result = await pool.query(query, params);

    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('Fetch Operators Error:', err);
    res.status(500).json({ success: false, error: 'ไม่สามารถดึงข้อมูลพนักงานได้' });
  }
});

router.post('/api/operators', authenticateToken, requireAdmin, async (req, res) => {
  const { employee_id, name, lines, station } = req.body;

  if (!employee_id || !name) {
    return res.status(400).json({
      success: false,
      error: 'กรุณากรอกรหัสพนักงาน (employee_id) และชื่อ (name)',
    });
  }

  try {
    const query = `
      INSERT INTO automation_lines.operators (employee_id, name, lines, station, updated_at)
      VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
      ON CONFLICT (employee_id) DO UPDATE 
      SET 
        name = EXCLUDED.name,
        lines = EXCLUDED.lines,
        station = EXCLUDED.station,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *;
    `;
    const result = await pool.query(query, [
      String(employee_id).trim(),
      String(name).trim(),
      lines ? String(lines).trim() : null,
      station ? String(station).trim() : null,
    ]);

    res.json({ success: true, message: 'บันทึกข้อมูลพนักงานสำเร็จ', data: result.rows[0] });
  } catch (err) {
    console.error('Save Operator Error:', err);
    if (err.code === '23503') {
      return res.status(400).json({
        success: false,
        error: 'Line หรือ Station ที่ระบุไม่มีอยู่ในระบบ กรุณาตรวจสอบอีกครั้ง',
      });
    }
    res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาดในการบันทึกข้อมูล' });
  }
});

router.put('/api/operators/:employeeId', authenticateToken, requireAdmin, async (req, res) => {
  const { employeeId } = req.params;
  const { name, lines, station } = req.body;

  if (!name) {
    return res.status(400).json({ success: false, error: 'กรุณาระบุชื่อ (name)' });
  }

  try {
    const query = `
      UPDATE automation_lines.operators 
      SET 
        name = $1, 
        lines = $2, 
        station = $3, 
        updated_at = CURRENT_TIMESTAMP
      WHERE employee_id = $4
      RETURNING *;
    `;
    const result = await pool.query(query, [
      String(name).trim(),
      lines ? String(lines).trim() : null,
      station ? String(station).trim() : null,
      employeeId,
    ]);

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'ไม่พบรหัสพนักงานที่ต้องการแก้ไข' });
    }

    res.json({ success: true, message: 'แก้ไขข้อมูลสำเร็จ', data: result.rows[0] });
  } catch (err) {
    console.error('Update Operator Error:', err);
    if (err.code === '23503') {
      return res.status(400).json({
        success: false,
        error: 'Line หรือ Station ที่ระบุไม่มีอยู่ในระบบ กรุณาตรวจสอบอีกครั้ง',
      });
    }
    res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาดในการแก้ไขข้อมูล' });
  }
});

router.delete('/api/operators/:employeeId', authenticateToken, requireAdmin, async (req, res) => {
  const { employeeId } = req.params;

  try {
    const result = await pool.query(
      `DELETE FROM automation_lines.operators WHERE employee_id = $1 RETURNING *;`,
      [employeeId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'ไม่พบรหัสพนักงานที่ต้องการลบ' });
    }

    res.json({ success: true, message: `ลบพนักงานรหัส ${employeeId} สำเร็จ` });
  } catch (err) {
    console.error('Delete Operator Error:', err);
    res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาดในการลบข้อมูล' });
  }
});

router.post('/api/operator-photo', authenticateToken, async (req, res) => {
  const { employee_id, image_base64 } = req.body;

  const cleanEmpId = String(employee_id || '').trim().replace(/\D/g, '');
  if (!cleanEmpId) {
    return res.status(400).json({ success: false, message: 'กรุณาระบุรหัสพนักงานเป็นตัวเลข' });
  }

  if (!image_base64 || !image_base64.startsWith('data:image')) {
    return res.status(400).json({ success: false, message: 'ไม่พบข้อมูลรูปภาพที่ถูกต้อง' });
  }

  // 🟢 ดึงข้อมูลผู้ใช้งานที่กำลังดำเนินการจาก token
  const userEmpId = Number(req.user?.employee_id);
  const userName = req.user?.name || `Emp #${userEmpId}`;
  const userRole = String(req.user?.role || '').toLowerCase().trim();

  try {
    const targetDir = path.resolve('C:/Website/Automation 1.0.1/src/assets');
    
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const base64Data = image_base64.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    const fileName = `${cleanEmpId}.png`;
    const filePath = path.join(targetDir, fileName);

    fs.writeFileSync(filePath, buffer);

    console.log(`Saved operator photo: ${filePath}`);

    // 🟢 1. บันทึกลง Audit Log
    const auditPayload = {
      employeeId: userEmpId,
      userName: userName,
      role: userRole,
      deviceId: req.user?.device_id || null,
      action: 'UPDATE_OPERATOR_PHOTO',
      target: `Operator #${cleanEmpId}`,
      details: `${userName} ได้อัปเดตรูปภาพประจำตัวพนักงานรหัส #${cleanEmpId} (${fileName})`,
      ipAddress: typeof getClientIp === 'function' ? getClientIp(req) : (req.ip || req.connection.remoteAddress)
    };

    let auditEntry = null;
    if (typeof recordAuditLog === 'function') {
      auditEntry = await recordAuditLog(auditPayload);
    }

    // 🟢 2. ยิง Socket.io Broadcast แบบ Real-time
    const socketServer = typeof io !== 'undefined' ? io : req.app.get('io');
    if (socketServer) {
      // Broadcast ไปที่หน้า Audit Log
      socketServer.emit('new_audit_log', auditEntry || {
        id: Date.now(),
        user_name: userName,
        role: userRole,
        action: 'UPDATE_OPERATOR_PHOTO',
        target: `Operator #${cleanEmpId}`,
        details: `${userName} ได้อัปเดตรูปภาพประจำตัวพนักงานรหัส #${cleanEmpId}`,
        ip_address: auditPayload.ipAddress,
        created_at: new Date().toISOString()
      });

      // Broadcast แจ้งหน้า Layout View ให้อัปเดตรูป Operator ทันที
      socketServer.emit('operator_photo_updated', { employee_id: cleanEmpId });
    }

    return res.json({
      success: true,
      fileName,
      filePath,
      message: `บันทึกรูปภาพ ${fileName} เรียบร้อยแล้ว`,
    });
  } catch (err) {
    console.error('Save Operator Photo Error:', err);
    return res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดในการบันทึกรูปภาพลงเซิร์ฟเวอร์',
      error: err.message,
    });
  }
});


export default router;

