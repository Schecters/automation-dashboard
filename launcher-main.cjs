const { app, BrowserWindow, ipcMain, shell } = require('electron');
const { fork, exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

let win = null;
let server5000 = null;
let viteProcess = null;

// ดึง IPv4 Address ของเครื่องในวงแลนอัตโนมัติ
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

function getProjectRoot() {
  if (!app.isPackaged) {
    return __dirname;
  }
  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    return process.env.PORTABLE_EXECUTABLE_DIR;
  }
  const exeDir = path.dirname(app.getPath('exe'));
  if (fs.existsSync(path.join(exeDir, 'src', 'api'))) {
    return exeDir;
  }
  if (fs.existsSync(path.join(exeDir, '..', '..', 'src', 'api'))) {
    return path.resolve(exeDir, '..', '..');
  }
  return process.cwd();
}

function createWindow() {
  win = new BrowserWindow({
    width: 640,
    height: 560,
    resizable: false,
    autoHideMenuBar: true,
    title: "Automation Server Control Panel",
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  const htmlPath = path.join(__dirname, 'launcher.html');
  win.loadFile(htmlPath).catch((err) => {
    console.error("Failed to load launcher.html:", err);
  });
}

function safeSendLog(channel, message) {
  if (win && !win.isDestroyed() && win.webContents) {
    win.webContents.send(channel, message);
  }
}

function killPortsAsync(callback) {
  if (process.platform === 'win32') {
    const psCmd = `Get-NetTCPConnection -LocalPort 5000, 3000, 5173 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }`;
    exec(`powershell -NoProfile -Command "${psCmd}"`, () => {
      if (callback) callback();
    });
  } else {
    if (callback) callback();
  }
}

function stopServers(callback) {
  if (server5000) { server5000.kill('SIGTERM'); server5000 = null; }
  if (viteProcess) {
    if (process.platform === 'win32' && viteProcess.pid) {
      try { exec(`taskkill /pid ${viteProcess.pid} /f /t`); } catch (e) {}
    } else {
      viteProcess.kill('SIGTERM');
    }
    viteProcess = null;
  }

  killPortsAsync(() => {
    safeSendLog('server-log', '⏹ หยุดการทำงานและคืนค่า Port เรียบร้อย');
    if (callback) callback();
  });
}

function startServers() {
  safeSendLog('server-log', '⏳ กำลังตรวจสอบและเตรียมระบบ...');

  stopServers(() => {
    const projectRoot = getProjectRoot();
    const baseDir = path.resolve(projectRoot, 'src', 'api');
    const localIp = getLocalIP();

    const file5000 = path.join(baseDir, 'server.js');

    if (!fs.existsSync(file5000)) {
      safeSendLog('server-error', `[Error] ไม่พบไฟล์ Server ที่: ${baseDir}`);
      return;
    }

    try {
      // 1. Port 5000 (API ทั้งหมด รวม Microsoft Graph ที่เคยอยู่ Port 3000)
      server5000 = fork(file5000, [], { cwd: baseDir, silent: true });
      server5000.stdout.on('data', (d) => safeSendLog('server-log', `[5000] ${d.toString().trim()}`));
      server5000.stderr.on('data', (d) => safeSendLog('server-error', `[5000 Error] ${d.toString().trim()}`));

      // 2. Port 5173 (หน้าเว็บโหมดใช้งานจริง: build ก่อน แล้วค่อยเปิด preview)
      //    - ไม่ใช้ vite dev แล้ว (ช้า และเปิดให้เห็นซอร์สโค้ดทั้งหมด)
      //    - preview ใช้ https + proxy เดิม URL จึงยังเป็น https://<ip>:5173 เหมือนเดิม
      const viteBin = path.join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js');

      if (!fs.existsSync(viteBin)) {
        safeSendLog('server-error', `[Vite Error] ไม่พบ Vite ที่ ${viteBin} กรุณารัน npm install ในโฟลเดอร์โปรเจกต์ก่อน`);
        return;
      }

      const pipeViteLogs = (proc, label) => {
        proc.stdout.on('data', (d) => safeSendLog('server-log', `[${label}] ${d.toString().trim()}`));
        proc.stderr.on('data', (d) => safeSendLog('server-error', `[${label} Error] ${d.toString().trim()}`));
      };

      safeSendLog('server-log', '🔨 กำลัง Build หน้าเว็บ (ประมาณ 10-30 วินาที)...');
      const buildProcess = fork(viteBin, ['build'], { cwd: projectRoot, silent: true });
      viteProcess = buildProcess;
      pipeViteLogs(buildProcess, 'Build');

      buildProcess.on('exit', (code) => {
        // ถูกกด Stop ระหว่าง build -> ไม่ต้องเปิด preview ต่อ
        if (viteProcess !== buildProcess) return;

        if (code !== 0) {
          viteProcess = null;
          safeSendLog('server-error', `[Build Error] Build หน้าเว็บไม่สำเร็จ (exit code ${code}) ดูรายละเอียดด้านบน`);
          return;
        }

        viteProcess = fork(viteBin, ['preview', '--host', '0.0.0.0', '--port', '5173'], {
          cwd: projectRoot,
          silent: true
        });
        pipeViteLogs(viteProcess, 'Web');
        safeSendLog('server-log', `🚀 ระบบพร้อมทำงาน (Local IP: https://${localIp}:5173)`);
      });
    } catch (err) {
      safeSendLog('server-error', `[Exception] ${err.message}`);
    }
  });
}

ipcMain.on('start-servers', () => startServers());
ipcMain.on('stop-servers', () => stopServers());
ipcMain.on('open-browser', () => {
  const localIp = getLocalIP();
  shell.openExternal(`https://${localIp}:5173`);
});

app.whenReady().then(createWindow);

app.on('before-quit', () => {
  stopServers();
});

app.on('window-all-closed', () => {
  stopServers(() => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
});