// ==========================================
// 🔐 สร้าง certificate HTTPS ของ server (self-signed อายุ 10 ปี) ให้หน้าเว็บ 5173 ใช้แทน basicSsl (ที่เปลี่ยนทุก 30 วัน)
//  ทำไม: คอมเทส Chroma pin SHA-256 ของ cert server ไว้ → cert ต้องคงที่ ไม่งั้นคอมเทสส่ง log / ผลเทสขึ้น server ไม่ได้
//  ใช้ (บน server): npm run make:https-cert -- --ip 10.204.206.1
//    --ip    IP ที่เบราว์เซอร์ / คอมเทสใช้เข้า (ใส่ได้หลายตัว คั่น ,)   --name  ชื่อเครื่อง (default = ชื่อคอม)
//    --out   โฟลเดอร์เก็บไฟล์ (default = <โฟลเดอร์แม่ของโปรเจกต์>\certs — นอก repo)  --force  เขียนทับของเดิม
//  ต้องมี openssl (มากับ Git for Windows) · ไฟล์ .key เป็นความลับ ห้ามขึ้น GitHub
//  สร้างใหม่ = fingerprint เปลี่ยน → ต้องแก้ "Server cert SHA-256" ที่คอมเทสทุกเครื่อง + เบราว์เซอร์เตือน cert ใหม่ 1 ครั้ง
// ==========================================
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const args = {};
process.argv.slice(2).forEach((a, i, arr) => {
  if (a.startsWith('--')) args[a.slice(2)] = arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true;
});

const projectRoot = path.resolve(__dirname, '..');
const outDir = path.resolve(args.out || path.join(projectRoot, '..', 'certs'));
const keyFile = path.join(outDir, 'dashboard.key');
const certFile = path.join(outDir, 'dashboard.crt');
// IP ใน cert: ที่สั่ง (--ip) + IP server หลัก + ทุก IPv4 ของเครื่องนี้ (เข้าได้ทุกช่องทาง ไม่ต้องรู้ IP ล่วงหน้า)
const localIps = Object.values(os.networkInterfaces()).flat()
  .filter((n) => n && n.family === 'IPv4' && !n.internal).map((n) => n.address);
const ips = [...new Set([
  ...String(args.ip || '').split(',').map((s) => s.trim()).filter(Boolean),
  '10.204.206.1',
  ...localIps,
])];
const name = String(args.name || os.hostname());

const fingerprint = (pem) => new crypto.X509Certificate(pem).fingerprint256.replace(/:/g, '').toUpperCase();

if (fs.existsSync(certFile) && !args.force) {
  const pem = fs.readFileSync(certFile, 'utf8');
  const c = new crypto.X509Certificate(pem);
  console.log(`มี certificate อยู่แล้ว: ${certFile}`);
  console.log(`  ใช้ได้ถึง ${c.validTo} · ${c.subjectAltName || ''}`);
  console.log(`  SHA-256 (ใส่ที่คอมเทส): ${fingerprint(pem)}`);
  console.log('ไม่ได้สร้างใหม่ (สร้างใหม่ = fingerprint เปลี่ยน ต้องแก้ที่คอมเทสทุกเครื่อง) — ถ้าต้องการจริงใส่ --force');
  process.exit(0);
}

const findOpenssl = () => {
  const candidates = [
    'openssl',
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'usr', 'bin', 'openssl.exe'),
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'mingw64', 'bin', 'openssl.exe'),
  ];
  for (const c of candidates) {
    try {
      execFileSync(c, ['version'], { stdio: 'ignore' });
      return c;
    } catch {
      /* ลองตัวถัดไป */
    }
  }
  return null;
};

const openssl = findOpenssl();
if (!openssl) {
  console.error('ไม่พบ openssl — ติดตั้ง Git for Windows หรือใส่ openssl ใน PATH');
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });
const san = [...ips.map((ip) => `IP:${ip}`), `DNS:${name}`, 'DNS:localhost', 'IP:127.0.0.1'].join(',');
// ใช้ไฟล์ config แทน -subj (Git Bash แปลง /CN=... เป็น path)
const cfgFile = path.join(os.tmpdir(), `dashboard-cert-${process.pid}.cnf`);
fs.writeFileSync(cfgFile, [
  '[req]', 'distinguished_name = dn', 'prompt = no', 'x509_extensions = ext',
  '[dn]', `CN = ${name}`, 'O = Automation Dashboard',
  '[ext]', `subjectAltName = ${san}`, 'basicConstraints = critical,CA:FALSE',
  'keyUsage = critical,digitalSignature,keyEncipherment', 'extendedKeyUsage = serverAuth',
].join('\n'));
try {
  execFileSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '3650',
    '-config', cfgFile, '-keyout', keyFile, '-out', certFile], { stdio: 'pipe' });
} finally {
  fs.rmSync(cfgFile, { force: true });
}

const pem = fs.readFileSync(certFile, 'utf8');
const c = new crypto.X509Certificate(pem);
console.log('สร้าง certificate แล้ว');
console.log(`  key : ${keyFile}   (ความลับ ห้ามขึ้น GitHub / ห้ามส่งต่อ)`);
console.log(`  cert: ${certFile}`);
console.log(`  ใช้ได้ถึง ${c.validTo} · ${c.subjectAltName}`);
console.log(`  SHA-256 (ใส่ที่คอมเทสช่อง "Server cert SHA-256"): ${fingerprint(pem)}`);
console.log('ต่อไป: Restart "หน้าเว็บ (Vite)" ใน launcher ให้ใช้ cert นี้');
