import path from 'path';
import multer from 'multer';
import { uploadDir, layoutImgDir } from './config.js';

// ==========================================
// 🛡️ รับเฉพาะไฟล์รูปภาพ
// ห้ามรับ .html / .svg / .js ฯลฯ เพราะไฟล์ถูกเปิดผ่าน /uploads บนโดเมนเดียวกับเว็บ
// ถ้าฝังสคริปต์มาได้ จะขโมย token ของคนที่เปิดดูได้
// นามสกุลไฟล์ตั้งจากชนิดไฟล์ (mimetype) ไม่ใช้นามสกุลที่ผู้ใช้ส่งมา
// ==========================================
const IMAGE_EXT_BY_MIME = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

export const UPLOAD_TYPE_ERROR = 'INVALID_FILE_TYPE';

const imageOnlyFilter = (req, file, cb) => {
  if (IMAGE_EXT_BY_MIME[file.mimetype]) return cb(null, true);
  const err = new Error('อนุญาตเฉพาะไฟล์รูปภาพ (JPG, PNG, WEBP, GIF) เท่านั้น');
  err.code = UPLOAD_TYPE_ERROR;
  cb(err);
};

// ==========================================
// 📦 ตั้งค่า Multer สำหรับการอัปโหลดไฟล์
// ==========================================
export const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = IMAGE_EXT_BY_MIME[file.mimetype];
    const uniqueName = `task_${Date.now()}_${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, uniqueName);
  },
});
export const upload = multer({
  storage,
  fileFilter: imageOnlyFilter,
  limits: { fileSize: 1024 * 1024 * 20 } // 20MB ต่อรูป
});

export const layoutStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, layoutImgDir);
  },
  filename: (req, file, cb) => {
    const ext = IMAGE_EXT_BY_MIME[file.mimetype];
    const cleanName = path.parse(file.originalname).name.replace(/[^a-zA-Z0-9_-]/g, '_') || 'layout_img';
    const uniqueName = `${cleanName}_${Date.now()}_${Math.round(Math.random() * 1e4)}${ext}`;
    cb(null, uniqueName);
  },
});
export const uploadLayout = multer({
  storage: layoutStorage,
  fileFilter: imageOnlyFilter,
  limits: { fileSize: 1024 * 1024 * 50 } // 50MB
});

