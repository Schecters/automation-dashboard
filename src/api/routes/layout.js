import express from 'express';
import path from 'path';
import fs from 'fs';
import { pool } from '../lib/db.js';
import { getClientIp } from '../lib/clientIp.js';
import { recordAuditLog } from '../lib/audit.js';
import { uploadLayout } from '../lib/uploads.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

router.post('/api/layout/upload-image', authenticateToken, requireAdmin, (req, res, next) => {
  uploadLayout.single('image')(req, res, (err) => {
    if (err) {
      console.error('[Multer Layout Error]:', err);
      return res.status(400).json({ success: false, message: `Multer Error: ${err.message}` });
    }
    next();
  });
}, async (req, res) => {
  try {
    const targetDir = path.resolve('C:/Website/Automation 1.0.1/img/Layout');
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    let fileName = '';

    if (req.file) {
      fileName = req.file.filename;
      console.log(`[Upload Layout] Saved file via Multipart: ${req.file.path}`);
    } else if (req.body?.image_base64) {
      const { image_base64, original_name } = req.body;
      const parts = image_base64.split(';base64,');
      const mimeType = parts[0].replace('data:', '');
      const rawBase64 = parts[1] || parts[0];
      const buffer = Buffer.from(rawBase64, 'base64');

      let ext = 'png';
      if (mimeType.includes('jpeg') || mimeType.includes('jpg')) ext = 'jpg';
      else if (mimeType.includes('webp')) ext = 'webp';

      const cleanName = path.parse(original_name || 'layout_img').name.replace(/[^a-zA-Z0-9_-]/g, '_') || 'img';
      fileName = `${cleanName}_${Date.now()}_${Math.round(Math.random() * 1e4)}.${ext}`;
      const filePath = path.join(targetDir, fileName);

      fs.writeFileSync(filePath, buffer);
      console.log(`[Upload Layout] Saved file via Base64: ${filePath}`);
    } else {
      return res.status(400).json({ success: false, message: 'ไม่พบไฟล์รูปภาพหรือข้อมูลรูปภาพที่ส่งมา' });
    }

    const fileUrl = `/api/operator-images/${fileName}`;

    await recordAuditLog({
      employeeId: req.user?.employee_id || null,
      userName: req.user?.name || 'Unknown',
      role: req.user?.role || 'user',
      deviceId: req.user?.device_id || null,
      action: 'UPLOAD_LAYOUT_IMAGE',
      target: `Layout Image (${fileName})`,
      details: `Saved photo file to C:/Website/Automation 1.0.1/img/Layout/${fileName}`,
      ipAddress: getClientIp(req),
    });

    return res.json({
      success: true,
      fileName,
      url: fileUrl,
      message: 'อัปโหลดรูปภาพสำเร็จ',
    });
  } catch (err) {
    console.error('Upload Layout Image Fatal Error:', err);
    return res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดในการบันทึกรูปภาพลงเซิร์ฟเวอร์',
      error: err.message,
    });
  }
});

router.get('/api/layout/:lineId', async (req, res) => {
  const { lineId } = req.params;
  try {
    const result = await pool.query(
      `SELECT elements FROM automation_lines.line_layouts WHERE line_id = $1 LIMIT 1;`,
      [lineId]
    );

    if (result.rows.length === 0) {
      return res.json({ success: true, data: [] });
    }

    res.json({ success: true, data: result.rows[0].elements });
  } catch (err) {
    console.error('Fetch Layout Error:', err);
    res.status(500).json({ success: false, error: 'ไม่สามารถดึงข้อมูลผังได้' });
  }
});

router.post('/api/layout/:lineId', authenticateToken, requireAdmin, async (req, res) => {
  const { lineId } = req.params;
  const elements = req.body?.elements || [];

  if (!Array.isArray(elements)) {
    return res.status(400).json({ 
      success: false, 
      error: 'รูปแบบข้อมูลไม่ถูกต้อง (elements ต้องเป็น Array)' 
    });
  }

  try {
    const query = `
      INSERT INTO automation_lines.line_layouts (line_id, elements, updated_at)
      VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP)
      ON CONFLICT (line_id) DO UPDATE 
      SET 
        elements = EXCLUDED.elements,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *;
    `;
    const result = await pool.query(query, [lineId, JSON.stringify(elements)]);
    res.json({ success: true, message: `บันทึก Layout ของ ${lineId} สำเร็จ`, data: result.rows[0] });
  } catch (err) {
    console.error('Save Layout Error:', err);
    res.status(500).json({ success: false, error: 'บันทึก Layout ไม่สำเร็จ' });
  }
});


export default router;

