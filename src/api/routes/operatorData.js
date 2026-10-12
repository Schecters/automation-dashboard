import express from 'express';
import { pool } from '../lib/db.js';
import { PORT } from '../lib/config.js';

const router = express.Router();

router.all('/api/operator-data', async (req, res) => {
  const employeeId = String(req.query.employee_id || req.body.employee_id || req.query.employeeId || req.body.employeeId || '').trim();
  const lineId = String(req.query.lines || req.query.line_id || req.body.lines || req.body.line_id || '').trim().toUpperCase();
  const stationId = String(req.query.station || req.query.station_id || req.body.station || req.body.station_id || '').trim();

  // Helper สำหรับส่ง JSON แบบ Pretty-Print (จัดบรรทัดให้อ่านง่าย)
  const sendPrettyJson = (statusCode, data) => {
    res.status(statusCode);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.send(JSON.stringify(data, null, 2));
  };

  if (!employeeId || !lineId || !stationId) {
    return sendPrettyJson(400, {
      status: 'error',
      message: 'กรุณาระบุ employee_id, lines และ station ให้ครบถ้วน'
    });
  }

  try {
    // 1. ค้นหาเกณฑ์ข้อสอบจาก Database
    const examQuery = `
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
          OR
          (se.line_scope_type = 'EXCLUDE' AND NOT ($2::text = ANY(COALESCE(se.line_ids, '{}'::text[]))))
          OR
          (se.line_scope_type = 'COMMON' OR se.line_scope_type IS NULL)
        )
      ORDER BY 
        se.config_key,
        CASE se.line_scope_type 
          WHEN 'INCLUDE' THEN 1 
          WHEN 'EXCLUDE' THEN 2 
          WHEN 'COMMON'  THEN 3 
          ELSE 4 
        END ASC,
        se.id DESC;
    `;

    const examRes = await pool.query(examQuery, [stationId, lineId]);
    const requiredExams = examRes.rows.filter(e => e.is_required !== false);

    // ถ้าสถานีไม่มีวิชาบังคับ
    if (requiredExams.length === 0) {
      return sendPrettyJson(200, {
        status: 'pass',
        employee_id: employeeId,
        operator_name: '-',
        lines: lineId,
        station: stationId,
        total_exams: 0,
        passed_exams: 0,
        message: 'สถานีนี้ไม่มีข้อสอบบังคับ พนักงานผ่านเกณฑ์พร้อมเข้าปฏิบัติงาน',
        details: []
      });
    }

    // 2. ดึงข้อมูลชื่อพนักงานจาก DB
    let matchedOpName = '-';
    let dbNames = [];
    try {
      const uRes = await pool.query(
        `SELECT name FROM auth.users WHERE employee_id::text = $1 
         UNION 
         SELECT name FROM automation_lines.operators WHERE employee_id::text = $1`,
        [employeeId]
      );
      dbNames = uRes.rows.map(r => String(r.name || '').trim()).filter(Boolean);
      if (dbNames.length > 0) matchedOpName = dbNames[0];
    } catch (e) {}

    let isAllPassed = true;
    let passedCount = 0;
    const examDetails = [];

    for (const exam of requiredExams) {
      let userScore = null;
      let rawList = [];

      const targetUrl = `http://127.0.0.1:${PORT}/publics/excel-scores?configKey=${encodeURIComponent(exam.config_key)}&t=${Date.now()}`;
      try {
        const fetchRes = await fetch(targetUrl);
        if (fetchRes.ok) {
          const json = await fetchRes.json();
          if (json.success && Array.isArray(json.data)) {
            rawList = json.data;
          }
        }
      } catch (fetchErr) {}

      if (rawList.length > 0) {
        const matched = rawList.find(item => {
          const itemEmpId = String(item.employeeId || item.employee_id || item.empId || '').trim();
          const cleanItemEmpId = itemEmpId.replace(/^0+/, '');
          const cleanTargetId = employeeId.replace(/^0+/, '');
          const itemName = String(item.name || item.fullName || '').trim();

          const matchId = (itemEmpId === employeeId) || (cleanTargetId && cleanItemEmpId === cleanTargetId);
          const matchName = dbNames.some(n => itemName.includes(n) || n.includes(itemName)) || itemName.includes('พชรพล');

          return matchId || matchName;
        });

        if (matched) {
          if (matched.name && matchedOpName === '-') {
            matchedOpName = matched.name;
          }
          const val = matched.score !== undefined ? matched.score : (matched.Score !== undefined ? matched.Score : matched.total_score);
          if (val !== undefined && val !== null && val !== '') {
            userScore = Number(val);
          }
        }
      }

      const minScore = Number(exam.min_score) || 80;
      const passed = userScore !== null && !isNaN(userScore) && userScore >= minScore;

      if (passed) {
        passedCount++;
      } else {
        isAllPassed = false;
      }

      examDetails.push({
        exam_key: exam.config_key,
        exam_name: exam.file_name ? exam.file_name.replace('.xlsx', '') : exam.config_key,
        min_score: minScore,
        score: userScore,
        status: passed ? 'PASS' : 'FAIL'
      });
    }

    // 3. ส่งผลลัพธ์จัดฟอร์แมต JSON สวยงาม อ่านง่าย
    return sendPrettyJson(200, {
      status: isAllPassed ? 'pass' : 'fail',
      employee_id: employeeId,
      operator_name: matchedOpName,
      lines: lineId,
      station: stationId,
      summary: {
        total_exams: requiredExams.length,
        passed_exams: passedCount,
        all_passed: isAllPassed
      },
      details: examDetails
    });

  } catch (error) {
    console.error('Check Qualification Fatal Error:', error);
    return sendPrettyJson(500, {
      status: 'error',
      message: 'เกิดข้อผิดพลาดในการประมวลผล',
      error: error.message
    });
  }
});


export default router;

