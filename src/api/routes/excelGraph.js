import express from 'express';
import { DeviceCodeCredential } from '@azure/identity';
import { Client } from '@microsoft/microsoft-graph-client';
import { TokenCredentialAuthenticationProvider } from '@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials/index.js';
import { pool } from '../lib/db.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';

// ==========================================
// 📊 Microsoft Graph: Excel / OneDrive / รูปโปรไฟล์
// (เดิมแยกรันอยู่ที่ Port 3000 ในไฟล์ excel.js)
// ==========================================
const router = express.Router();

const { TENANT_ID, CLIENT_ID } = process.env;

// ฟังก์ชันดึง Config จาก PostgreSQL ตาม configKey
const getExcelConfig = async (configKey = 'exam_scores') => {
  const result = await pool.query(
    `SELECT drive_id, drive_item_id, table_name, file_name, col_employee_id, col_name, col_score
     FROM auth.excel_configs 
     WHERE config_key = $1 
     LIMIT 1;`,
    [configKey]
  );

  if (result.rows.length === 0) {
    throw new Error(`ไม่พบการตั้งค่าในระบบสำหรับ Key: "${configKey}"`);
  }

  const row = result.rows[0];
  return {
    driveId: row.drive_id,
    driveItemId: row.drive_item_id,
    tableName: row.table_name || 'OfficeForms.Table',
    fileName: row.file_name,
    colEmployeeId: row.col_employee_id || 'รหัสพนักงาน',
    colName: row.col_name || 'ชื่อ-นามสกุล',
    colScore: row.col_score || 'Total points',
  };
};

let globalAuthInfo = null;
let credential = null;
let cachedToken = null;
let tokenExpiresOn = null;
let graphClient = null;

// Helper สำหรับดึง Token พร้อมระบบ Cache
const getGraphToken = async () => {
  const now = Date.now();
  if (cachedToken && tokenExpiresOn && now < tokenExpiresOn - 60000) {
    return cachedToken;
  }

  if (!credential && TENANT_ID && CLIENT_ID) {
    credential = new DeviceCodeCredential({
      tenantId: TENANT_ID,
      clientId: CLIENT_ID,
      userPromptCallback: (info) => {
        const codeMatch = info.message.match(/enter the code ([A-Z0-9]+)/i) || info.message.match(/code ([A-Z0-9]+)/i);
        const userCode = codeMatch ? codeMatch[1] : '';
        globalAuthInfo = { 
          code: userCode, 
          url: 'https://microsoft.com/devicelogin', 
          message: info.message,
          expiresAt: Date.now() + 15 * 60 * 1000 
        };
        console.log(`🔑 แจ้ง React ให้นำรหัส [${userCode}] ไปแสดง popup...`);
      },
    });

    const authProvider = new TokenCredentialAuthenticationProvider(credential, {
      scopes: ['https://graph.microsoft.com/Files.ReadWrite', 'https://graph.microsoft.com/User.Read'],
    });

    graphClient = Client.initWithMiddleware({ authProvider });
  }

  // User.ReadBasic.All ใช้สำหรับดึงรูปโปรไฟล์ของผู้ใช้คนอื่นด้วยอีเมล
  const scopes = ['https://graph.microsoft.com/Files.ReadWrite', 'https://graph.microsoft.com/User.ReadBasic.All'];
  const tokenResponse = await credential.getToken(scopes);
  cachedToken = tokenResponse.token;
  tokenExpiresOn = tokenResponse.expiresOnTimestamp || (now + 3500000);
  globalAuthInfo = null;
  return cachedToken;
};

