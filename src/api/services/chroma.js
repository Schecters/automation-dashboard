import { createServiceApp, listenService } from '../lib/service.js';
import chromaRoutes from '../routes/chroma.js';

// 🔌 Chroma Tester (หน้า /chroma) — สั่งงานคอมเทส Chroma 19036 + รับ log / ผลเทส / OEE จากคอมเทส
//  แยก service ไว้ เพราะถือ connection SSE ไปคอมเทสค้างไว้ และรีสตาร์ทได้โดยไม่กระทบส่วนอื่น
//  ตารางใน Database สร้างโดย initDatabase() ของ service data (ตาราง automation_lines.chroma_*)
const { server } = createServiceApp('chroma', [chromaRoutes]);
listenService(server, 'chroma');
