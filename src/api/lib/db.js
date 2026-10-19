import pkg from 'pg';
import './config.js';

const { Pool } = pkg;
export const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || process.env.DB_USER_NAME || 'Automation',
  password: String(process.env.DB_PASSWORD || ''), // 🛡️ ตั้งใน .env เท่านั้น ห้ามเขียนรหัสผ่านในโค้ด
  port: Number(process.env.DB_PORT) || 5432,
});

// 🕒 คอลัมน์เวลารับงาน (accepted_at) + เติมเวลาให้งานเก่าจาก Audit Log (ACCEPT_TASK)
// แยกออกมามี try/catch ของตัวเอง เพื่อให้เห็น log ชัด ๆ ว่าสำเร็จหรือพัง
const migrateTaskAcceptedAt = async () => {
  try {
    await pool.query(`ALTER TABLE automation_lines.tasks ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ DEFAULT NULL;`);

    // งานที่มีคนรับแล้วแต่ยังไม่มี accepted_at -> ใช้เวลาครั้งล่าสุดที่กดรับงานใน audit_logs
    const backfill = await pool.query(`
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
    `);

    console.log(`✅ tasks.accepted_at พร้อมใช้งาน (เติมเวลารับงานให้งานเก่า ${backfill.rowCount} รายการ)`);
  } catch (err) {
    console.error('❌ สร้าง/เติมคอลัมน์ tasks.accepted_at ไม่สำเร็จ:', err.message);
  }
};

