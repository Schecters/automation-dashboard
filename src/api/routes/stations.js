import express from 'express';
import { pool } from '../lib/db.js';
import { io } from '../lib/realtime.js';
import { getClientIp } from '../lib/clientIp.js';
import { recordAuditLog } from '../lib/audit.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

router.get('/api/stations', async (req, res) => {
  try {
    const query = `
      SELECT 
        s.id, 
        s.name,
        COALESCE(
          json_agg(
            json_build_object(
              'config_key', se.config_key,
              'min_score', se.min_score,
              'is_required', se.is_required
            )
          ) FILTER (WHERE se.config_key IS NOT NULL),
          '[]'::json
        ) AS required_exams
      FROM automation_lines.station s
      LEFT JOIN automation_lines.station_exams se 
        ON s.id = ANY(se.station_id)
      GROUP BY s.id, s.name
      ORDER BY s.id ASC;
    `;

    const result = await pool.query(query);

    // 🟢 คงโครงสร้าง Response เดิม ({ success: true, data: [...] }) 100%
    // จัดรูปแบบ JSON เว้นบรรทัดและเยื้อง 2 spaces ให้อ่านง่าย
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.send(JSON.stringify({ success: true, data: result.rows }, null, 2));

  } catch (err) {
    console.error('Fetch Stations Error:', err);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(500).send(JSON.stringify({ success: false, message: 'ไม่สามารถดึงข้อมูล Stations ได้' }, null, 2));
  }
});

router.post('/api/stations', authenticateToken, requireAdmin, async (req, res) => {
  const { id, name, exams } = req.body; // exams: [{ config_key, min_score, is_required }]
  
  if (!id || !name) {
    return res.status(400).json({ message: 'กรุณากรอกรหัสและชื่อ Station ให้ครบถ้วน' });
  }

  const cleanId = id.trim();
  const cleanName = name.trim();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. เพิ่มข้อมูลสถานีลงตารางหลัก
    await client.query(
      'INSERT INTO automation_lines.station (id, name) VALUES ($1, $2)',
      [cleanId, cleanName]
    );

    // 2. จัดการเกณฑ์ข้อสอบ (ถ้ามีการส่งข้อสอบมาด้วย)
    if (Array.isArray(exams) && exams.length > 0) {
      for (const ex of exams) {
        if (!ex.config_key) continue;

        const minScore = Number(ex.min_score) || 80;
        const isRequired = ex.is_required !== false;

        // ถ้าข้อสอบนี้มีอยู่แล้วในตาราง ให้ append cleanId เข้าไปใน Array station_id
        // ถ้ายังไม่มี ให้ INSERT แถวใหม่พร้อม ARRAY[cleanId]
        const examUpsertQuery = `
          INSERT INTO automation_lines.station_exams (config_key, min_score, is_required, station_id)
          VALUES ($1, $2, $3, ARRAY[$4]::text[])
          ON CONFLICT (config_key) 
          DO UPDATE SET 
            min_score = EXCLUDED.min_score,
            is_required = EXCLUDED.is_required,
            station_id = CASE 
              WHEN NOT ($4 = ANY(station_exams.station_id)) 
              THEN array_append(station_exams.station_id, $4)
              ELSE station_exams.station_id
            END;
        `;

        await client.query(examUpsertQuery, [
          ex.config_key,
          minScore,
          isRequired,
          cleanId
        ]);
      }
    }

    // 3. บันทึก Audit Log
    await recordAuditLog({
      employeeId: req.user.employee_id,
      userName: req.user.name,
      role: req.user.role,
      deviceId: req.user.device_id,
      action: 'CREATE_STATION',
      target: `Station ${cleanId}`,
      details: `Name: ${cleanName} | Associated Exams: ${Array.isArray(exams) ? exams.length : 0}`,
      ipAddress: getClientIp(req)
    });

    await client.query('COMMIT');

    // 4. ส่ง Socket Broadcast อัปเดตแบบ Real-time (ถ้ามี)
    const socketServer = typeof io !== 'undefined' ? io : req.app.get('io');
    if (socketServer) {
      socketServer.emit('station_created', { id: cleanId, name: cleanName });
    }

    res.json({ success: true, message: `เพิ่ม Station ${cleanId} สำเร็จ` });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Create Station Error:', err);
    if (err.code === '23505') {
      return res.status(400).json({ message: `Station ID "${cleanId}" มีอยู่ในระบบแล้ว` });
    }
    res.status(500).json({ message: 'ไม่สามารถเพิ่ม Station ได้', error: err.message });
  } finally {
    client.release();
  }
});

