import { createServiceApp, listenService } from '../lib/service.js';
import { initRealtime, internalEmitRouter } from '../lib/realtime.js';

// 📡 Realtime (socket.io) — หน้าเว็บต่อ socket ที่นี่ / service อื่นสั่งส่งข้อมูลผ่าน POST /internal/emit
// ตัวนี้เล็กและแทบไม่ต้องแก้ ไม่ต้องรีสตาร์ทตอนอัปเดตเรื่องอื่น (รีสตาร์ทแล้วหน้าเว็บต่อใหม่เอง)
const { server } = createServiceApp('realtime', [internalEmitRouter]);
initRealtime(server);
listenService(server, 'realtime');
