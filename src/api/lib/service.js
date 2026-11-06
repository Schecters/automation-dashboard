import http from 'http';
import cors from 'cors';
import express from 'express';
import multer from 'multer';
import { UPLOAD_TYPE_ERROR } from './uploads.js';
import { getService, findServiceByPath, SERVICES } from './serviceMap.js';

// ==========================================
// 🧱 ตัวสร้าง backend แต่ละส่วน (ใช้ร่วมกันทุก service + server.js โหมดรวม)
//  middleware ชุดเดียวกับ server.js เดิม: CORS → body 20mb → routes → error handler กลาง
//  + GET /internal/health ให้ launcher เช็คว่ายังทำงานอยู่
// ==========================================

const corsOptions = {
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'x-session-token',
    'X-Session-Token',
    'x-device-id',
    'X-Device-Id',
    'x-requested-with',
  ],
};

// ⚠️ Error handler กลาง: ไฟล์ผิดประเภท / ใหญ่เกิน / body ใหญ่เกิน -> ตอบ JSON 400/413
const errorHandler = (err, req, res, next) => {
  if (res.headersSent) return next(err);

  if (err.code === UPLOAD_TYPE_ERROR) {
    return res.status(400).json({ success: false, message: err.message });
  }
  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE'
      ? 'ไฟล์รูปใหญ่เกินไป (ไม่เกิน 20MB ต่อรูป)'
      : `อัปโหลดไฟล์ไม่สำเร็จ: ${err.message}`;
    return res.status(400).json({ success: false, message });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ success: false, message: 'ข้อมูลที่ส่งมาใหญ่เกินไป (ไม่เกิน 20MB)' });
  }

  console.error('Unhandled API Error:', err);
  res.status(err.status || 500).json({ success: false, message: 'เกิดข้อผิดพลาดภายในระบบ' });
};

/**
 * สร้าง express app + http server ของ service
 * @param {string} name  ชื่อที่แสดงใน health / log
 * @param {object[]} routers  express routers ของ service นี้
 * @param {{ before?: Function[] }} opts  before = middleware ที่ต้องอยู่ก่อน body parser (เช่น ตัวส่งต่อ)
 */
export const createServiceApp = (name, routers, { before = [] } = {}) => {
  const app = express();
  app.set('trust proxy', true);

  const startedAt = Date.now();
  app.get('/internal/health', (req, res) => {
    res.json({ ok: true, service: name, uptime_s: Math.round((Date.now() - startedAt) / 1000), pid: process.pid });
  });

  before.forEach((mw) => app.use(mw));
  app.use(cors(corsOptions));
  // 🛡️ จำกัดขนาด body 20mb พอสำหรับรูปพนักงาน/รูป Layout แบบ base64 (ไฟล์แนบ Task ใช้ multer แยกต่างหาก)
  app.use(express.json({ limit: '20mb' }));
  app.use(express.urlencoded({ limit: '20mb', extended: true, parameterLimit: 10000 }));

  routers.forEach((r) => app.use(r));
  app.use(errorHandler);

  return { app, server: http.createServer(app) };
};

// เปิด service ตาม services.json (port / host)
export const listenService = (server, id) => {
  const { port, host, name } = getService(id);
  server.on('error', (err) => {
    console.error(`❌ เปิด ${name} ที่ port ${port} ไม่ได้: ${err.message}`);
    process.exit(1);
  });
  server.listen(port, host, () => {
    console.log(`✅ ${name} พร้อมทำงานที่ ${host}:${port} (pid ${process.pid})`);
  });
};

// ==========================================
// 🔀 ตัวส่งต่อ (ใช้ใน service data port 5000)
//  ให้โปรแกรมภายนอกที่เคยเรียก http://<server>:5000/... ตรง ๆ ยังใช้ได้ แม้ path นั้นย้ายไป service อื่นแล้ว
//  ต้องวางก่อน body parser เพื่อส่งต่อ body ดิบได้
// ==========================================
export const forwardToOtherServices = (selfId) => (req, res, next) => {
  const target = findServiceByPath(req.path);
  if (!target || target.id === selfId || target.id === 'realtime') return next();

  const proxyReq = http.request(
    {
      host: '127.0.0.1',
      port: target.port,
      method: req.method,
      path: req.originalUrl,
      headers: {
        ...req.headers,
        'x-forwarded-for': [req.headers['x-forwarded-for'], req.socket.remoteAddress].filter(Boolean).join(', '),
      },
      timeout: 120000,
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(res);
    }
  );
  proxyReq.on('timeout', () => proxyReq.destroy(new Error('timeout')));
  proxyReq.on('error', () => {
    if (res.headersSent) return res.end();
    res.status(503).json({ success: false, message: `ระบบ ${target.name} ปิดอยู่ หรือไม่ตอบสนอง` });
  });
  req.pipe(proxyReq);
};

export { SERVICES };
