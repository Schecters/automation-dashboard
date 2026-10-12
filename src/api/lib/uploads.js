import path from 'path';
import multer from 'multer';
import { uploadDir, layoutImgDir } from './config.js';

// ==========================================
// 📦 ตั้งค่า Multer สำหรับการอัปโหลดไฟล์
// ==========================================
export const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const uniqueName = `task_${Date.now()}_${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, uniqueName);
  },
});
export const upload = multer({ 
  storage,
  limits: { fileSize: 1024 * 1024 * 1024 } // 1GB
});

export const layoutStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, layoutImgDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.png';
    const cleanName = path.parse(file.originalname).name.replace(/[^a-zA-Z0-9_-]/g, '_') || 'layout_img';
    const uniqueName = `${cleanName}_${Date.now()}_${Math.round(Math.random() * 1e4)}${ext}`;
    cb(null, uniqueName);
  },
});
export const uploadLayout = multer({
  storage: layoutStorage,
  limits: { fileSize: 1024 * 1024 * 100 } // 100MB
});

