import express from 'express';
import { pool } from '../lib/db.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

router.post('/api/excel/save-config', authenticateToken, requireAdmin, async (req, res) => {
  const { 
    config_key, file_name, drive_id, drive_item_id, table_name,
    col_employee_id, col_name, col_score, web_url 
  } = req.body;

  if (!config_key || !file_name || !drive_id || !drive_item_id) {
    return res.status(400).json({ message: 'กรุณาระบุข้อมูลให้ครบถ้วน' });
  }

  try {
    const query = `
      INSERT INTO auth.excel_configs (
        config_key, file_name, drive_id, drive_item_id, table_name, 
        col_employee_id, col_name, col_score, web_url, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)
      ON CONFLICT (config_key) DO UPDATE 
      SET 
        file_name = EXCLUDED.file_name,
        drive_id = EXCLUDED.drive_id,
        drive_item_id = EXCLUDED.drive_item_id,
        table_name = EXCLUDED.table_name,
        col_employee_id = EXCLUDED.col_employee_id,
        col_name = EXCLUDED.col_name,
        col_score = EXCLUDED.col_score,
        web_url = EXCLUDED.web_url,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *;
    `;

    const result = await pool.query(query, [
      config_key.trim(),
      file_name.trim(),
      drive_id.trim(),
      drive_item_id.trim(),
      table_name?.trim() || 'OfficeForms.Table',
      col_employee_id?.trim() || 'Employee ID',
      col_name?.trim() || 'Name',
      col_score?.trim() || 'Score',
      web_url ? web_url.trim() : null
    ]);

    res.json({ success: true, message: `บันทึกข้อมูล "${config_key}" สำเร็จ`, data: result.rows[0] });
  } catch (error) {
    console.error('Save Excel Config Error:', error);
    res.status(500).json({ message: 'เกิดข้อผิดพลาดในการบันทึกข้อมูล', error: error.message });
  }
});

router.get('/api/excel-configs', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT config_key, file_name, drive_id, drive_item_id, table_name, 
              col_employee_id, col_name, col_score, web_url, created_at, updated_at 
       FROM auth.excel_configs ORDER BY updated_at DESC`
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('Fetch Excel Configs Error:', err);
    res.status(500).json({ success: false, message: 'ไม่สามารถดึงข้อมูลการตั้งค่าได้' });
  }
});

router.put('/api/excel-configs/:key', authenticateToken, requireAdmin, async (req, res) => {
  const { key } = req.params;
  const { 
    file_name, drive_id, drive_item_id, table_name,
    col_employee_id, col_name, col_score, web_url 
  } = req.body;

  if (!file_name || !drive_id || !drive_item_id) {
    return res.status(400).json({ message: 'กรุณากรอกข้อมูลให้ครบถ้วน' });
  }

  try {
    const result = await pool.query(
      `UPDATE auth.excel_configs 
       SET file_name = $1, drive_id = $2, drive_item_id = $3, table_name = $4,
           col_employee_id = $5, col_name = $6, col_score = $7, web_url = $8, updated_at = CURRENT_TIMESTAMP 
       WHERE config_key = $9 RETURNING *`,
      [
        file_name.trim(),
        drive_id.trim(),
        drive_item_id.trim(),
        table_name?.trim() || 'OfficeForms.Table',
        col_employee_id?.trim() || 'Employee ID',
        col_name?.trim() || 'Name',
        col_score?.trim() || 'Score',
        web_url ? web_url.trim() : null,
        key
      ]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'ไม่พบรายการที่ต้องการแก้ไข' });
    }

    res.json({ success: true, message: `อัปเดต ${key} สำเร็จ`, data: result.rows[0] });
  } catch (err) {
    console.error('Update Config Error:', err);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการอัปเดตข้อมูล' });
  }
});

router.delete('/api/excel-configs/:key', authenticateToken, requireAdmin, async (req, res) => {
  const { key } = req.params;

  try {
    const result = await pool.query('DELETE FROM auth.excel_configs WHERE config_key = $1 RETURNING *', [key]);

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'ไม่พบรายการที่ต้องการลบ' });
    }

    res.json({ success: true, message: `ลบการตั้งค่า ${key} เรียบร้อยแล้ว` });
  } catch (err) {
    console.error('Delete Config Error:', err);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการลบข้อมูล' });
  }
});

router.get('/api/excel-targets', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, url, is_active, created_at, updated_at 
       FROM auth.excel_sync_targets 
       ORDER BY id ASC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Fetch Excel Targets Error:', err);
    res.status(500).json({ success: false, message: 'ไม่สามารถดึงข้อมูลเป้าหมาย Excel ได้', error: err.message });
  }
});

router.get('/api/excel-configs/sync-urls', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT config_key, file_name, web_url 
       FROM auth.excel_configs 
       WHERE web_url IS NOT NULL AND TRIM(web_url) != ''
       ORDER BY config_key ASC`
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('Fetch Sync URLs Error:', err);
    res.status(500).json({ success: false, message: 'ไม่สามารถดึงข้อมูล URL ได้' });
  }
});


export default router;

