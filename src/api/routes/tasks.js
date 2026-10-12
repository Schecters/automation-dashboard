import express from 'express';
import { pool } from '../lib/db.js';
import { io, deviceSessions } from '../lib/realtime.js';
import { getClientIp } from '../lib/clientIp.js';
import { recordAuditLog } from '../lib/audit.js';
import { upload } from '../lib/uploads.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

router.get('/api/tasks/my-recent', authenticateToken, async (req, res) => {
  const userEmpId = Number(req.user?.employee_id);

  if (!userEmpId || isNaN(userEmpId)) {
    return res.json([]);
  }

  try {
    const query = `
      SELECT 
        t.task_id,
        t.lines,
        t.station AS station_id,
        s.name AS station_name,
        t.problem,
        t.solution,
        t.status,
        t.image_url,
        t.images,
        t.solution_images,
        COALESCE(t.task_type, 'general') AS task_type,
        COALESCE(t.shift, 'a') AS shift,
        t.created_by,
        t.accepted_by,
        t.created_at,
        t.end_at
      FROM automation_lines.tasks t
      LEFT JOIN automation_lines.station s ON t.station = s.id
      WHERE t.created_by = $1
      ORDER BY t.created_at DESC
      LIMIT 5;
    `;
    const result = await pool.query(query, [userEmpId]);
    res.json(result.rows);
  } catch (err) {
    console.error('Fetch My Recent Tasks Error:', err);
    res.status(500).json({ message: 'ไม่สามารถดึงข้อมูล Task ล่าสุดได้', error: err.message });
  }
});

// ดึง Tasks ตามสิทธิ์การมองเห็นทั่วไป (อัปเดตให้ Line Owner มองเห็น shift_handover ข้ามกะได้ 100%)
router.get('/api/tasks', authenticateToken, async (req, res) => {
  const userEmpId = Number.isInteger(Number(req.user?.employee_id)) 
    ? Number(req.user.employee_id) 
    : 0;
  const userRole = String(req.user?.role || 'user').toLowerCase().trim();
  const userShift = req.user?.shift ? String(req.user.shift).toLowerCase().trim() : '';

  try {
    const query = `
      SELECT 
        t.task_id,
        t.lines,
        t.station AS station_id,
        s.name AS station_name,
        t.problem,
        t.solution,
        t.status,
        t.image_url,
        t.images,
        t.solution_images,
        COALESCE(t.task_type, 'general') AS task_type,
        COALESCE(t.shift, 'a') AS shift,
        t.created_by,
        t.accepted_by,
        u.name AS accepted_by_name,
        t.created_at,
        t.end_at
      FROM automation_lines.tasks t
      LEFT JOIN automation_lines.station s ON t.station = s.id
      LEFT JOIN auth.users u ON t.accepted_by = u.employee_id
      LEFT JOIN automation_lines.line_owners lo ON t.lines = lo.line_id AND lo.employee_id = $1::int
      WHERE 
        $2::text = 'admin'
        OR ($2::text = 'pd' AND t.created_by = $1::int)
        
        -- 🟢 งานส่งต่อกะ (Shift Handover): ให้ Admin, ME, IE หรือ Line Owner ของ Line นั้นมองเห็นได้ทั้งหมด (ทุกกะ)
        OR (
          $2::text != 'pd'
          AND COALESCE(t.task_type, 'general') = 'shift_handover'
          AND (
            $2::text = 'admin' 
            OR $2::text = 'me' 
            OR $2::text = 'ie' 
            OR lo.employee_id IS NOT NULL
          )
        )

        OR (
          $2::text != 'pd'
          AND COALESCE(t.task_type, 'general') = 'pd_call_me'
          AND (
            (lo.employee_id IS NOT NULL AND ($3::text = '' OR COALESCE(t.shift, 'a') = $3::text))
            OR ($2::text = 'me' AND ($3::text = '' OR COALESCE(t.shift, 'a') = $3::text) AND t.status = 'pending' AND t.created_at <= (NOW() - INTERVAL '15 minutes'))
            OR ($2::text = 'me' AND ($3::text = '' OR COALESCE(t.shift, 'a') = $3::text) AND t.status != 'pending')
          )
        )
        OR (
          $2::text != 'pd'
          AND COALESCE(t.task_type, 'general') IN ('improvement', 'product_issue')
          AND ($2::text = 'me' OR $2::text = 'ie' OR lo.employee_id IS NOT NULL)
        )
        OR (
          $2::text != 'pd'
          AND COALESCE(t.task_type, 'general') = 'general'
          AND ($2::text = 'me' OR $2::text = 'ie' OR lo.employee_id IS NOT NULL)
        )
      ORDER BY t.created_at DESC;
    `;

    const result = await pool.query(query, [userEmpId, userRole, userShift]);
    res.json(result.rows);
  } catch (err) {
    console.error('Fetch Tasks Error:', err);
    res.status(500).json({ message: 'ไม่สามารถดึงข้อมูล Tasks ได้', error: err.message });
  }
});

