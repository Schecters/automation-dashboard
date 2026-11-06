const { app, BrowserWindow, ipcMain, shell } = require('electron');
const { fork, exec } = require('child_process');
const http = require('http');
const net = require('net');
const path = require('path');
const fs = require('fs');
const os = require('os');

// ==========================================
// ⚙️ Automation Server Control Panel
//  - backend แยกเป็นหลายส่วน (services.json) + หน้าเว็บ (vite) — สั่ง Start / Stop / Restart ทีละส่วนได้
//  - ส่วนไหนดับเอง เปิดใหม่อัตโนมัติใน 3 วินาที (ดับเกิน 5 ครั้งใน 2 นาที = หยุด รอคนดู)
//  - หน้าเว็บ Restart: build ใหม่ขณะเว็บเดิมยังเปิดอยู่ แล้วค่อยสลับ (ดับแค่ ~2 วินาที)
// ==========================================

const RESTART_DELAY_MS = 3000;
const CRASH_WINDOW_MS = 2 * 60 * 1000;
const MAX_CRASHES = 5;
const HEALTH_INTERVAL_MS = 5000;

let win = null;
const units = new Map(); // id -> { def, proc, status, wantRunning, crashes: [], restartTimer, healthy, building }

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return '127.0.0.1';
}

function getProjectRoot() {
  if (!app.isPackaged) return __dirname;
  if (process.env.PORTABLE_EXECUTABLE_DIR) return process.env.PORTABLE_EXECUTABLE_DIR;
  const exeDir = path.dirname(app.getPath('exe'));
  if (fs.existsSync(path.join(exeDir, 'src', 'api'))) return exeDir;
  if (fs.existsSync(path.join(exeDir, '..', '..', 'src', 'api'))) return path.resolve(exeDir, '..', '..');
  return process.cwd();
}

const projectRoot = getProjectRoot();
const viteBin = path.join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js');

// อ่าน services.json ทุกครั้งที่เปิด launcher (เปลี่ยน port ไม่ต้อง build .exe ใหม่)
function loadConfig() {
  const file = path.join(projectRoot, 'services.json');
  const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  // data สร้างตารางใน DB -> เริ่มก่อน / realtime ต่อมา / ที่เหลือตามลำดับในไฟล์ / หน้าเว็บสุดท้าย
  const order = ['data', 'realtime'];
  const services = [...cfg.services].sort((a, b) => {
    const ia = order.indexOf(a.id);
    const ib = order.indexOf(b.id);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
  return { services, web: cfg.web };
}

// ---------- ส่งข้อมูลไปหน้าต่าง ----------
function send(channel, payload) {
  if (win && !win.isDestroyed() && win.webContents) win.webContents.send(channel, payload);
}
function log(id, text, level = 'info') {
  String(text)
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '') // ตัดรหัสสีของ terminal (vite)
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .forEach((line) => send('svc-log', { id, text: line, level }));
}
function pushStatus(u) {
  send('svc-status', {
    id: u.def.id,
    status: u.status,
    healthy: u.healthy,
    building: Boolean(u.building),
    crashes: u.crashes.length,
    pid: u.proc ? u.proc.pid : null,
  });
}
function setStatus(u, status) {
  u.status = status;
  pushStatus(u);
}

// ---------- ช่วยจัดการ process / port ----------
function killTree(proc) {
  if (!proc || proc.exitCode !== null) return;
  if (process.platform === 'win32' && proc.pid) {
    exec(`taskkill /pid ${proc.pid} /f /t`, () => {});
  } else {
    proc.kill('SIGTERM');
  }
}

// ปิดโปรแกรมที่ค้าง port นี้อยู่ (เฉพาะ port ของส่วนนั้น ไม่กระทบส่วนอื่น)
async function freePort(port) {
  // port ว่างอยู่แล้ว ไม่ต้องเรียก PowerShell (ช้า 1-3 วินาที)
  if (!(await checkTcp(port))) return;
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve();
    const ps = `Get-NetTCPConnection -LocalPort ${Number(port)} -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }`;
    exec(`powershell -NoProfile -Command "${ps}"`, () => setTimeout(resolve, 300));
  });
}

function pipeLogs(u, proc, label = u.def.id) {
  proc.stdout && proc.stdout.on('data', (d) => log(label, d.toString()));
  proc.stderr && proc.stderr.on('data', (d) => log(label, d.toString(), 'error'));
}

// ---------- เปิดใหม่อัตโนมัติ ----------
function handleExit(u, proc, code) {
  if (u.proc !== proc) return; // เป็น process เก่าที่ถูกแทนแล้ว
  u.proc = null;
  u.healthy = false;
  if (!u.wantRunning) {
    setStatus(u, 'stopped');
    return;
  }
  const now = Date.now();
  u.crashes = u.crashes.filter((t) => now - t < CRASH_WINDOW_MS);
  u.crashes.push(now);
  if (u.crashes.length > MAX_CRASHES) {
    u.wantRunning = false;
    log(u.def.id, `❌ ดับซ้ำ ${u.crashes.length} ครั้งใน 2 นาที — หยุดเปิดใหม่อัตโนมัติ ดู log ด้านบนแล้วกด Start เอง`, 'error');
    setStatus(u, 'failed');
    return;
  }
  log(u.def.id, `⚠️ ดับเอง (exit code ${code}) — เปิดใหม่ใน ${RESTART_DELAY_MS / 1000} วินาที`, 'error');
  setStatus(u, 'restarting');
  clearTimeout(u.restartTimer);
  u.restartTimer = setTimeout(() => {
    if (u.wantRunning) launch(u);
  }, RESTART_DELAY_MS);
}

