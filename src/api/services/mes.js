import { createServiceApp, listenService } from '../lib/service.js';
import mesRoutes from '../routes/mes.js';

// 🏭 MES Update (หน้า /MES) — แยกไว้ให้ไลน์ส่ง MES ได้ต่อ แม้รีสตาร์ทส่วนอื่นของ dashboard
const { server } = createServiceApp('mes', [mesRoutes]);
listenService(server, 'mes');
