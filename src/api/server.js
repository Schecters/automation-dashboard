import { createServiceApp } from './lib/service.js';
import { SINGLE_MODE_PORT } from './lib/serviceMap.js';
import { initDatabase } from './lib/db.js';
import { initRealtime, internalEmitRouter } from './lib/realtime.js';
import { startPdCallMeEscalation } from './jobs/pdCallMeEscalation.js';

import staticFilesRoutes from './routes/staticFiles.js';
import authRoutes from './routes/auth.js';
import usersRoutes from './routes/users.js';
import notificationsRoutes from './routes/notifications.js';
import linesRoutes from './routes/lines.js';
import stationsRoutes from './routes/stations.js';
import operatorsRoutes from './routes/operators.js';
import layoutRoutes from './routes/layout.js';
import tasksRoutes from './routes/tasks.js';
import excelConfigsRoutes from './routes/excelConfigs.js';
import excelGraphRoutes from './routes/excelGraph.js';
import stationAssignmentsRoutes from './routes/stationAssignments.js';
import plcRoutes from './routes/plc.js';
import operatorDataRoutes from './routes/operatorData.js';
import pmChecklistRoutes from './routes/pmChecklist.js';
import mesRoutes from './routes/mes.js';
import defectsRoutes from './routes/defects.js';

// ==========================================
// 🧰 โหมดรวม: ทุก API อยู่ใน process เดียวที่ port 5000 (แบบเดิมก่อนแยก service)
//  ใช้ตอนฉุกเฉิน / ทดสอบ: node .\src\api\server.js  (ห้ามรันพร้อม service แยกใน launcher — port ชนกัน)
//  ปกติให้ใช้ launcher ที่รันแต่ละส่วนแยกกัน (ดู services.json, src/api/services/)
// ==========================================
process.env.API_MODE = 'single'; // serviceUrl() ชี้มาที่ตัวเอง (อ่านตอนมี request จึงตั้งตรงนี้ได้)

const { server } = createServiceApp('all-in-one', [
  staticFilesRoutes,
  internalEmitRouter,
  authRoutes,
  usersRoutes,
  notificationsRoutes,
  linesRoutes,
  stationsRoutes,
  operatorsRoutes,
  layoutRoutes,
  tasksRoutes,
  excelConfigsRoutes,
  excelGraphRoutes, // Microsoft Graph (เดิม Port 3000)
  stationAssignmentsRoutes,
  plcRoutes,
  operatorDataRoutes,
  pmChecklistRoutes, // Daily PM Checklist
  mesRoutes, // MES Update
  defectsRoutes, // Defect Code + ประวัติงานเสีย
]);

initRealtime(server);
initDatabase();
startPdCallMeEscalation();

server.listen(SINGLE_MODE_PORT, '0.0.0.0', () => {
  console.log(`✅ API (โหมดรวม) พร้อมทำงานที่ port ${SINGLE_MODE_PORT} (Database: ${process.env.DB_NAME || process.env.DB_USER_NAME || 'Automation'})`);
});
