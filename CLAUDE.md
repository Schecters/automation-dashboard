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

- แก้ฝั่ง API → กด **Restart เฉพาะส่วนที่แก้** ใน launcher (ดูตาราง "backend แยกเป็นหลาย service" ด้านล่างว่าไฟล์ไหนอยู่ส่วนไหน)
  เช่น แก้ `routes/mes.js` → Restart "MES Update" อย่างเดียว / แก้ `src/api/lib/**` ที่ใช้ร่วมกัน → Restart ทุกส่วนที่ import ไฟล์นั้น (ไม่แน่ใจ = Stop ทั้งหมด → Start ทั้งหมด)
- แก้ `launcher-main.cjs` / `launcher.html` → ปิด launcher แล้วเปิดใหม่
  - เปิดแบบไม่ต้อง build: `npm run start:launcher`
  - ใช้ `.exe`: `npm run build:launcher:dir` → `release\win-unpacked\Automation Server Control.exe` (ใช้ Electron ใน node_modules ไม่ต้องโหลดจากเน็ต)
    (`npm run build:launcher` แบบ portable ต้องโหลด NSIS จาก GitHub — เน็ตบน server ตัด ECONNRESET ใช้ไม่ได้)
  - `.exe` ตัวเก่าที่ build ก่อนแยก service ห้ามใช้ (มี launcher เก่าฝังอยู่)
- แก้หน้าเว็บ (`src/components/**`, `src/pages/**` ฯลฯ) → กด **Restart ที่ "หน้าเว็บ (Vite)"** ใน launcher
  (build ใหม่ขณะเว็บเดิมยังเปิดอยู่ แล้วสลับ — ดับแค่ ~2 วินาที / build ไม่ผ่าน = เว็บเดิมใช้ต่อ) แล้วผู้ใช้กดรีเฟรชหน้าเว็บ
  ถ้าไม่ใช้ launcher: `npm run start:web`
- แก้ `services.json` (port / path) → Stop ทั้งหมด แล้วปิดเปิด launcher ใหม่ (ไม่ต้อง build .exe ใหม่)
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

## 🗂️ หน้าเว็บ ↔ API (แยกโฟลเดอร์ตามเรื่อง)

หน้าเว็บอยู่ที่ `src/components/<เรื่อง>/` ส่วน API อยู่ที่ `src/api/routes/` (ฟังก์ชันที่ใช้ร่วมกันอยู่ `src/api/lib/`)
เพิ่มหน้าใหม่ให้วางในโฟลเดอร์ของเรื่องนั้น ถ้าเป็นเรื่องใหม่ให้สร้างโฟลเดอร์ใหม่

| โฟลเดอร์หน้าเว็บ | หน้า | API (`src/api/routes/`) |
|---|---|---|
| `lines/` | LinesAndStation | `lines.js`, `stations.js` |
| `operators/` | OperatorContent, PhotoOperator | `operators.js`, `operatorData.js` (+ คะแนน Excel ใน `excelGraph.js`) |
| `layout/` | LayoutViewerContent, LayoutEditorContent | `layout.js`, `stationAssignments.js` |
| `tasks/` | TaskContent, RepairTaskContent, KnowledgeContent | `tasks.js` |
| `pm/` | DailyCheckList, PmChecklistBuilder | `pmChecklist.js` |
| `excel/` | ExcelSearchContent, AutoTriggerExcel | `excelConfigs.js`, `excelGraph.js` |
| `plc/` | StepCustom | `plc.js` |
| `users/` | UserManagementContent, AuditLogContent | `users.js`, `auth.js` |
| `mes/` | MesUpdate (+ `pages/MesLogin.jsx`) | `mes.js` + `lib/mesClient.js`, `lib/mesLog.js`, `lib/operatorExams.js` |
| `dashboard/` | OverallContent (ภาพรวม ดึงหลายเรื่อง), ApiDocContent (คู่มือ API) | หลายไฟล์ |
| `defects/` | DefectCodeContent (อาการงานเสีย), DefectHistoryContent (ประวัติงานเสีย) | `defects.js` |
| `common/` | NotificationBell, DarkModeToggle | `notifications.js` |

หน้าหลัก (`src/pages/Home.jsx`) เป็นตัวโหลดหน้าเหล่านี้ / `src/pages/Login.jsx` ใช้ `auth.js`

## 📌 ข้อมูลระบบที่ควรรู้