// 📋 ตาราง Daily PM Checklist
//  - pm_templates / pm_template_items : แม่แบบเช็คลิสต์ (Line, Process, รายการที่ต้องเช็ค, ลำดับผู้อนุมัติ)
//  - pm_records / pm_record_values    : ผลการเช็คประจำวัน (เก็บสำเนาหัวข้อ/เกณฑ์ไว้ แก้แม่แบบทีหลังประวัติไม่เพี้ยน)
//  - pm_approvals                     : ประวัติการอนุมัติ/ไม่อนุมัติ ทีละขั้น
const migratePmChecklist = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS automation_lines.pm_templates (
        id SERIAL PRIMARY KEY,
        name VARCHAR(200) NOT NULL,
        line_id TEXT NOT NULL,
        process VARCHAR(200) NOT NULL,
        description TEXT,
        approval_steps JSONB NOT NULL DEFAULT '[]'::jsonb,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_by INT,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS automation_lines.pm_template_items (
        id SERIAL PRIMARY KEY,
        template_id INT NOT NULL REFERENCES automation_lines.pm_templates(id) ON DELETE CASCADE,
        seq INT NOT NULL DEFAULT 0,
        label TEXT NOT NULL,
        check_type VARCHAR(20) NOT NULL DEFAULT 'pass_fail' CHECK (check_type IN ('pass_fail', 'number')),
        unit VARCHAR(30),
        min_value NUMERIC,
        max_value NUMERIC,
        is_required BOOLEAN NOT NULL DEFAULT TRUE
      );

      CREATE TABLE IF NOT EXISTS automation_lines.pm_records (
        id SERIAL PRIMARY KEY,
        template_id INT NOT NULL REFERENCES automation_lines.pm_templates(id),
        template_name VARCHAR(200) NOT NULL,
        line_id TEXT NOT NULL,
        process VARCHAR(200) NOT NULL,
        check_date DATE NOT NULL,
        shift VARCHAR(10) NOT NULL DEFAULT 'a',
        approval_steps JSONB NOT NULL DEFAULT '[]'::jsonb,
        current_step INT NOT NULL DEFAULT 0,
        status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
        overall_result VARCHAR(5) NOT NULL DEFAULT 'OK' CHECK (overall_result IN ('OK', 'NG')),
        note TEXT,
        checked_by INT,
        checked_by_name VARCHAR(100),
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );

      -- 1 แม่แบบ / 1 วัน / 1 กะ บันทึกได้ครั้งเดียว (ยกเว้นใบที่ถูก Reject สามารถทำใหม่ได้)
      CREATE UNIQUE INDEX IF NOT EXISTS uq_pm_record_daily
        ON automation_lines.pm_records (template_id, check_date, shift)
        WHERE status <> 'rejected';

      CREATE TABLE IF NOT EXISTS automation_lines.pm_record_values (
        id SERIAL PRIMARY KEY,
        record_id INT NOT NULL REFERENCES automation_lines.pm_records(id) ON DELETE CASCADE,
        item_id INT,
        seq INT NOT NULL DEFAULT 0,
        label TEXT NOT NULL,
        check_type VARCHAR(20) NOT NULL,
        unit VARCHAR(30),
        min_value NUMERIC,
        max_value NUMERIC,
        value_bool BOOLEAN,
        value_number NUMERIC,
        result VARCHAR(5) CHECK (result IN ('OK', 'NG')),
        remark TEXT
      );

      CREATE TABLE IF NOT EXISTS automation_lines.pm_approvals (
        id SERIAL PRIMARY KEY,
        record_id INT NOT NULL REFERENCES automation_lines.pm_records(id) ON DELETE CASCADE,
        step_index INT NOT NULL,
        position VARCHAR(30) NOT NULL,
        action VARCHAR(10) NOT NULL CHECK (action IN ('approve', 'reject')),
        approved_by INT,
        approver_name VARCHAR(100),
        comment TEXT,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_pm_records_date ON automation_lines.pm_records (check_date DESC);
    `);
    console.log('✅ ตาราง Daily PM Checklist พร้อมใช้งาน');
  } catch (err) {
    console.error('❌ สร้างตาราง Daily PM Checklist ไม่สำเร็จ:', err.message);
  }
};

// ตรวจสอบและเตรียมตารางใน Database
export const initDatabase = async () => {
  try {
    await pool.query(`CREATE SCHEMA IF NOT EXISTS auth;`);
    await pool.query(`CREATE SCHEMA IF NOT EXISTS automation_lines;`);

    await migrateTaskAcceptedAt();
    await migratePmChecklist();

    await pool.query(`
      CREATE TABLE IF NOT EXISTS auth.audit_logs (
        id SERIAL PRIMARY KEY,
        employee_id INT,
        user_name VARCHAR(100) NOT NULL,
        role VARCHAR(50),
        device_id VARCHAR(100),
        action VARCHAR(50) NOT NULL,
        target VARCHAR(255) NOT NULL,
        details TEXT,
        ip_address VARCHAR(45) DEFAULT '127.0.0.1',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS auth.notifications (
        id SERIAL PRIMARY KEY,
        employee_id INT NOT NULL,
        line_id VARCHAR(50),
        task_id VARCHAR(50),
        title VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        problem TEXT,
        task_type VARCHAR(50) DEFAULT 'general',
        is_read BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS auth.excel_configs (
        config_key VARCHAR(100) PRIMARY KEY,
        file_name VARCHAR(255) NOT NULL,
        drive_id VARCHAR(255) NOT NULL,
        drive_item_id VARCHAR(255) NOT NULL,
        table_name VARCHAR(100) DEFAULT 'OfficeForms.Table',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS automation_lines.line_stations (
        id SERIAL PRIMARY KEY,
        line_id VARCHAR(50) NOT NULL REFERENCES automation_lines.lines(id) ON DELETE CASCADE,
        station_id VARCHAR(50) NOT NULL REFERENCES automation_lines.station(id) ON DELETE CASCADE,
        sequence_order INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT unique_line_station UNIQUE (line_id, station_id)
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS automation_lines.station_assignments (
        id SERIAL PRIMARY KEY,
        line_id VARCHAR(50) NOT NULL REFERENCES automation_lines.lines(id) ON DELETE CASCADE,
        station_id VARCHAR(50) REFERENCES automation_lines.station(id) ON DELETE SET NULL,
        element_id VARCHAR(100) NOT NULL,
        shift VARCHAR(10) NOT NULL DEFAULT 'a',
        operator_id VARCHAR(50) NOT NULL,
        operator_name VARCHAR(100) NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT unique_element_shift_assignment UNIQUE (line_id, element_id, shift)
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS automation_lines.station_exams (
        id SERIAL PRIMARY KEY,
        station_id VARCHAR(50) NOT NULL REFERENCES automation_lines.station(id) ON DELETE CASCADE,
        config_key VARCHAR(100) NOT NULL,
        min_score INT DEFAULT 80,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT unique_station_exam UNIQUE (station_id, config_key)
      );
    `);

    await pool.query(`
      ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email VARCHAR(255) DEFAULT NULL;
      ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS shift VARCHAR(10) DEFAULT NULL;
      ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS last_device_id VARCHAR(100) DEFAULT NULL;
      
      ALTER TABLE auth.users ALTER COLUMN email DROP NOT NULL;
      ALTER TABLE auth.users ALTER COLUMN role DROP NOT NULL;

      ALTER TABLE auth.audit_logs ADD COLUMN IF NOT EXISTS device_id VARCHAR(100) DEFAULT NULL;

      ALTER TABLE auth.notifications ADD COLUMN IF NOT EXISTS task_type VARCHAR(50) DEFAULT 'general';
      ALTER TABLE automation_lines.tasks ADD COLUMN IF NOT EXISTS image_url TEXT;
      ALTER TABLE automation_lines.tasks ADD COLUMN IF NOT EXISTS images TEXT[] DEFAULT '{}';
      ALTER TABLE automation_lines.tasks ADD COLUMN IF NOT EXISTS task_type VARCHAR(50) DEFAULT 'general';
      ALTER TABLE automation_lines.tasks ADD COLUMN IF NOT EXISTS shift VARCHAR(10) DEFAULT 'a';
      ALTER TABLE automation_lines.tasks ADD COLUMN IF NOT EXISTS created_by INT DEFAULT NULL;

      ALTER TABLE automation_lines.tasks DROP CONSTRAINT IF EXISTS chk_task_type;
      ALTER TABLE automation_lines.tasks ADD CONSTRAINT chk_task_type 
        CHECK (task_type IN ('general', 'shift_handover', 'improvement', 'product_issue', 'pd_call_me'));
    `);

    console.log('PostgreSQL: Schemas & Tables initialized successfully');
  } catch (err) {
    console.error('Failed to initialize database tables:', err);
  }
};