router.put('/api/stations/:id', authenticateToken, requireAdmin, async (req, res) => {
  const oldId = req.params.id;
  const { new_id, name } = req.body;
  const targetId = (new_id && new_id.trim()) ? new_id.trim() : oldId;

  try {
    const result = await pool.query(
      'UPDATE automation_lines.station SET id = $1, name = $2 WHERE id = $3 RETURNING *',
      [targetId, name.trim(), oldId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'ไม่พบ Station รหัสนี้' });
    }

    await recordAuditLog({
      employeeId: req.user.employee_id,
      userName: req.user.name,
      role: req.user.role,
      deviceId: req.user.device_id,
      action: 'UPDATE_STATION',
      target: `Station ${targetId}`,
      details: `Updated info: Name="${name}"`,
      ipAddress: getClientIp(req)
    });

    res.json({ success: true, message: `อัปเดต Station ${targetId} สำเร็จ` });
  } catch (err) {
    console.error('Update Station Error:', err);
    res.status(500).json({ message: 'ไม่สามารถอัปเดต Station ได้' });
  }
});

router.delete('/api/stations/:id', authenticateToken, requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      'DELETE FROM automation_lines.station WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'ไม่พบ Station รหัสนี้' });
    }

    await recordAuditLog({
      employeeId: req.user.employee_id,
      userName: req.user.name,
      role: req.user.role,
      deviceId: req.user.device_id,
      action: 'DELETE_STATION',
      target: `Station ${id}`,
      details: `Deleted station permanently`,
      ipAddress: getClientIp(req)
    });

    res.json({ success: true, message: `ลบ Station ${id} สำเร็จ` });
  } catch (err) {
    console.error('Delete Station Error:', err);
    res.status(500).json({ message: 'ไม่สามารถลบ Station ได้' });
  }
});

router.get('/api/stations/:stationId/exams', async (req, res) => {
  const { stationId } = req.params;
  const cleanStationId = decodeURIComponent(String(stationId || '')).trim();

  try {
    const query = `
      SELECT 
        se.config_key,
        se.min_score,
        COALESCE(se.is_required, TRUE) AS is_required,
        COALESCE(se.line_scope_type, 'COMMON') AS line_scope_type,
        COALESCE(se.line_ids, '{}'::text[]) AS line_ids,
        COALESCE(ec.file_name, se.config_key) AS file_name
      FROM automation_lines.station_exams se
      LEFT JOIN auth.excel_configs ec 
        ON se.config_key = ec.config_key
      WHERE se.station_id IS NOT NULL 
        AND $1::text = ANY(se.station_id)
      ORDER BY COALESCE(se.is_required, TRUE) DESC, se.config_key ASC;
    `;

    const result = await pool.query(query, [cleanStationId]);
    return res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('Fetch Station Exams Error:', err);
    return res.status(500).json({ 
      success: false, 
      message: 'ไม่สามารถดึงข้อมูลข้อสอบของสถานีได้', 
      error: err.message 
    });
  }
});

