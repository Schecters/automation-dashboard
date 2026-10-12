import express from 'express';
import bcrypt from 'bcrypt';
import { SALT_ROUNDS } from '../lib/config.js';
import { pool } from '../lib/db.js';
import { getClientIp } from '../lib/clientIp.js';
import { recordAuditLog } from '../lib/audit.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

router.get('/api/audit-logs', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM auth.audit_logs ORDER BY created_at DESC LIMIT 150');
    res.json(result.rows);
  } catch (err) {
    console.error('Fetch Logs Error:', err);
    res.status(500).json({ message: 'ไม่สามารถดึงข้อมูล Audit Log ได้' });
  }
});

router.get('/api/users', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      // 🛡️ ห้ามส่ง current_session_token ออกไป (ใครได้ไปจะสวมรอยเป็นเจ้าของบัญชีได้ทันที)
      'SELECT employee_id, name, email, role, shift, last_device_id FROM auth.users ORDER BY employee_id ASC'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Fetch Users Error:', err);
    res.status(500).json({ message: 'ไม่สามารถดึงข้อมูลผู้ใช้ได้' });
  }
});

router.put('/api/users/:id', authenticateToken, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { name, email, role, password, shift } = req.body;
  const targetRole = String(role).toLowerCase().trim();
  const targetShift = shift && ['a', 'b'].includes(String(shift).toLowerCase().trim()) 
    ? String(shift).toLowerCase().trim() 
    : null;
  const targetEmail = email && email.trim() !== '' ? email.trim() : null;

  if (String(req.user.employee_id) === String(id) && targetRole !== 'admin') {
    return res.status(400).json({ message: 'ไม่สามารถลดสิทธิ์บัญชีผู้ดูแลระบบของตนเองได้' });
  }

  try {
    let result;
    if (password && password.trim() !== '') {
      const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
      result = await pool.query(
        'UPDATE auth.users SET name = $1, email = $2, role = $3, password = $4, shift = $5, updated_at = CURRENT_TIMESTAMP WHERE employee_id = $6 RETURNING *',
        [name, targetEmail, targetRole, hashedPassword, targetShift, id]
      );
    } else {
      result = await pool.query(
        'UPDATE auth.users SET name = $1, email = $2, role = $3, shift = $4, updated_at = CURRENT_TIMESTAMP WHERE employee_id = $5 RETURNING *',
        [name, targetEmail, targetRole, targetShift, id]
      );
    }

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'ไม่พบพนักงานรหัสนี้' });
    }

    await recordAuditLog({
      employeeId: req.user.employee_id,
      userName: req.user.name,
      role: req.user.role,
      deviceId: req.user.device_id,
      action: 'UPDATE_USER',
      target: `User #${id}`,
      details: `Updated info: Name="${name}", Role="${targetRole}", Shift="${targetShift || '-'}"`,
      ipAddress: getClientIp(req)
    });

    res.json({ message: 'อัปเดตข้อมูลพนักงานสำเร็จ' });
  } catch (err) {
    console.error('Update User Error:', err);
    res.status(500).json({ message: 'ไม่สามารถอัปเดตข้อมูลได้' });
  }
});

router.delete('/api/users/:id', authenticateToken, requireAdmin, async (req, res) => {
  const { id } = req.params;

  if (String(req.user.employee_id) === String(id)) {
    return res.status(400).json({ message: 'ไม่สามารถลบบัญชีที่กำลังใช้งานอยู่ได้' });
  }

  try {
    const result = await pool.query('DELETE FROM auth.users WHERE employee_id = $1 RETURNING *', [id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'ไม่พบพนักงานรหัสนี้ในระบบ' });
    }

    const deletedUser = result.rows[0];

    await recordAuditLog({
      employeeId: req.user.employee_id,
      userName: req.user.name,
      role: req.user.role,
      deviceId: req.user.device_id,
      action: 'DELETE_USER',
      target: `User #${id} (${deletedUser.name})`,
      details: `Deleted user account permanently`,
      ipAddress: getClientIp(req)
    });

    res.json({ message: 'ลบข้อมูลผู้ใช้งานสำเร็จ' });
  } catch (err) {
    console.error('Delete User Error:', err);
    res.status(500).json({ message: 'ไม่สามารถลบข้อมูลผู้ใช้ได้' });
  }
});


export default router;

