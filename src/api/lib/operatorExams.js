import { pool } from './db.js';
import { serviceUrl } from './serviceMap.js';

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
    const url = `${serviceUrl('graph')}/publics/excel-scores?configKey=${encodeURIComponent(configKey)}&t=${Date.now()}`;
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

// ==========================================
// ✅ เช็คความสามารถ operator ตามเกณฑ์ข้อสอบของ Line + Station (ตั้งในหน้า Lines & Stations ของ dashboard)
// ใช้กับหน้า MES Update: เครื่องที่ตั้ง "เกณฑ์ความสามารถ" ไว้ operator ต้องผ่านทุก station ที่ตั้ง
// ==========================================
const DEFAULT_MIN_SCORE = 80; // เหมือน /api/operator-data

// ข้อสอบบังคับของคู่ Line + Station (query เดียวกับ GET /api/lines/:lineId/stations/:stationId/exams)
export const getStationCriteria = async (lineId, stationId) => {
  const result = await pool.query(
    `
    SELECT DISTINCT ON (se.config_key)
      se.config_key,
      se.min_score,
      COALESCE(se.is_required, TRUE) AS is_required,
      COALESCE(ec.file_name, se.config_key) AS file_name
    FROM automation_lines.station_exams se
    LEFT JOIN auth.excel_configs ec ON se.config_key = ec.config_key
    WHERE se.station_id IS NOT NULL
      AND $1::text = ANY(se.station_id)
      AND (
        (se.line_scope_type = 'INCLUDE' AND $2::text = ANY(COALESCE(se.line_ids, '{}'::text[])))
        OR (se.line_scope_type = 'EXCLUDE' AND NOT ($2::text = ANY(COALESCE(se.line_ids, '{}'::text[]))))
        OR (se.line_scope_type = 'COMMON' OR se.line_scope_type IS NULL)
      )
    ORDER BY
      se.config_key,
      CASE se.line_scope_type WHEN 'INCLUDE' THEN 1 WHEN 'EXCLUDE' THEN 2 WHEN 'COMMON' THEN 3 ELSE 4 END ASC,
      se.id DESC
    `,
    [String(stationId), String(lineId)]
  );
  return result.rows.filter((r) => r.is_required !== false);
};

const examScore = (row) => {
  const v = row.score !== undefined ? row.score : row.Score !== undefined ? row.Score : row.total_score;
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
};

// targets = [{ line, station }]
// คืน { passed, name, unavailable, results: [{ line, station, passed, exams: [{ exam_key, exam_name, min_score, score, status }] }] }
// status: PASS / FAIL (คะแนนไม่ถึง) / NO_SCORE (ไม่มีรหัสในไฟล์) / UNREADABLE (อ่านไฟล์ Excel ไม่ได้)
export const checkOperatorQualification = async (employeeId, targets) => {
  const criteria = await Promise.all(
    targets.map(async (t) => ({ ...t, exams: await getStationCriteria(t.line, t.station) }))
  );

  // ข้อสอบเดียวกันหลาย station ดึงไฟล์ครั้งเดียว
  const keys = [...new Set(criteria.flatMap((c) => c.exams.map((e) => e.config_key)))];
  const scores = new Map(await Promise.all(keys.map(async (k) => [k, await fetchExcelScores(k)])));

  let name = '';
  const results = criteria.map((c) => {
    const exams = c.exams.map((e) => {
      const sheet = scores.get(e.config_key);
      const minScore = Number(e.min_score) || DEFAULT_MIN_SCORE;
      const examName = e.file_name ? String(e.file_name).replace('.xlsx', '') : e.config_key;
      if (!sheet?.ok) return { exam_key: e.config_key, exam_name: examName, min_score: minScore, score: null, status: 'UNREADABLE' };
      const matched = sheet.data.find((item) => sameEmployeeId(item.employeeId || item.employee_id || item.empId, employeeId));
      if (matched && !name && matched.name && matched.name !== '-') name = String(matched.name).trim();
      const score = matched ? examScore(matched) : null;
      const status = score === null ? 'NO_SCORE' : score >= minScore ? 'PASS' : 'FAIL';
      return { exam_key: e.config_key, exam_name: examName, min_score: minScore, score, status };
    });
    return { line: c.line, station: c.station, passed: exams.every((x) => x.status === 'PASS'), exams };
  });

  return {
    passed: results.every((r) => r.passed),
    name,
    unavailable: keys.length > 0 && keys.every((k) => !scores.get(k)?.ok),
    results,
  };
};
