
// 🟢 Helper Function: ทำความสะอาด IP Address ตัด ::ffff: ออก
export const getClientIp = (req) => {
  if (!req) return '127.0.0.1';
  let ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || req.ip || '';
  if (typeof ip === 'string' && ip.includes(',')) {
    ip = ip.split(',')[0].trim();
  }
  if (typeof ip === 'string' && ip.startsWith('::ffff:')) {
    ip = ip.replace('::ffff:', '');
  }
  if (ip === '::1') {
    ip = '127.0.0.1';
  }
  return ip || '127.0.0.1';
};

