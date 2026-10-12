import express from 'express';
import { pool } from '../lib/db.js';
import { io } from '../lib/realtime.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

// ==========================================
// ⚙️ PLC Sequence & Recipe APIs (สำหรับ StepCustom.jsx และ .NET)
// ==========================================

// 1. ดึง ID ลำดับถัดไป (Auto-Increment) และรายชื่อ Recipe ทั้งหมด
router.get('/api/plc/sequence/next-id', async (req, res) => {
  try {
    const maxResult = await pool.query(`
      SELECT COALESCE(MAX(
        CASE 
          WHEN recipe_id ~ '^[0-9]+$' THEN recipe_id::int 
          ELSE 0 
        END
      ), 0) + 1 AS next_id 
      FROM automation_lines.plc_recipes;
    `);
    const nextId = maxResult.rows[0]?.next_id || 1;

    const listResult = await pool.query(`
      SELECT recipe_id AS "RecipeId", recipe_name AS "RecipeName" 
      FROM automation_lines.plc_recipes 
      ORDER BY id DESC;
    `);

    res.json({
      success: true,
      nextId: String(nextId),
      recipes: listResult.rows
    });
  } catch (err) {
    console.error('Fetch Next Recipe ID Error:', err);
    res.status(500).json({ success: false, message: 'ไม่สามารถดึงข้อมูล Recipe ID ได้', error: err.message });
  }
});

