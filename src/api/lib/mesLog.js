import fs from 'fs/promises';
import path from 'path';
import { MES_LOG_DIR } from './config.js';

// ==========================================
// 📝 ประวัติหน้า MES Update เก็บเป็นไฟล์ CSV (ไม่ใช้ Database)
//  - ส่ง routing-update : <MES_LOG_DIR>/YYYY-MM-DD.csv (วันที่เวลาไทย, 1 ไฟล์ / วัน)
//  - operator login     : <MES_LOG_DIR>/login_YYYY-MM.csv
//  เปิดด้วย Excel ได้ (มี BOM ภาษาไทยแสดงถูก)
// ==========================================

const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;

const bangkokParts = (d = new Date()) => {
  const iso = new Date(d.getTime() + BANGKOK_OFFSET_MS).toISOString(); // อ่านแบบ UTC = เวลาไทย
  return { date: iso.slice(0, 10), time: iso.slice(11, 19) };
};

const ROUTE_COLUMNS = [
  'time', 'terminal', 'emp_no', 'emp_name', 'line', 'section', 'group', 'station',
  'mo', 'model', 'sn', 'result', 'success', 'mes_response',
];
const LOGIN_COLUMNS = ['time', 'emp_no', 'emp_name', 'terminal', 'ip', 'exams'];

// กันสูตร Excel + ใส่ "..." ทุกช่อง
const csvCell = (v) => {
  let s = v === null || v === undefined ? '' : String(v);
  s = s.replace(/[\r\n]+/g, ' ');
  if (/^[=+\-@\t]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};

const parseCsvLine = (line) => {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') inQuotes = false;
      else cur += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out.map((s) => (s.startsWith("'") && /^'[=+\-@\t]/.test(s) ? s.slice(1) : s));
};

// เขียนต่อท้ายไฟล์ทีละบรรทัด (คิวเดียว กันบรรทัดซ้อนกัน)
let writeQueue = Promise.resolve();
const appendRow = (fileName, columns, row) => {
  writeQueue = writeQueue.then(async () => {
    await fs.mkdir(MES_LOG_DIR, { recursive: true });
    const file = path.join(MES_LOG_DIR, fileName);
    let isNew = false;
    try {
      await fs.access(file);
    } catch {
      isNew = true;
    }
    const header = isNew ? `﻿${columns.map(csvCell).join(',')}\r\n` : '';
    await fs.appendFile(file, `${header}${columns.map((c) => csvCell(row[c])).join(',')}\r\n`, 'utf8');
  });
  // เขียนไม่ได้ (เช่น ไม่มีไดรฟ์ D:) ไม่ให้ทำให้การส่ง MES ล้ม — แจ้งใน console
  return writeQueue.catch((err) => {
    console.error(`❌ เขียนไฟล์ log MES ไม่ได้ (${MES_LOG_DIR}):`, err.message);
    writeQueue = Promise.resolve();
    throw err;
  });
};

export const appendRouteLog = async (entry) => {
  const { date, time } = bangkokParts();
  const row = { ...entry, time: `${date} ${time}`, success: entry.success ? 'Y' : 'N' };
  try {
    await appendRow(`${date}.csv`, ROUTE_COLUMNS, row);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
};

export const appendLoginLog = async (entry) => {
  const { date, time } = bangkokParts();
  try {
    await appendRow(`login_${date.slice(0, 7)}.csv`, LOGIN_COLUMNS, { ...entry, time: `${date} ${time}` });
  } catch {
    // แจ้งใน console แล้ว
  }
};

// ประวัติล่าสุดของเครื่อง (อ่านไฟล์วันนี้ + เมื่อวาน) ใหม่สุดก่อน
export const readRouteLogs = async ({ terminal, limit = 30 }) => {
  const today = bangkokParts().date;
  const yesterday = bangkokParts(new Date(Date.now() - 86400000)).date;
  const rows = [];
  for (const date of [today, yesterday]) {
    let content;
    try {
      content = await fs.readFile(path.join(MES_LOG_DIR, `${date}.csv`), 'utf8');
    } catch {
      continue;
    }
    const lines = content.replace(/^﻿/, '').split(/\r?\n/).filter(Boolean).slice(1);
    for (let i = lines.length - 1; i >= 0 && rows.length < limit; i--) {
      const cells = parseCsvLine(lines[i]);
      const row = Object.fromEntries(ROUTE_COLUMNS.map((c, idx) => [c, cells[idx] ?? '']));
      if (terminal && row.terminal !== terminal) continue;
      rows.push({ ...row, success: row.success === 'Y' });
    }
    if (rows.length >= limit) break;
  }
  return rows;
};