- **backend แยกเป็นหลาย service** (process แยกกัน ส่วนหนึ่งดับ / รีสตาร์ท ส่วนอื่นยังทำงาน) — ตารางกลางอยู่ที่ `services.json`
  entry แต่ละตัวที่ `src/api/services/<id>.js` (ใช้ `createServiceApp` / `listenService` ใน `src/api/lib/service.js`)

  | Port | id | ไฟล์ (`src/api/routes/`) | เปิดให้ |
  |---|---|---|---|
  | **5000** | data | `lines`, `stations`, `layout`, `stationAssignments`, `operators`, `operatorData`, `plc`, `staticFiles` + `initDatabase()` | ทั้ง LAN (.NET เรียก `/api/plc/sequence/*`, เว็บ OI เรียก `/api/operator-data`) |
  | 5001 | auth | `auth`, `users` | ภายในเครื่อง |
  | 5002 | realtime | socket.io (`lib/realtime.js`) | ภายในเครื่อง |
  | 5003 | graph | `excelGraph`, `excelConfigs` (Microsoft Graph token อยู่ที่นี่ตัวเดียว) | ภายในเครื่อง |
  | 5004 | mes | `mes` | ภายในเครื่อง |
  | 5005 | work | `tasks`, `pmChecklist`, `notifications` + `jobs/pdCallMeEscalation.js` | ภายในเครื่อง |

  - service ภายในเครื่อง bind `127.0.0.1` เข้าได้ผ่านหน้าเว็บ 5173 หรือผ่าน 5000 เท่านั้น
  - port 5000 **ส่งต่อ** path ของ service อื่นให้ (`forwardToOtherServices`) โปรแกรมเก่าที่เรียก `:5000/api/...` ตรงจึงยังใช้ได้ / ปลายทางปิด = 503
  - service คุยกันเอง: `serviceUrl('<id>')` (`lib/serviceMap.js`) เช่น อ่านคะแนน Excel → `serviceUrl('graph')/publics/excel-scores`
  - realtime: route ทุกตัวใช้ `io.emit(...)` / `io.to(room).emit(...)` จาก `lib/realtime.js` ได้เหมือนเดิม — ส่ง HTTP ไปที่ service realtime ให้ (`POST /internal/emit`, key คำนวณจาก `JWT_SECRET`)
    ห้องที่มี: `user:<employee_id>` (`userRoom()`), `device:<deviceId>` / เตะ session: `kickOtherSessions`, `logoutDevice` / ห้ามใช้ `deviceSessions` ตรง (อยู่ใน process realtime เท่านั้น)
  - เพิ่ม route ใหม่: ใส่ใน service ของเรื่องนั้น + ถ้า path ขึ้นต้นใหม่ ต้องเพิ่มใน `prefixes` ของ `services.json` (ไม่งั้นจะไปตกที่ data 5000)
  - launcher: Start / Stop / Restart ทีละส่วน, เช็ค `GET /internal/health` ทุก 5 วินาที, ดับเอง = เปิดใหม่ใน 3 วินาที (เกิน 5 ครั้งใน 2 นาที = หยุด สถานะแดง)
  - โหมดรวม (ฉุกเฉิน / ทดสอบ): `npm run api:single` = `node src/api/server.js` ทุกอย่างใน 5000 ตัวเดียว (ห้ามรันพร้อม launcher) + หน้าเว็บต้องรันด้วย `API_MODE=single`
  - เครื่อง dev: `npm run api:all` (เปิดทุก service) + `npm run dev` / เครื่อง dev ไม่มี Database (อยู่บน server) API ที่ใช้ DB จะตอบ 500 เป็นเรื่องปกติ
- หน้าเว็บ port **5173** (https) proxy แต่ละ path ไป service ตาม `services.json` (`vite.config.js` สร้าง `apiProxy` จากไฟล์นี้)
  - บน server: launcher รัน `vite build` แล้ว `vite preview` (โหมดใช้งานจริง ไม่มี source map)
  - บนเครื่อง dev: `npm run dev` ได้ตามปกติ (proxy ชุดเดียวกัน)
