import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { socket, deviceId } from "../../socket";
import MesLogin from "../../pages/MesLogin";

// 🏭 MES Update (เปิดที่ https://<server>:5173/MES)
//  - operator login ด้วยรหัสพนักงาน → เลือก WO ของแต่ละ station → Lock station ที่จะใช้
//  - เครื่องนี้ต่อ Modbus TCP กับเครื่องสแกน Keyence "ครั้งเดียว" (ตั้งค่าต่อเครื่อง)
//  - สแกน QR 1 ครั้ง → ส่ง routing-update ไปทุก station ที่ Lock ตามลำดับ บนลงล่าง (station 1 → 2 → ...)
//  - สแกนด้วย scanner ที่ต่อเครื่อง (พิมพ์ลงช่อง + Enter) ได้ด้วย
//  - การตั้งค่า (ชื่อเครื่อง / Modbus / station) ทำได้เฉพาะ ME และ admin — เก็บในเบราว์เซอร์ของเครื่องนี้ (ไม่ใช้ DB)
//  - ประวัติการส่ง server เขียนเป็นไฟล์ CSV ที่ D:\MES logs
const API_URL = "/api";
const MES_AUTH_KEY = "mesAuth";
const MES_LOCKED_KEY = "mesLockedStations";
const MES_TERMINAL_KEY = "mesTerminal"; // ชื่อเครื่องนี้ (ใช้ระบุในไฟล์ log)
const MES_STATIONS_KEY = "mesStations"; // station ของเครื่องนี้ เรียงบนลงล่าง
const MES_MODBUS_KEY = "mesModbus"; // การเชื่อมต่อเครื่องสแกน (null = ไม่ใช้ Modbus)
const POLL_INTERVAL_MS = 700;
const STAFF_ROLES = ["admin", "me"];

const loadJson = (key, fallback) => {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v ?? fallback;
  } catch {
    return fallback;
  }
};
const saveJson = (key, value) => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // localStorage ใช้ไม่ได้ ก็ทำงานต่อได้ (แค่ไม่จำค่า)
  }
};

const loadMesAuth = () => {
  const a = loadJson(MES_AUTH_KEY, null);
  if (!a?.token || !a?.expires_at || new Date(a.expires_at).getTime() <= Date.now()) return null;
  return a;
};

// token dashboard ในเครื่องนี้ ถ้าเป็น ME/admin ใช้ตั้งค่าได้เลย
const loadDashboardStaff = () => {
  const token = localStorage.getItem("token") || localStorage.getItem("sessionToken");
  const role = String(localStorage.getItem("userRole") || "").toLowerCase();
  if (!token || !STAFF_ROLES.includes(role)) return null;
  return { token, role, name: localStorage.getItem("userName") || "" };
};

