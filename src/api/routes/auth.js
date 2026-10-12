import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { SALT_ROUNDS, JWT_SECRET } from '../lib/config.js';
import { pool } from '../lib/db.js';
import { io, deviceSessions, broadcastOnlineUsers, kickOtherSessions } from '../lib/realtime.js';
import { getClientIp } from '../lib/clientIp.js';
import { recordAuditLog } from '../lib/audit.js';
import { authenticateToken, isRequestFromAdmin } from '../middleware/auth.js';

const router = express.Router();

// ==========================================
// 🔑 Auth & Microsoft API Routes
// ==========================================
router.post('/api/auth/microsoft-profile', async (req, res) => {
  const { accessToken } = req.body;

  if (!accessToken) {
    return res.status(400).json({ message: 'Missing Microsoft Access Token' });
  }

  try {
    const response = await fetch('https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName,employeeId,jobTitle', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!response.ok) {
      return res.status(401).json({ message: 'Invalid Microsoft Token' });
    }

    const graphUser = await response.json();
    const email = graphUser.mail || graphUser.userPrincipalName || '';
    const empIdFromEmail = email ? email.split('@')[0].replace(/\D/g, '') : '';
    const employeeId = graphUser.employeeId || empIdFromEmail || '';

    res.json({
      success: true,
      profile: {
        employeeId: employeeId,
        fullName: graphUser.displayName || '',
        email: email
      }
    });
  } catch (err) {
    console.error('Microsoft Profile Fetch Error:', err);
    res.status(500).json({ message: 'Failed to fetch Microsoft profile' });
  }
});

router.post('/api/register', async (req, res) => {
  const { employeeId, name, email, fullName, password, role, shift } = req.body;
  const targetName = (name || fullName || '').trim();
  const parsedEmpId = Number(employeeId);

  if (!employeeId || isNaN(parsedEmpId) || !targetName || !password) {
    return res.status(400).json({ 
      success: false, 
      message: 'กรุณากรอกรหัสพนักงาน (ตัวเลข), ชื่อ-นามสกุล และรหัสผ่านให้ครบถ้วน' 
    });
  }

  const cleanEmail = email && typeof email === 'string' && email.trim() !== '' 
    ? email.trim().toLowerCase() 
    : null;
  const requestedRole = role && typeof role === 'string' && role.trim() !== ''
    ? role.trim().toLowerCase()
    : 'view';

  // 🛡️ สมัครเองได้แค่ 'view' เท่านั้น การกำหนด role อื่น (เช่น admin) ต้องทำโดย admin ที่ล็อกอินอยู่
  if (requestedRole !== 'view' && !(await isRequestFromAdmin(req))) {
    return res.status(403).json({
      success: false,
      message: 'ไม่มีสิทธิ์กำหนด Role นี้ เฉพาะผู้ดูแลระบบเท่านั้นที่กำหนด Role ได้'
    });
  }
  const targetRole = requestedRole;
  const targetShift = shift && ['a', 'b'].includes(String(shift).toLowerCase().trim()) 
    ? String(shift).toLowerCase().trim() 
    : null;

  try {
    let existingCheck;
    if (cleanEmail) {
      existingCheck = await pool.query(
        'SELECT employee_id, email FROM auth.users WHERE employee_id = $1 OR email = $2',
        [parsedEmpId, cleanEmail]
      );
    } else {
      existingCheck = await pool.query(
        'SELECT employee_id FROM auth.users WHERE employee_id = $1',
        [parsedEmpId]
      );
    }

    if (existingCheck.rows.length > 0) {
      return res.status(400).json({ 
        success: false, 
        message: `รหัสพนักงาน #${parsedEmpId} หรืออีเมลนี้มีอยู่ในระบบแล้ว` 
      });
    }

    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    await pool.query(
      `INSERT INTO auth.users 
        (employee_id, name, email, password, role, shift) 
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [parsedEmpId, targetName, cleanEmail, hashedPassword, targetRole, targetShift]
    );

    await recordAuditLog({
      employeeId: parsedEmpId,
      userName: targetName,
      role: targetRole,
      deviceId: null,
      action: 'USER_REGISTERED',
      target: `User #${parsedEmpId}`,
      details: `Registered (Role: '${targetRole}', Email: ${cleanEmail || 'None'})`,
      ipAddress: getClientIp(req)
    });

    return res.json({ 
      success: true, 
      message: `สมัครสมาชิกสำเร็จ! บัญชีของคุณได้รับสิทธิ์ ${targetRole.toUpperCase()} เรียบร้อย สามารถเข้าสู่ระบบได้ทันที` 
    });
  } catch (err) {
    console.error('Register Error:', err);
    return res.status(500).json({ 
      success: false, 
      message: 'เกิดข้อผิดพลาดในการบันทึกข้อมูลลงฐานข้อมูล', 
      error: err.message 
    });
  }
});