// =========================================================================
// Helper Function: แมปตำแหน่งคอลัมน์
// =========================================================================
const resolveColumnIndices = (headers, mapping = {}) => {
  const customEmp = mapping.colEmployeeId || 'รหัสพนักงาน';
  const customName = mapping.colName || 'ชื่อ-นามสกุล';
  const customScore = mapping.colScore || 'Total points';

  let empIdIdx = headers.findIndex((h) => h === customEmp);
  if (empIdIdx === -1) {
    empIdIdx = headers.findIndex((h) => /^รหัสพนักงาน/i.test(h) && !/points|feedback/i.test(h));
  }
  if (empIdIdx === -1) {
    empIdIdx = headers.findIndex((h) => /employee\s*id|emp_id/i.test(h) && !/points|feedback/i.test(h));
  }

  let nameIdx = headers.findIndex((h) => h === customName);
  if (nameIdx === -1) {
    nameIdx = headers.findIndex((h) => /^ชื่อ-นามสกุล/i.test(h) && !/points|feedback/i.test(h));
  }
  if (nameIdx === -1) {
    nameIdx = headers.findIndex((h) => (/^ชื่อ/i.test(h) || /^fullname/i.test(h)) && !/points|feedback/i.test(h));
  }

  let scoreIdx = headers.findIndex((h) => h === customScore);
  if (scoreIdx === -1) {
    scoreIdx = headers.findIndex((h) => /^total\s*points$/i.test(h) || h === 'Total points' || h === 'คะแนนรวม');
  }

  return { empIdIdx, nameIdx, scoreIdx };
};

// =========================================================================
// Endpoints ตรวจสอบสถานะ Authentication
// =========================================================================
router.get(['/check-auth', '/api/check-auth', '/publics/check-auth', '/api/excel/auth-status'], (req, res) => {
  const needsAuth = globalAuthInfo !== null && (globalAuthInfo.expiresAt ? Date.now() < globalAuthInfo.expiresAt : true);
  res.json({ 
    needsAuth: needsAuth, 
    required: needsAuth,
    authInfo: needsAuth ? globalAuthInfo : null,
    authData: needsAuth ? globalAuthInfo : null
  });
});

// =========================================================================
// 🟢 NEW: API ค้นหาไฟล์ Excel บน OneDrive (Graph API Search)
// =========================================================================
// =========================================================================
// 🟢 API ค้นหาไฟล์ Excel บน OneDrive (คืนค่า Array ทุกไฟล์ที่พบ)
// =========================================================================
router.get([
  '/search',
  '/api/search',
  '/publics/search',
  '/excel/search',
  '/api/excel/search',
  '/publics/excel/search'
], async (req, res) => {
  const { filename } = req.query;
  if (!filename || !filename.trim()) {
    return res.status(400).json({ success: false, message: 'กรุณาระบุชื่อไฟล์ที่ต้องการค้นหา' });
  }

  try {
    const token = await getGraphToken();

    // ค้นหาไฟล์ผ่าน Graph API
    const searchUrl = `https://graph.microsoft.com/v1.0/me/drive/root/search(q='${encodeURIComponent(filename.trim())}')`;
    const response = await fetch(searchUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errJson = await response.json().catch(() => ({}));
      return res.status(response.status).json({
        success: false,
        message: 'ค้นหาไฟล์จาก Microsoft Graph ไม่สำเร็จ',
        error: errJson
      });
    }

    const searchData = await response.json();
    const rawItems = searchData.value || [];

    // 🟢 กรองเฉพาะไฟล์ที่เป็น Excel (.xlsx, .xls, .xlsm) และไม่เอาโฟลเดอร์
    const excelFiles = rawItems
      .filter((item) => {
        const isFolder = !!item.folder;
        const isExcelExt = /\.(xlsx|xls|xlsm)$/i.test(item.name || '');
        return !isFolder && isExcelExt;
      })
      .map((item) => ({
        fileName: item.name,
        driveId: item.parentReference?.driveId,
        itemId: item.id,
        webUrl: item.webUrl,
        size: item.size,
        lastModifiedDateTime: item.lastModifiedDateTime,
      }));

    if (excelFiles.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: `ไม่พบไฟล์ Excel ที่ตรงกับคำค้นหา "${filename}" บน OneDrive` 
      });
    }

    // 🟢 ส่งกลับ Array ของทุกไฟล์ที่ค้นพบ
    res.json({
      success: true,
      data: excelFiles,
    });
  } catch (error) {
    console.error('❌ Search File Error:', error);
    if (globalAuthInfo) {
      return res.status(428).json({
        success: false,
        authRequired: true,
        authData: globalAuthInfo,
        message: 'จำเป็นต้องยืนยันตัวตน Microsoft Account'
      });
    }
    res.status(500).json({ success: false, message: error.message || 'เกิดข้อผิดพลาดในการค้นหาไฟล์' });
  }
});

