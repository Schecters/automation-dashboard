import { pool } from './db.js';
import { PORT } from './config.js';

// ==========================================
// 🔎 เช็คว่าพนักงานเคยทำข้อสอบ (มีชื่อในไฟล์ Excel คะแนนสอบไฟล์ใดไฟล์หนึ่ง) — ไม่ต้องระบุ Line / Station
// ใช้กับหน้า MES Update (operator login) และเรียกตรงได้ที่ /api/operator-exam-check?employee_id=...
// ==========================================
const EXCEL_FETCH_TIMEOUT_MS = 15000;

const sameEmployeeId = (a, b) => {
  const x = String(a || '').trim();
  const y = String(b || '').trim();
  if (!x || !y) return false;
  return x === y || x.replace(/^0+/, '') === y.replace(/^0+/, '');
};

const fetchExcelScores = async (configKey) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EXCEL_FETCH_TIMEOUT_MS);
  try {
    const url = `http://127.0.0.1:${PORT}/publics/excel-scores?configKey=${encodeURIComponent(configKey)}&t=${Date.now()}`;
    const res = await fetch(url, { signal: controller.signal });
    const json = await res.json().catch(() => ({}));
    // excel-scores ตอบ 200 + data [] + message เมื่อเปิดตารางไม่ได้ -> นับเป็นอ่านไม่สำเร็จ
    if (!res.ok || !json.success || (json.message && !(json.data || []).length)) return { ok: false, data: [] };
    return { ok: true, data: Array.isArray(json.data) ? json.data : [] };
  } catch {
    return { ok: false, data: [] };
  } finally {
    clearTimeout(timer);
  }
};

// คืน { found, name, exams: [{ exam_key, exam_name, score }], checked, failed }
export const findOperatorExams = async (employeeId) => {
  const configs = await pool.query(`SELECT config_key, file_name FROM auth.excel_configs ORDER BY config_key`);
  const results = await Promise.all(
    configs.rows.map(async (cfg) => ({ cfg, ...(await fetchExcelScores(cfg.config_key)) }))
  );

  let name = '';
  const exams = [];
  for (const { cfg, data } of results) {
    const matched = data.find((item) => sameEmployeeId(item.employeeId || item.employee_id || item.empId, employeeId));
    if (!matched) continue;
    if (!name && matched.name && matched.name !== '-') name = String(matched.name).trim();
    exams.push({
      exam_key: cfg.config_key,
      exam_name: cfg.file_name ? cfg.file_name.replace('.xlsx', '') : cfg.config_key,
      score: matched.score ?? null,
    });
  }

  return {
    found: exams.length > 0,
    name,
    exams,
    checked: results.length,
    failed: results.filter((r) => !r.ok).length,
  };
};
