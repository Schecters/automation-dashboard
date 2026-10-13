import express from 'express';
import path from 'path';
import fs from 'fs';
import { uploadDir, layoutImgDir, assetsDir } from '../lib/config.js';

const router = express.Router();

// ==========================================
// 🌐 Static Routes ให้เบราว์เซอร์เข้าถึงไฟล์
// ==========================================
// nosniff: บังคับให้เบราว์เซอร์ใช้ชนิดไฟล์ตามนามสกุลจริง ไม่เดาเอง (กันไฟล์เก่าที่อาจไม่ใช่รูป)
router.use('/uploads', express.static(uploadDir, {
  setHeaders: (res) => res.set('X-Content-Type-Options', 'nosniff'),
}));

// 🟢 ระบบเช็คไฟล์อัจฉริยะ (ถ้าไม่มีรูปพนักงาน จะส่ง unknow.jpg ให้แทนทันที ป้องกัน 404 ใน Console)
router.use('/api/operator-images', (req, res, next) => {
  const cleanPath = req.path.replace(/^\/+/, '');
  const assetFilePath = path.join(assetsDir, cleanPath);
  const layoutFilePath = path.join(layoutImgDir, cleanPath);
  const fallbackFilePath = path.resolve('C:/Website/Automation 1.0.1/src/assets/unknow.jpg');

  if (fs.existsSync(assetFilePath) && fs.statSync(assetFilePath).isFile()) {
    return res.sendFile(assetFilePath);
  }
  if (fs.existsSync(layoutFilePath) && fs.statSync(layoutFilePath).isFile()) {
    return res.sendFile(layoutFilePath);
  }
  
  if (fs.existsSync(fallbackFilePath)) {
    return res.sendFile(fallbackFilePath);
  }
  
  next();
});
router.use('/api/operator-images', express.static(assetsDir));


export default router;

