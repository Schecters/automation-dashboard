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

// ตรวจสอบและเตรียมตารางใน Database
export const initDatabase = async () => {
  try {
    await pool.query(`CREATE SCHEMA IF NOT EXISTS auth;`);
    await pool.query(`CREATE SCHEMA IF NOT EXISTS automation_lines;`);

    // เวลาที่รับงาน (แยก query และทำก่อน ไม่ให้ไปพังตามคำสั่งอื่นด้านล่าง)
    await pool.query(`ALTER TABLE automation_lines.tasks ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ DEFAULT NULL;`);
    
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

