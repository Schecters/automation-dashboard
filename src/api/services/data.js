import { createServiceApp, listenService, forwardToOtherServices } from '../lib/service.js';
import { initDatabase } from '../lib/db.js';
import staticFilesRoutes from '../routes/staticFiles.js';
import linesRoutes from '../routes/lines.js';
import stationsRoutes from '../routes/stations.js';
import layoutRoutes from '../routes/layout.js';
import stationAssignmentsRoutes from '../routes/stationAssignments.js';
import operatorsRoutes from '../routes/operators.js';
import operatorDataRoutes from '../routes/operatorData.js';
import plcRoutes from '../routes/plc.js';
import defectsRoutes from '../routes/defects.js';

// 🗂️ ข้อมูลหลัก + API ภายนอก (port 5000 เปิดให้ทั้งวง LAN)
//  - Line / Station / Layout / พนักงาน / PLC sequence / ไฟล์รูป
//  - โปรแกรม .NET (PLC) และเว็บ OI (operator-data) เรียก port นี้ตรง
//  - path ของ service อื่นที่ถูกเรียกเข้ามาที่ 5000 จะถูกส่งต่อให้ (โปรแกรมเก่าที่เรียก 5000 ตรงยังใช้ได้)
//  - service นี้เป็นตัวสร้าง/อัปเดตตารางใน Database (initDatabase) ตัวเดียว
const { server } = createServiceApp(
  'data',
  [staticFilesRoutes, linesRoutes, stationsRoutes, operatorsRoutes, layoutRoutes, stationAssignmentsRoutes, plcRoutes, operatorDataRoutes, defectsRoutes],
  { before: [forwardToOtherServices('data')] }
);

initDatabase();
listenService(server, 'data');