const formatTime = (v) =>
  v
    ? new Date(v).toLocaleString("th-TH", {
        timeZone: "Asia/Bangkok",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : "-";

const EMPTY_STATION_FORM = { id: null, label: "", line: "", section_name: "", group_name: "", station: "" };
// การเชื่อมต่อเครื่องสแกน: mode "tcp" = Keyence ส่งผลอ่านมาทาง TCP data port, "modbus" = อ่าน register
// (ค่าที่บันทึกไว้รุ่นก่อนไม่มี mode = modbus)
const scannerMode = (cfg) => cfg?.mode || "modbus";
// เครื่องสแกนต่อกับ PC หน้าไลน์ (network แยก) -> PC เครื่องนี้ต่อเอง ผ่านโปรแกรม MES Bridge
// (tools/mes-bridge/start-mes-bridge.bat) เพราะเบราว์เซอร์ต่อ TCP / Modbus เองไม่ได้
const BRIDGE_URL = "http://127.0.0.1:18080";
const BRIDGE_MISSING = "ไม่พบโปรแกรม MES Bridge บนเครื่องนี้ — เปิด start-mes-bridge.bat ก่อน";

const bridgeRead = async (path, body) => {
  let res;
  try {
    res = await fetch(`${BRIDGE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(BRIDGE_MISSING);
  }
  const data = await res.json().catch(() => ({}));
  if (!data.success) throw new Error(data.message || `MES Bridge ตอบ HTTP ${res.status}`);
  return data;
};

// ปิด connection เครื่องสแกนที่ Bridge ทันที (Keyence รับ client ได้จำกัด ถ้าไม่ปิดเครื่องอื่นต่อไม่ได้)
// ใช้ keepalive ให้ส่งได้แม้กำลังปิดหน้า — ไม่สำเร็จก็ไม่เป็นไร Bridge ปิดเองเมื่อไม่มีใครใช้
const bridgeDisconnect = (cfg) => {
  const port = scannerMode(cfg) === "tcp" ? Number(cfg?.tcp_port) : Number(cfg?.modbus_port ?? 502);
  const body = JSON.stringify(cfg?.modbus_host ? { host: cfg.modbus_host, port } : {});
  try {
    fetch(`${BRIDGE_URL}/disconnect`, { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true })
      .catch(() => {});
  } catch {
    // Bridge ไม่ได้เปิดอยู่
  }
};

const SOURCE_LABEL = { TCP: "จาก Keyence (TCP)", Modbus: "จาก Modbus", Scanner: "จาก Scanner" };

const EMPTY_MODBUS_FORM = {
  mode: "tcp",
  tcp_port: 9004,
  modbus_host: "",
  modbus_port: 502,
  unit_id: 1,
  register_type: "holding",
  start_address: 0,
  word_count: 20,
  byte_order: "BE",
  clear_after_read: true,
};

export default function MesUpdate({ isDarkMode = false }) {
  const [mesAuth, setMesAuth] = useState(loadMesAuth);
  const [message, setMessage] = useState(null); // { type: 'ok'|'error', text }

  const [terminal, setTerminal] = useState(() => loadJson(MES_TERMINAL_KEY, ""));
  const [terminalInput, setTerminalInput] = useState(terminal);
  const [modbusCfg, setModbusCfg] = useState(() => loadJson(MES_MODBUS_KEY, null)); // null = ไม่ใช้ Modbus

  const [stations, setStationsState] = useState(() => loadJson(MES_STATIONS_KEY, []));
  const [lineInfo, setLineInfo] = useState([]);
  const [moByLine, setMoByLine] = useState({});
  const [logs, setLogs] = useState([]);
  const [locked, setLocked] = useState(() => new Set(loadJson(MES_LOCKED_KEY, [])));
  const [runtime, setRuntime] = useState({}); // stationId -> { sn, result, status, text }
  // station ที่กด FAIL ไว้: ชิ้นถัดไปส่ง PASS ให้ station ก่อนหน้า แล้วส่ง FAIL ที่ station นี้ และหยุด
  const [failArmed, setFailArmed] = useState(() => new Set());

  // QR ล่าสุด (จาก Modbus หรือ Scanner)
  const [scan, setScan] = useState(null); // { sn, source, at }
  const [modbusStatus, setModbusStatus] = useState(null); // { ok, text }
  const [manualInput, setManualInput] = useState("");
  const [sending, setSending] = useState(false);

  // ตั้งค่า (ME/admin)
  const [staff, setStaff] = useState(loadDashboardStaff);
  const [showSettings, setShowSettings] = useState(false);
  const [staffLogin, setStaffLogin] = useState({ employeeId: "", password: "" });
  const [stationForm, setStationForm] = useState(null);
  const [modbusForm, setModbusForm] = useState(EMPTY_MODBUS_FORM);
  const [testResult, setTestResult] = useState(null);
  const [saving, setSaving] = useState(false);

  const stationsRef = useRef([]);
  const lockedRef = useRef(locked);
  const failArmedRef = useRef(failArmed);
  const mesAuthRef = useRef(mesAuth);
  const sendingRef = useRef(false);
  const lastSeenRef = useRef(""); // SN ล่าสุดที่อ่านจาก Modbus ("" = register ว่าง / ถูกล้าง)
  const tcpAfterRef = useRef(null); // seq ล่าสุดที่รับจาก TCP data port แล้ว (null = เพิ่งเริ่ม)
  const manualRef = useRef(null);
  const terminalRef = useRef(terminal);
  const modbusCfgRef = useRef(modbusCfg);

  // ให้ loop อ่านสแกน / callback เห็นค่าล่าสุด (effect นี้ประกาศก่อน effect อื่น จึงรันก่อน)
  useEffect(() => {
    stationsRef.current = stations;
    lockedRef.current = locked;
    failArmedRef.current = failArmed;
    mesAuthRef.current = mesAuth;
    terminalRef.current = terminal;
    modbusCfgRef.current = modbusCfg;
  }, [stations, locked, failArmed, mesAuth, terminal, modbusCfg]);

  const operatorHeaders = useCallback(
    () => ({ "Content-Type": "application/json", Authorization: `Bearer ${mesAuthRef.current?.token || ""}` }),
    []
  );
  const staffHeaders = useCallback(
    () => ({ "Content-Type": "application/json", Authorization: `Bearer ${staff?.token || ""}`, "x-device-id": deviceId }),
    [staff]
  );
  // ข้อมูลอ่านอย่างเดียว ใช้ token operator ก่อน ถ้าไม่มีใช้ token ME/admin
  const readHeaders = useCallback(
    () => (mesAuthRef.current ? operatorHeaders() : staffHeaders()),
    [operatorHeaders, staffHeaders]
  );
  const canRead = Boolean(mesAuth || staff);

  const logoutOperator = useCallback((text) => {
    saveJson(MES_AUTH_KEY, null);
    setMesAuth(null);
    setLocked(new Set());
    saveJson(MES_LOCKED_KEY, []);
    setFailArmed(new Set());
    if (text) setMessage({ type: "error", text });
  }, []);

  const handleOperator401 = useCallback(
    async (res) => {
      if (res.status !== 401) return false;
      let text = "หมดเวลาการใช้งาน กรุณาเข้าสู่ระบบใหม่";
      try {
        text = (await res.json())?.message || text;
      } catch {
        // ใช้ข้อความ default
      }
      logoutOperator(text);
      return true;
    },
    [logoutOperator]
  );

  // ---------- station ในเครื่อง ----------
  const setStations = useCallback((updater) => {
    setStationsState((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      saveJson(MES_STATIONS_KEY, next);
      return next;
    });
  }, []);

  // ---------- โหลดข้อมูล ----------
  const fetchLogs = useCallback(async () => {
    if ((!mesAuthRef.current && !staff) || !terminal) return;
    try {
      const res = await fetch(`${API_URL}/mes/logs?limit=30&terminal=${encodeURIComponent(terminal)}`, { headers: readHeaders() });
      const data = await res.json();
      if (data.success) setLogs(data.data);
    } catch (err) {
      console.error("Fetch MES logs error:", err);
    }
  }, [readHeaders, staff, terminal]);

  const fetchLineInfo = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/mes/lineinfo`, { headers: readHeaders() });
      const data = await res.json();
      if (data.success) setLineInfo(data.data);
      else setMessage({ type: "error", text: data.message });
    } catch (err) {
      setMessage({ type: "error", text: `ดึง Line / Station จาก MES ไม่ได้: ${err.message}` });
    }
  }, [readHeaders]);

  const fetchMoList = useCallback(
    async (line) => {
      if (!line) return;
      try {
        const res = await fetch(`${API_URL}/mes/molist?line=${encodeURIComponent(line)}`, { headers: readHeaders() });
        const data = await res.json();
        if (data.success) setMoByLine((prev) => ({ ...prev, [line]: data.data }));
        else setMessage({ type: "error", text: data.message });
      } catch (err) {
        setMessage({ type: "error", text: `ดึง WO จาก MES ไม่ได้: ${err.message}` });
      }
    },
    [readHeaders]
  );

  useEffect(() => {
    if (!canRead) return;
    fetchLogs();
  }, [canRead, fetchLogs]);

  // โหลด WO ของทุก Line ที่มี station
  const stationLines = useMemo(() => [...new Set(stations.map((s) => s.line))], [stations]);
  useEffect(() => {
    if (!canRead) return;
    stationLines.forEach((line) => {
      if (!moByLine[line]) fetchMoList(line);
    });
  }, [canRead, stationLines, moByLine, fetchMoList]);

  useEffect(() => {
    const onUpdated = () => fetchLogs();
    socket.on("mes_updated", onUpdated);
    return () => socket.off("mes_updated", onUpdated);
  }, [fetchLogs]);

  // token operator หมดอายุตอนเปลี่ยนกะ (07:40 / 19:40) -> กลับหน้า login อัตโนมัติ
  useEffect(() => {
    if (!mesAuth) return;
    const ms = new Date(mesAuth.expires_at).getTime() - Date.now();
    const timer = setTimeout(
      () => logoutOperator("หมดเวลากะแล้ว (07:40 / 19:40) กรุณาเข้าสู่ระบบใหม่"),
      Math.max(0, Math.min(ms, 2 ** 31 - 1))
    );
    return () => clearTimeout(timer);
  }, [mesAuth, logoutOperator]);

  // ---------- ส่ง QR 1 ตัว ไปทุก station ที่ Lock ตามลำดับบนลงล่าง ----------
  const setStationRuntime = (id, patch) => setRuntime((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  const processScan = useCallback(
    async (rawSn, source) => {
      // Keyence ต่อท้ายผลอ่านด้วยข้อมูลอื่นหลังช่องว่าง (เช่น "... Y") -> SN = ส่วนแรกก่อนช่องว่าง
      const sn = String(rawSn || "").replace(/[}\r\n\t]/g, " ").trim().split(/\s+/)[0] || "";
      if (!sn || sendingRef.current) return false;
      const targets = stationsRef.current.filter((s) => lockedRef.current.has(s.id));
      if (targets.length === 0) {
        setMessage({ type: "error", text: "ยังไม่ได้ Lock station ใด — กด Lock station ที่จะส่งก่อน" });
        return false;
      }
      sendingRef.current = true;
      setSending(true);
      setScan({ sn, source, at: new Date().toISOString() });
      setRuntime((prev) => {
        const next = { ...prev };
        targets.forEach((st) => {
          next[st.id] = { sn, status: "waiting", text: "รอส่ง" };
        });
        return next;
      });

      let allOk = true;
      try {
        for (let i = 0; i < targets.length; i++) {
          const st = targets[i];
          const result = failArmedRef.current.has(st.id) ? "FAIL" : "PASS";
          setStationRuntime(st.id, { sn, result, status: "sending", text: `กำลังส่ง ${result}...` });
          const upd = await fetch(`${API_URL}/mes/update-route`, {
            method: "POST",
            headers: operatorHeaders(),
            body: JSON.stringify({
              terminal: terminalRef.current,
              sn,
              result,
              line: st.line,
              station: st.station,
              group: st.group_name,
              mo: st.mo,
            }),
          });
          if (await handleOperator401(upd)) return false;
          const out = await upd.json();
          setStationRuntime(st.id, {
            sn,
            result,
            status: out.success ? (out.skipped ? "skipped" : "ok") : "error",
            text: out.success
              ? out.message || "Update สำเร็จ"
              : `${out.message || "Update ไม่สำเร็จ"}${out.mes_response ? ` — ${out.mes_response}` : ""}`,
          });

          const rest = targets.slice(i + 1);
          if (!out.success) {
            // station นี้ไม่ผ่าน -> ไม่ส่ง station ถัดไป (MES ต้องผ่านตามลำดับ)
            allOk = false;
            rest.forEach((r) => setStationRuntime(r.id, { sn, status: "stopped", text: "ไม่ได้ส่ง (station ก่อนหน้าไม่สำเร็จ)" }));
            break;
          }
          if (result === "FAIL") {
            // ชิ้นงาน FAIL ที่ station นี้ -> ไม่ส่ง station ถัดไป และกลับเป็นโหมด PASS
            setFailArmed((prev) => {
              const next = new Set(prev);
              next.delete(st.id);
              return next;
            });
            rest.forEach((r) => setStationRuntime(r.id, { sn, status: "stopped", text: "ไม่ได้ส่ง (ชิ้นงาน FAIL ก่อนหน้า)" }));
            break;
          }
        }
      } catch (err) {
        allOk = false;
        setMessage({ type: "error", text: `ส่งไป MES ไม่สำเร็จ: ${err.message}` });
      } finally {
        sendingRef.current = false;
        setSending(false);
      }
      return allOk;
    },
    [operatorHeaders, handleOperator401]
  );

  // อ่านเครื่องสแกน (ครั้งเดียวต่อรอบ ไม่ใช่ต่อ station)
  const modbusReady = Boolean(modbusCfg?.modbus_host);
  const hasLocked = locked.size > 0;
  useEffect(() => {
    if (!mesAuth || !modbusReady || !hasLocked) return;
    let cancelled = false;
    let timer = null;
    tcpAfterRef.current = null; // เริ่มใหม่: ไม่ส่งค่าที่สแกนไว้ก่อน Lock

    // TCP data port: รับทุกครั้งที่สแกน (ชิ้นเดิมซ้ำก็นับ) ตามลำดับ
    const tickTcp = async () => {
      const cfg = modbusCfgRef.current;
      const data = await bridgeRead("/tcp/read", { host: cfg.modbus_host, port: Number(cfg.tcp_port), after: tcpAfterRef.current });
      if (cancelled) return false;
      setModbusStatus({ ok: !data.error, text: data.error || "เชื่อมต่อแล้ว" });
      if (tcpAfterRef.current === null) {
        tcpAfterRef.current = data.seq;
        return true;
      }
      for (const item of data.items) {
        if (cancelled) return false;
        tcpAfterRef.current = item.seq;
        await processScan(item.sn, "TCP");
      }
      if (data.items.length === 0 && data.seq < tcpAfterRef.current) tcpAfterRef.current = data.seq; // Bridge เริ่มนับใหม่
      return true;
    };

    const tick = async () => {
      try {
        if (!sendingRef.current && scannerMode(modbusCfgRef.current) === "tcp") {
          if (!(await tickTcp())) return;
        } else if (!sendingRef.current) {
          const data = await bridgeRead("/modbus/read", modbusCfgRef.current);
          if (cancelled) return;
          {
            setModbusStatus({ ok: true, text: "เชื่อมต่อแล้ว" });
            const sn = data.sn;
            if (!sn) {
              // register ว่าง (ถูกล้างหลังอ่าน) -> สแกนครั้งถัดไปนับเป็นชิ้นใหม่ แม้ SN เดิม
              lastSeenRef.current = "";
            } else if (sn !== lastSeenRef.current) {
              lastSeenRef.current = sn;
              await processScan(sn, "Modbus");
            }
          }
        }
      } catch (err) {
        if (!cancelled) setModbusStatus({ ok: false, text: err.message });
      }
      if (!cancelled) timer = setTimeout(tick, POLL_INTERVAL_MS);
    };
    tick();
    // ปิดหน้า / รีเฟรช ระหว่าง Lock -> ปล่อยเครื่องสแกนให้เครื่องอื่น
    const cfgAtStart = modbusCfgRef.current;
    const onPageHide = () => bridgeDisconnect(cfgAtStart);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      window.removeEventListener("pagehide", onPageHide);
      // Unlock ทั้งหมด / ออกจากระบบ / เปลี่ยนการตั้งค่า -> ปิด connection ทันที
      bridgeDisconnect(cfgAtStart);
    };
  }, [mesAuth, modbusReady, hasLocked, modbusCfg, processScan]);

  // ---------- operator actions ----------
  const applyOperatorAuth = (auth) => {
    saveJson(MES_AUTH_KEY, auth);
    setMesAuth(auth);
    setMessage(null);
  };

  const submitManual = async (e) => {
    e.preventDefault();
    if (sendingRef.current) {
      setMessage({ type: "error", text: "กำลังส่งชิ้นก่อนหน้าอยู่ รอสักครู่" });
      return;
    }
    const value = manualInput;
    setManualInput("");
    await processScan(value, "Scanner");
    manualRef.current?.focus();
  };

  const resendLast = () => {
    if (scan?.sn) processScan(scan.sn, scan.source);
  };

  const toggleFail = (st) => {
    setFailArmed((prev) => {
      const next = new Set(prev);
      if (next.has(st.id)) next.delete(st.id);
      else next.add(st.id);
      return next;
    });
  };

  const toggleLock = (st) => {
    if (!locked.has(st.id) && !st.mo) {
      setMessage({ type: "error", text: `กรุณาเลือก WO ของ ${st.label || st.station} ก่อน Lock` });
      return;
    }
    if (locked.has(st.id)) {
      setFailArmed((prev) => {
        const next = new Set(prev);
        next.delete(st.id);
        return next;
      });
    }
    setLocked((prev) => {
      const next = new Set(prev);
      if (next.has(st.id)) next.delete(st.id);
      else next.add(st.id);
      saveJson(MES_LOCKED_KEY, [...next]);
      return next;
    });
  };

  const changeMo = (st, mo) => {
    const found = (moByLine[st.line] || []).find((m) => String(m.mo) === mo);
    setStations((prev) =>
      prev.map((s) => (s.id === st.id ? { ...s, mo: mo || null, model_name: found?.model || null } : s))
    );
  };

  // ---------- staff (ME/admin) ----------
  const handleStaffLogin = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch(`${API_URL}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...staffLogin, deviceId }),
      });
      const data = await res.json();
      const role = String(data?.user?.role || "").toLowerCase();
      if (!res.ok || !data.token) {
        setMessage({ type: "error", text: data.message || "เข้าสู่ระบบไม่สำเร็จ" });
        return;
      }
      if (!STAFF_ROLES.includes(role)) {
        setMessage({ type: "error", text: "การตั้งค่าแก้ไขได้เฉพาะ ME หรือ Admin เท่านั้น" });
        return;
      }
      // ถ้าเป็นบัญชีเดียวกับที่ login dashboard ในเครื่องนี้ อัปเดต token ให้ด้วย (token เดิมใช้ไม่ได้แล้ว)
      if (localStorage.getItem("employeeId") === String(data.user.employee_id)) {
        localStorage.setItem("token", data.token);
        localStorage.setItem("sessionToken", data.token);
      }
      setStaff({ token: data.token, role, name: data.user.name || "" });
      setStaffLogin({ employeeId: "", password: "" });
      setMessage(null);
    } catch (err) {
      setMessage({ type: "error", text: err.message });
    }
  };

  const openSettings = () => {
    setShowSettings(true);
    setStationForm(null);
    setTestResult(null);
    setModbusForm(modbusCfg ? { ...EMPTY_MODBUS_FORM, ...modbusCfg } : EMPTY_MODBUS_FORM);
  };

  useEffect(() => {
    if (showSettings && staff && lineInfo.length === 0) fetchLineInfo();
  }, [showSettings, staff, lineInfo.length, fetchLineInfo]);

  // ตั้งชื่อเครื่องนี้ (ใช้ระบุในไฟล์ log)
  const applyTerminal = () => {
    const name = terminalInput.trim().slice(0, 100);
    if (!name) {
      setMessage({ type: "error", text: "กรุณาตั้งชื่อเครื่อง" });
      return;
    }
    saveJson(MES_TERMINAL_KEY, name);
    setTerminal(name);
    setLogs([]);
    setMessage({ type: "ok", text: `เครื่องนี้ใช้ชื่อ "${name}" แล้ว` });
  };

  const saveModbus = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      // ทดลองเชื่อมต่อก่อนบันทึก (ตรวจ IP / port / register ที่ server)
      await testScannerRequest(modbusForm);
      const cfg = { ...modbusForm };
      saveJson(MES_MODBUS_KEY, cfg);
      setModbusCfg(cfg);
      lastSeenRef.current = "";
      setMessage({ type: "ok", text: "บันทึกการเชื่อมต่อเครื่องสแกนของเครื่องนี้แล้ว" });
    } catch (err) {
      setMessage({ type: "error", text: `ยังไม่บันทึก — ${err.message}` });
    } finally {
      setSaving(false);
    }
  };

  const disableModbus = () => {
    if (!window.confirm("ไม่เชื่อมต่อเครื่องสแกนกับเครื่องนี้? (สแกนด้วย scanner ลงช่องในหน้าเว็บแทน)")) return;
    saveJson(MES_MODBUS_KEY, null);
    setModbusCfg(null);
    setModbusForm(EMPTY_MODBUS_FORM);
    setMessage({ type: "ok", text: "ปิดการเชื่อมต่อเครื่องสแกนของเครื่องนี้แล้ว" });
  };

  // TCP: after -1 = ขอค่าที่เคยได้รับทั้งหมด (ดูค่าล่าสุด) / Modbus: อ่าน register ตอนนี้
  // ทดสอบจาก PC เครื่องนี้ผ่าน MES Bridge (ทดสอบไม่ล้าง register)
  const testScannerRequest = (form) =>
    scannerMode(form) === "tcp"
      ? bridgeRead("/tcp/read", { host: form.modbus_host, port: Number(form.tcp_port), after: -1 })
      : bridgeRead("/modbus/read", { ...form, clear_after_read: false, close: true }); // ทดสอบเสร็จปิดทันที

  const testModbus = async () => {
    setTestResult({ loading: true });
    try {
      const data = await testScannerRequest(modbusForm);
      if (scannerMode(modbusForm) === "tcp" && !hasLocked) bridgeDisconnect(modbusForm); // ทดสอบเสร็จปล่อยเครื่องสแกน
      if (scannerMode(modbusForm) === "tcp") {
        const last = data.items?.[data.items.length - 1];
        setTestResult({
          ok: true,
          text: last
            ? `เชื่อมต่อได้ — ค่าล่าสุดที่สแกน: ${last.sn}`
            : "เชื่อมต่อได้ — ยังไม่มีการสแกน (ลองสแกน 1 ครั้งแล้วกดทดสอบอีกครั้ง)",
        });
      } else {
        setTestResult({ ok: true, text: data.sn || "(ว่าง — ยังไม่มีค่าสแกน)", raw: data.raw });
      }
    } catch (err) {
      setTestResult({ ok: false, text: err.message });
    }
  };

  const lines = useMemo(() => [...new Set(lineInfo.map((r) => r.line))].sort(), [lineInfo]);
  const formLine = stationForm?.line;
  const stationsOfFormLine = useMemo(
    () =>
      lineInfo
        .filter((r) => r.line === formLine)
        .sort((a, b) => String(a.station).localeCompare(String(b.station))),
    [lineInfo, formLine]
  );

  const saveStation = (e) => {
    e.preventDefault();
    const { id, label: name, line, section_name, group_name, station } = stationForm;
    const data = { label: name?.trim() || "", line, section_name, group_name, station };
    if (id) {
      // เปลี่ยน Line แล้ว WO เดิมใช้ไม่ได้
      setStations((prev) =>
        prev.map((s) => (s.id === id ? { ...s, ...data, ...(s.line !== line ? { mo: null, model_name: null } : {}) } : s))
      );
    } else {
      const newId = `st_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      setStations((prev) => [...prev, { id: newId, ...data, mo: null, model_name: null }]);
    }
    setStationForm(null);
    setMessage({ type: "ok", text: "บันทึก station แล้ว" });
  };

  const deleteStation = (st) => {
    if (!window.confirm(`ลบ station "${st.label || st.station}" (${st.line}) ?`)) return;
    setStations((prev) => prev.filter((s) => s.id !== st.id));
    setLocked((prev) => {
      const next = new Set(prev);
      next.delete(st.id);
      saveJson(MES_LOCKED_KEY, [...next]);
      return next;
    });
  };

  const moveStation = (index, dir) => {
    setStations((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const scannerAddr = modbusCfg
    ? scannerMode(modbusCfg) === "tcp"
      ? `TCP ${modbusCfg.modbus_host}:${modbusCfg.tcp_port}`
      : `Modbus ${modbusCfg.modbus_host}:${modbusCfg.modbus_port}`
    : "";

  // ---------- styles ----------
  const card = isDarkMode ? "bg-[#1E293B] border-slate-700/60" : "bg-white border-gray-200";
  const input = `px-3 py-2 rounded-xl border text-xs outline-none focus:border-blue-500 disabled:opacity-50 ${
    isDarkMode ? "bg-slate-900 border-slate-700 text-slate-100" : "bg-white border-gray-300 text-gray-800"
  }`;
  const textMain = isDarkMode ? "text-slate-100" : "text-gray-800";
  const label = "text-[11px] font-bold text-gray-400 block mb-1";
  const btnPrimary = "px-4 py-2 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-40";
  const btnGhost = `px-3 py-2 rounded-xl text-xs font-bold border disabled:opacity-40 ${
    isDarkMode ? "border-slate-600 text-slate-300 hover:bg-slate-700" : "border-gray-300 text-gray-600 hover:bg-gray-100"
  }`;

  const messageBar = message && (
    <div
      className={`p-3 rounded-xl border text-xs font-semibold flex items-center justify-between gap-2 ${
        message.type === "ok"
          ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-500"
          : "bg-rose-500/10 border-rose-500/30 text-rose-500"
      }`}
    >
      <span>{message.text}</span>
      <button type="button" onClick={() => setMessage(null)} className="opacity-60 hover:opacity-100">
        ✕
      </button>
    </div>
  );

  const resultBadge = (result) => (
    <span
      className={`px-2 py-0.5 rounded-md text-[10px] font-black border ${
        result === "FAIL" ? "border-rose-500 text-rose-500" : "border-emerald-500 text-emerald-500"
      }`}
    >
      {result}
    </span>
  );

  const statusPill = (rt) => {
    if (!rt?.status) return <span className="text-[11px] text-gray-400">รอสแกน</span>;
    const cls = {
      ok: "bg-emerald-600 text-white",
      skipped: "bg-slate-500 text-white",
      sending: "bg-amber-500 text-white",
      waiting: "bg-slate-400 text-white",
      stopped: "bg-slate-400 text-white",
      error: "bg-rose-600 text-white",
    }[rt.status];
    const txt = { ok: "สำเร็จ", skipped: "ซ้ำ", sending: "กำลังส่ง", waiting: "รอส่ง", stopped: "ไม่ได้ส่ง", error: "ผิดพลาด" }[
      rt.status
    ];
    return (
      <>
        {rt.result && rt.status !== "waiting" && rt.status !== "stopped" && resultBadge(rt.result)}
        <span className={`px-2 py-0.5 rounded-md text-[10px] font-black ${cls}`}>{txt}</span>
      </>
    );
  };

  // ---------- render: settings ----------
  const renderSettings = () => {
    if (!staff) {
      return (
        <form onSubmit={handleStaffLogin} className={`rounded-2xl border p-5 space-y-3 max-w-sm ${card}`}>
          <div className={`text-sm font-bold ${textMain}`}>เข้าสู่ระบบ ME / Admin</div>
          <p className="text-[11px] text-gray-400">
            การตั้งค่าชื่อเครื่อง / Modbus / station ทำได้เฉพาะ ME หรือ Admin
            (ถ้าบัญชีนี้เปิด dashboard ค้างไว้ที่เครื่องอื่น จะถูกออกจากระบบที่เครื่องนั้น)
          </p>
          <input className={`${input} w-full`} placeholder="รหัสพนักงาน" value={staffLogin.employeeId}
            onChange={(e) => setStaffLogin((p) => ({ ...p, employeeId: e.target.value }))} autoFocus />
          <input className={`${input} w-full`} type="password" placeholder="รหัสผ่าน" value={staffLogin.password}
            onChange={(e) => setStaffLogin((p) => ({ ...p, password: e.target.value }))} />
          <div className="flex gap-2">
            <button type="submit" className={btnPrimary}>เข้าสู่ระบบ</button>
            <button type="button" className={btnGhost} onClick={() => setShowSettings(false)}>ปิด</button>
          </div>
        </form>
      );
    }

    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs text-gray-400">
            ตั้งค่าโดย <span className="font-bold text-blue-400">{staff.name || "-"}</span> ({staff.role.toUpperCase()})
          </div>
          <button type="button" className={btnPrimary} onClick={() => { setShowSettings(false); setStationForm(null); }}>
            เสร็จ
          </button>
        </div>

        {/* 1) ชื่อเครื่อง */}
        <div className={`rounded-2xl border p-4 space-y-2 ${card}`}>
          <div className={`text-sm font-bold ${textMain}`}>
            1. ชื่อเครื่องนี้ {terminal ? <span className="text-blue-400">: {terminal}</span> : <span className="text-rose-500">(ยังไม่ได้ตั้ง)</span>}
          </div>
          <p className="text-[11px] text-gray-400">
            ใช้ระบุเครื่องในไฟล์ประวัติ (D:\MES logs) — การตั้งค่าทั้งหมดในหน้านี้เก็บในเบราว์เซอร์ของเครื่องนี้
            (ถ้าล้างข้อมูลเบราว์เซอร์ ต้องตั้งค่าใหม่)
          </p>
          <div className="flex flex-wrap gap-2">
            <input className={`${input} w-64`} placeholder="เช่น STF32-PC1"
              value={terminalInput} onChange={(e) => setTerminalInput(e.target.value)} />
            <button type="button" className={btnPrimary} onClick={applyTerminal}
              disabled={!terminalInput.trim() || terminalInput.trim() === terminal}>
              ใช้ชื่อนี้กับเครื่องนี้
            </button>
          </div>
        </div>

        {/* 2) Modbus ของเครื่อง (ตั้งครั้งเดียว) */}
        <form onSubmit={saveModbus} className={`rounded-2xl border p-4 space-y-3 ${card}`}>
          <div className={`text-sm font-bold ${textMain}`}>
            2. การเชื่อมต่อเครื่องสแกน Keyence ของเครื่องนี้{" "}
            {modbusCfg
              ? <span className="text-emerald-500">
                  — ใช้งานอยู่ {scannerMode(modbusCfg) === "tcp" ? `TCP ${modbusCfg.modbus_host}:${modbusCfg.tcp_port}` : `Modbus ${modbusCfg.modbus_host}:${modbusCfg.modbus_port}`}
                </span>
              : <span className="text-gray-400">— ยังไม่ได้ตั้ง (ใช้สแกนลงช่องในหน้าเว็บได้)</span>}
          </div>
          <p className="text-[11px] text-gray-400">
            ตั้งครั้งเดียว ใช้กับทุก station ของเครื่องนี้ — สแกน 1 ครั้งส่งให้ทุก station ที่ Lock ตามลำดับ
            <br />
            PC เครื่องนี้เป็นตัวต่อเครื่องสแกนเอง ต้องเปิดโปรแกรม <b>MES Bridge</b> (start-mes-bridge.bat) ค้างไว้
          </p>
          <div className="flex flex-wrap gap-2">
            {[
              ["tcp", "TCP data port (แนะนำ)"],
              ["modbus", "Modbus TCP"],
            ].map(([key, text]) => (
              <button key={key} type="button"
                onClick={() => { setModbusForm({ ...modbusForm, mode: key }); setTestResult(null); }}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${scannerMode(modbusForm) === key
                  ? "bg-blue-600 border-blue-600 text-white" : "border-gray-400/40 text-gray-400"}`}>
                {text}
              </button>
            ))}
          </div>
          {scannerMode(modbusForm) === "tcp" && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="col-span-2">
                <label className={label}>IP เครื่องสแกน</label>
                <input className={`${input} w-full`} value={modbusForm.modbus_host} required placeholder="192.168.0.10"
                  onChange={(e) => setModbusForm({ ...modbusForm, modbus_host: e.target.value })} />
              </div>
              <div>
                <label className={label}>Data port</label>
                <input type="number" className={`${input} w-full`} value={modbusForm.tcp_port ?? 9004}
                  onChange={(e) => setModbusForm({ ...modbusForm, tcp_port: e.target.value })} />
              </div>
              <p className="col-span-2 sm:col-span-4 text-[11px] text-gray-400">
                เครื่องสแกนส่งผลอ่านมาเองทุกครั้งที่สแกน (สแกนชิ้นเดิมซ้ำก็ส่ง) ไม่ต้องตั้ง register
              </p>
            </div>
          )}
          {scannerMode(modbusForm) === "modbus" && (<>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
            <div className="col-span-2">
              <label className={label}>IP เครื่องสแกน</label>
              <input className={`${input} w-full`} value={modbusForm.modbus_host} required placeholder="192.168.0.10"
                onChange={(e) => setModbusForm({ ...modbusForm, modbus_host: e.target.value })} />
            </div>
            <div>
              <label className={label}>Port</label>
              <input type="number" className={`${input} w-full`} value={modbusForm.modbus_port}
                onChange={(e) => setModbusForm({ ...modbusForm, modbus_port: e.target.value })} />
            </div>
            <div>
              <label className={label}>Unit ID</label>
              <input type="number" className={`${input} w-full`} value={modbusForm.unit_id}
                onChange={(e) => setModbusForm({ ...modbusForm, unit_id: e.target.value })} />
            </div>
            <div>
              <label className={label}>Register</label>
              <select className={`${input} w-full`} value={modbusForm.register_type}
                onChange={(e) => setModbusForm({ ...modbusForm, register_type: e.target.value })}>
                <option value="holding">Holding (4x)</option>
                <option value="input">Input (3x)</option>
              </select>
            </div>
            <div>
              <label className={label}>Address เริ่ม</label>
              <input type="number" className={`${input} w-full`} value={modbusForm.start_address}
                onChange={(e) => setModbusForm({ ...modbusForm, start_address: e.target.value })} />
            </div>
            <div>
              <label className={label}>จำนวน word</label>
              <input type="number" className={`${input} w-full`} value={modbusForm.word_count}
                onChange={(e) => setModbusForm({ ...modbusForm, word_count: e.target.value })} />
            </div>
            <div>
              <label className={label}>ลำดับ byte</label>
              <select className={`${input} w-full`} value={modbusForm.byte_order}
                onChange={(e) => setModbusForm({ ...modbusForm, byte_order: e.target.value })}>
                <option value="BE">Hi-Lo (BE)</option>
                <option value="LE">Lo-Hi (LE)</option>
              </select>
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs text-gray-400">
            <input type="checkbox" checked={modbusForm.clear_after_read}
              onChange={(e) => setModbusForm({ ...modbusForm, clear_after_read: e.target.checked })} />
            อ่านแล้วล้าง register เป็น 0 (Holding เท่านั้น — สแกนชิ้นเดิมซ้ำได้ เช่น ส่ง FAIL หลัง PASS)
          </label>
          </>)}
          {testResult && (
            <div className={`text-xs p-2 rounded-lg border ${testResult.loading ? "text-gray-400 border-gray-500/30"
              : testResult.ok ? "text-emerald-500 border-emerald-500/30" : "text-rose-500 border-rose-500/30"}`}>
              {testResult.loading ? "กำลังอ่าน..." : (
                <>
                  <div className="font-bold break-all">{testResult.text}</div>
                  {testResult.raw && <div className="text-[10px] opacity-70 break-all">raw: [{testResult.raw.join(", ")}]</div>}
                </>
              )}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="submit" className={btnPrimary} disabled={saving}>{saving ? "กำลังทดสอบ..." : "ทดสอบแล้วบันทึก"}</button>
            <button type="button" className={btnGhost} onClick={testModbus} disabled={!modbusForm.modbus_host}>ทดสอบเชื่อมต่อ</button>
            {modbusCfg && (
              <button type="button" className="px-3 py-2 rounded-xl text-xs font-bold border border-rose-500/40 text-rose-500 hover:bg-rose-500/10"
                onClick={disableModbus}>
                ไม่เชื่อมต่อเครื่องสแกน
              </button>
            )}
          </div>
        </form>

        {/* 3) Station (แค่ Line / Station) */}
        <div className={`rounded-2xl border ${card}`}>
          <div className="p-4 flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className={`text-sm font-bold ${textMain}`}>3. Station ของเครื่องนี้ (เรียงตามลำดับที่ส่ง บน → ล่าง)</div>
              <p className="text-[11px] text-gray-400">เลือกแค่ Line / Station จาก MES</p>
            </div>
            <div className="flex gap-2">
              <button type="button" className={btnGhost} onClick={fetchLineInfo}>↻ โหลด Line จาก MES</button>
              <button type="button" className={btnPrimary} onClick={() => setStationForm({ ...EMPTY_STATION_FORM })}>
                + เพิ่ม station
              </button>
            </div>
          </div>

          {stationForm && (
            <form onSubmit={saveStation} className={`mx-4 mb-4 rounded-xl border p-4 space-y-3 ${isDarkMode ? "border-slate-700" : "border-gray-200"}`}>
              <div className={`text-sm font-bold ${textMain}`}>{stationForm.id ? "แก้ไข station" : "เพิ่ม station"}</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div>
                  <label className={label}>Line (MES)</label>
                  <select className={`${input} w-full`} value={stationForm.line} required
                    onChange={(e) => setStationForm({ ...stationForm, line: e.target.value, station: "", section_name: "", group_name: "" })}>
                    <option value="">— เลือก Line —</option>
                    {stationForm.line && !lines.includes(stationForm.line) && <option value={stationForm.line}>{stationForm.line}</option>}
                    {lines.map((l) => <option key={l} value={l}>{l}</option>)}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className={label}>Station (MES)</label>
                  <select className={`${input} w-full`} required
                    value={stationForm.station ? `${stationForm.section_name}|${stationForm.group_name}|${stationForm.station}` : ""}
                    onChange={(e) => {
                      const r = stationsOfFormLine.find((x) => `${x.section}|${x.group}|${x.station}` === e.target.value);
                      setStationForm({ ...stationForm, station: r?.station || "", section_name: r?.section || "", group_name: r?.group || "" });
                    }}>
                    <option value="">— เลือก Station —</option>
                    {stationForm.station && !stationsOfFormLine.some((x) => x.station === stationForm.station) && (
                      <option value={`${stationForm.section_name}|${stationForm.group_name}|${stationForm.station}`}>{stationForm.station}</option>
                    )}
                    {stationsOfFormLine.map((r) => (
                      <option key={`${r.section}|${r.group}|${r.station}`} value={`${r.section}|${r.group}|${r.station}`}>
                        {r.station} · {r.section} / {r.group}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={label}>ชื่อเรียก (ไม่บังคับ)</label>
                  <input className={`${input} w-full`} value={stationForm.label || ""}
                    onChange={(e) => setStationForm({ ...stationForm, label: e.target.value })} />
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="submit" className={btnPrimary}>บันทึก</button>
                <button type="button" className={btnGhost} onClick={() => setStationForm(null)}>ยกเลิก</button>
              </div>
            </form>
          )}

          <div className={`divide-y border-t ${isDarkMode ? "divide-slate-700/60 border-slate-700/60" : "divide-gray-100 border-gray-100"}`}>
            {stations.length === 0 && <div className="p-6 text-center text-xs text-gray-400">ยังไม่มี station</div>}
            {stations.map((st, i) => (
              <div key={st.id} className="p-3 flex flex-wrap items-center gap-3">
                <div className="flex flex-col">
                  <button type="button" className="text-xs text-gray-400 hover:text-blue-500 disabled:opacity-20" disabled={i === 0}
                    onClick={() => moveStation(i, -1)}>▲</button>
                  <button type="button" className="text-xs text-gray-400 hover:text-blue-500 disabled:opacity-20"
                    disabled={i === stations.length - 1} onClick={() => moveStation(i, 1)}>▼</button>
                </div>
                <span className="w-6 h-6 shrink-0 rounded-full bg-blue-600 text-white text-[11px] font-black flex items-center justify-center">
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <div className={`text-sm font-bold truncate ${textMain}`}>{st.label || st.station}</div>
                  <div className="text-[11px] text-gray-400">
                    <span className="text-blue-400 font-semibold">{st.line}</span> · {st.station} · {st.section_name}/{st.group_name}
                  </div>
                </div>
                <button type="button" className={btnGhost} onClick={() => setStationForm({ ...EMPTY_STATION_FORM, ...st })}>
                  แก้ไข
                </button>
                <button type="button" className="px-3 py-2 rounded-xl text-xs font-bold border border-rose-500/40 text-rose-500 hover:bg-rose-500/10"
                  onClick={() => deleteStation(st)}>
                  ลบ
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  // ---------- render ----------
  const wrapper = `min-h-screen p-4 sm:p-6 space-y-5 ${isDarkMode ? "bg-[#0F172A]" : "bg-[#F4F6F8]"}`;

  const header = (
    <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
      <div>
        <h2 className={`text-2xl font-bold ${isDarkMode ? "text-white" : "text-gray-900"}`}>MES Update</h2>
        <p className={`text-xs mt-1 ${isDarkMode ? "text-slate-400" : "text-gray-500"}`}>
          สแกน QR 1 ครั้ง → ส่ง update route ไปทุก station ที่ Lock ตามลำดับบนลงล่าง
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className={`px-3 py-2 rounded-xl border text-xs ${card}`}>
          <span className="text-gray-400">เครื่อง </span>
          <span className={`font-bold ${terminal ? "text-blue-400" : "text-rose-500"}`}>{terminal || "ยังไม่ได้ตั้ง"}</span>
        </div>
        {mesAuth && (
          <div className={`px-3 py-2 rounded-xl border text-xs ${card}`}>
            <span className={`font-bold ${textMain}`}>{mesAuth.operator?.name || mesAuth.operator?.employee_id}</span>
            <span className="text-gray-400"> · #{mesAuth.operator?.employee_id} · หมดเวลา {formatTime(mesAuth.expires_at)}</span>
          </div>
        )}
        {!showSettings && (
          <button type="button" className={btnGhost} onClick={openSettings}>⚙ ตั้งค่า (ME/Admin)</button>
        )}
        {mesAuth && (
          <button type="button" className={btnGhost} onClick={() => logoutOperator()}>ออกจากระบบ</button>
        )}
      </div>
    </div>
  );

  if (showSettings) {
    return (
      <div className={wrapper}>
        {header}
        {messageBar}
        {renderSettings()}
      </div>
    );
  }

  if (!mesAuth) {
    return (
      <MesLogin
        onLoggedIn={applyOperatorAuth}
        onOpenSettings={openSettings}
        terminal={terminal}
        message={message?.type === "error" ? message.text : ""}
      />
    );
  }

  return (
    <div className={wrapper}>
      {header}
      {messageBar}

      {/* QR ที่อ่านได้ล่าสุด + ช่องสแกนด้วย scanner */}
      <div className={`rounded-2xl border p-4 space-y-3 ${card}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className={`text-sm font-bold ${textMain}`}>QR Code ที่อ่านได้</div>
          <div className="text-[11px]">
            {!modbusReady ? (
              <span className="text-gray-400">เครื่องสแกน: ไม่ได้เชื่อมต่อ (สแกนด้วย scanner ลงช่องด้านล่าง)</span>
            ) : !hasLocked ? (
              <span className="text-gray-400">เครื่องสแกน {scannerAddr} — รอ Lock station</span>
            ) : modbusStatus?.ok === false ? (
              <span className="text-rose-500 font-bold">เครื่องสแกน {scannerAddr}: {modbusStatus.text}</span>
            ) : (
              <span className="text-emerald-500 font-bold">● เครื่องสแกน {scannerAddr} พร้อมรับค่า</span>
            )}
          </div>
        </div>

        <div className={`flex flex-wrap items-center gap-3 p-3 rounded-xl ${isDarkMode ? "bg-slate-900" : "bg-gray-50"}`}>
          {scan ? (
            <>
              <span className={`px-2 py-0.5 rounded-md text-[10px] font-black ${scan.source === "Scanner" ? "bg-violet-600 text-white" : "bg-blue-600 text-white"}`}>
                {SOURCE_LABEL[scan.source] || scan.source}
              </span>
              <span className={`text-lg font-mono font-black break-all ${textMain}`}>{scan.sn}</span>
              <span className="text-[11px] text-gray-400">{formatTime(scan.at)}</span>
              <button type="button" className={`${btnGhost} ml-auto`} onClick={resendLast} disabled={sending}>
                ↻ ส่งอีกครั้ง
              </button>
            </>
          ) : (
            <span className="text-xs text-gray-400">ยังไม่มีการสแกน</span>
          )}
        </div>

        <form onSubmit={submitManual} className="flex gap-2">
          <input
            ref={manualRef}
            className={`${input} flex-1 text-sm font-mono`}
            placeholder="สแกนด้วย scanner หรือพิมพ์ QR แล้วกด Enter"
            value={manualInput}
            onChange={(e) => setManualInput(e.target.value)}
            disabled={!hasLocked}
          />
          <button type="submit" className={btnPrimary} disabled={!manualInput.trim() || sending || !hasLocked}>
            {sending ? "กำลังส่ง..." : "ส่ง"}
          </button>
        </form>
      </div>

      {stations.length === 0 ? (
        <div className={`rounded-2xl border p-10 text-center text-xs text-gray-400 ${card}`}>
          เครื่องนี้ยังไม่มี station — ให้ ME / Admin กด "⚙ ตั้งค่า" เพื่อเพิ่ม
        </div>
      ) : (
        <div className="space-y-3">
          {stations.map((st, i) => {
            const isLocked = locked.has(st.id);
            const isFail = isLocked && failArmed.has(st.id);
            const rt = runtime[st.id];
            const mos = moByLine[st.line] || [];
            return (
              <div
                key={st.id}
                className={`rounded-2xl border p-4 flex flex-col lg:flex-row lg:items-center gap-3 ${card} ${
                  isFail ? "ring-2 ring-rose-500" : isLocked ? "ring-2 ring-emerald-500/60" : ""
                }`}
              >
                <div className="flex items-center gap-3 lg:w-72 min-w-0">
                  <span className="w-7 h-7 shrink-0 rounded-full bg-blue-600 text-white text-xs font-black flex items-center justify-center">
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <div className={`text-sm font-bold truncate ${textMain}`}>{st.label || st.station}</div>
                    <div className="text-[11px] text-gray-400 truncate">
                      <span className="text-blue-400 font-semibold">{st.line}</span> · {st.station}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 lg:w-80">
                  <select
                    className={`${input} flex-1 min-w-0`}
                    value={st.mo || ""}
                    disabled={isLocked}
                    onChange={(e) => changeMo(st, e.target.value)}
                  >
                    <option value="">— เลือก WO —</option>
                    {st.mo && !mos.some((m) => String(m.mo) === st.mo) && (
                      <option value={st.mo}>{st.mo} {st.model_name ? `— ${st.model_name}` : ""}</option>
                    )}
                    {mos.map((m) => (
                      <option key={m.mo} value={m.mo}>{m.mo} — {m.model}</option>
                    ))}
                  </select>
                  <button type="button" title="โหลด WO ใหม่" className={btnGhost} disabled={isLocked}
                    onClick={() => fetchMoList(st.line)}>↻</button>
                </div>

                <div className="flex-1 min-w-0">
                  {isFail && (
                    <div className="text-xs font-black text-rose-500 mb-1">⚠ โหมด FAIL — ชิ้นถัดไปส่ง FAIL ที่ station นี้</div>
                  )}
                  <div className="flex items-center gap-2">
                    {isLocked ? statusPill(rt) : <span className="text-[11px] text-gray-400">ยังไม่ Lock (ไม่ส่ง)</span>}
                    {isLocked && rt?.sn && <span className={`text-xs font-mono font-bold truncate ${textMain}`}>{rt.sn}</span>}
                  </div>
                  {isLocked && rt?.text && (
                    <div className={`text-[11px] truncate ${rt.status === "error" ? "text-rose-500" : "text-gray-400"}`} title={rt.text}>
                      {rt.text}
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => toggleFail(st)}
                  disabled={!isLocked}
                  title={isLocked ? "ชิ้นถัดไปที่สแกนจะส่ง FAIL ที่ station นี้" : "ต้อง Lock ก่อน"}
                  className={`px-5 py-2.5 rounded-xl text-xs font-black shrink-0 disabled:opacity-30 disabled:cursor-not-allowed ${
                    isFail ? "bg-rose-600 hover:bg-rose-700 text-white" : "border border-rose-500/60 text-rose-500 hover:bg-rose-500/10"
                  }`}
                >
                  {isFail ? "✕ ยกเลิก FAIL" : "✖ FAIL"}
                </button>

                <button
                  type="button"
                  onClick={() => toggleLock(st)}
                  className={`px-5 py-2.5 rounded-xl text-xs font-black shrink-0 ${
                    isLocked ? "bg-emerald-600 hover:bg-emerald-700 text-white" : "bg-slate-500/15 text-gray-500 hover:bg-slate-500/25"
                  }`}
                >
                  {isLocked ? "🔒 Locked" : "🔓 Lock"}
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className={`rounded-2xl border ${card}`}>
        <div className={`px-4 py-3 text-sm font-bold ${textMain}`}>ประวัติล่าสุด</div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-gray-400 text-left">
              <tr>
                <th className="px-4 py-2">เวลา</th>
                <th className="px-4 py-2">Line / Station</th>
                <th className="px-4 py-2">WO</th>
                <th className="px-4 py-2">SN</th>
                <th className="px-4 py-2">ผู้สแกน</th>
                <th className="px-4 py-2">ผล</th>
              </tr>
            </thead>
            <tbody className={textMain}>
              {logs.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-400">ยังไม่มีประวัติ</td></tr>
              )}
              {logs.map((l, idx) => (
                <tr key={`${l.time}-${idx}`} className={`border-t ${isDarkMode ? "border-slate-700/60" : "border-gray-100"}`}>
                  <td className="px-4 py-2 whitespace-nowrap">{l.time}</td>
                  <td className="px-4 py-2 whitespace-nowrap">{l.line} / {l.station}</td>
                  <td className="px-4 py-2">{l.mo}</td>
                  <td className="px-4 py-2 font-mono">{l.sn}</td>
                  <td className="px-4 py-2 whitespace-nowrap">{l.emp_name || l.emp_no}</td>
                  <td className="px-4 py-2 whitespace-nowrap" title={l.mes_response || ""}>
                    <span className="inline-flex items-center gap-1">
                      {resultBadge(l.result || "PASS")}
                      {l.success
                        ? <span className="px-2 py-0.5 rounded-md text-[10px] font-black bg-emerald-600 text-white">ส่งแล้ว</span>
                        : <span className="px-2 py-0.5 rounded-md text-[10px] font-black bg-rose-600 text-white">ส่งไม่สำเร็จ</span>}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