router.post('/api/tasks', authenticateToken, upload.array('images', 5), async (req, res) => {
  const { lines, station, problem, task_type = 'general', shift = 'a' } = req.body;
  
  const imageUrls = req.files && req.files.length > 0 
    ? req.files.map(file => `/uploads/${file.filename}`) 
    : [];
  const primaryImageUrl = imageUrls.length > 0 ? imageUrls[0] : null;

  const cleanTaskType = String(task_type || 'general').trim().toLowerCase();
  const cleanShift = String(shift || 'a').trim().toLowerCase();
  const userRole = String(req.user?.role || '').toLowerCase().trim();
  const senderEmpId = Number(req.user?.employee_id);

  if (userRole === 'pd') {
    const allowedPdTypes = ['general', 'product_issue', 'pd_call_me'];
    if (!allowedPdTypes.includes(cleanTaskType)) {
      return res.status(403).json({ 
        message: 'แผนก Production (PD) สามารถเปิดงานได้เฉพาะ General, Product Issue และ PD Call ME เท่านั้น' 
      });
    }
  }

  if (!lines || !station || !problem) {
    return res.status(400).json({ message: 'กรุณาระบุ Line, Station และรายละเอียดปัญหาให้ครบถ้วน' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const taskResult = await client.query(
      `INSERT INTO automation_lines.tasks 
        (lines, station, problem, status, image_url, images, task_type, shift, created_by) 
       VALUES ($1, $2, $3, 'pending', $4, $5, $6, $7, $8) 
       RETURNING *;`,
      [lines.trim(), station.trim(), problem.trim(), primaryImageUrl, imageUrls, cleanTaskType, cleanShift, senderEmpId]
    );
    const newTask = taskResult.rows[0];

    let targetEmpIds = [];
    let titlePrefix = 'แจ้งเตือนงานทั่วไป';

    if (cleanTaskType === 'pd_call_me') {
      titlePrefix = `🚨 PD Call ME: ${lines} (กะ ${cleanShift.toUpperCase()})`;
      const targetOwners = await client.query(
        `SELECT u.employee_id 
         FROM automation_lines.line_owners lo
         JOIN auth.users u ON lo.employee_id = u.employee_id
         WHERE lo.line_id ILIKE $1 AND LOWER(COALESCE(u.shift, '')) = $2`,
        [lines.trim(), cleanShift]
      );
      targetEmpIds = targetOwners.rows.map((r) => String(r.employee_id));

    } else if (cleanTaskType === 'shift_handover') {
      const oppositeShift = cleanShift === 'a' ? 'b' : 'a';
      titlePrefix = `🔄 แจ้งงานต่อกะ (${lines} กะ ${oppositeShift.toUpperCase()})`;
      const targetOwners = await client.query(
        `SELECT u.employee_id 
         FROM automation_lines.line_owners lo
         JOIN auth.users u ON lo.employee_id = u.employee_id
         WHERE lo.line_id ILIKE $1 AND LOWER(COALESCE(u.shift, '')) = $2`,
        [lines.trim(), oppositeShift]
      );
      targetEmpIds = targetOwners.rows.map((r) => String(r.employee_id));

    } else if (cleanTaskType === 'improvement' || cleanTaskType === 'product_issue') {
      titlePrefix = cleanTaskType === 'improvement' 
        ? `💡 แจ้งงาน Improvement: ${lines}` 
        : `📦 แจ้งพบปัญหา Product Issue: ${lines}`;
      const meUsers = await client.query(`SELECT employee_id FROM auth.users WHERE role::text = 'me'`);
      targetEmpIds = meUsers.rows.map((r) => String(r.employee_id));

    } else {
      titlePrefix = `แจ้งเตือนเครื่องจักรขัดข้อง: ${lines}`;
      const ownersResult = await client.query(
        `SELECT employee_id FROM automation_lines.line_owners WHERE line_id ILIKE $1`,
        [lines.trim()]
      );
      targetEmpIds = ownersResult.rows.map((r) => String(r.employee_id));
    }

    for (const empId of targetEmpIds) {
      if (!empId) continue;
      const notifResult = await client.query(
        `INSERT INTO auth.notifications (employee_id, line_id, task_id, title, message, problem, task_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *;`,
        [Number(empId), lines, newTask.task_id, titlePrefix, `Station: ${station}`, problem, cleanTaskType]
      );
      const savedNotif = notifResult.rows[0];

      for (const [dId, session] of deviceSessions.entries()) {
        if (String(session.employeeId) === String(empId) && session.socketId) {
          io.to(session.socketId).emit('new_notification', {
            id: savedNotif.id,
            title: savedNotif.title,
            message: savedNotif.message,
            problem: savedNotif.problem,
            taskId: savedNotif.task_id,
            image_url: primaryImageUrl,
            images: imageUrls,
            task_type: cleanTaskType,
            created_at: savedNotif.created_at,
            read: false
          });
        }
      }
    }

    await client.query('COMMIT');

    await recordAuditLog({
      employeeId: senderEmpId,
      userName: req.user.name,
      role: userRole,
      deviceId: req.user.device_id,
      action: 'CREATE_TASK',
      target: `Task #${newTask.task_id}`,
      details: `Created ${cleanTaskType} task on Line: ${lines}, Station: ${station}`,
      ipAddress: getClientIp(req)
    });

    io.emit('task_created', newTask);
    res.json({ success: true, task: newTask, message: `สร้างงาน ${titlePrefix} สำเร็จ` });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Create Task Server Error:', err);
    res.status(500).json({ message: 'ไม่สามารถสร้างงานได้', error: err.message });
  } finally {
    client.release();
  }
});

router.put('/api/tasks/:task_id', authenticateToken, async (req, res) => {
  const { task_id } = req.params;
  const { lines, station, problem, task_type, shift } = req.body;
  const userEmpId = Number(req.user?.employee_id);
  const userRole = req.user?.role;

  try {
    const check = await pool.query('SELECT * FROM automation_lines.tasks WHERE task_id = $1', [task_id]);
    if (check.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'ไม่พบ Task นี้ในระบบ' });
    }

    const task = check.rows[0];
    if (userRole !== 'admin' && Number(task.created_by) !== userEmpId) {
      return res.status(403).json({ success: false, message: 'คุณไม่มีสิทธิ์แก้ไข Task ของผู้อื่น' });
    }

    if (task.status !== 'pending' && userRole !== 'admin') {
      return res.status(400).json({ success: false, message: 'ไม่สามารถแก้ไข Task ที่มีผู้รับงานไปแล้วได้' });
    }

    const updateQuery = `
      UPDATE automation_lines.tasks
      SET 
        lines = COALESCE($1, lines),
        station = COALESCE($2, station),
        problem = COALESCE($3, problem),
        task_type = COALESCE($4, task_type),
        shift = COALESCE($5, shift)
      WHERE task_id = $6
      RETURNING *;
    `;
    const result = await pool.query(updateQuery, [
      lines ? lines.trim() : null,
      station ? station.trim() : null,
      problem ? problem.trim() : null,
      task_type ? task_type.trim() : null,
      shift ? shift.trim() : null,
      task_id
    ]);

    await recordAuditLog({
      employeeId: userEmpId,
      userName: req.user.name,
      role: userRole,
      deviceId: req.user.device_id,
      action: 'UPDATE_TASK',
      target: `Task #${task_id}`,
      details: `Updated task details: Line=${lines}, Station=${station}`,
      ipAddress: getClientIp(req)
    });

    io.emit('task_status_updated', result.rows[0]);
    res.json({ success: true, task: result.rows[0], message: 'แก้ไขข้อมูล Task สำเร็จ' });
  } catch (err) {
    console.error('Update Task Error:', err);
    res.status(500).json({ success: false, message: 'ไม่สามารถแก้ไข Task ได้', error: err.message });
  }
});

