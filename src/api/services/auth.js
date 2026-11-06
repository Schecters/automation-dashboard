import { createServiceApp, listenService } from '../lib/service.js';
import authRoutes from '../routes/auth.js';
import usersRoutes from '../routes/users.js';

// 🔐 Login / ผู้ใช้ / Audit log
const { server } = createServiceApp('auth', [authRoutes, usersRoutes]);
listenService(server, 'auth');