// =========================================================================
// 🟢 API ดึงรูปโปรไฟล์ผู้ใช้จาก Microsoft Graph ด้วยอีเมล
// =========================================================================
const PHOTO_CACHE_TTL = 60 * 60 * 1000; // 1 ชั่วโมง
const photoCache = new Map(); // email -> { buffer, contentType, expiresAt } (buffer = null คือไม่มีรูป)

router.get(['/api/users/photo-by-email', '/users/photo-by-email'], async (req, res) => {
  const email = String(req.query.email || '').trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+$/.test(email)) {
    return res.status(400).json({ success: false, message: 'กรุณาระบุอีเมลให้ถูกต้อง' });
  }

  const cached = photoCache.get(email);
  if (cached && Date.now() < cached.expiresAt) {
    if (!cached.buffer) return res.status(404).end();
    res.set('Content-Type', cached.contentType);
    res.set('Cache-Control', 'private, max-age=3600');
    return res.send(cached.buffer);
  }

  try {
    const token = await getGraphToken();
    const photoUrl = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(email)}/photo/$value`;
    const response = await fetch(photoUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (response.status === 404) {
      photoCache.set(email, { buffer: null, expiresAt: Date.now() + PHOTO_CACHE_TTL });
      return res.status(404).end();
    }

    if (!response.ok) {
      const errJson = await response.json().catch(() => ({}));
      console.error('❌ Graph Photo Error:', response.status, errJson);
      return res.status(response.status).json({ success: false, message: 'ดึงรูปโปรไฟล์ไม่สำเร็จ' });
    }

    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const buffer = Buffer.from(await response.arrayBuffer());
    photoCache.set(email, { buffer, contentType, expiresAt: Date.now() + PHOTO_CACHE_TTL });

    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'private, max-age=3600');
    res.send(buffer);
  } catch (error) {
    console.error('❌ Fetch Photo Error:', error);
    if (globalAuthInfo) {
      return res.status(428).json({
        success: false,
        authRequired: true,
        authData: globalAuthInfo,
        message: 'จำเป็นต้องยืนยันตัวตน Microsoft Account'
      });
    }
    res.status(500).json({ success: false, message: error.message || 'เกิดข้อผิดพลาดในการดึงรูปโปรไฟล์' });
  }
});

// =========================================================================
// 🟢 NEW: API จัดการ Configs (CRUD auth.excel_configs)
// =========================================================================
// หมายเหตุ: /api/excel-configs และ /api/excel/save-config ใช้ของ routes/excelConfigs.js (มี auth)
// ที่นี่จึงรับเฉพาะ /publics/... เพื่อไม่ให้ชนกัน
// 1. ดึงรายการ Configs ทั้งหมด
router.get(['/excel-configs', '/publics/excel-configs'], async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT config_key, file_name, drive_id, drive_item_id, table_name, 
              col_employee_id, col_name, col_score, updated_at 
       FROM auth.excel_configs 
       ORDER BY updated_at DESC;`
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('❌ Fetch Configs Error:', error);
    res.status(500).json({ success: false, message: 'ไม่สามารถดึงข้อมูล Config ได้' });
  }
});

// 2. บันทึก Config ใหม่ (รองรับทั้ง /excel-configs และ /save-config)
router.post([
  '/excel-configs',
  '/publics/excel-configs',
  '/excel/save-config',
  '/publics/excel/save-config'
], authenticateToken, requireAdmin, async (req, res) => {
  const {
    config_key,
    file_name,
    drive_id,
    drive_item_id,
    table_name,
    col_employee_id,
    col_name,
    col_score
  } = req.body;

  try {
    const query = `
      INSERT INTO auth.excel_configs (
        config_key, file_name, drive_id, drive_item_id, table_name,
        col_employee_id, col_name, col_score, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
      ON CONFLICT (config_key) DO UPDATE SET
        file_name = EXCLUDED.file_name,
        drive_id = EXCLUDED.drive_id,
        drive_item_id = EXCLUDED.drive_item_id,
        table_name = EXCLUDED.table_name,
        col_employee_id = EXCLUDED.col_employee_id,
        col_name = EXCLUDED.col_name,
        col_score = EXCLUDED.col_score,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *;
    `;

    const result = await pool.query(query, [
      config_key,
      file_name,
      drive_id,
      drive_item_id,
      table_name || 'OfficeForms.Table',
      col_employee_id || 'รหัสพนักงาน',
      col_name || 'ชื่อ-นามสกุล',
      col_score || 'Total points'
    ]);

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('❌ Save Config Error:', error);
    res.status(500).json({ success: false, message: error.message || 'บันทึก Config ไม่สำเร็จ' });
  }
});

