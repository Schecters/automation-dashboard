import crypto from 'crypto';
import https from 'https';
import tls from 'tls';
import { JWT_SECRET } from './config.js';

// ==========================================
// 🔌 คุยกับคอมเทส Chroma (C# Station App) ผ่าน HTTPS
//  - คอมเทสใช้ certificate self-signed → "pin" ไว้: เก็บ cert ตอนลงทะเบียน (ผู้ใช้เทียบ fingerprint กับจอคอมเทส)
//    แล้วทุก request เชื่อเฉพาะ cert นั้น (ca = cert ที่เก็บ + เช็ค fingerprint ซ้ำ) ไม่ได้ปิดการตรวจ TLS
//  - API key ต่อเครื่อง เก็บแบบเข้ารหัส AES-256-GCM (key คำนวณจาก JWT_SECRET) เพราะต้องส่งให้คอมเทส
//  - สัญญา API อยู่ที่ D:\Chroma DCR\CLAUDE.md (base /api/v1, header X-Api-Key / X-User / X-User-Name)
// ==========================================

const ENC_KEY = crypto.createHash('sha256').update(`${JWT_SECRET}:chroma-station-key`).digest();

export const newApiKey = () => crypto.randomBytes(24).toString('base64url');

export const encryptKey = (plain) => {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', ENC_KEY, iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
};

export const decryptKey = (enc) => {
  const buf = Buffer.from(String(enc || ''), 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8');
};

// เทียบ key แบบเวลาคงที่
export const sameKey = (a, b) => {
  const x = crypto.createHash('sha256').update(String(a || '')).digest();
  const y = crypto.createHash('sha256').update(String(b || '')).digest();
  return crypto.timingSafeEqual(x, y) && String(a || '') !== '';
};

// fingerprint แบบไม่มี ":" ตัวใหญ่ (C# แสดงแบบนี้ / Node ให้แบบ AB:CD:...)
export const normFp = (fp) => String(fp || '').replace(/[^0-9a-f]/gi, '').toUpperCase();

const toPem = (raw) =>
  `-----BEGIN CERTIFICATE-----\n${raw.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`;

export const validHost = (ip) => /^[0-9a-zA-Z.\-]{1,63}$/.test(String(ip || ''));
export const validPort = (p) => Number.isInteger(Number(p)) && Number(p) > 0 && Number(p) < 65536;

/**
 * อ่าน certificate ของคอมเทส (ตอนลงทะเบียน) — ยังไม่เชื่อ ให้ผู้ใช้เทียบ fingerprint ก่อน
 * @returns {Promise<{ pem: string, sha256: string, subject: string, validTo: string }>}
 */
export const fetchCert = (host, port, timeoutMs = 5000) =>
  new Promise((resolve, reject) => {
    const sock = tls.connect({ host, port: Number(port), rejectUnauthorized: false, servername: undefined });
    const timer = setTimeout(() => {
      sock.destroy();
      reject(new Error(`ต่อ ${host}:${port} ไม่ทันเวลา`));
    }, timeoutMs);
    sock.once('secureConnect', () => {
      clearTimeout(timer);
      const cert = sock.getPeerCertificate(true);
      sock.end();
      if (!cert || !cert.raw) return reject(new Error('คอมเทสไม่ส่ง certificate มา'));
      resolve({
        pem: toPem(cert.raw),
        sha256: normFp(cert.fingerprint256),
        subject: cert.subject?.CN || '',
        validTo: cert.valid_to || '',
      });
    });
    sock.once('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`ต่อ ${host}:${port} ไม่ได้: ${err.message}`));
    });
  });

// ตัวเลือก TLS ที่เชื่อเฉพาะ cert ที่ pin ไว้
const pinnedTls = (station) => ({
  ca: station.cert_pem,
  rejectUnauthorized: true,
  // ใช้ IP ต่อ (cert ไม่มีชื่อ IP) → ข้ามการเทียบชื่อ แต่เทียบ fingerprint แทน
  checkServerIdentity: (_host, cert) =>
    normFp(cert.fingerprint256) === normFp(station.cert_sha256)
      ? undefined
      : new Error('certificate ของคอมเทสไม่ตรงกับที่ลงทะเบียนไว้ (เครื่องถูกเปลี่ยน / สร้าง cert ใหม่?) — ลงทะเบียนใหม่'),
  agent: false,
});

