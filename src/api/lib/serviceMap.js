import fs from 'fs';
import path from 'path';
import { PROJECT_ROOT } from './config.js';

// ==========================================
// 🗺️ backend แต่ละส่วนอยู่ port ไหน (อ่านจาก services.json ที่ root โปรเจกต์)
//  - โหมดแยก service (launcher): แต่ละส่วนรันเป็น process ของตัวเอง
//  - โหมดรวม (node src/api/server.js): ทุกส่วนอยู่ใน process เดียว port 5000 → serviceUrl() ชี้มาที่ตัวเอง
// ==========================================
const config = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'services.json'), 'utf8'));

export const SERVICES = config.services;
export const getService = (id) => {
  const s = SERVICES.find((x) => x.id === id);
  if (!s) throw new Error(`ไม่พบ service "${id}" ใน services.json`);
  return s;
};

export const SINGLE_MODE_PORT = 5000;
export const isSingleMode = () => process.env.API_MODE === 'single';

// URL ภายในเครื่อง server สำหรับให้ service คุยกันเอง
export const serviceUrl = (id) =>
  `http://127.0.0.1:${isSingleMode() ? SINGLE_MODE_PORT : getService(id).port}`;

// path ตรงกับ prefix แบบทั้งท่อน: /api/mes ตรง /api/mes, /api/mes/logs, /api/mes?x — ไม่ตรง /api/messages
export const matchPrefix = (urlPath, prefix) =>
  urlPath === prefix || urlPath.startsWith(`${prefix}/`) || urlPath.startsWith(`${prefix}?`);

// service ที่รับ path นี้ (ตามลำดับใน services.json — เฉพาะเจาะจงก่อน)
export const findServiceByPath = (urlPath) =>
  SERVICES.find((s) => s.prefixes.some((p) => matchPrefix(urlPath, p))) || null;