// ---------- backend service ----------
async function launchService(u) {
  const entry = path.join(projectRoot, u.def.entry);
  if (!fs.existsSync(entry)) {
    log(u.def.id, `[Error] ไม่พบไฟล์ ${entry}`, 'error');
    u.wantRunning = false;
    return setStatus(u, 'failed');
  }
  setStatus(u, 'starting');
  await freePort(u.def.port);
  if (!u.wantRunning) return setStatus(u, 'stopped');
  const proc = fork(entry, [], { cwd: path.join(projectRoot, 'src', 'api'), silent: true });
  u.proc = proc;
  pipeLogs(u, proc);
  proc.on('exit', (code) => handleExit(u, proc, code));
  pushStatus(u);
}

// ---------- หน้าเว็บ (vite build + preview) ----------
function runBuild(u, outDir) {
  return new Promise((resolve) => {
    const proc = fork(viteBin, ['build', '--outDir', outDir, '--emptyOutDir'], { cwd: projectRoot, silent: true });
    u.buildProc = proc;
    pipeLogs(u, proc, 'web:build');
    proc.on('exit', (code) => {
      u.buildProc = null;
      resolve(code === 0);
    });
  });
}

function startPreview(u) {
  const proc = fork(viteBin, ['preview', '--host', '0.0.0.0', '--port', String(u.def.port), '--strictPort'], {
    cwd: projectRoot,
    silent: true,
  });
  u.proc = proc;
  pipeLogs(u, proc);
  proc.on('exit', (code) => handleExit(u, proc, code));
  pushStatus(u);
}

const distDir = () => path.join(projectRoot, 'dist');
const distNextDir = () => path.join(projectRoot, 'dist-next');
const distOldDir = () => path.join(projectRoot, 'dist-old');

function swapDist() {
  fs.rmSync(distOldDir(), { recursive: true, force: true });
  if (fs.existsSync(distDir())) fs.renameSync(distDir(), distOldDir());
  fs.renameSync(distNextDir(), distDir());
  fs.rmSync(distOldDir(), { recursive: true, force: true });
}

// rebuild = true: build ใหม่ / false: เปิด preview จาก dist เดิม (ใช้ตอนเปิดใหม่อัตโนมัติ)
async function launchWeb(u, { rebuild = true } = {}) {
  if (!fs.existsSync(viteBin)) {
    log('web', `[Error] ไม่พบ Vite ที่ ${viteBin} กรุณารัน npm install ในโฟลเดอร์โปรเจกต์ก่อน`, 'error');
    u.wantRunning = false;
    return setStatus(u, 'failed');
  }
  if (u.building) return;

  if (rebuild || !fs.existsSync(path.join(distDir(), 'index.html'))) {
    u.building = true;
    if (!u.proc) setStatus(u, 'starting');
    else pushStatus(u);
    log('web', '🔨 กำลัง Build หน้าเว็บ (ประมาณ 10-30 วินาที) — เว็บเดิมยังใช้งานได้ระหว่างนี้');
    const ok = await runBuild(u, distNextDir());
    u.building = false;
    if (!u.wantRunning) {
      fs.rmSync(distNextDir(), { recursive: true, force: true });
      return setStatus(u, u.proc ? u.status : 'stopped');
    }
    if (!ok) {
      log('web', '[Build Error] Build หน้าเว็บไม่สำเร็จ ดูรายละเอียดด้านบน — เว็บเดิมยังใช้งานต่อ', 'error');
      fs.rmSync(distNextDir(), { recursive: true, force: true });
      if (u.proc) return pushStatus(u);
      if (!fs.existsSync(path.join(distDir(), 'index.html'))) {
        u.wantRunning = false;
        return setStatus(u, 'failed');
      }
      log('web', 'ใช้หน้าเว็บที่ build ไว้ครั้งก่อนแทน');
    } else {
      // หยุด preview เดิม -> สลับโฟลเดอร์ -> เปิดใหม่ (ดับแค่ช่วงนี้)
      if (u.proc) {
        const old = u.proc;
        u.proc = null;
        await new Promise((resolve) => {
          old.once('exit', resolve);
          killTree(old);
          setTimeout(resolve, 5000);
        });
      }
      try {
        swapDist();
      } catch (err) {
        log('web', `[Error] สลับไฟล์หน้าเว็บไม่ได้: ${err.message}`, 'error');
      }
    }
  }

  if (u.proc) return pushStatus(u);
  setStatus(u, 'starting');
  await freePort(u.def.port);
  if (!u.wantRunning) return setStatus(u, 'stopped');
  startPreview(u);
  log('web', `🚀 หน้าเว็บพร้อม: https://${getLocalIP()}:${u.def.port}`);
}

