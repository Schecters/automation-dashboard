import express from 'express';
import { pool } from '../lib/db.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

router.get('/api/notifications', authenticateToken, async (req, res) => {
  const empId = Number(req.user.employee_id);
  try {
    const result = await pool.query(
      `SELECT * FROM auth.notifications 
       WHERE employee_id = $1 
       ORDER BY created_at DESC 
       LIMIT 50;`,
      [empId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Fetch Notifications Error:', err);
    res.status(500).json({ message: 'ไม่สามารถดึงข้อมูลการแจ้งเตือนได้' });
  }
});

router.put('/api/notifications/mark-read', authenticateToken, async (req, res) => {
  const empId = Number(req.user.employee_id);
  try {
    await pool.query(
      `UPDATE auth.notifications SET is_read = TRUE WHERE employee_id = $1`,
      [empId]
    );
    res.json({ success: true, message: 'ทำเครื่องหมายอ่านแล้วทั้งหมด' });
  } catch (err) {
    console.error('Mark Read Error:', err);
    res.status(500).json({ message: 'เกิดข้อผิดพลาดในการอัปเดตสถานะ' });
  }
});

router.delete('/api/notifications', authenticateToken, async (req, res) => {
  const empId = Number(req.user.employee_id);
  try {
    await pool.query(`DELETE FROM auth.notifications WHERE employee_id = $1`, [empId]);
    res.json({ success: true, message: 'ลบรายการแจ้งเตือนทั้งหมดเรียบร้อย' });
  } catch (err) {
    console.error('Clear Notifications Error:', err);
    res.status(500).json({ message: 'ไม่สามารถลบการแจ้งเตือนได้' });
  }
});


export default router;

