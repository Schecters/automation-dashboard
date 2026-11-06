import { createServiceApp, listenService } from '../lib/service.js';
import tasksRoutes from '../routes/tasks.js';
import pmChecklistRoutes from '../routes/pmChecklist.js';
import notificationsRoutes from '../routes/notifications.js';
import { startPdCallMeEscalation } from '../jobs/pdCallMeEscalation.js';

// 🛠️ งานซ่อม (Task) / Daily PM Checklist / แจ้งเตือน + job แจ้ง ME เมื่อ PD Call ME ค้างเกิน 15 นาที
const { server } = createServiceApp('work', [tasksRoutes, pmChecklistRoutes, notificationsRoutes]);
startPdCallMeEscalation();
listenService(server, 'work');
