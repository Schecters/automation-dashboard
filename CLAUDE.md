# CLAUDE.md — กติกาการทำงานในโปรเจกต์ Automation Dashboard

## ✅ แก้โค้ดเสร็จทุกครั้ง ต้อง commit + push ขึ้น GitHub

ระบบจริงรันอยู่บน server อีกเครื่อง (`10.204.206.1` ที่ `C:\Website\Automation 1.0.1`)
และ server ดึงโค้ดจาก GitHub ด้วย `git pull` ไม่ใช้วิธีก็อปไฟล์ทีละไฟล์อีกแล้ว
(เคยลืมก็อป `src/api/middleware/auth.js` จน server เปิดไม่ขึ้น)

**ก่อนเริ่มแก้ทุกครั้ง** ให้ `git pull` ก่อน เพราะอาจมีคนแก้บน server แล้ว push ขึ้นมา
(เครื่อง dev ถ้า `git` ไม่อยู่ใน PATH ให้ใช้ `& "$env:ProgramFiles\Git\cmd\git.exe"`)

ขั้นตอนหลังแก้เสร็จ:

1. ตรวจ syntax ไฟล์ที่แก้ (`node --check <ไฟล์>.js` สำหรับฝั่ง API, `npx eslint <ไฟล์>.jsx` สำหรับหน้าเว็บ)
2. `git status` แล้วดูให้แน่ใจว่า **ไม่มีไฟล์ลับ** ติดไปด้วย (ดูหัวข้อด้านล่าง)
3. `git add` เฉพาะไฟล์ที่เกี่ยวข้อง
4. `git commit` พร้อมข้อความที่บอกว่าแก้อะไร เพราะอะไร (ภาษาไทยได้)
5. `git push`
6. แจ้งผู้ใช้ว่า push แล้ว พร้อมบอกขั้นตอนอัปเดตบน server (ด้านล่าง)
   และถ้ามีอะไรที่ต้องทำเพิ่มบน server (เช่น ค่าใหม่ใน `.env`, `npm install`, รัน SQL) ต้องบอกให้ชัด

ถ้า push ไม่ได้ (ยังไม่มี remote, ไม่มีสิทธิ์, conflict) ให้แจ้งผู้ใช้ตรง ๆ ห้ามข้ามไปเงียบ ๆ

## 🔒 ห้ามขึ้น GitHub เด็ดขาด

- `.env` และ `.env.*` (มี `JWT_SECRET`, รหัสผ่าน DB, Azure ID)
- `*.bak` (ไฟล์สำรองเก่ามี secret เดิมอยู่)
- `uploads/`, `browser_profile/`, `release/`, `node_modules/`
- รหัสผ่าน / token / connection string ที่เขียนไว้ในโค้ด ถ้าเจอให้ย้ายไป `.env` ก่อน commit

ทั้งหมดนี้อยู่ใน `.gitignore` แล้ว แต่ต้องเช็ก `git status` ทุกครั้งก่อน commit

## 🖥️ อัปเดตบน server (บอกผู้ใช้ทุกครั้งหลัง push)

```powershell
cd "C:\Website\Automation 1.0.1"
git pull
```

จากนั้น restart:

- แก้ฝั่ง API (`src/api/**`) → กด Stop แล้ว Start ใน launcher หรือรัน `node .\src\api\server.js` ใหม่
- แก้ `launcher-main.cjs` / `launcher.html` → ปิด launcher แล้วเปิดใหม่ (ถ้าใช้ `.exe` ต้อง `npm run build:launcher` ใหม่)
- แก้หน้าเว็บ (`src/components/**`, `src/pages/**` ฯลฯ) → **ต้องกด Stop แล้ว Start ใน launcher** เพื่อ build ใหม่
  (server ใช้ `vite build` + `vite preview` ไม่ใช่ `vite dev` แล้ว จึงไม่โหลดไฟล์ใหม่เอง) แล้วผู้ใช้กดรีเฟรชหน้าเว็บ
  ถ้าไม่ใช้ launcher: `npm run start:web`
- มี package ใหม่ใน `package.json` → `npm install` ก่อน restart

