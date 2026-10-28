import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../lib/config.js';
import { pool } from '../lib/db.js';
import { getClientIp } from '../lib/clientIp.js';

// 🛡️ Middleware: ตรวจสอบ REST API Token
export const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  let token = null;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1]?.trim();
  }

  if (!token || token === 'null' || token === 'undefined') {
    token = req.headers['x-session-token'];
    if (typeof token === 'string') token = token.trim();
  }

  const clientDeviceId = req.headers['x-device-id'] || req.headers['X-Device-Id'];

  if (!token || token === 'null' || token === 'undefined' || token === '') {
    return res.status(401).json({ message: 'Access Denied: Missing Token' });
  }

  jwt.verify(token, JWT_SECRET, async (err, decodedUser) => {
    if (!err && decodedUser) {
      try {
        // 🛡️ ใช้ role ปัจจุบันจาก Database เสมอ ไม่เชื่อ role ใน JWT
        // (token อายุยาว ถ้า admin ลดสิทธิ์/ลบผู้ใช้ไปแล้ว token เดิมต้องใช้สิทธิ์เก่าไม่ได้)
        const dbUser = await pool.query(
          'SELECT role, shift, current_session_token FROM auth.users WHERE employee_id = $1',
          [decodedUser.employee_id]
        );

        if (dbUser.rows.length === 0) {
          return res.status(401).json({ code: 'SESSION_INVALID', message: 'Session Expired or Invalid' });
        }

        // 🛡️ 1 บัญชี ใช้ได้ 1 session: ถ้ามีการ login ใหม่จากที่อื่น หรือ logout ไปแล้ว token เดิมต้องใช้ไม่ได้
        if (dbUser.rows[0].current_session_token !== token) {
          return res.status(401).json({
            code: 'SESSION_REPLACED',
            message: 'มีการเข้าสู่ระบบจากอุปกรณ์อื่น หรือ Session นี้ถูกออกจากระบบแล้ว'
          });
        }

        req.user = {
          employee_id: String(decodedUser.employee_id),
          name: decodedUser.name,
          email: decodedUser.email || null,
          role: String(dbUser.rows[0].role || '').toLowerCase().trim(),
          shift: dbUser.rows[0].shift || null,
          device_id: clientDeviceId || decodedUser.deviceId || null
        };
        return next();
      } catch (dbErr) {
        console.error('Auth DB Verification Error:', dbErr);
        return res.status(500).json({ message: 'Authentication verification failed' });
      }
    }

    // 🛡️ token ที่เป็น JWT แต่ verify ไม่ผ่าน (หมดอายุ / เซ็นด้วย secret เก่า / ถูกปลอม) ต้องปฏิเสธทันที
    // ห้ามไปเทียบกับ current_session_token ใน DB ไม่อย่างนั้น token หมดอายุหรือ token เก่าจะยังใช้ได้
    if (token.split('.').length === 3) {
      return res.status(401).json({ code: 'SESSION_EXPIRED', message: 'Session หมดอายุ กรุณาเข้าสู่ระบบใหม่' });
    }

    try {
      const dbCheck = await pool.query(
        'SELECT employee_id, name, email, role, shift, last_device_id FROM auth.users WHERE current_session_token = $1',
        [token]
      );

      if (dbCheck.rows.length > 0) {
        const u = dbCheck.rows[0];
        req.user = {
          employee_id: String(u.employee_id),
          name: u.name,
          email: u.email || null,
          role: String(u.role || '').toLowerCase().trim(),
          shift: u.shift || null,
          device_id: clientDeviceId || u.last_device_id || null
        };
        return next();
      }

      console.warn(`[Auth 401] Invalid Token from IP: ${getClientIp(req)}`);
      return res.status(401).json({ message: 'Session Expired or Invalid' });
    } catch (dbErr) {
      console.error('Auth DB Verification Error:', dbErr);
      return res.status(500).json({ message: 'Authentication verification failed' });
    }
  });
};

// 🏭 token ของ operator หน้า MES Update (login ด้วยรหัสพนักงานอย่างเดียว)
// ใช้ได้เฉพาะ API /api/mes/* — token dashboard ใช้แทนไม่ได้ และ token นี้ก็ใช้ API อื่นไม่ได้
// (authenticateToken เทียบกับ current_session_token ใน auth.users จึงไม่ผ่าน)
export const MES_OPERATOR_KIND = 'mes_operator';

export const authenticateMesOperator = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return res.status(401).json({ code: 'MES_LOGIN_REQUIRED', message: 'กรุณาเข้าสู่ระบบด้วยรหัสพนักงาน' });
  }

  jwt.verify(token, JWT_SECRET, async (err, decoded) => {
    if (err || decoded?.kind !== MES_OPERATOR_KIND) {
      return res.status(401).json({ code: 'MES_SESSION_EXPIRED', message: 'หมดเวลาการใช้งาน กรุณาเข้าสู่ระบบใหม่' });
    }
    try {
      // ถูกลบออกจากระบบ Operator แล้ว ใช้ต่อไม่ได้
      const op = await pool.query(
        'SELECT employee_id, name FROM automation_lines.operators WHERE employee_id::text = $1::text',
        [decoded.employee_id]
      );
      if (op.rowCount === 0) {
        return res.status(401).json({ code: 'MES_OPERATOR_NOT_FOUND', message: 'ไม่พบรหัสพนักงานนี้ในระบบ Operator' });
      }
      req.mesOperator = { employee_id: String(op.rows[0].employee_id), name: op.rows[0].name || '' };
      return next();
    } catch (dbErr) {
      console.error('MES Operator Auth Error:', dbErr);
      return res.status(500).json({ message: 'Authentication verification failed' });
    }
  });
};

export const requireAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Forbidden: Admin access required only' });
  }
  next();
};

// 🛡️ อนุญาตเฉพาะ role ที่กำหนด เช่น requireRoles('admin', 'me')
export const requireRoles = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ success: false, message: `Forbidden: ต้องเป็น ${roles.join(' หรือ ').toUpperCase()} เท่านั้น` });
  }
  next();
};

// 🛡️ ใช้กับ route ที่เปิดให้ทุกคนเรียกได้ แต่บาง option ต้องเป็น admin (เช่น สมัครสมาชิกพร้อมกำหนด role)
// คืนค่า true ถ้า request นี้มี token ของผู้ใช้ที่เป็น admin อยู่จริงใน Database
export const isRequestFromAdmin = (req) => new Promise((resolve) => {
  const hasToken = req.headers['authorization'] || req.headers['x-session-token'];
  if (!hasToken) return resolve(false);

  // authenticateToken จะเรียก res.status().json() เมื่อ token ไม่ผ่าน -> ถือว่าไม่ใช่ admin
  const silentRes = { status: () => ({ json: () => resolve(false) }) };
  authenticateToken(req, silentRes, () => resolve(req.user?.role === 'admin'));
});

