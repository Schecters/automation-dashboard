import http from 'http';
import cors from 'cors';
import express from 'express';
import { PORT } from './lib/config.js';
import { initDatabase } from './lib/db.js';
import { initRealtime } from './lib/realtime.js';
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

const app = express();

// 🟢 บอกให้ Express เชื่อถือ Header ที่ส่งต่อมาจาก Proxy / Vite
app.set('trust proxy', true);

// 🌐 Static files (ต้องลงทะเบียนก่อน CORS เหมือนเดิม)
app.use(staticFilesRoutes);

// ==========================================
// 🛡️ Middleware: CORS & Body Parsers
// ==========================================
app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'x-session-token',
    'X-Session-Token',
    'x-device-id',
    'X-Device-Id',
    'x-requested-with'
  ]
}));

app.use(express.json({ limit: '1000mb' }));
app.use(express.urlencoded({ limit: '1000mb', extended: true, parameterLimit: 1000000 }));

const server = http.createServer(app);
initRealtime(server);

initDatabase();

// ==========================================
// 🧭 API Routes
// ==========================================
app.use(authRoutes);
app.use(usersRoutes);
app.use(notificationsRoutes);
app.use(linesRoutes);
app.use(stationsRoutes);
app.use(operatorsRoutes);
app.use(layoutRoutes);
app.use(tasksRoutes);
app.use(excelConfigsRoutes);
app.use(excelGraphRoutes); // Microsoft Graph (เดิม Port 3000)
app.use(stationAssignmentsRoutes);
app.use(plcRoutes);
app.use(operatorDataRoutes);

startPdCallMeEscalation();

// ==========================================
// 🚀 Start Server (Bind 0.0.0.0 รับการเชื่อมต่อผ่าน Network)
// ==========================================
server.listen(PORT, '0.0.0.0', () => {
  console.log(`User & Auth Service running on port ${PORT} (Database: ${process.env.DB_NAME || process.env.DB_USER_NAME || 'Automation'})`);
});

