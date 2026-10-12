import express from 'express';
import { neon, neonConfig } from '@neondatabase/serverless';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import dotenv from 'dotenv';

neonConfig.fetchConnectionCache = true;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const app = express();
app.use(express.json());

// CORS Policy
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Database URL (🛡️ ห้ามเขียนรหัสผ่านไว้ในโค้ด ต้องตั้งใน .env เท่านั้น)
const NEON_DATABASE_URL = process.env.NEON_DATABASE_URL;
if (!NEON_DATABASE_URL) {
  throw new Error('ไม่พบ NEON_DATABASE_URL ใน .env');
}

const sql = neon(NEON_DATABASE_URL);

// ==================== IMAGE STORAGE & STATIC ROUTE ====================
const imageDir = path.join(__dirname, 'publics', 'images');
if (!fs.existsSync(imageDir)) {
  fs.mkdirSync(imageDir, { recursive: true });
}

// ตั้งค่า Static Routes
app.use('/publics/images', express.static(imageDir));
app.use('/images', express.static(imageDir));

// ==================== DOWNLOAD IMAGE FUNCTION ====================
async function downloadDriveImage(operatorId, imageUrl) {
  if (!imageUrl) return;

  // 1. แกะ File ID จาก Google Drive URL
  const fileIdMatch = String(imageUrl).match(/[-\w]{25,}/);
  if (!fileIdMatch) return;

  const fileId = fileIdMatch[0];
  const filePath = path.join(imageDir, `${operatorId}.jpg`);

  // Direct Download Link ของ Google Drive
  const downloadUrl = `https://drive.google.com/uc?export=download&id=${fileId}&confirm=t`;

  try {
    const response = await axios({
      url: downloadUrl,
      method: 'GET',
      responseType: 'stream',
      timeout: 30000,
      maxRedirects: 5,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8'
      }
    });

    const writer = fs.createWriteStream(filePath);
    response.data.pipe(writer);

    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', (err) => {
        writer.close();
        reject(err);
      });
      response.data.on('error', (err) => {
        writer.close();
        reject(err);
      });
    });

    const stats = fs.statSync(filePath);
    console.log(`[IMAGE SAVED] เซฟรูปสำเร็จ! Operator ID ${operatorId} | ขนาดไฟล์: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

  } catch (imgErr) {
    console.error(`[IMAGE ERROR] โหลดรูปไม่สำเร็จสำหรับ Operator ID ${operatorId}: ${imgErr.message}`);
  }
}

// ==================== API ENDPOINTS ====================

// [GET] /api/operators
app.get('/api/operators', async (req, res) => {
  try {
    const rows = await sql`
      SELECT 
        operator_id, 
        operator_name, 
        score1, 
        "Result_1", 
        score2, 
        "Result_2", 
        timestamp,
        image_url 
      FROM "Operator" 
      ORDER BY timestamp DESC
    `;

    // 📍 เช็กว่าในเครื่องมีรูปหรือยัง ถ้ายังไม่มี ให้สั่งโหลดทันที
    for (const row of rows) {
      if (row.operator_id) {
        const localImagePath = path.join(imageDir, `${row.operator_id}.jpg`);
        
        // ถ้าไฟล์รูปยังไม่มีในดิสก์ และใน DB มี image_url อยู่ ให้สั่งดาวน์โหลด
        if (!fs.existsSync(localImagePath) && row.image_url) {
          // สั่งทำงานแบบ asynchronous ไม่ต้อง await เพื่อให้ API ส่ง Response กลับ React ได้เร็ว
          downloadDriveImage(row.operator_id, row.image_url);
        }
      }
    }

    return res.status(200).json({ success: true, data: rows });
  } catch (error) {
    console.error('[API GET OPERATORS ERROR]:', error.message);
    return res.status(500).json({ success: false, error: 'Database connection error: ' + error.message });
  }
});

// ==================== START SERVER ====================
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n=================================`);
  console.log(`Node.js Server running on port ${PORT}`);
  console.log(`=================================\n`);
});