router.delete('/api/tasks/:task_id', authenticateToken, async (req, res) => {
  const { task_id } = req.params;
  const userEmpId = Number(req.user?.employee_id);
  const userRole = req.user?.role;

  try {
    const check = await pool.query('SELECT * FROM automation_lines.tasks WHERE task_id = $1', [task_id]);
    if (check.rows.length === 0) {
      return res.status(404).json({ message: 'ไม่พบ Task รหัสนี้ในระบบ' });
    }

    const task = check.rows[0];

    if (userRole !== 'admin' && Number(task.created_by) !== userEmpId) {
      return res.status(403).json({ message: 'คุณไม่มีสิทธิ์ลบ Task ของผู้อื่น' });
    }

    if (task.status !== 'pending' && userRole !== 'admin') {
      return res.status(400).json({ message: 'ไม่สามารถลบ Task ที่เริ่มดำเนินการแล้วได้' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM auth.notifications WHERE task_id = $1', [task_id]);
      await client.query('DELETE FROM automation_lines.tasks WHERE task_id = $1', [task_id]);
      await client.query('COMMIT');
    } catch (dbErr) {
      await client.query('ROLLBACK');
      throw dbErr;
    } finally {
      client.release();
    }

    await recordAuditLog({
      employeeId: userEmpId,
      userName: req.user.name,
      role: userRole,
      deviceId: req.user.device_id,
      action: 'DELETE_TASK',
      target: `Task #${task_id}`,
      details: `Deleted task permanently (Line: ${task.lines}, Station: ${task.station})`,
      ipAddress: getClientIp(req)
    });

    io.emit('task_deleted', { task_id });
    res.json({ success: true, message: `ลบ Task ${task_id} สำเร็จเรียบร้อย` });
  } catch (err) {
    console.error('Delete Task Error:', err);
    res.status(500).json({ message: 'เกิดข้อผิดพลาดในการลบ Task', error: err.message });
  }
});

// Endpoint รับงาน และ ปิดงาน (ปรับให้ทุกคนยกเว้น PD สามารถกดรับงานได้ทั้งหมด)
router.patch('/api/tasks/:task_id/status', authenticateToken, upload.array('solution_images', 5), async (req, res) => {
  const { task_id } = req.params;
  const { status, solution } = req.body;
  const userEmpId = Number(req.user?.employee_id);
  const userRole = String(req.user?.role || '').toLowerCase().trim();

  // แผนก PD ยังคงถูกห้ามรับงานตามเดิม
  if (userRole === 'pd') {
    return res.status(403).json({ message: 'แผนก Production (PD) ไม่มีสิทธิ์รับงานหรือดำเนินการงานซ่อม' });
  }

  try {
    const checkTask = await pool.query(
      'SELECT * FROM automation_lines.tasks WHERE task_id = $1',
      [task_id]
    );

    if (checkTask.rows.length === 0) {
      return res.status(404).json({ message: 'ไม่พบ Task รหัสนี้ในระบบ' });
    }

    const currentTask = checkTask.rows[0];

    // 🟢 1. ยกเลิกรับงาน (คืนสถานะกลับเป็น Pending)
    if (status === 'pending') {
      if (currentTask.status !== 'in_progress') {
        return res.status(400).json({ message: 'สามารถยกเลิกได้เฉพาะ Task ที่กำลังดำเนินการ (In Progress) เท่านั้น' });
      }

      // ตรวจสอบสิทธิ์: อนุญาตเฉพาะคนที่รับงานนี้ไว้ หรือ Admin เท่านั้น
      if (userRole !== 'admin' && Number(currentTask.accepted_by) !== userEmpId) {
        return res.status(403).json({ 
          message: `คุณไม่มีสิทธิ์ยกเลิกงานนี้ (เฉพาะผู้รับงาน #${currentTask.accepted_by} หรือ Admin เท่านั้น)` 
        });
      }

      const cancelQuery = `
        UPDATE automation_lines.tasks 
        SET 
          status = 'pending'::automation_lines.task_status,
          accepted_by = NULL
        WHERE task_id = $1
        RETURNING *;
      `;
      const result = await pool.query(cancelQuery, [task_id]);

      await recordAuditLog({
        employeeId: userEmpId,
        userName: req.user.name,
        role: userRole,
        deviceId: req.user.device_id,
        action: 'CANCEL_TASK_ACCEPT',
        target: `Task #${task_id}`,
        details: `User #${userEmpId} cancelled acceptance of task #${task_id} (Returned to Pending)`,
        ipAddress: getClientIp(req)
      });

      // ยิงทั้ง 2 event เพื่อให้ครอบคลุม Frontend ทุกตัวที่ดักฟังอยู่
      io.emit('task_status_updated', result.rows[0]);
      io.emit('task_updated', result.rows[0]);

      return res.json({ success: true, task: result.rows[0], message: 'ยกเลิกการรับงานเรียบร้อยแล้ว' });
    }

    // 🟢 2. รับงานซ่อม
    if (status === 'in_progress') {
      if (currentTask.status !== 'pending') {
        return res.status(400).json({ message: 'Task นี้ถูกรับไปแล้ว' });
      }

      const updateQuery = `
        UPDATE automation_lines.tasks 
        SET 
          status = 'in_progress'::automation_lines.task_status,
          accepted_by = $1
        WHERE task_id = $2
        RETURNING *;
      `;
      const result = await pool.query(updateQuery, [userEmpId, task_id]);

      await recordAuditLog({
        employeeId: userEmpId,
        userName: req.user.name,
        role: userRole,
        deviceId: req.user.device_id,
        action: 'ACCEPT_TASK',
        target: `Task #${task_id}`,
        details: `User/Engineer #${userEmpId} accepted the repair task`,
        ipAddress: getClientIp(req)
      });

      io.emit('task_status_updated', result.rows[0]);
      io.emit('task_updated', result.rows[0]);

      return res.json({ success: true, task: result.rows[0], message: 'รับงานซ่อมสำเร็จ' });
    }

    // 🟢 3. ปิดงานซ่อม
    if (status === 'complete') {
      if (currentTask.status !== 'in_progress') {
        return res.status(400).json({ message: 'Task ต้องอยู่ในสถานะ In Progress ก่อนปิดงาน' });
      }

      if (userRole !== 'admin' && Number(currentTask.accepted_by) !== userEmpId) {
        return res.status(403).json({ 
          message: `คุณไม่มีสิทธิ์ปิดงานนี้ (เฉพาะผู้รับงาน #${currentTask.accepted_by} หรือ Admin เท่านั้น)` 
        });
      }

      if (!solution || !solution.trim()) {
        return res.status(400).json({ message: 'กรุณาระบุรายละเอียดการแก้ไขปัญหา (Solution)' });
      }

      const newImages = req.files && req.files.length > 0 
        ? req.files.map((file) => `/uploads/${file.filename}`) 
        : [];

      const uploadedSolutionImages = newImages.length > 0 
        ? newImages 
        : (Array.isArray(currentTask.solution_images) ? currentTask.solution_images : []);

      const updateQuery = `
        UPDATE automation_lines.tasks 
        SET 
          status = 'complete'::automation_lines.task_status,
          solution = $1,
          solution_images = $2::text[],
          end_at = CURRENT_TIMESTAMP
        WHERE task_id = $3
        RETURNING *;
      `;
      const result = await pool.query(updateQuery, [
        solution.trim(),
        uploadedSolutionImages,
        task_id
      ]);

      await recordAuditLog({
        employeeId: userEmpId,
        userName: req.user.name,
        role: userRole,
        deviceId: req.user.device_id,
        action: 'COMPLETE_TASK',
        target: `Task #${task_id}`,
        details: `Completed by #${userEmpId}. Solution: ${solution.trim()} (${uploadedSolutionImages.length} photo(s))`,
        ipAddress: getClientIp(req)
      });

      io.emit('task_status_updated', result.rows[0]);
      io.emit('task_updated', result.rows[0]);

      return res.json({ success: true, task: result.rows[0], message: 'ปิดงานซ่อมเรียบร้อย' });
    }

    return res.status(400).json({ message: 'สถานะที่ส่งมาไม่ถูกต้อง' });

  } catch (err) {
    console.error('Task Workflow Error:', err);
    res.status(500).json({ message: 'เกิดข้อผิดพลาดในการอัปเดตสถานะงาน', error: err.message });
  }
});

router.put('/api/tasks/:task_id/admin-override', authenticateToken, requireAdmin, async (req, res) => {
  const { task_id } = req.params;
  const { status, accepted_by, solution } = req.body;

  try {
    const endAtValue = status === 'complete' ? 'CURRENT_TIMESTAMP' : 'NULL';
    const finalAcceptedBy = status === 'pending' ? null : (accepted_by ? Number(accepted_by) : null);
    const finalSolution = status === 'complete' ? (solution || null) : null;

    const query = `
      UPDATE automation_lines.tasks 
      SET 
        status = $1::automation_lines.task_status,
        accepted_by = $2,
        solution = $3,
        end_at = ${endAtValue}
      WHERE task_id = $4
      RETURNING *;
    `;
    const result = await pool.query(query, [status, finalAcceptedBy, finalSolution, task_id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'ไม่พบ Task รหัสนี้ในระบบ' });
    }

    const updatedTask = result.rows[0];

    await recordAuditLog({
      employeeId: req.user.employee_id,
      userName: req.user.name,
      role: req.user.role,
      deviceId: req.user.device_id,
      action: 'ADMIN_OVERRIDE_TASK',
      target: `Task #${task_id}`,
      details: `Admin force updated: status=${status}, accepted_by=${finalAcceptedBy}`,
      ipAddress: getClientIp(req)
    });

    io.emit('task_status_updated', updatedTask);
    res.json({ success: true, task: updatedTask, message: `Admin อัปเดต Task ${task_id} สำเร็จ` });
  } catch (err) {
    console.error('Admin Override Task Error:', err);
    res.status(500).json({ message: 'ไม่สามารถอัปเดต Task ได้', error: err.message });
  }
});


export default router;