router.post('/api/login', async (req, res) => {
  const { employeeId, password, deviceId } = req.body;

  if (!employeeId || !password) {
    return res.status(400).json({ message: 'กรุณากรอกรหัสพนักงานและรหัสผ่าน' });
  }

  const clientDeviceId = deviceId || 'dev_unknown_' + Math.random().toString(36).substring(2);

  try {
    const result = await pool.query('SELECT * FROM auth.users WHERE employee_id = $1', [employeeId]);
    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'รหัสพนักงานหรือรหัสผ่านไม่ถูกต้อง' });
    }

    const dbUser = result.rows[0];

    if (!dbUser.role || dbUser.role.trim() === '') {
      return res.status(403).json({ 
        message: 'บัญชีนี้ยังไม่ได้รับสิทธิ์การเข้าใช้งาน กรุณาติดต่อผู้ดูแลระบบ' 
      });
    }

    const isPasswordMatch = await bcrypt.compare(password, dbUser.password);
    if (!isPasswordMatch) {
      return res.status(401).json({ message: 'รหัสพนักงานหรือรหัสผ่านไม่ถูกต้อง' });
    }

    const userData = {
      employee_id: String(dbUser.employee_id),
      name: dbUser.name,
      email: dbUser.email || null,
      role: String(dbUser.role).toLowerCase().trim(),
      shift: dbUser.shift || null,
      deviceId: clientDeviceId
    };

    // 🛡️ อายุ 7 วัน (เดิม 100 ปี ทำให้ token ที่หลุดไปใช้ได้ตลอด) ครบแล้วต้อง login ใหม่
    const token = jwt.sign(userData, JWT_SECRET, { expiresIn: '7d' });

    await pool.query(
      'UPDATE auth.users SET current_session_token = $1, last_device_id = $2 WHERE employee_id = $3',
      [token, clientDeviceId, employeeId]
    );

    // 🚨 token เก่าใช้ไม่ได้แล้ว -> เตะอุปกรณ์อื่นที่ยังเปิดค้างอยู่ให้ออกจากระบบทันที
    kickOtherSessions(userData.employee_id, clientDeviceId);

    await recordAuditLog({
      employeeId: userData.employee_id,
      userName: userData.name,
      role: userData.role,
      deviceId: clientDeviceId,
      action: 'USER_LOGIN',
      target: 'Session Auth',
      details: `User #${userData.employee_id} logged in from Device: ${clientDeviceId}`,
      ipAddress: getClientIp(req)
    });

    return res.json({
      success: true,
      user: userData,
      token: token,
      sessionToken: token,
      deviceId: clientDeviceId
    });
  } catch (err) {
    console.error('Login Error:', err);
    res.status(500).json({ message: 'Database connection error' });
  }
});