router.post('/api/stations/:stationId/exams', authenticateToken, requireAdmin, async (req, res) => {
  const { stationId } = req.params;
  const { exams } = req.body;

  if (!Array.isArray(exams)) {
    return res.status(400).json({ success: false, message: 'exams ต้องเป็น Array' });
  }

  const cleanStationId = decodeURIComponent(String(stationId || '')).trim();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. ถอดรหัสสถานีนี้ออกจากทุกแถวเดิมก่อน
    await client.query(`
      UPDATE automation_lines.station_exams 
      SET station_id = COALESCE(array_remove(station_id, $1::text), '{}'::text[])
      WHERE station_id IS NOT NULL 
        AND $1::text = ANY(station_id);
    `, [cleanStationId]);

    // 2. บันทึกข้อสอบแต่ละกฎ
    for (const item of exams) {
      const configKey = String(item.config_key || '').trim();
      if (!configKey) continue;

      const minScore = Number(item.min_score) || 80;
      const isRequired = item.is_required !== false;
      const rawScope = String(item.line_scope_type || '').toUpperCase().trim();
      const scopeType = ['INCLUDE', 'EXCLUDE'].includes(rawScope) ? rawScope : 'COMMON';

      const targetLines = scopeType === 'COMMON' 
        ? [] 
        : Array.from(
            new Set(
              (Array.isArray(item.line_ids) ? item.line_ids : [])
                .map(l => String(l || '').trim())
                .filter(Boolean)
            )
          ).sort();

      // ค้นหากฎที่ตรงกันทุกประการ
      const matchExam = await client.query(`
        SELECT id, station_id 
        FROM automation_lines.station_exams 
        WHERE config_key = $1 
          AND min_score = $2 
          AND COALESCE(is_required, TRUE) = $3
          AND COALESCE(line_scope_type, 'COMMON') = $4
          AND COALESCE(line_ids, '{}'::text[]) = $5::text[]
        LIMIT 1;
      `, [configKey, minScore, isRequired, scopeType, targetLines]);

      if (matchExam.rows.length > 0) {
        const examId = matchExam.rows[0].id;
        await client.query(`
          UPDATE automation_lines.station_exams
          SET station_id = CASE 
            WHEN NOT ($1::text = ANY(COALESCE(station_id, '{}'::text[]))) 
            THEN COALESCE(station_id, '{}'::text[]) || ARRAY[$1::text]
            ELSE station_id
          END
          WHERE id = $2;
        `, [cleanStationId, examId]);
      } else {
        await client.query(`
          INSERT INTO automation_lines.station_exams (
            config_key, 
            min_score, 
            is_required, 
            line_scope_type, 
            line_ids, 
            station_id
          )
          VALUES ($1, $2, $3, $4, $5::text[], ARRAY[$6::text]);
        `, [configKey, minScore, isRequired, scopeType, targetLines, cleanStationId]);
      }
    }

    // 3. เคลียร์แถวที่ไม่มีสถานีใดใช้แล้ว
    await client.query(`
      DELETE FROM automation_lines.station_exams 
      WHERE station_id IS NULL 
         OR cardinality(station_id) = 0;
    `);

    await client.query('COMMIT');
    return res.json({ 
      success: true, 
      message: `อัปเดตเกณฑ์ข้อสอบของ Station "${cleanStationId}" สำเร็จ` 
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Update Station Exams Detailed Error:', {
      message: err.message,
      detail: err.detail,
      table: err.table,
      constraint: err.constraint
    });
    return res.status(500).json({ 
      success: false, 
      message: 'เกิดข้อผิดพลาดในการบันทึกข้อมูล', 
      detail: err.detail || err.message 
    });
  } finally {
    client.release();
  }
});

// GET: ดึงข้อสอบตามคู่ Line + Station (พร้อม Hierarchy Fallback)
router.get('/api/lines/:lineId/stations/:stationId/exams', async (req, res) => {
  const { lineId, stationId } = req.params;
  const cleanLine = decodeURIComponent(String(lineId || '')).trim();
  const cleanStation = decodeURIComponent(String(stationId || '')).trim();

  try {
    const query = `
      SELECT DISTINCT ON (se.config_key)
        se.config_key,
        se.min_score,
        COALESCE(se.is_required, TRUE) AS is_required,
        COALESCE(se.line_scope_type, 'COMMON') AS line_scope_type,
        COALESCE(se.line_ids, '{}'::text[]) AS line_ids,
        COALESCE(ec.file_name, se.config_key) AS file_name
      FROM automation_lines.station_exams se
      LEFT JOIN auth.excel_configs ec 
        ON se.config_key = ec.config_key
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

    const result = await pool.query(query, [cleanStation, cleanLine]);
    return res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('Fetch Line Station Exams Error:', err);
    return res.status(500).json({ 
      success: false, 
      message: 'ดึงข้อมูลเกณฑ์ข้อสอบไม่สำเร็จ', 
      error: err.message 
    });
  }
});


export default router;