// 2. ดึงเฉพาะรายชื่อ Recipe ทั้งหมด (สำหรับ Dropdown ใน C# .NET หรือ Web)
router.get('/api/plc/sequence/list', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT recipe_id AS "RecipeId", recipe_name AS "RecipeName", updated_at AS "UpdatedAt"
      FROM automation_lines.plc_recipes 
      ORDER BY id DESC;
    `);

    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('Fetch Recipe List Error:', err);
    res.status(500).json({ success: false, message: 'ไม่สามารถดึงรายชื่อ Recipe ได้', error: err.message });
  }
});

// 3. บันทึก / อัปเดต Recipe และ Steps (รองรับทั้ง PLC Control และ Sensor Reading)
router.post('/api/plc/sequence/save', authenticateToken, requireAdmin, async (req, res) => {
  let { RecipeId, RecipeName, Steps } = req.body;

  if (!RecipeName || !String(RecipeName).trim()) {
    return res.status(400).json({ success: false, message: 'กรุณาระบุ RecipeName' });
  }

  const cleanRecipeName = String(RecipeName).trim();
  const stepList = Array.isArray(Steps) ? Steps : [];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ถ้าไม่มี RecipeId ส่งมา (สร้างใหม่) ให้หา Next ID ให้อัตโนมัติภายใน Transaction
    let cleanRecipeId = RecipeId ? String(RecipeId).trim() : '';
    if (!cleanRecipeId) {
      const genIdResult = await client.query(`
        SELECT COALESCE(MAX(
          CASE 
            WHEN recipe_id ~ '^[0-9]+$' THEN recipe_id::int 
            ELSE 0 
          END
        ), 0) + 1 AS gen_id 
        FROM automation_lines.plc_recipes;
      `);
      cleanRecipeId = String(genIdResult.rows[0]?.gen_id || 1);
    }

    // 1. บันทึกหรืออัปเดตหัวข้อ Recipe
    await client.query(`
      INSERT INTO automation_lines.plc_recipes (recipe_id, recipe_name, updated_at)
      VALUES ($1, $2, CURRENT_TIMESTAMP)
      ON CONFLICT (recipe_id) DO UPDATE
      SET recipe_name = EXCLUDED.recipe_name,
          updated_at = CURRENT_TIMESTAMP;
    `, [cleanRecipeId, cleanRecipeName]);

    // 2. เคลียร์ Steps เดิมของ Recipe นี้ออก
    await client.query(`DELETE FROM automation_lines.plc_recipe_steps WHERE recipe_id = $1;`, [cleanRecipeId]);

    // 3. บันทึกรายการ Step ใหม่ (รองรับทั้ง Control และ Sensor Reading)
    for (const step of stepList) {
      const stepNo = Number(step.StepNo) || 1;
      const stepType = step.Type || 'CONTROL';
      const desc = step.Description || '';
      const durationMs = Number(step.DurationMs) || 0;
      const actions = Array.isArray(step.Actions) ? step.Actions : [];
      
      // แปลง SensorConfig เป็น JSON String สำหรับ jsonb
      const sensorConfigJson = step.SensorConfig ? JSON.stringify(step.SensorConfig) : null;

      await client.query(`
        INSERT INTO automation_lines.plc_recipe_steps 
          (recipe_id, step_no, step_type, description, duration_ms, actions, sensor_config)
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb);
      `, [
        cleanRecipeId, 
        stepNo, 
        stepType, 
        desc, 
        durationMs, 
        JSON.stringify(actions), 
        sensorConfigJson
      ]);
    }

    await client.query('COMMIT');

    // แจ้งเตือน Socket.IO ให้ .NET หรือ Web ทราบแบบ Real-time
    io.emit('plc_recipe_updated', { recipe_id: cleanRecipeId, recipe_name: cleanRecipeName });

    res.json({
      success: true,
      message: `บันทึก Recipe "${cleanRecipeName}" สำเร็จ`,
      data: { 
        RecipeId: cleanRecipeId, 
        RecipeName: cleanRecipeName, 
        stepCount: stepList.length 
      }
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Save PLC Recipe Error:', err);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการบันทึกข้อมูล', error: err.message });
  } finally {
    client.release();
  }
});

// 4. ดึงข้อมูล Recipe และ Steps ตาม Recipe ID (แก้ไขแล้ว: ดึง step_type และ sensor_config ด้วย)
router.get('/api/plc/sequence/get', async (req, res) => {
  const { recipeId } = req.query;

  if (!recipeId || !String(recipeId).trim()) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(400).send(JSON.stringify({ success: false, message: 'กรุณาระบุ Query Parameter ?recipeId=' }, null, 2));
  }

  const cleanRecipeId = String(recipeId).trim();

  try {
    const recipeResult = await pool.query(
      `SELECT recipe_id, recipe_name FROM automation_lines.plc_recipes WHERE recipe_id = $1;`,
      [cleanRecipeId]
    );

    if (recipeResult.rows.length === 0) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.status(404).send(JSON.stringify({ success: false, message: `ไม่พบ Recipe ID: ${cleanRecipeId}` }, null, 2));
    }

    const recipe = recipeResult.rows[0];

    // 🟢 ดึง step_type และ sensor_config ออกมาด้วย
    const stepsResult = await pool.query(`
      SELECT step_no, step_type, description, duration_ms, actions, sensor_config 
      FROM automation_lines.plc_recipe_steps 
      WHERE recipe_id = $1 
      ORDER BY step_no ASC;
    `, [cleanRecipeId]);

    // 🟢 Map ส่งคืนค่า Type และ SensorConfig ให้ตรงกับ React และ C# Model
    const formattedSteps = stepsResult.rows.map((s) => ({
      StepNo: s.step_no,
      Type: s.step_type || 'CONTROL',
      Description: s.description,
      DurationMs: s.duration_ms,
      Actions: s.actions || [],
      SensorConfig: s.sensor_config || null
    }));

    const responsePayload = {
      RecipeId: recipe.recipe_id,
      RecipeName: recipe.recipe_name,
      Steps: formattedSteps
    };

    // 🟢 คงโครงสร้างเดิม 100% พร้อมจัด Format ให้อ่านง่าย
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.send(JSON.stringify(responsePayload, null, 2));
  } catch (err) {
    console.error('Get PLC Recipe Error:', err);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(500).send(JSON.stringify({ success: false, message: 'ไม่สามารถดึงข้อมูล Recipe ได้', error: err.message }, null, 2));
  }
});

// 5. ลบ Recipe พร้อม Steps ทั้งหมด (Cascade Delete)
router.delete('/api/plc/sequence/:recipeId', authenticateToken, requireAdmin, async (req, res) => {
  const { recipeId } = req.params;

  if (!recipeId || !String(recipeId).trim()) {
    return res.status(400).json({ success: false, message: 'กรุณาระบุ Recipe ID ที่ต้องการลบ' });
  }

  try {
    const result = await pool.query(
      `DELETE FROM automation_lines.plc_recipes WHERE recipe_id = $1 RETURNING *;`,
      [String(recipeId).trim()]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'ไม่พบ Recipe ที่ต้องการลบ' });
    }

    io.emit('plc_recipe_deleted', { recipe_id: recipeId });

    res.json({ success: true, message: `ลบ Recipe เรียบร้อยแล้ว` });
  } catch (err) {
    console.error('Delete PLC Recipe Error:', err);
    res.status(500).json({ success: false, message: 'ไม่สามารถลบ Recipe ได้', error: err.message });
  }
});


export default router;

