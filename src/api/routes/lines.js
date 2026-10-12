import express from 'express';
import { pool } from '../lib/db.js';
import { getClientIp } from '../lib/clientIp.js';
import { recordAuditLog } from '../lib/audit.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

router.get('/api/lines', async (req, res) => {
  try {
    const query = `
      SELECT 
        l.id, 
        COALESCE(
          JSON_AGG(
            JSON_BUILD_OBJECT(
              'employee_id', u.employee_id,
              'name', u.name,
              'role', u.role,
              'role_type', COALESCE(lo.role_type, 'owner')
            )
          ) FILTER (WHERE u.employee_id IS NOT NULL),
          '[]'
        ) AS owners
      FROM automation_lines.lines l
      LEFT JOIN automation_lines.line_owners lo ON l.id = lo.line_id
      LEFT JOIN auth.users u ON lo.employee_id = u.employee_id
      GROUP BY l.id
      ORDER BY l.id ASC;
    `;
    const result = await pool.query(query);

    // 🟢 ส่งข้อมูลเดิมแบบ Array เหมือนเดิมทุกประการ ไม่กระทบ Frontend
    // เพียงจัดฟอร์แมต JSON ให้เว้นบรรทัดและเยื้อง 2 spaces ให้อ่านง่าย
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.send(JSON.stringify(result.rows, null, 2));

  } catch (err) {
    console.error('Fetch Lines Error:', err);
    res.status(500).json({ message: 'ไม่สามารถดึงข้อมูล Production Lines ได้' });
  }
});

router.post('/api/lines', authenticateToken, requireAdmin, async (req, res) => {
  const { id, owner_ids } = req.body;
  if (!id || !id.trim()) {
    return res.status(400).json({ message: 'กรุณาระบุ Line ID' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cleanId = id.trim().toUpperCase();

    await client.query(
      'INSERT INTO automation_lines.lines (id) VALUES ($1)',
      [cleanId]
    );

    if (Array.isArray(owner_ids) && owner_ids.length > 0) {
      for (const item of owner_ids) {
        // รองรับทั้งแบบส่งมาเป็น Object { employee_id, role_type } หรือแบบส่งค่า ID มาตรงๆ
        const empId = typeof item === 'object' && item !== null ? item.employee_id : item;
        const roleType = typeof item === 'object' && item !== null ? (item.role_type || 'owner') : 'owner';

        if (empId) {
          await client.query(
            'INSERT INTO automation_lines.line_owners (line_id, employee_id, role_type) VALUES ($1, $2, $3)',
            [cleanId, empId, roleType]
          );
        }
      }
    }

    await client.query('COMMIT');

    const ownerDetailsText = (owner_ids || []).map(o => typeof o === 'object' ? `${o.employee_id}(${o.role_type})` : o).join(', ');

    await recordAuditLog({
      employeeId: req.user.employee_id,
      userName: req.user.name,
      role: req.user.role,
      deviceId: req.user.device_id,
      action: 'CREATE_LINE',
      target: `Line ${cleanId}`,
      details: `Created line with management team: [${ownerDetailsText}]`,
      ipAddress: getClientIp(req)
    });

    res.json({ success: true, message: `เพิ่ม Line ${cleanId} สำเร็จ` });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Create Line Error:', err);
    if (err.code === '23505') {
      return res.status(400).json({ message: `Line ID "${id}" มีอยู่ในระบบแล้ว` });
    }
    res.status(500).json({ message: 'ไม่สามารถเพิ่ม Line ได้', error: err.message });
  } finally {
    client.release();
  }
});

router.put('/api/lines/:id', authenticateToken, requireAdmin, async (req, res) => {
  const oldId = req.params.id;
  const { new_id, owner_ids } = req.body;
  const targetId = (new_id && new_id.trim()) ? new_id.trim().toUpperCase() : oldId;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (targetId !== oldId) {
      await client.query(
        'UPDATE automation_lines.lines SET id = $1 WHERE id = $2',
        [targetId, oldId]
      );
    }

    // ลบรายชื่อผู้ดูแลเดิมทั้งหมดของไลน์นี้ก่อน เพื่อเพิ่มชุดใหม่เข้าไปแทนที่อย่างสะอาด
    await client.query(
      'DELETE FROM automation_lines.line_owners WHERE line_id = $1',
      [targetId]
    );

    if (Array.isArray(owner_ids) && owner_ids.length > 0) {
      for (const item of owner_ids) {
        const empId = typeof item === 'object' && item !== null ? item.employee_id : item;
        const roleType = typeof item === 'object' && item !== null ? (item.role_type || 'owner') : 'owner';

        if (empId) {
          await client.query(
            'INSERT INTO automation_lines.line_owners (line_id, employee_id, role_type) VALUES ($1, $2, $3)',
            [targetId, empId, roleType]
          );
        }
      }
    }

    await client.query('COMMIT');

    const ownerDetailsText = (owner_ids || []).map(o => typeof o === 'object' ? `${o.employee_id}(${o.role_type})` : o).join(', ');

    await recordAuditLog({
      employeeId: req.user.employee_id,
      userName: req.user.name,
      role: req.user.role,
      deviceId: req.user.device_id,
      action: 'UPDATE_LINE',
      target: `Line ${targetId}`,
      details: `Updated line info and management team: [${ownerDetailsText}]`,
      ipAddress: getClientIp(req)
    });

    res.json({ success: true, message: `อัปเดต Line ${targetId} สำเร็จ` });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Update Line Error:', err);
    res.status(500).json({ message: 'ไม่สามารถอัปเดต Line ได้', error: err.message });
  } finally {
    client.release();
  }
});

router.delete('/api/lines/:id', authenticateToken, requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      'DELETE FROM automation_lines.lines WHERE id = $1 RETURNING *',
      [id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'ไม่พบ Line รหัสนี้' });
    }

    await recordAuditLog({
      employeeId: req.user.employee_id,
      userName: req.user.name,
      role: req.user.role,
      deviceId: req.user.device_id,
      action: 'DELETE_LINE',
      target: `Line ${id}`,
      details: `Deleted line permanently`,
      ipAddress: getClientIp(req)
    });

    res.json({ success: true, message: `ลบ Line ${id} สำเร็จ` });
  } catch (err) {
    console.error('Delete Line Error:', err);
    res.status(500).json({ message: 'ไม่สามารถลบ Line ได้' });
  }
});

