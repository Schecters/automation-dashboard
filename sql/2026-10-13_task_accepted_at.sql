-- เพิ่มคอลัมน์เวลารับงาน (accepted_at) ให้ตาราง Task
-- ปกติ API จะรันให้เองตอน start (src/api/lib/db.js -> migrateTaskAcceptedAt)
-- ไฟล์นี้ไว้รันเองใน pgAdmin กรณีที่ API สร้างไม่สำเร็จ (รันซ้ำได้ ไม่พัง)

ALTER TABLE automation_lines.tasks
  ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ DEFAULT NULL;

-- เติมเวลารับงานให้งานเก่า จากประวัติกดรับงานใน Audit Log
UPDATE automation_lines.tasks t
SET accepted_at = a.accepted_time
FROM (
  SELECT substring(target FROM 'Task #(.+)$') AS task_id, MAX(created_at) AS accepted_time
  FROM auth.audit_logs
  WHERE action = 'ACCEPT_TASK'
  GROUP BY 1
) a
WHERE t.task_id = a.task_id
  AND t.accepted_at IS NULL
  AND t.accepted_by IS NOT NULL;

-- ตรวจผล
SELECT task_id, status, created_at, accepted_at, end_at
FROM automation_lines.tasks
ORDER BY created_at DESC
LIMIT 20;