// 3. แก้ไข Config (PUT)
router.put([
  '/excel-configs/:key',
  '/publics/excel-configs/:key'
], authenticateToken, requireAdmin, async (req, res) => {
  const { key } = req.params;
  const {
    file_name,
    drive_id,
    drive_item_id,
    table_name,
    col_employee_id,
    col_name,
    col_score
  } = req.body;

  try {
    const query = `
      UPDATE auth.excel_configs SET
        file_name = $1,
        drive_id = $2,
        drive_item_id = $3,
        table_name = $4,
        col_employee_id = $5,
        col_name = $6,
        col_score = $7,
        updated_at = CURRENT_TIMESTAMP
      WHERE config_key = $8
      RETURNING *;
    `;

    const result = await pool.query(query, [
      file_name,
      drive_id,
      drive_item_id,
      table_name,
      col_employee_id,
      col_name,
      col_score,
      key
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'ไม่พบ Config ที่ต้องการแก้ไข' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('❌ Update Config Error:', error);
    res.status(500).json({ success: false, message: error.message || 'อัปเดต Config ไม่สำเร็จ' });
  }
});

// 4. ลบ Config (DELETE)
router.delete([
  '/excel-configs/:key',
  '/publics/excel-configs/:key'
], authenticateToken, requireAdmin, async (req, res) => {
  const { key } = req.params;
  try {
    const result = await pool.query(`DELETE FROM auth.excel_configs WHERE config_key = $1 RETURNING *;`, [key]);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'ไม่พบ Config ที่ต้องการลบ' });
    }
    res.json({ success: true, message: `ลบ Config "${key}" เรียบร้อยแล้ว` });
  } catch (error) {
    console.error('❌ Delete Config Error:', error);
    res.status(500).json({ success: false, message: error.message || 'ลบ Config ไม่สำเร็จ' });
  }
});