- อัปโหลดไฟล์รับเฉพาะรูป JPG/PNG/WEBP/GIF ไม่เกิน 20MB (`src/api/lib/uploads.js`), body JSON ไม่เกิน 20MB
- สิทธิ์ตรวจจาก role ใน DB เสมอ (`authenticateToken` ใน `src/api/middleware/auth.js`) ไม่เชื่อ role ใน JWT
- 1 บัญชี ใช้ได้ 1 session (`current_session_token`) login ที่ใหม่จะเตะเครื่องเก่าออก
- Daily PM Checklist: API `src/api/routes/pmChecklist.js`, ตาราง `automation_lines.pm_*` (สร้างอัตโนมัติใน `db.js`)
  - หน้า `DailyCheckList.jsx` (กรอก/ประวัติ/อนุมัติ) และ `PmChecklistBuilder.jsx` (สร้างแม่แบบ: admin, me)
  - ผู้อนุมัติ: ตำแหน่ง Line (owner/leader/supervisor จาก `line_owners`) หรือ role (me/ie/q/pd/admin), Admin อนุมัติแทนได้ทุกขั้น
- MES Update: เปิดที่ `https://10.204.206.1:5173/MES` เท่านั้น (ไม่มีเมนูใน dashboard) หน้า login `src/pages/MesLogin.jsx`,
  หน้าใช้งาน `src/components/mes/MesUpdate.jsx`, API `src/api/routes/mes.js` — **ไม่ใช้ Database เอง** (อาการ / ประวัติงานเสียอยู่ที่ service data เรียกผ่าน `internalFetch`)
  - operator login ด้วยรหัสพนักงาน ต้องเคยทำข้อสอบ (มีรหัสในไฟล์ Excel คะแนนสอบไฟล์ใดก็ได้ใน `auth.excel_configs`
    ฟังก์ชัน `findOperatorExams` ใน `src/api/lib/operatorExams.js`, เรียกตรงได้ที่ `/api/operator-exam-check?employee_id=`)
    ถ้าเครื่องนั้นตั้ง **เกณฑ์ความสามารถ** (`mesQualStations` = Line/Station จาก dashboard) operator ต้องผ่านข้อสอบบังคับ + คะแนนขั้นต่ำ
    ของ **ทุก** station ที่ตั้ง (`checkOperatorQualification` ใน `operatorExams.js`, เกณฑ์จาก `automation_lines.station_exams`) — ไม่ตั้ง = เช็คแบบเดิม
    ได้ token แยก (`kind: mes_operator`) หมดอายุ 07:40 / 19:40
  - เรียก MES ที่ `MES_API_BASE` (default `http://10.204.212.22:5207`) ผ่าน `src/api/lib/mesClient.js`
    ดู Line / Station / WO (lineinfo, molist) ใช้รหัสกลาง `MES_QUERY_EMP_NO` (default 86727533) / routing-update ใช้รหัส operator ที่ login
    ส่งแต่ละ station: POST /api/mes/tdc/routing-check (ต้อง OK) แล้วค่อย POST /api/mes/tdc/typed/routing-update (testData "")
    รูปแบบ routing-update: `SN}MO}MODEL}LINE}SECTION}GROUP}STATION}}PASS|FAIL}EMPNO}1` (`buildRoutingRow`) สแกนปกติส่ง PASS / ส่ง FAIL ได้ทางปุ่ม "งานเสีย" เท่านั้น (ด้านล่าง)
  - รับ QR จาก Keyence: **PC หน้าไลน์ต่อเครื่องสแกนเอง** ผ่านโปรแกรม MES Bridge (`tools/mes-bridge/mes-bridge.cjs`,
    เปิดด้วย `start-mes-bridge.bat`, ต้องมี Node.js ไม่ต้องลง package) ฟังที่ `http://127.0.0.1:18080` หน้าเว็บเรียกตรง
    (เครื่องสแกนอยู่ network ของ PC นั้น เช่น 192.168.1.x server เข้าไม่ถึง / เบราว์เซอร์ต่อ TCP เองไม่ได้)
    2 แบบ: TCP data port เช่น 9004 (Keyence SR) หรือ Modbus TCP — server ไม่ได้ต่อเครื่องสแกนแล้ว
    ถ้าเปลี่ยน URL เว็บ ต้องเพิ่มใน `MES_BRIDGE_ORIGINS` ของ Bridge
    สแกน 1 ครั้ง → ส่งให้ทุก station ที่ Lock ตามลำดับบนลงล่าง รอ `delay_sec` วินาทีระหว่าง station (ตั้งต่อเครื่อง, 0 = ทันที)
    station ไม่สำเร็จ → ส่ง station ถัดไปต่อ (`continue_on_error`, default เปิด / ปิด = หยุด)
  - การตั้งค่าของแต่ละเครื่อง เก็บในเบราว์เซอร์เครื่องนั้น: `mesTerminal` (ชื่อเครื่อง), `mesModbus`, `mesStations`, `mesQualStations` (เกณฑ์ความสามารถ),
    `mesSendOptions` (`{ delay_sec, continue_on_error }`)
    แก้ได้เฉพาะ ME, admin (หน้าตั้งค่าต้อง login) / ล้างข้อมูลเบราว์เซอร์ = ต้องตั้งค่าใหม่
  - ประวัติการส่ง: ไฟล์ CSV ที่ `MES_LOG_DIR` (default `D:\MES logs`) — `YYYY-MM-DD.csv` และ `login_YYYY-MM.csv` (`src/api/lib/mesLog.js`)
  - ยอด OK / NG ของกะปัจจุบัน (กะเช้า 07:40-19:40 / กะดึก 19:40-07:40) นับจากไฟล์ CSV เดียวกัน เฉพาะที่ส่งสำเร็จ
    (OK = PASS/INPUT, NG = FAIL) แสดงเป็นกล่องใหญ่ข้างปุ่ม Lock ของแต่ละ station: `GET /api/mes/shift-summary?terminal=` (`readShiftSummary`)
  - **งานเสีย**: ปุ่ม "✖ งานเสีย" ในแถว station ที่ Lock → popup สแกน SN (ผลสแกนจาก Modbus/TCP/ช่องพิมพ์เข้า popup แทนการส่งปกติ `routeScan`)
    + dropdown อาการ (`GET /api/mes/defect-codes?station=`) → ส่ง station ที่ Lock ก่อนหน้าให้ผ่าน (PASS / INPUT) ก่อน แล้วส่ง FAIL ที่ station นั้นแล้วหยุด
    (station ก่อนหน้าไม่ผ่าน ก็ส่งต่อจนถึง FAIL เสมอ ไม่ขึ้นกับตั้งค่า continue_on_error)
    `update-route` รับ `defect_id` → station แบบ routing: routing-check → routing-update `...}FAIL}...` + testData / station แบบ input: FAIL ส่งที่ **routing-input** (`MES_ROUTING_INPUT_PATH`, default `/api/mes/tdc/typed/routing-input`, ไม่ต้อง routing-check)
    JSON `{ sn, mo, model, line, section, group, station, errorCode: รหัสอาการ, result: "FAIL", employeeId, barcodePrefix, barcodeLength, ..., testData }` (`buildRoutingInputPayload`)
    testData `[SN/FAIL];[รหัสอาการ/อาการ];[รหัสพนักงาน]` (`buildDefectTestData`) + บันทึก `defect_logs` (หน้าเว็บส่ง `fail_via_input: true`)
  - **Defect Code / Defect History** (แท็บใน Home): `src/api/routes/defects.js` อยู่ใน service data (5000) ตาราง `automation_lines.defect_codes`
    (station_name = ชื่อ Station ของ MES, defect_code, description, is_active) และ `automation_lines.defect_logs` / แก้อาการได้: admin, me, q
    service อื่นเรียก `/internal/defect-codes`, `/internal/defect-logs` ด้วย `internalFetch` (`lib/internalKey.js` — เฉพาะ 127.0.0.1 + key จาก JWT_SECRET)
  - **WO เลือกครั้งเดียว ใช้ทุก station** (กล่องบนสุดของหน้า, เก็บใน `mesWo` = `{ line, mo, model }`) เปลี่ยนได้เมื่อปลด Lock ทุก station
    ทุก station ส่ง WO เดียวกัน — server เช็คว่า WO อยู่ใน Line ของ station นั้น (station ต่าง Line กัน = ส่งไม่ผ่าน)
    + Progress bar Output / Target จาก WMS (`GET /api/mes/wo-progress?mo=` โหลดใหม่ทุก 30 วินาที, ต้องตั้ง `WMS_API_USER` / `WMS_API_PASSWORD`)
  - ตาราง `automation_lines.mes_*` ที่เคยสร้างไว้รุ่นก่อน เลิกใช้แล้ว (ลบได้)
- **WMS** (ข้อมูล WO): `src/api/lib/wmsClient.js` login ที่ `WMS_AUTH_BASE` (default `http://10.204.212.28:15000/auth/login`)
  ด้วย `WMS_API_USER` / `WMS_API_PASSWORD` ใน `.env` แล้วเรียก `WMS_API_BASE` (default `http://10.204.212.28:5207`) เช่น `/workorder/<WO>/detail`
  - token จำในหน่วยความจำ ใกล้หมด (< 2 นาที) หรือได้ 401 → login ใหม่อัตโนมัติ (`wmsGet`) / ไม่ตั้งบัญชี = ตอบ 503