router.get('/api/lines/:lineId/stations', async (req, res) => {
  const { lineId } = req.params;
  try {
    const query = `
      SELECT 
        s.id, 
        s.name, 
        ls.sequence_order
      FROM automation_lines.line_stations ls
      JOIN automation_lines.station s ON ls.station_id = s.id
      WHERE ls.line_id = $1
      ORDER BY ls.sequence_order ASC, s.id ASC;
    `;
    const result = await pool.query(query, [lineId]);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('Fetch Line Stations Error:', err);
    res.status(500).json({ success: false, message: 'ไม่สามารถดึงข้อมูล Station ของ Line นี้ได้' });
  }
});

router.post('/api/lines/:lineId/stations', authenticateToken, requireAdmin, async (req, res) => {
  const { lineId } = req.params;
  const { station_ids } = req.body;

  if (!Array.isArray(station_ids)) {
    return res.status(400).json({ success: false, message: 'station_ids ต้องเป็น Array' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query('DELETE FROM automation_lines.line_stations WHERE line_id = $1', [lineId]);

    for (let i = 0; i < station_ids.length; i++) {
      const stId = String(station_ids[i]).trim();
      if (stId) {
        await client.query(
          `INSERT INTO automation_lines.line_stations (line_id, station_id, sequence_order) 
           VALUES ($1, $2, $3) 
           ON CONFLICT (line_id, station_id) DO NOTHING`,
          [lineId, stId, i + 1]
        );
      }
    }

    await client.query('COMMIT');
    res.json({ success: true, message: `อัปเดต Station ประจำ Line ${lineId} สำเร็จ` });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Update Line Stations Error:', err);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการบันทึกข้อมูล' });
  } finally {
    client.release();
  }
});

router.delete('/api/lines/:lineId/stations/:stationId', authenticateToken, requireAdmin, async (req, res) => {
  const { lineId, stationId } = req.params;
  try {
    await pool.query(
      `DELETE FROM automation_lines.line_stations WHERE line_id = $1 AND station_id = $2`,
      [lineId, stationId]
    );
    res.json({ success: true, message: `ลบ Station ${stationId} ออกจาก Line ${lineId} สำเร็จ` });
  } catch (err) {
    console.error('Delete Line Station Error:', err);
    res.status(500).json({ success: false, message: 'ไม่สามารถลบ Station ออกจาก Line ได้' });
  }
});


export default router;