// =========================================================================
// 1. API ดึงข้อมูลคะแนน (GET)
// =========================================================================
router.get(['/excel-scores', '/api/excel-scores', '/publics/excel-scores'], async (req, res) => {
  const configKey = req.query.configKey || 'exam_scores';
  try {
    console.log(`\n⏳ [API GET] กำลังขอข้อมูลชุด [${configKey}] จาก Microsoft Graph...`);

    const config = await getExcelConfig(configKey);
    const token = await getGraphToken();

    const url = `https://graph.microsoft.com/v1.0/drives/${config.driveId}/items/${config.driveItemId}/workbook/tables('${config.tableName}')/range`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache',
      },
    });

    if (!response.ok) {
      const errJson = await response.json().catch(() => ({}));
      console.error(`❌ Graph Error (${configKey}):`, errJson);
      return res.status(200).json({
        success: true,
        data: [],
        message: `ไม่สามารถเปิดตาราง "${config.tableName}" ในไฟล์ ${config.fileName} ได้`,
        configKey,
        fileName: config.fileName,
      });
    }

    const responseData = await response.json();

    if (!responseData.values || responseData.values.length < 2) {
      console.log(`⚠️ ตาราง [${configKey}] ว่างเปล่า หรือไม่มีข้อมูลแถว`);
      return res.status(200).json({ success: true, data: [], configKey, fileName: config.fileName });
    }

    const data = responseData.values;
    const headers = data[0].map((h) => String(h || '').trim());
    const rows = data.slice(1);

    const { empIdIdx, nameIdx, scoreIdx } = resolveColumnIndices(headers, config);

    const displayData = rows
      .filter((row) => {
        const nameVal = nameIdx !== -1 && row[nameIdx] !== undefined ? String(row[nameIdx]).trim() : '';
        const empVal = empIdIdx !== -1 && row[empIdIdx] !== undefined ? String(row[empIdIdx]).trim() : '';
        return nameVal !== '' || empVal !== '';
      })
      .map((row, index) => {
        const rawEmpId = empIdIdx !== -1 && row[empIdIdx] !== undefined && String(row[empIdIdx]).trim() !== ''
          ? String(row[empIdIdx]).trim()
          : '-';

        const rawName = nameIdx !== -1 && row[nameIdx] !== undefined && String(row[nameIdx]).trim() !== ''
          ? String(row[nameIdx]).trim()
          : '-';

        const rawScore = scoreIdx !== -1 && row[scoreIdx] !== undefined && String(row[scoreIdx]).trim() !== ''
          ? row[scoreIdx]
          : 0;

        return {
          id: index + 1,
          employeeId: rawEmpId,
          name: rawName,
          score: isNaN(Number(rawScore)) ? 0 : Number(rawScore),
        };
      });

    console.log(`✅ ส่งข้อมูล [${configKey}] สำเร็จ: ${displayData.length} รายการ\n`);
    return res.json({ success: true, data: displayData, configKey, fileName: config.fileName });
  } catch (error) {
    console.error(`❌ [API Error on ${configKey}]:`, error.message);
    return res.status(500).json({ success: false, error: error.message || 'เกิดข้อผิดพลาดในการดึงข้อมูล' });
  }
});

// =========================================================================
// 2. API เพิ่มข้อมูลใหม่ (POST)
// =========================================================================
router.post(['/excel-scores', '/api/excel-scores', '/publics/excel-scores'], authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { configKey = 'exam_scores', employeeId, name, score } = req.body;
    const config = await getExcelConfig(configKey);
    const token = await getGraphToken();

    const getUrl = `https://graph.microsoft.com/v1.0/drives/${config.driveId}/items/${config.driveItemId}/workbook/tables('${config.tableName}')/range`;
    const getRes = await fetch(getUrl, { headers: { Authorization: `Bearer ${token}` } });
    const getData = await getRes.json();
    const headers = (getData.values && getData.values[0]) ? getData.values[0].map((h) => String(h || '').trim()) : [];

    const { empIdIdx, nameIdx, scoreIdx } = resolveColumnIndices(headers, config);

    let newRow = new Array(headers.length).fill('');
    if (empIdIdx !== -1) newRow[empIdIdx] = employeeId;
    if (nameIdx !== -1) newRow[nameIdx] = name;
    if (scoreIdx !== -1) newRow[scoreIdx] = score;

    const url = `https://graph.microsoft.com/v1.0/drives/${config.driveId}/items/${config.driveItemId}/workbook/tables('${config.tableName}')/rows`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values: [newRow.length > 0 ? newRow : [employeeId, name, score]] }),
    });

    if (!response.ok) return res.status(500).json({ success: false, error: 'เพิ่มข้อมูลไม่สำเร็จ' });
    res.json({ success: true, message: 'เพิ่มข้อมูลสำเร็จ' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || 'เกิดข้อผิดพลาด' });
  }
});

