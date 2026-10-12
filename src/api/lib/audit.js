import { pool } from './db.js';
import { io } from './realtime.js';

export const recordAuditLog = async ({ employeeId, userName, role, deviceId, action, target, details, ipAddress }) => {
  try {
    const parsedEmpId = Number.isInteger(Number(employeeId)) ? Number(employeeId) : null;
    
    let cleanIp = ipAddress || '127.0.0.1';
    if (typeof cleanIp === 'string') {
      if (cleanIp.startsWith('::ffff:')) cleanIp = cleanIp.replace('::ffff:', '');
      if (cleanIp === '::1') cleanIp = '127.0.0.1';
    }

    const result = await pool.query(
      `INSERT INTO auth.audit_logs (employee_id, user_name, role, device_id, action, target, details, ip_address) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [parsedEmpId, userName || 'Unknown', role || 'unverified', deviceId || null, action, target, details, cleanIp]
    );
    io.emit('new_audit_log', result.rows[0]);
  } catch (err) {
    console.error('Audit Log Record Error:', err);
  }
};

