import { createServiceApp, listenService } from '../lib/service.js';
import excelConfigsRoutes from '../routes/excelConfigs.js';
import excelGraphRoutes from '../routes/excelGraph.js';

// 📊 Microsoft Graph / Excel (คะแนนสอบ, ค้นหาไฟล์ OneDrive, รูปโปรไฟล์) + ตั้งค่าไฟล์ Excel
// token ของ Graph (device code login) อยู่ใน service นี้ตัวเดียว — รีสตาร์ทตัวนี้อาจต้อง login Microsoft ใหม่
const { server } = createServiceApp('graph', [excelConfigsRoutes, excelGraphRoutes]);
listenService(server, 'graph');
