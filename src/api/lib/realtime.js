import jwt from 'jsonwebtoken';
import { Server } from 'socket.io';
import { JWT_SECRET } from './config.js';
import { pool } from './db.js';

export let io = null;

// -------------------------------------------------------------
// 🖥️ จัดการ Device & User Session Map
// -------------------------------------------------------------
export const deviceSessions = new Map();

export const broadcastOnlineUsers = () => {
  const activeUsers = Array.from(deviceSessions.values()).map(s => ({
    employee_id: s.employeeId,
    name: s.name,
    role: s.role,
    device_id: s.deviceId
  }));
  io.emit('online_devices_update', activeUsers);
};

// 🚨 เตะทุกอุปกรณ์ของบัญชีนี้ที่ไม่ใช่เครื่องที่เพิ่ง login (ใช้ตอน login ใหม่ / login ซ้อน)
export const kickOtherSessions = (employeeId, keepDeviceId) => {
  if (!io) return;
  for (const [devId, session] of deviceSessions.entries()) {
    if (String(session.employeeId) === String(employeeId) && devId !== keepDeviceId) {
      io.to(session.socketId).emit('force_logout', {
        message: 'มีการเข้าสู่ระบบซ้อนจากอุปกรณ์อื่น บัญชีของคุณถูกออกจากระบบ'
      });
      const target = io.sockets.sockets.get(session.socketId);
      if (target) setTimeout(() => target.disconnect(true), 500);
      deviceSessions.delete(devId);
    }
  }
  broadcastOnlineUsers();
};

export const initRealtime = (server) => {
  // 🟢 Socket.IO Configuration
  io = new Server(server, {
    cors: { 
      origin: (origin, callback) => callback(null, true), 
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'] 
    },
    transports: ['websocket', 'polling']
  });

  io.use(async (socket, next) => {
    try {
      const { token, deviceId } = socket.handshake.auth;

      socket.data.deviceId = deviceId || 'dev_guest';
      socket.data.clientIp = socket.handshake.address || '127.0.0.1';

      if (!token || token === 'null' || token === 'undefined') {
        socket.data.user = { employee_id: 'guest', role: 'guest', name: 'Guest' };
        return next();
      }

      jwt.verify(token, JWT_SECRET, async (err, decoded) => {
        let userData = null;
        try {
          // ใช้ข้อมูลจาก DB เสมอ และ token ต้องตรงกับ session ล่าสุดของบัญชีนี้
          const dbUser = await pool.query(
            'SELECT employee_id, name, email, role, shift, current_session_token FROM auth.users WHERE employee_id = $1',
            [!err && decoded ? decoded.employee_id : null]
          );
          if (dbUser.rows.length > 0 && dbUser.rows[0].current_session_token === token) {
            userData = dbUser.rows[0];
          }
        } catch (dbErr) {
          console.error('Socket Auth DB Error:', dbErr);
        }

        // ส่ง token มาแต่ใช้ไม่ได้ (หมดอายุ / login ซ้อนจากที่อื่น / logout แล้ว) -> สั่งให้หน้าเว็บออกจากระบบ
        if (!userData) socket.data.sessionInvalid = true;

        if (userData) {
          socket.data.user = {
            employee_id: String(userData.employee_id),
            name: userData.name,
            role: String(userData.role || '').toLowerCase().trim(),
            shift: userData.shift || null
          };
        } else {
          socket.data.user = { employee_id: 'guest', role: 'guest', name: 'Guest' };
        }
        next();
      });
    } catch (error) {
      next();
    }
  });

  io.on('connection', (socket) => {
    const { user, deviceId } = socket.data;

    if (socket.data.sessionInvalid) {
      socket.emit('force_logout', { message: 'Session ของคุณหมดอายุ หรือมีการเข้าสู่ระบบจากอุปกรณ์อื่น กรุณาเข้าสู่ระบบใหม่' });
      setTimeout(() => socket.disconnect(true), 500);
      return;
    }

    if (user && user.employee_id !== 'guest') {
      deviceSessions.set(deviceId, {
        employeeId: user.employee_id,
        name: user.name,
        role: user.role,
        shift: user.shift,
        deviceId: deviceId,
        socketId: socket.id,
        connectedAt: new Date()
      });

      broadcastOnlineUsers();
    }

    socket.on('operator:audit_log', (data, ack) => {
      if (typeof ack === 'function') ack({ success: true });
    });

    socket.on('disconnect', () => {
      if (user && user.employee_id !== 'guest') {
        deviceSessions.delete(deviceId);
        broadcastOnlineUsers();
      }
    });
  });

  return io;
};