// ---------- คำสั่งรวม ----------
function launch(u, opts) {
  return u.def.id === 'web' ? launchWeb(u, { rebuild: false, ...opts }) : launchService(u);
}

async function startUnit(id, opts = {}) {
  const u = units.get(id);
  if (!u) return;
  u.wantRunning = true;
  u.crashes = [];
  clearTimeout(u.restartTimer);
  if (u.proc && id !== 'web') return pushStatus(u);
  await launch(u, { rebuild: true, ...opts });
}

function stopUnit(id) {
  const u = units.get(id);
  if (!u) return Promise.resolve();
  u.wantRunning = false;
  u.crashes = [];
  clearTimeout(u.restartTimer);
  if (u.buildProc) killTree(u.buildProc);
  const proc = u.proc;
  if (!proc) {
    setStatus(u, 'stopped');
    return freePort(u.def.port);
  }
  setStatus(u, 'stopping');
  return new Promise((resolve) => {
    proc.once('exit', () => resolve());
    killTree(proc);
    setTimeout(resolve, 5000);
  }).then(() => freePort(u.def.port));
}

async function restartUnit(id) {
  const u = units.get(id);
  if (!u) return;
  if (id === 'web' && u.proc) {
    // หน้าเว็บ: build ใหม่ขณะเว็บเดิมยังเปิด แล้วค่อยสลับ
    u.wantRunning = true;
    return launchWeb(u, { rebuild: true });
  }
  await stopUnit(id);
  await startUnit(id);
}

async function startAll() {
  for (const u of units.values()) {
    if (u.def.id === 'web') continue;
    await startUnit(u.def.id);
    await new Promise((r) => setTimeout(r, 400));
  }
  await startUnit('web', { rebuild: true });
}

async function stopAll() {
  await Promise.all([...units.keys()].map((id) => stopUnit(id)));
}

// ---------- เช็คสุขภาพ ----------
function checkHttp(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/internal/health', timeout: 2000 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
  });
}
function checkTcp(port) {
  return new Promise((resolve) => {
    const sock = net.connect({ host: '127.0.0.1', port, timeout: 2000 }, () => {
      sock.destroy();
      resolve(true);
    });
    sock.on('timeout', () => {
      sock.destroy();
      resolve(false);
    });
    sock.on('error', () => resolve(false));
  });
}
async function healthTick() {
  for (const u of units.values()) {
    if (!u.proc) {
      if (u.healthy) {
        u.healthy = false;
        pushStatus(u);
      }
      continue;
    }
    const ok = u.def.id === 'web' ? await checkTcp(u.def.port) : await checkHttp(u.def.port);
    const next = ok ? 'running' : u.status === 'running' ? 'unhealthy' : u.status;
    if (ok !== u.healthy || next !== u.status) {
      u.healthy = ok;
      setStatus(u, next);
    }
  }
}

// ---------- หน้าต่าง ----------
function createWindow() {
  win = new BrowserWindow({
    width: 900,
    height: 880,
    minWidth: 760,
    minHeight: 600,
    autoHideMenuBar: true,
    title: 'Automation Server Control Panel',
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  win.loadFile(path.join(__dirname, 'launcher.html')).catch((err) => console.error('Failed to load launcher.html:', err));
}

function initUnits() {
  let cfg;
  try {
    cfg = loadConfig();
  } catch (err) {
    log('launcher', `[Error] อ่าน services.json ไม่ได้: ${err.message}`, 'error');
    return [];
  }
  const defs = [...cfg.services, { ...cfg.web, id: 'web' }];
  for (const def of defs) {
    if (!units.has(def.id)) {
      units.set(def.id, { def, proc: null, status: 'stopped', wantRunning: false, crashes: [], healthy: false });
    }
  }
  return defs.map((d) => ({ id: d.id, name: d.name, port: d.port, host: d.host || '0.0.0.0' }));
}

ipcMain.on('launcher-ready', () => {
  const defs = initUnits();
  send('svc-config', { services: defs, localIp: getLocalIP(), projectRoot });
  units.forEach((u) => pushStatus(u));
});
ipcMain.on('svc-start', (e, id) => startUnit(id));
ipcMain.on('svc-stop', (e, id) => stopUnit(id));
ipcMain.on('svc-restart', (e, id) => restartUnit(id));
ipcMain.on('start-all', () => startAll());
ipcMain.on('stop-all', () => stopAll());
ipcMain.on('open-browser', () => {
  const web = units.get('web');
  shell.openExternal(`https://${getLocalIP()}:${web ? web.def.port : 5173}`);
});

app.whenReady().then(() => {
  createWindow();
  setInterval(healthTick, HEALTH_INTERVAL_MS);
});

let quitting = false;
app.on('before-quit', (e) => {
  if (quitting) return;
  quitting = true;
  e.preventDefault();
  stopAll().finally(() => app.exit(0));
});

app.on('window-all-closed', () => {
  app.quit();
});
