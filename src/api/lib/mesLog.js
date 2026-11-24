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
  // ต่อจากงานก่อนหน้าเสมอ แม้งานก่อนหน้าเขียนไม่ได้ (เดิมแถวที่รอคิวอยู่หายไปด้วย)
  const task = writeQueue.catch(() => {}).then(async () => {
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
  writeQueue = task;
  // เขียนไม่ได้ (เช่น ไม่มีไดรฟ์ D:) ไม่ให้ทำให้การส่ง MES ล้ม — แจ้งใน console
  return task.catch((err) => {
    console.error(`❌ เขียนไฟล์ log MES ไม่ได้ (${MES_LOG_DIR}):`, err.message);
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

// นับยอดส่งสำเร็จของเครื่องตั้งแต่ since (Date) — OK = PASS / INPUT, NG = FAIL — แยกตาม Line / Station
export const readShiftSummary = async ({ terminal, since }) => {
  const start = bangkokParts(since);
  const startKey = `${start.date} ${start.time}`;
  const dates = [...new Set([start.date, bangkokParts().date])];
  const byStation = new Map();
  const total = { ok: 0, ng: 0 };
  for (const date of dates) {
    let content;
    try {
      content = await fs.readFile(path.join(MES_LOG_DIR, `${date}.csv`), 'utf8');
    } catch {
      continue;
    }
    const lines = content.replace(/^﻿/, '').split(/\r?\n/).filter(Boolean).slice(1);
    for (const line of lines) {
      const cells = parseCsvLine(line);
      const row = Object.fromEntries(ROUTE_COLUMNS.map((c, idx) => [c, cells[idx] ?? '']));
      if (row.success !== 'Y' || row.time < startKey) continue;
      if (terminal && row.terminal !== terminal) continue;
      const key = `${row.line}|${row.station}`;
      if (!byStation.has(key)) byStation.set(key, { line: row.line, station: row.station, ok: 0, ng: 0 });
      const field = row.result === 'FAIL' ? 'ng' : 'ok';
      byStation.get(key)[field] += 1;
      total[field] += 1;
    }
  }
  return { total, stations: [...byStation.values()] };
};

// ---------- ยอด OK / NG ตาม Line / Station (หน้า MES Output ใน Home) ----------
// วันทำงาน + กะ จากเวลาไทย "YYYY-MM-DD HH:MM:SS": 07:40-19:40 = กะเช้าของวันนั้น / 19:40-07:40 = กะดึก นับเป็นวันที่เริ่มกะ
const DAY_START_MIN = 7 * 60 + 40;
const NIGHT_START_MIN = 19 * 60 + 40;
const addDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
export const workShiftOf = (bkkTime) => {
  const t = String(bkkTime);
  const date = t.slice(0, 10);
  const minutes = Number(t.slice(11, 13)) * 60 + Number(t.slice(14, 16));
  if (minutes >= DAY_START_MIN && minutes < NIGHT_START_MIN) return { date, shift: 'day' };
  return { date: minutes < DAY_START_MIN ? addDays(date, -1) : date, shift: 'night' };
};
export const OUTPUT_MAX_DAYS = 93;

// from / to = วันทำงาน YYYY-MM-DD (รวมทั้งสองวัน) / line, shift (day | night) = กรองเพิ่ม (ว่าง = ทั้งหมด)
// นับเฉพาะที่ส่ง MES สำเร็จ: OK = PASS / INPUT, NG = FAIL (แบบเดียวกับกล่อง OK / NG หน้า /MES)
export const readOutputSummary = async ({ from, to, line = '', shift = '' }) => {
  const total = { ok: 0, ng: 0 };
  const lines = new Map(); // line -> { line, ok, ng, stations: Map }
  const days = new Map(); // date|shift|line|station
  const models = new Map(); // line|station|model|mo (แยก station: ชิ้นเดียวกันผ่านหลาย station ห้ามรวมกัน)
  const bump = (obj, field) => {
    obj[field] += 1;
    return obj;
  };
  // กะดึกของวันสุดท้ายจบเช้าวันถัดไป -> อ่านไฟล์ถึง to + 1
  const lastFile = addDays(to, 1);
  for (let date = from; date <= lastFile; date = addDays(date, 1)) {
    let content;
    try {
      content = await fs.readFile(path.join(MES_LOG_DIR, `${date}.csv`), 'utf8');
    } catch {
      continue;
    }
    const rows = content.replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean).slice(1);
    for (const raw of rows) {
      const cells = parseCsvLine(raw);
      if (cells.length < ROUTE_COLUMNS.length - 1) continue; // บรรทัดที่เขียนไม่ครบ
      const row = Object.fromEntries(ROUTE_COLUMNS.map((c, idx) => [c, cells[idx] ?? '']));
      if (row.success !== 'Y' || !row.line || !row.station) continue;
      const ws = workShiftOf(row.time);
      if (ws.date < from || ws.date > to) continue;
      if (line && row.line !== line) continue;
      if (shift && ws.shift !== shift) continue;
      const field = row.result === 'FAIL' ? 'ng' : 'ok';
      bump(total, field);

      if (!lines.has(row.line)) lines.set(row.line, { line: row.line, ok: 0, ng: 0, stations: new Map() });
      const l = bump(lines.get(row.line), field);
      if (!l.stations.has(row.station)) l.stations.set(row.station, { station: row.station, group: row.group, ok: 0, ng: 0 });
      bump(l.stations.get(row.station), field);

      const dk = `${ws.date}|${ws.shift}|${row.line}|${row.station}`;
      if (!days.has(dk)) days.set(dk, { date: ws.date, shift: ws.shift, line: row.line, station: row.station, ok: 0, ng: 0 });
      bump(days.get(dk), field);

      const mk = `${row.line}|${row.station}|${row.model}|${row.mo}`;
      if (!models.has(mk)) models.set(mk, { line: row.line, station: row.station, model: row.model, mo: row.mo, ok: 0, ng: 0 });
      bump(models.get(mk), field);
    }
  }
  const byName = (k) => (a, b) => String(a[k]).localeCompare(String(b[k]));
  return {
    total,
    lines: [...lines.values()]
      .sort(byName('line'))
      .map((l) => ({ ...l, stations: [...l.stations.values()].sort(byName('station')) })),
    days: [...days.values()].sort(
      (a, b) => a.date.localeCompare(b.date) || a.shift.localeCompare(b.shift) || a.line.localeCompare(b.line) || a.station.localeCompare(b.station)
    ),
    models: [...models.values()].sort(
      (a, b) => a.line.localeCompare(b.line) || a.station.localeCompare(b.station) || b.ok + b.ng - (a.ok + a.ng)
    ),
  };
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