export class StationError extends Error {
  constructor(message, status = 503, body = null) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

/**
 * เรียก API ของคอมเทส → { status, body } (body = JSON หรือข้อความ)
 * @param {object} station  แถวจาก chroma_stations (ต้องมี ip, port, cert_pem, cert_sha256, api_key_enc)
 * @param {string} method
 * @param {string} path  หลัง /api/v1 เช่น "/status"
 * @param {{ body?: any, user?: { employee_id: string, name?: string }, timeoutMs?: number }} opts
 */
export const stationRequest = (station, method, path, { body, user, timeoutMs = 8000 } = {}) =>
  new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const headers = {
      Accept: 'application/json',
      'X-Api-Key': decryptKey(station.api_key_enc),
    };
    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = payload.length;
    }
    if (user) {
      headers['X-User'] = String(user.employee_id || '');
      // header ต้องเป็น ASCII → ชื่อภาษาไทยส่งแบบ encodeURIComponent
      headers['X-User-Name'] = encodeURIComponent(String(user.name || ''));
    }
    const req = https.request(
      { host: station.ip, port: Number(station.port), method, path: `/api/v1${path}`, headers, timeout: timeoutMs, ...pinnedTls(station) },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let data = text;
          try {
            data = text ? JSON.parse(text) : null;
          } catch {
            /* ข้อความธรรมดา */
          }
          resolve({ status: res.statusCode || 502, body: data });
        });
      }
    );
    req.on('timeout', () => req.destroy(new StationError(`คอมเทส ${station.name || station.ip} ไม่ตอบภายใน ${Math.round(timeoutMs / 1000)} วินาที`)));
    req.on('error', (err) =>
      reject(err instanceof StationError ? err : new StationError(`ต่อคอมเทส ${station.name || station.ip} ไม่ได้: ${err.message}`))
    );
    if (payload) req.write(payload);
    req.end();
  });

/**
 * เปิด SSE /events ของคอมเทส — เรียก onEvent(type, data) ทุก event / คืนฟังก์ชันปิด
 * หลุดแล้วเรียก onClose(err) (ผู้เรียกตัดสินใจเองว่าจะต่อใหม่ไหม)
 */
export const openStationEvents = (station, onEvent, onClose) => {
  let closed = false;
  let buf = '';
  const req = https.request(
    {
      host: station.ip,
      port: Number(station.port),
      method: 'GET',
      path: '/api/v1/events',
      headers: { Accept: 'text/event-stream', 'X-Api-Key': decryptKey(station.api_key_enc) },
      ...pinnedTls(station),
    },
    (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        if (!closed) onClose?.(new Error(`SSE ตอบ ${res.statusCode}`));
        closed = true;
        return;
      }
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        buf += chunk.replace(/\r\n/g, '\n');
        let idx;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          let type = 'message';
          const lines = [];
          for (const line of block.split('\n')) {
            if (line.startsWith('event:')) type = line.slice(6).trim();
            else if (line.startsWith('data:')) lines.push(line.slice(5).replace(/^ /, ''));
          }
          if (!lines.length) continue;
          let data = lines.join('\n');
          try {
            data = JSON.parse(data);
          } catch {
            /* ไม่ใช่ JSON */
          }
          // รองรับทั้ง "event: x" และ data แบบ { type, data }
          if (type === 'message' && data && typeof data === 'object' && data.type) onEvent(data.type, data.data);
          else onEvent(type, data);
        }
      });
      res.on('end', () => {
        if (!closed) onClose?.(new Error('คอมเทสปิด SSE'));
        closed = true;
      });
    }
  );
  req.on('error', (err) => {
    if (!closed) onClose?.(err);
    closed = true;
  });
  req.end();
  return () => {
    closed = true;
    req.destroy();
  };
};
