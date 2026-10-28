import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

export let isLoginSessionActive = false;
export let isSyncing = false;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const BROWSER_SESSION_DIR = path.resolve('C:/Website/Automation 1.0.1/browser_profile');
export const STORAGE_STATE_PATH = path.join(BROWSER_SESSION_DIR, 'storage_state.json');
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

export const SALT_ROUNDS = 10;
export const PORT = process.env.PORT_USER || 5000;
export const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
// 🛡️ ห้ามมีค่า default ในโค้ด (ใครเห็นซอร์สจะปลอม token ได้) ต้องตั้งใน .env เท่านั้น
export const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32 || JWT_SECRET === 'super_secret_jwt_key_automation_2026') {
  throw new Error('JWT_SECRET ใน .env ไม่ได้ตั้งค่า หรือสั้นเกินไป (ต้องเป็นค่าสุ่มอย่างน้อย 32 ตัวอักษร)');
}

// 🏭 MES API (หน้า MES Update) — ไม่ใช่ความลับ จึงมีค่า default ได้ เปลี่ยนได้ใน .env
export const MES_API_BASE = (process.env.MES_API_BASE || 'http://10.204.212.22:5207').replace(/\/+$/, '');

// ==========================================
// 📁 เตรียมโฟลเดอร์สำหรับจัดเก็บไฟล์
// ==========================================
export const uploadDir = path.resolve(__dirname, '../../../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// 🟢 โฟลเดอร์เก็บรูปภาพผัง Layout
export const layoutImgDir = path.resolve('C:/Website/Automation 1.0.1/img/Layout');
if (!fs.existsSync(layoutImgDir)) {
  fs.mkdirSync(layoutImgDir, { recursive: true });
}

// 🟢 โฟลเดอร์ assets (เก็บรูปพนักงาน)
export const assetsDir = path.resolve('C:/Website/Automation 1.0.1/src/assets');
if (!fs.existsSync(assetsDir)) {
  fs.mkdirSync(assetsDir, { recursive: true });
}

