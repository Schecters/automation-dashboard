import crypto from 'crypto';
import { JWT_SECRET } from './config.js';
import { serviceUrl } from './serviceMap.js';

// ==========================================
// 🔐 เรียกกันเองระหว่าง service ในเครื่อง server (ไม่ต้องตั้งค่าใน .env — key คำนวณจาก JWT_SECRET)
//  - ปลายทางรับเฉพาะ request จาก 127.0.0.1 + header x-internal-key ถูกต้อง
// ==========================================
const INTERNAL_KEY = crypto.createHash('sha256').update(`${JWT_SECRET}:internal-service`).digest('hex');

const isLoopback = (addr = '') => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(addr);

// middleware ฝั่งปลายทาง
export const requireInternal = (req, res, next) => {
  if (!isLoopback(req.socket.remoteAddress) || req.get('x-internal-key') !== INTERNAL_KEY) {
    return res.status(403).json({ success: false, message: 'Forbidden' });
  }
  next();
};

export class InternalServiceError extends Error {
  constructor(message, status = 503) {
    super(message);
    this.status = status;
  }
}

// ฝั่งผู้เรียก: fetch JSON จาก service อื่น { status, body }
export const internalFetch = async (serviceId, pathAndQuery, { method = 'GET', body, timeoutMs = 8000 } = {}) => {
  let res;
  try {
    res = await fetch(`${serviceUrl(serviceId)}${pathAndQuery}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'x-internal-key': INTERNAL_KEY },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new InternalServiceError(`ต่อระบบ ${serviceId} ไม่ได้ (${err.message})`);
  }
  const data = await res.json().catch(() => ({}));
  return { status: res.status, body: data };
};
