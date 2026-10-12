import { pool } from '../lib/db.js';
import { io, deviceSessions } from '../lib/realtime.js';

// แจ้งเตือน ME เมื่องาน PD Call ME ค้างเกิน 15 นาที (ตรวจทุก 1 นาที)
export const startPdCallMeEscalation = () => {
  setInterval(async () => {
    try {
      const overdueTasks = await pool.query(`
        SELECT t.* 
        FROM automation_lines.tasks t
        WHERE t.task_type = 'pd_call_me'
          AND t.status = 'pending'
          AND t.created_at <= NOW() - INTERVAL '15 minutes'
          AND NOT EXISTS (
            SELECT 1 FROM auth.notifications n 
            WHERE n.task_id = t.task_id AND n.title LIKE '%[Escalated]%'
          );
      `);

      if (overdueTasks.rows.length === 0) return;

      for (const task of overdueTasks.rows) {
        const taskShift = String(task.shift || 'a').toLowerCase().trim();
        const title = `🚨 [Escalated] PD Call ME เกิน 15 นาที: Line ${task.lines} (กะ ${taskShift.toUpperCase()})`;
        const message = `Station: ${task.station} ยังไม่มี Line Owner กดรับงาน`;

        const meUsers = await pool.query(
          `SELECT employee_id FROM auth.users WHERE role::text = 'me' AND LOWER(COALESCE(shift, '')) = $1`,
          [taskShift]
        );
        const meIds = meUsers.rows.map((r) => r.employee_id);

        for (const empId of meIds) {
          const notifRes = await pool.query(
            `INSERT INTO auth.notifications (employee_id, line_id, task_id, title, message, problem, task_type)
             VALUES ($1, $2, $3, $4, $5, $6, 'pd_call_me')
             RETURNING *;`,
            [empId, task.lines, task.task_id, title, message, task.problem]
          );

          for (const [dId, session] of deviceSessions.entries()) {
            if (String(session.employeeId) === String(empId) && session.socketId) {
              io.to(session.socketId).emit('new_notification', {
                id: notifRes.rows[0].id,
                title,
                message,
                problem: task.problem,
                taskId: task.task_id,
                image_url: task.image_url,
                images: task.images,
                task_type: 'pd_call_me',
                created_at: notifRes.rows[0].created_at,
                read: false
              });
            }
          }
        }

        io.emit('task_status_updated', task);
      }
    } catch (err) {
      console.error('PD Call ME Escalation Error:', err);
    }
  }, 60000);
};