## ✏️ ถ้าแก้โค้ดบน server โดยตรง → push กลับขึ้น GitHub

ตั้งชื่อผู้ commit ครั้งแรกครั้งเดียว:

```powershell
git config --global user.name "ชื่อของคุณ"
git config --global user.email "อีเมลของคุณ"
```

แก้เสร็จ วางทั้งก้อนนี้ใน PowerShell (จะถามว่าแก้อะไร แล้ว push ให้เลย):

```powershell
cd "C:\Website\Automation 1.0.1"
$msg = Read-Host "แก้อะไร (ข้อความ commit)"
git pull --rebase --autostash
git add -A
git status --short
git commit -m "[server] $msg"
git push
```

## 📌 ข้อมูลระบบที่ควรรู้

- API ทั้งหมดรวมอยู่ที่ port **5000** (`src/api/server.js`) — port 3000 (`excel.js`) เลิกใช้แล้ว
- หน้าเว็บ port **5173** (https) proxy `/api`, `/publics`, `/uploads`, `/socket.io` ไปที่ 5000
  - บน server: launcher รัน `vite build` แล้ว `vite preview` (โหมดใช้งานจริง ไม่มี source map)
  - บนเครื่อง dev: `npm run dev` ได้ตามปกติ (proxy ชุดเดียวกัน อยู่ใน `vite.config.js` ตัวแปร `apiProxy`)
- อัปโหลดไฟล์รับเฉพาะรูป JPG/PNG/WEBP/GIF ไม่เกิน 20MB (`src/api/lib/uploads.js`), body JSON ไม่เกิน 20MB
- สิทธิ์ตรวจจาก role ใน DB เสมอ (`authenticateToken` ใน `src/api/middleware/auth.js`) ไม่เชื่อ role ใน JWT
- 1 บัญชี ใช้ได้ 1 session (`current_session_token`) login ที่ใหม่จะเตะเครื่องเก่าออก
- Daily PM Checklist: API `src/api/routes/pmChecklist.js`, ตาราง `automation_lines.pm_*` (สร้างอัตโนมัติใน `db.js`)
  - หน้า `DailyCheckList.jsx` (กรอก/ประวัติ/อนุมัติ) และ `PmChecklistBuilder.jsx` (สร้างแม่แบบ: admin, me)
  - ผู้อนุมัติ: ตำแหน่ง Line (owner/leader/supervisor จาก `line_owners`) หรือ role (me/ie/q/pd/admin), Admin อนุมัติแทนได้ทุกขั้น
- MES Update: หน้า `src/components/mes/MesUpdate.jsx` (เมนู "MES Update" หรือเปิดเต็มจอที่ `https://10.204.206.1:5173/MES` (หน้า login `src/pages/MesLogin.jsx`)), API `src/api/routes/mes.js`
  - operator login ด้วยรหัสพนักงาน ต้องเคยทำข้อสอบ (มีรหัสในไฟล์ Excel คะแนนสอบไฟล์ใดก็ได้ใน `auth.excel_configs`
    ฟังก์ชัน `findOperatorExams` ใน `operatorData.js`, เรียกตรงได้ที่ `/api/operator-exam-check?employee_id=`)
    ได้ token แยก (`kind: mes_operator`) หมดอายุ 07:40 / 19:40
  - เรียก MES ที่ `MES_API_BASE` (default `http://10.204.212.22:5207`) ผ่าน `src/api/lib/mesClient.js`
    รูปแบบ routing-update: `SN}MO}MODEL}LINE}SECTION}GROUP}STATION}}PASS}EMPNO}1` (`buildRoutingRow`)
  - อ่าน QR จาก Keyence ผ่าน Modbus TCP (`src/api/lib/modbusReader.js`, package `modbus-serial`) ตั้งค่า IP/register ต่อ station
  - ตาราง `automation_lines.mes_stations`, `automation_lines.mes_update_logs` / แก้ station ได้เฉพาะ ME, admin
  - แต่ละเครื่องมีชุด station ของตัวเอง: คอลัมน์ `mes_stations.terminal` = ชื่อเครื่องที่เก็บใน localStorage `mesTerminal`
