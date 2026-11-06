import crypto from 'crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import { Server } from 'socket.io';
import { JWT_SECRET } from './config.js';
import { pool } from './db.js';
import { serviceUrl } from './serviceMap.js';

// ==========================================
// 📡 Realtime (socket.io)
//  - socket.io จริงอยู่ที่ service "realtime" ตัวเดียว (หรือ server.js โหมดรวม) — เรียก initRealtime()
//  - service อื่นใช้ `io` ตัวเดียวกันนี้ได้เหมือนเดิม: io.emit(...) / io.to(room).emit(...)
//    แต่จะส่งเป็น HTTP ไปให้ service realtime กระจายต่อ (ไม่รอผล — realtime ดับ API อื่นยังทำงานได้)
//  - ห้องที่ใช้: user:<employee_id>, device:<deviceId>
// ==========================================

let server = null; // socket.io Server (มีเฉพาะใน process ที่เรียก initRealtime)
const deviceSessions = new Map(); // deviceId -> { employeeId, name, role, shift, deviceId, socketId, connectedAt }

// key ภายในระหว่าง service (ไม่ต้องตั้งเพิ่มใน .env — คำนวณจาก JWT_SECRET)
const INTERNAL_KEY = crypto.createHash('sha256').update(`${JWT_SECRET}:internal-emit`).digest('hex');
const INTERNAL_PATH = '/internal/emit';

const broadcastOnlineLocal = () => {
  const activeUsers = Array.from(deviceSessions.values()).map((s) => ({
    employee_id: s.employeeId,
    name: s.name,
    role: s.role,
    device_id: s.deviceId,
  }));
  server.emit('online_devices_update', activeUsers);
};

// 🚨 เตะทุกอุปกรณ์ของบัญชีนี้ที่ไม่ใช่เครื่องที่เพิ่ง login (ใช้ตอน login ใหม่ / login ซ้อน)
const kickLocal = (employeeId, keepDeviceId) => {
  for (const [devId, session] of deviceSessions.entries()) {
    if (String(session.employeeId) === String(employeeId) && devId !== keepDeviceId) {
      server.to(session.socketId).emit('force_logout', {
        message: 'มีการเข้าสู่ระบบซ้อนจากอุปกรณ์อื่น บัญชีของคุณถูกออกจากระบบ',
      });
      const target = server.sockets.sockets.get(session.socketId);
      if (target) setTimeout(() => target.disconnect(true), 500);
      deviceSessions.delete(devId);
    }
  }
  broadcastOnlineLocal();
};

// logout: ตัดเฉพาะอุปกรณ์นี้ ถ้าเป็นของบัญชีนี้จริง
const logoutDeviceLocal = (employeeId, deviceId) => {
  const session = deviceId ? deviceSessions.get(deviceId) : null;
  if (session && String(session.employeeId) === String(employeeId)) {
    server.to(session.socketId).disconnectSockets(true);
    deviceSessions.delete(deviceId);
  }
  broadcastOnlineLocal();
};

// ทำคำสั่งจริง (ใน process ที่มี socket.io)
const applyLocal = (cmd) => {
  if (cmd.kick) return kickLocal(cmd.kick.employeeId, cmd.kick.keepDeviceId);
  if (cmd.logoutDevice) return logoutDeviceLocal(cmd.logoutDevice.employeeId, cmd.logoutDevice.deviceId);
  if (cmd.broadcastOnline) return broadcastOnlineLocal();
  const target = cmd.room ? server.to(cmd.room) : server;
  if (cmd.disconnect) return target.disconnectSockets(true);
  if (cmd.event) target.emit(cmd.event, cmd.data);
};

let warnedAt = 0;
const send = (cmd) => {
  if (server) {
    try {
      applyLocal(cmd);
    } catch (err) {
      console.error('Realtime emit error:', err.message);
    }
    return;
  }
  fetch(`${serviceUrl('realtime')}${INTERNAL_PATH}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-key': INTERNAL_KEY },
    body: JSON.stringify(cmd),
    signal: AbortSignal.timeout(3000),
  }).catch((err) => {
    // realtime ปิดอยู่ -> หน้าเว็บแค่ไม่อัปเดตสด เตือนใน log ไม่เกินนาทีละครั้ง
    if (Date.now() - warnedAt > 60000) {
      warnedAt = Date.now();
      console.warn(`⚠️ ส่งข้อมูล realtime ไม่ได้ (service realtime ปิดอยู่?): ${err.message}`);
    }
  });
};

// ใช้แทน socket.io Server ได้เหมือนเดิมทุก service
export const io = {
  emit: (event, data) => send({ event, data }),
  to: (room) => ({
    emit: (event, data) => send({ room, event, data }),
    disconnectSockets: () => send({ room, disconnect: true }),
  }),
};
export const kickOtherSessions = (employeeId, keepDeviceId) => send({ kick: { employeeId, keepDeviceId } });
export const logoutDevice = (employeeId, deviceId) => send({ logoutDevice: { employeeId, deviceId } });
export const broadcastOnlineUsers = () => send({ broadcastOnline: true });
export const userRoom = (employeeId) => `user:${employeeId}`;

const isLoopback = (addr = '') => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(addr);

// endpoint ให้ service อื่นสั่ง emit (รับเฉพาะในเครื่อง server + key ถูก)
export const internalEmitRouter = express.Router();
internalEmitRouter.post(INTERNAL_PATH, express.json({ limit: '5mb' }), (req, res) => {
  if (!isLoopback(req.socket.remoteAddress) || req.get('x-internal-key') !== INTERNAL_KEY) {
    return res.status(403).json({ success: false });
  }
  if (!server) return res.status(503).json({ success: false, message: 'realtime ยังไม่พร้อม' });
  try {
    applyLocal(req.body || {});
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export const initRealtime = (httpServer) => {
  // 🟢 Socket.IO Configuration
  server = new Server(httpServer, {
    cors: {
      origin: (origin, callback) => callback(null, true),
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
    },
    transports: ['websocket', 'polling'],
  });

  server.use(async (socket, next) => {
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
            shift: userData.shift || null,
          };
        } else {
          socket.data.user = { employee_id: 'guest', role: 'guest', name: 'Guest' };
        }
        next();
      });
    } catch {
      next();
    }
  });

  server.on('connection', (socket) => {
    const { user, deviceId } = socket.data;

    if (socket.data.sessionInvalid) {
      socket.emit('force_logout', { message: 'Session ของคุณหมดอายุ หรือมีการเข้าสู่ระบบจากอุปกรณ์อื่น กรุณาเข้าสู่ระบบใหม่' });
      setTimeout(() => socket.disconnect(true), 500);
      return;
    }

    if (user && user.employee_id !== 'guest') {
      socket.join(userRoom(user.employee_id));
      socket.join(`device:${deviceId}`);
      deviceSessions.set(deviceId, {
        employeeId: user.employee_id,
        name: user.name,
        role: user.role,
        shift: user.shift,
        deviceId: deviceId,
        socketId: socket.id,
        connectedAt: new Date(),
      });

      broadcastOnlineLocal();
    }

    socket.on('operator:audit_log', (data, ack) => {
      if (typeof ack === 'function') ack({ success: true });
    });

    socket.on('disconnect', () => {
      if (user && user.employee_id !== 'guest') {
        // เชื่อมใหม่ก่อน disconnect เก่าจะมาถึง -> อย่าลบ session ใหม่
        if (deviceSessions.get(deviceId)?.socketId === socket.id) deviceSessions.delete(deviceId);
        broadcastOnlineLocal();
      }
    });
  });

  return server;
};
