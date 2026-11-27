/* global process */
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';
import tailwindcss from '@tailwindcss/vite';

// Proxy ไป backend แต่ละส่วน ตาม services.json (ใช้ร่วมกันทั้งโหมด dev และ preview)
//  - เรียงตาม services.json: เฉพาะเจาะจงก่อน (เช่น /api/mes → MES 5004) ที่เหลือ /api → data 5000
//  - API_MODE=single (รัน node src/api/server.js ตัวเดียว) → ทุกอย่างไป 5000 แบบเดิม
const servicesConfig = JSON.parse(readFileSync(new URL('./services.json', import.meta.url), 'utf8'));
const singleMode = process.env.API_MODE === 'single';
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const apiProxy = {};
for (const svc of servicesConfig.services) {
  const target = `http://127.0.0.1:${singleMode ? 5000 : svc.port}`;
  for (const prefix of svc.prefixes) {
    // ตรงทั้งท่อน: /api/mes ตรง /api/mes/logs แต่ไม่ตรง /api/messages
    apiProxy[`^${escapeRegex(prefix)}(?=/|\\?|$)`] = {
      target,
      changeOrigin: true,
      secure: false,
      xfwd: true,
      ws: svc.id === 'realtime',
    };
  }
}

// 🔐 HTTPS: ใช้ certificate ของ server เอง (อายุ 10 ปี) ถ้ามีไฟล์ — fingerprint คงที่
//  คอมเทส Chroma (C# Station App) pin SHA-256 ของ cert นี้ไว้ตอนส่ง log ขึ้น server → cert เปลี่ยน = คอมเทสส่งไม่ได้
//  basicSsl สร้าง cert ใหม่ทุก 30 วัน จึงใช้เป็นตัวสำรองเท่านั้น (ยังไม่ได้สร้างไฟล์ / เครื่อง dev)
//  ตำแหน่งไฟล์: HTTPS_KEY_FILE / HTTPS_CERT_FILE ใน .env หรือค่าเริ่มต้น <โฟลเดอร์แม่ของโปรเจกต์>\certs\dashboard.key|crt (นอก repo)
//  สร้างไฟล์: npm run make:https-cert (ดู tools/make-https-cert.cjs)
const projectRoot = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(projectRoot, '.env'), quiet: true });
const certDir = path.resolve(projectRoot, '..', 'certs');
const keyFile = process.env.HTTPS_KEY_FILE || path.join(certDir, 'dashboard.key');
const certFile = process.env.HTTPS_CERT_FILE || path.join(certDir, 'dashboard.crt');
const ownCert = existsSync(keyFile) && existsSync(certFile)
  ? { key: readFileSync(keyFile), cert: readFileSync(certFile) }
  : null;
const httpsOption = ownCert || true;

export default defineConfig({
  plugins: [
    react(),
    ...(ownCert ? [] : [basicSsl()]),
    tailwindcss(),
  ],
  build: {
    // 🛡️ ไม่สร้าง source map -> เปิด DevTools แล้วไม่เห็นซอร์สโค้ดต้นฉบับ
    sourcemap: false,
  },
  // โหมดพัฒนา (npm run dev) - ใช้ตอนแก้โค้ดบนเครื่อง dev
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    https: httpsOption,
    watch: {
      ignored: ['**/node_modules/**', '**/.git/**'],
    },
    hmr: {
      protocol: 'wss',
    },
    proxy: apiProxy,
  },
  // โหมดใช้งานจริง (npm run build แล้ว npm run preview) - URL เดิม https://<ip>:5173
  preview: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    https: httpsOption,
    proxy: apiProxy,
  },
});