router.post('/api/auth/microsoft-sso', async (req, res) => {
  const { accessToken, deviceId } = req.body;

  if (!accessToken) {
    return res.status(400).json({ message: 'Missing Microsoft Access Token' });
  }

  const clientDeviceId = deviceId || 'dev_unknown_' + Math.random().toString(36).substring(2);

  try {
    const msResponse = await fetch('https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName,employeeId', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!msResponse.ok) {
      return res.status(401).json({ message: 'Invalid Microsoft Token' });
    }

    const graphUser = await msResponse.json();
    const email = (graphUser.mail || graphUser.userPrincipalName || '').toLowerCase().trim();
    const empIdFromEmail = email ? email.split('@')[0].replace(/\D/g, '') : '';
    const employeeId = graphUser.employeeId || empIdFromEmail;

    if (!employeeId || isNaN(Number(employeeId))) {
      return res.status(400).json({ message: 'ไม่สามารถระบุรหัสพนักงานจากบัญชี Microsoft ได้' });
    }

    const parsedEmpId = Number(employeeId);

    const userCheck = await pool.query(
      'SELECT * FROM auth.users WHERE employee_id = $1 OR (email IS NOT NULL AND email = $2)',
      [parsedEmpId, email]
    );

    if (userCheck.rows.length > 0) {
      const dbUser = userCheck.rows[0];

      if (!dbUser.role || dbUser.role.trim() === '') {
        return res.status(403).json({ message: 'บัญชีนี้ยังไม่ได้รับสิทธิ์การเข้าใช้งาน กรุณาติดต่อผู้ดูแลระบบ' });
      }

      const userData = {
        employee_id: String(dbUser.employee_id),
        name: dbUser.name,
        email: dbUser.email || null,
        role: String(dbUser.role).toLowerCase().trim(),
        shift: dbUser.shift || null,
        deviceId: clientDeviceId
      };

      const token = jwt.sign(userData, JWT_SECRET, { expiresIn: '8h' });

      await pool.query(
        'UPDATE auth.users SET current_session_token = $1, last_device_id = $2 WHERE employee_id = $3',
        [token, clientDeviceId, dbUser.employee_id]
      );

      // 🚨 token เก่าใช้ไม่ได้แล้ว -> เตะอุปกรณ์อื่นที่ยังเปิดค้างอยู่ให้ออกจากระบบทันที
      kickOtherSessions(userData.employee_id, clientDeviceId);

      await recordAuditLog({
        employeeId: userData.employee_id,
        userName: userData.name,
        role: userData.role,
        deviceId: clientDeviceId,
        action: 'MICROSOFT_SSO_LOGIN',
        target: 'Session Auth',
        details: `User #${userData.employee_id} logged in via Microsoft SSO`,
        ipAddress: getClientIp(req)
      });

      return res.json({
        success: true,
        isRegistered: true,
        user: userData,
        token: token,
        sessionToken: token,
        deviceId: clientDeviceId
      });
    }

    return res.json({
      success: true,
      isRegistered: false,
      profile: {
        employeeId: String(parsedEmpId),
        fullName: graphUser.displayName || '',
        email: email
      }
    });
  } catch (err) {
    console.error('Microsoft SSO Error:', err);
    res.status(500).json({ message: 'เกิดข้อผิดพลาดในการตรวจสอบสิทธิ์ผ่าน Microsoft' });
  }
});

// 🛡️ ต้องมี token และ logout ได้เฉพาะบัญชีของตัวเอง (ไม่เชื่อ employeeId/name/role จาก body)
router.post('/api/logout', authenticateToken, async (req, res) => {
  const { employee_id: employeeId, name, role } = req.user;
  const deviceId = req.body?.deviceId || req.user.device_id;

  try {
    await pool.query(
      'UPDATE auth.users SET current_session_token = NULL WHERE employee_id = $1',
      [employeeId]
    );

    // ตัดการเชื่อมต่อเฉพาะอุปกรณ์ที่เป็นของผู้ใช้คนนี้เท่านั้น
    const session = deviceId ? deviceSessions.get(deviceId) : null;
    if (session && String(session.employeeId) === String(employeeId)) {
      io.to(session.socketId).disconnectSockets(true);
      deviceSessions.delete(deviceId);
    }

    await recordAuditLog({
      employeeId: employeeId,
      userName: name || 'User',
      role: role || 'user',
      deviceId: deviceId || null,
      action: 'USER_LOGOUT',
      target: 'Session Auth',
      details: `User #${employeeId} logged out manually`,
      ipAddress: getClientIp(req)
    });

    broadcastOnlineUsers();
    res.json({ success: true, message: 'Logged out successfully' });
  } catch (err) {
    console.error('Logout Error:', err);
    res.status(500).json({ message: 'Logout failed' });
  }
});

router.get('/api/roles', async (req, res) => {
  try {
    const query = `
      SELECT enumlabel AS role
      FROM pg_enum e
      JOIN pg_type t ON e.enumtypid = t.oid
      JOIN pg_namespace n ON t.typnamespace = n.oid
      WHERE t.typname = 'user_role' AND n.nspname = 'auth'
      ORDER BY e.enumsortorder;
    `;
    const result = await pool.query(query);
    const roles = result.rows.map(row => row.role);
    res.json({ success: true, data: roles });
  } catch (err) {
    console.error("Fetch Roles Error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});


export default router;