// =========================================================================
// 3. API แก้ไขข้อมูล (PATCH)
// =========================================================================
router.patch(['/excel-scores/update/:employeeId', '/api/excel-scores/update/:employeeId', '/publics/excel-scores/update/:employeeId'], authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { employeeId } = req.params;
    const { configKey = 'exam_scores', newEmployeeId, newName, newScore } = req.body;

    console.log(`✏️ [API Update] แก้ไข ID: ${employeeId} ในชุด [${configKey}]`);

    const config = await getExcelConfig(configKey);
    const token = await getGraphToken();

    const url = `https://graph.microsoft.com/v1.0/drives/${config.driveId}/items/${config.driveItemId}/workbook/tables('${config.tableName}')/range`;
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const responseData = await response.json();

    if (!responseData.values) {
      return res.status(404).json({ success: false, error: 'ไม่สามารถอ่านข้อมูลจากตาราง Excel ได้' });
    }

    const data = responseData.values;
    const headers = data[0].map((h) => String(h || '').trim());
    const rows = data.slice(1);

    const { empIdIdx, nameIdx, scoreIdx } = resolveColumnIndices(headers, config);
    const arrayIndex = rows.findIndex((row) => String(row[empIdIdx]).trim() === String(employeeId).trim());

    if (arrayIndex === -1) {
      return res.status(404).json({ success: false, error: 'ไม่พบรหัสพนักงานเดิมในตารางนี้' });
    }

    let currentRowValues = [...rows[arrayIndex]];
    if (empIdIdx !== -1) currentRowValues[empIdIdx] = newEmployeeId;
    if (nameIdx !== -1) currentRowValues[nameIdx] = newName;
    if (scoreIdx !== -1) currentRowValues[scoreIdx] = newScore;

    const rowRangeUrl = `https://graph.microsoft.com/v1.0/drives/${config.driveId}/items/${config.driveItemId}/workbook/tables('${config.tableName}')/rows/itemAt(index=${arrayIndex})/range`;

    const updateResponse = await fetch(rowRangeUrl, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values: [currentRowValues] }),
    });

    if (!updateResponse.ok) {
      const errData = await updateResponse.json();
      console.error('🔥 Graph API Error:', errData);
      return res.status(500).json({ success: false, error: 'อัปเดตข้อมูลใน Excel ไม่สำเร็จ' });
    }

    res.json({ success: true, message: 'แก้ไขข้อมูลสำเร็จ' });
  } catch (error) {
    console.error('[API Update Error]:', error);
    res.status(500).json({ success: false, error: error.message || 'เกิดข้อผิดพลาดในการแก้ไขข้อมูล' });
  }
});

// =========================================================================
// 4. API ลบข้อมูล (DELETE)
// =========================================================================
router.delete(['/excel-scores', '/api/excel-scores', '/publics/excel-scores'], authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { configKey = 'exam_scores', employeeId, name, score } = req.body;

    console.log(`🗑️ [API Delete] ลบแถว ID: ${employeeId} จากชุด [${configKey}]`);

    const config = await getExcelConfig(configKey);
    const token = await getGraphToken();

    const url = `https://graph.microsoft.com/v1.0/drives/${config.driveId}/items/${config.driveItemId}/workbook/tables('${config.tableName}')/range`;
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const responseData = await response.json();

    if (!responseData.values) {
      return res.status(404).json({ success: false, error: 'ไม่สามารถอ่านข้อมูลจากตาราง Excel ได้' });
    }

    const data = responseData.values;
    const headers = data[0].map((h) => String(h || '').trim());
    const rows = data.slice(1);

    const { empIdIdx, nameIdx, scoreIdx } = resolveColumnIndices(headers, config);

    const arrayIndex = rows.findIndex(
      (row) =>
        String(row[empIdIdx]).trim() === String(employeeId).trim() &&
        String(row[nameIdx]).trim() === String(name).trim() &&
        String(row[scoreIdx]).trim() === String(score).trim()
    );

    if (arrayIndex === -1) {
      return res.status(404).json({ success: false, error: 'ไม่พบแถวข้อมูลที่ตรงกันในตารางนี้' });
    }

    const deleteRowUrl = `https://graph.microsoft.com/v1.0/drives/${config.driveId}/items/${config.driveItemId}/workbook/tables('${config.tableName}')/rows/itemAt(index=${arrayIndex})`;

    const deleteResponse = await fetch(deleteRowUrl, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!deleteResponse.ok) {
      const errData = await deleteResponse.json();
      console.error('🔥 Graph API Error:', errData);
      return res.status(500).json({ success: false, error: 'ลบแถวใน Excel ไม่สำเร็จ' });
    }

    res.json({ success: true, message: 'ลบข้อมูลสำเร็จ' });
  } catch (error) {
    console.error('[API Delete Error]:', error);
    res.status(500).json({ success: false, error: error.message || 'เกิดข้อผิดพลาดในการลบข้อมูล' });
  }
});

export default router;