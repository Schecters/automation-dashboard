import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { socket, deviceId } from "../../socket";
import MesLogin from "../../pages/MesLogin";
import { operatorLogin } from "./mesApi";

// 🏭 MES Update: operator login ด้วยรหัสพนักงาน → เลือก WO ของแต่ละ station → Lock
// แล้วระบบอ่าน QR จากเครื่องสแกน Keyence (Modbus TCP) ทีละ station จากบนลงล่าง และยิง routing-update ไป MES
// การแก้ Line / Station / Modbus ทำได้เฉพาะ ME และ admin
const API_URL = "/api";
const MES_AUTH_KEY = "mesAuth";
const MES_LOCKED_KEY = "mesLockedStations";
const MES_TERMINAL_KEY = "mesTerminal"; // ชื่อเครื่องนี้ (แต่ละเครื่องมีชุด Line / Station ของตัวเอง)
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

const EMPTY_FORM = {
  id: null,
  label: "",
  line: "",
  section_name: "",
  group_name: "",
  station: "",
  modbus_host: "",
  modbus_port: 502,
  unit_id: 1,
  register_type: "holding",
  start_address: 0,
  word_count: 20,
  byte_order: "BE",
  clear_after_read: false,
};

export default function MesUpdate({ isDarkMode = false, embedded = false }) {
  const [mesAuth, setMesAuth] = useState(loadMesAuth);
  const [loginId, setLoginId] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);
  const [message, setMessage] = useState(null); // { type: 'ok'|'error', text }

  const [stations, setStations] = useState([]);
  const [lineInfo, setLineInfo] = useState([]);
  const [moByLine, setMoByLine] = useState({});
  const [logs, setLogs] = useState([]);
  const [locked, setLocked] = useState(() => new Set(loadJson(MES_LOCKED_KEY, [])));
  const [runtime, setRuntime] = useState({}); // id -> { sn, status, text, at }

  // ตั้งค่า (ME/admin)
  const [terminal, setTerminal] = useState(() => loadJson(MES_TERMINAL_KEY, ""));
  const [terminalInput, setTerminalInput] = useState(terminal);
  const [terminals, setTerminals] = useState([]);
  const [staff, setStaff] = useState(loadDashboardStaff);
  const [showSettings, setShowSettings] = useState(false);
  const [staffLogin, setStaffLogin] = useState({ employeeId: "", password: "" });
  const [form, setForm] = useState(null);
  const [testResult, setTestResult] = useState(null);
  const [saving, setSaving] = useState(false);

  const stationsRef = useRef([]);
  const lockedRef = useRef(locked);
  const mesAuthRef = useRef(mesAuth);
  // ให้ loop อ่านสแกน / callback เห็นค่าล่าสุด (effect นี้ประกาศก่อน effect อื่น จึงรันก่อน)
  useEffect(() => {
    stationsRef.current = stations;
    lockedRef.current = locked;
    mesAuthRef.current = mesAuth;
  }, [stations, locked, mesAuth]);

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

  // ---------- โหลดข้อมูล ----------
  const fetchStations = useCallback(async () => {
    if (!mesAuthRef.current && !staff) return;
    if (!terminal) {
      setStations([]);
      return;
    }
    try {
      const res = await fetch(`${API_URL}/mes/stations?terminal=${encodeURIComponent(terminal)}`, { headers: readHeaders() });
      if (mesAuthRef.current && (await handleOperator401(res))) return;
      const data = await res.json();
      if (data.success) {
        setStations(data.data);
        // station ที่ถูกลบไปแล้ว เอาออกจากรายการที่ Lock
        setLocked((prev) => {
          const ids = new Set(data.data.map((s) => s.id));
          const next = new Set([...prev].filter((id) => ids.has(id)));
          saveJson(MES_LOCKED_KEY, [...next]);
          return next;
        });
      }
    } catch (err) {
      console.error("Fetch MES stations error:", err);
    }
  }, [readHeaders, handleOperator401, staff, terminal]);

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

  const fetchTerminals = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/mes/terminals`, { headers: readHeaders() });
      const data = await res.json();
      if (data.success) setTerminals(data.data);
    } catch (err) {
      console.error("Fetch MES terminals error:", err);
    }
  }, [readHeaders]);

  // ตั้งชื่อเครื่องนี้ (เก็บในเครื่อง) — เปลี่ยนเครื่องแล้วปลด Lock ทั้งหมด
  const applyTerminal = () => {
    const name = terminalInput.trim().slice(0, 100);
    if (!name) {
      setMessage({ type: "error", text: "กรุณาตั้งชื่อเครื่อง" });
      return;
    }
    saveJson(MES_TERMINAL_KEY, name);
    setTerminal(name);
    setLocked(new Set());
    saveJson(MES_LOCKED_KEY, []);
    setLogs([]);
    setMessage({ type: "ok", text: `เครื่องนี้ใช้ชื่อ "${name}" แล้ว` });
  };

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
    fetchStations();
    fetchLogs();
  }, [canRead, fetchStations, fetchLogs]);

  // โหลด WO ของทุก Line ที่มี station
  const stationLines = useMemo(() => [...new Set(stations.map((s) => s.line))], [stations]);
  useEffect(() => {
    if (!canRead) return;
    stationLines.forEach((line) => {
      if (!moByLine[line]) fetchMoList(line);
    });
  }, [canRead, stationLines, moByLine, fetchMoList]);

  useEffect(() => {
    const onStations = () => fetchStations();
    const onUpdated = () => fetchLogs();
    socket.on("mes_stations_updated", onStations);
    socket.on("mes_updated", onUpdated);
    return () => {
      socket.off("mes_stations_updated", onStations);
      socket.off("mes_updated", onUpdated);
    };
  }, [fetchStations, fetchLogs]);

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

  // ---------- อ่านสแกน + update route (ทีละ station จากบนลงล่าง) ----------
  const setStationRuntime = (id, patch) =>
    setRuntime((prev) => ({ ...prev, [id]: { ...prev[id], ...patch, at: new Date().toISOString() } }));

  useEffect(() => {
    if (!mesAuth || locked.size === 0) return;
    let cancelled = false;
    let timer = null;
    const lastSeen = {};

    const tick = async () => {
      const targets = stationsRef.current.filter((s) => lockedRef.current.has(s.id));
      for (const st of targets) {
        if (cancelled) return;
        try {
          const res = await fetch(`${API_URL}/mes/stations/${st.id}/read`, { method: "POST", headers: operatorHeaders() });
          if (await handleOperator401(res)) return;
          const data = await res.json();
          if (!data.success) {
            setStationRuntime(st.id, { status: "error", text: data.message });
            continue;
          }
          const sn = data.sn;
          if (!sn || sn === lastSeen[st.id]) {
            setStationRuntime(st.id, { connected: true });
            continue;
          }
          lastSeen[st.id] = sn;
          setStationRuntime(st.id, { sn, status: "sending", text: "กำลังส่งไป MES...", connected: true });

          const upd = await fetch(`${API_URL}/mes/stations/${st.id}/update-route`, {
            method: "POST",
            headers: operatorHeaders(),
            body: JSON.stringify({ sn }),
          });
          if (await handleOperator401(upd)) return;
          const result = await upd.json();
          setStationRuntime(st.id, {
            sn,
            status: result.success ? (result.skipped ? "skipped" : "ok") : "error",
            text: result.success
              ? result.message || "Update สำเร็จ"
              : `${result.message || "Update ไม่สำเร็จ"}${result.mes_response ? ` — ${result.mes_response}` : ""}`,
          });
          // ส่งไม่สำเร็จ ให้ลองใหม่รอบหน้าได้
          if (!result.success) delete lastSeen[st.id];
        } catch (err) {
          setStationRuntime(st.id, { status: "error", text: err.message, connected: false });
        }
      }
      if (!cancelled) timer = setTimeout(tick, POLL_INTERVAL_MS);
    };
    tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [mesAuth, locked, operatorHeaders, handleOperator401]);

  // ---------- operator actions ----------
  const handleOperatorLogin = async (e) => {
    e.preventDefault();
    const id = loginId.trim();
    if (!id) return;
    setLoginBusy(true);
    setMessage(null);
    const { auth, error } = await operatorLogin(id);
    setLoginBusy(false);
    setLoginId("");
    if (error) {
      setMessage({ type: "error", text: error });
      return;
    }
    applyOperatorAuth(auth);
  };

  const applyOperatorAuth = (auth) => {
    saveJson(MES_AUTH_KEY, auth);
    setMesAuth(auth);
    setMessage(null);
  };

  const toggleLock = (st) => {
    if (!locked.has(st.id) && !st.mo) {
      setMessage({ type: "error", text: `กรุณาเลือก WO ของ ${st.label || st.station} ก่อน Lock` });
      return;
    }
    setLocked((prev) => {
      const next = new Set(prev);
      if (next.has(st.id)) next.delete(st.id);
      else next.add(st.id);
      saveJson(MES_LOCKED_KEY, [...next]);
      return next;
    });
  };

  const changeMo = async (st, mo) => {
    try {
      const res = await fetch(`${API_URL}/mes/stations/${st.id}/mo`, {
        method: "PATCH",
        headers: readHeaders(),
        body: JSON.stringify({ mo }),
      });
      if (mesAuthRef.current && (await handleOperator401(res))) return;
      const data = await res.json();
      if (!data.success) {
        setMessage({ type: "error", text: data.message });
        return;
      }
      setStations((prev) => prev.map((s) => (s.id === st.id ? data.data : s)));
    } catch (err) {
      setMessage({ type: "error", text: err.message });
    }
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
    setForm(null);
    setTestResult(null);
  };

  useEffect(() => {
    if (showSettings && staff && lineInfo.length === 0) fetchLineInfo();
  }, [showSettings, staff, lineInfo.length, fetchLineInfo]);

  useEffect(() => {
    if (showSettings && staff) fetchTerminals();
  }, [showSettings, staff, fetchTerminals]);

  const staffFetch = async (url, options) => {
    const res = await fetch(url, { ...options, headers: staffHeaders() });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      setStaff(null);
      throw new Error("Session ME/Admin หมดอายุ กรุณาเข้าสู่ระบบใหม่");
    }
    if (!data.success) throw new Error(data.message || `HTTP ${res.status}`);
    return data;
  };

  const lines = useMemo(() => [...new Set(lineInfo.map((r) => r.line))].sort(), [lineInfo]);
  const stationsOfFormLine = useMemo(
    () => lineInfo.filter((r) => r.line === form?.line).sort((a, b) => String(a.station).localeCompare(String(b.station))),
    [lineInfo, form?.line]
  );

  const saveForm = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await staffFetch(form.id ? `${API_URL}/mes/stations/${form.id}` : `${API_URL}/mes/stations`, {
        method: form.id ? "PUT" : "POST",
        body: JSON.stringify({ ...form, terminal }),
      });
      setForm(null);
      setTestResult(null);
      setMessage({ type: "ok", text: "บันทึก station แล้ว" });
      fetchStations();
    } catch (err) {
      setMessage({ type: "error", text: err.message });
    } finally {
      setSaving(false);
    }
  };

  const testModbus = async () => {
    setTestResult({ loading: true });
    try {
      const data = await staffFetch(`${API_URL}/mes/modbus/test`, { method: "POST", body: JSON.stringify(form) });
      setTestResult({ ok: true, text: data.value || "(ว่าง — ยังไม่มีค่าสแกน)", raw: data.raw });
    } catch (err) {
      setTestResult({ ok: false, text: err.message });
    }
  };

  const deleteStation = async (st) => {
    if (!window.confirm(`ลบ station "${st.label || st.station}" (${st.line}) ?`)) return;
    try {
      await staffFetch(`${API_URL}/mes/stations/${st.id}`, { method: "DELETE" });
      fetchStations();
    } catch (err) {
      setMessage({ type: "error", text: err.message });
    }
  };

  const moveStation = async (index, dir) => {
    const next = [...stations];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setStations(next);
    try {
      await staffFetch(`${API_URL}/mes/stations/order`, {
        method: "PUT",
        body: JSON.stringify({ ids: next.map((s) => s.id) }),
      });
    } catch (err) {
      setMessage({ type: "error", text: err.message });
      fetchStations();
    }
  };

  // ---------- styles ----------
  const card = isDarkMode ? "bg-[#1E293B] border-slate-700/60" : "bg-white border-gray-200";
  const input = `px-3 py-2 rounded-xl border text-xs outline-none focus:border-blue-500 disabled:opacity-50 ${
    isDarkMode ? "bg-slate-900 border-slate-700 text-slate-100" : "bg-white border-gray-300 text-gray-800"
  }`;
  const textMain = isDarkMode ? "text-slate-100" : "text-gray-800";
  const label = "text-[11px] font-bold text-gray-400 block mb-1";
  const btnPrimary = "px-4 py-2 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-40";
  const btnGhost = `px-3 py-2 rounded-xl text-xs font-bold border ${
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

  const statusPill = (rt) => {
    if (!rt?.status) return <span className="text-[11px] text-gray-400">รอสแกน</span>;
    const cls = {
      ok: "bg-emerald-600 text-white",
      skipped: "bg-slate-500 text-white",
      sending: "bg-amber-500 text-white",
      error: "bg-rose-600 text-white",
    }[rt.status];
    const txt = { ok: "สำเร็จ", skipped: "ซ้ำ", sending: "กำลังส่ง", error: "ผิดพลาด" }[rt.status];
    return <span className={`px-2 py-0.5 rounded-md text-[10px] font-black ${cls}`}>{txt}</span>;
  };

  // ---------- render: settings ----------
  const renderSettings = () => {
    if (!staff) {
      return (
        <form onSubmit={handleStaffLogin} className={`rounded-2xl border p-5 space-y-3 max-w-sm ${card}`}>
          <div className={`text-sm font-bold ${textMain}`}>เข้าสู่ระบบ ME / Admin</div>
          <p className="text-[11px] text-gray-400">
            การแก้ Line / Station / IP เครื่องสแกน ทำได้เฉพาะ ME หรือ Admin
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
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs text-gray-400">
            ตั้งค่าโดย <span className="font-bold text-blue-400">{staff.name || "-"}</span> ({staff.role.toUpperCase()})
          </div>
          <div className="flex gap-2">
            <button type="button" className={btnGhost} onClick={fetchLineInfo}>↻ โหลด Line จาก MES</button>
            <button type="button" className={btnPrimary} disabled={!terminal}
              onClick={() => { setForm({ ...EMPTY_FORM }); setTestResult(null); }}>
              + เพิ่ม station
            </button>
            <button type="button" className={btnGhost} onClick={() => { setShowSettings(false); setForm(null); }}>
              เสร็จ
            </button>
          </div>
        </div>

        <div className={`rounded-2xl border p-4 space-y-2 ${card}`}>
          <div className={`text-sm font-bold ${textMain}`}>
            ชื่อเครื่องนี้ {terminal ? <span className="text-blue-400">: {terminal}</span> : <span className="text-rose-500">(ยังไม่ได้ตั้ง)</span>}
          </div>
          <p className="text-[11px] text-gray-400">
            แต่ละเครื่องมีชุด Line / Station ของตัวเอง ตั้งชื่อเครื่องใหม่ หรือเลือกชื่อเดิมจากรายการ
            (เช่น เครื่องที่ล้างข้อมูลเบราว์เซอร์ไป จะได้ station เดิมกลับมา)
          </p>
          <div className="flex flex-wrap gap-2">
            <input className={`${input} w-64`} list="mes-terminal-list" placeholder="เช่น STF32-PC1"
              value={terminalInput} onChange={(e) => setTerminalInput(e.target.value)} />
            <datalist id="mes-terminal-list">
              {terminals.map((t) => (
                <option key={t.terminal} value={t.terminal}>{`${t.station_count} station · ${t.lines || "-"}`}</option>
              ))}
            </datalist>
            <button type="button" className={btnPrimary} onClick={applyTerminal}
              disabled={!terminalInput.trim() || terminalInput.trim() === terminal}>
              ใช้ชื่อนี้กับเครื่องนี้
            </button>
          </div>
        </div>

        {form && (
          <form onSubmit={saveForm} className={`rounded-2xl border p-4 space-y-3 ${card}`}>
            <div className={`text-sm font-bold ${textMain}`}>{form.id ? "แก้ไข station" : "เพิ่ม station"}</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label className={label}>ชื่อที่แสดง (ไม่บังคับ)</label>
                <input className={`${input} w-full`} value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
              </div>
              <div>
                <label className={label}>Line (MES)</label>
                <select className={`${input} w-full`} value={form.line} required
                  onChange={(e) => setForm({ ...form, line: e.target.value, station: "", section_name: "", group_name: "" })}>
                  <option value="">— เลือก Line —</option>
                  {form.line && !lines.includes(form.line) && <option value={form.line}>{form.line}</option>}
                  {lines.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className={label}>Station (MES)</label>
                <select className={`${input} w-full`} required
                  value={form.station ? `${form.section_name}|${form.group_name}|${form.station}` : ""}
                  onChange={(e) => {
                    const r = stationsOfFormLine.find((x) => `${x.section}|${x.group}|${x.station}` === e.target.value);
                    setForm({ ...form, station: r?.station || "", section_name: r?.section || "", group_name: r?.group || "" });
                  }}>
                  <option value="">— เลือก Station —</option>
                  {form.station && !stationsOfFormLine.some((x) => x.station === form.station) && (
                    <option value={`${form.section_name}|${form.group_name}|${form.station}`}>{form.station}</option>
                  )}
                  {stationsOfFormLine.map((r) => (
                    <option key={`${r.section}|${r.group}|${r.station}`} value={`${r.section}|${r.group}|${r.station}`}>
                      {r.station} · {r.section} / {r.group}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={label}>IP เครื่องสแกน (Modbus TCP)</label>
                <input className={`${input} w-full`} value={form.modbus_host} required placeholder="192.168.0.10"
                  onChange={(e) => setForm({ ...form, modbus_host: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={label}>Port</label>
                  <input type="number" className={`${input} w-full`} value={form.modbus_port}
                    onChange={(e) => setForm({ ...form, modbus_port: e.target.value })} />
                </div>
                <div>
                  <label className={label}>Unit ID</label>
                  <input type="number" className={`${input} w-full`} value={form.unit_id}
                    onChange={(e) => setForm({ ...form, unit_id: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={label}>Register</label>
                  <select className={`${input} w-full`} value={form.register_type}
                    onChange={(e) => setForm({ ...form, register_type: e.target.value })}>
                    <option value="holding">Holding (4x)</option>
                    <option value="input">Input (3x)</option>
                  </select>
                </div>
                <div>
                  <label className={label}>Address เริ่ม</label>
                  <input type="number" className={`${input} w-full`} value={form.start_address}
                    onChange={(e) => setForm({ ...form, start_address: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={label}>จำนวน word</label>
                  <input type="number" className={`${input} w-full`} value={form.word_count}
                    onChange={(e) => setForm({ ...form, word_count: e.target.value })} />
                </div>
                <div>
                  <label className={label}>ลำดับ byte</label>
                  <select className={`${input} w-full`} value={form.byte_order}
                    onChange={(e) => setForm({ ...form, byte_order: e.target.value })}>
                    <option value="BE">Hi-Lo (BE)</option>
                    <option value="LE">Lo-Hi (LE)</option>
                  </select>
                </div>
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs text-gray-400">
              <input type="checkbox" checked={form.clear_after_read}
                onChange={(e) => setForm({ ...form, clear_after_read: e.target.checked })} />
              อ่านแล้วล้าง register เป็น 0 (Holding เท่านั้น — กันอ่านค่าเดิมซ้ำ)
            </label>
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
              <button type="submit" className={btnPrimary} disabled={saving}>{saving ? "กำลังบันทึก..." : "บันทึก"}</button>
              <button type="button" className={btnGhost} onClick={testModbus} disabled={!form.modbus_host}>ทดสอบอ่าน Modbus</button>
              <button type="button" className={btnGhost} onClick={() => { setForm(null); setTestResult(null); }}>ยกเลิก</button>
            </div>
          </form>
        )}

        <div className={`rounded-2xl border divide-y ${card} ${isDarkMode ? "divide-slate-700/60" : "divide-gray-100"}`}>
          {stations.length === 0 && <div className="p-6 text-center text-xs text-gray-400">ยังไม่มี station</div>}
          {stations.map((st, i) => (
            <div key={st.id} className="p-3 flex flex-wrap items-center gap-3">
              <div className="flex flex-col">
                <button type="button" className="text-xs text-gray-400 hover:text-blue-500 disabled:opacity-20" disabled={i === 0}
                  onClick={() => moveStation(i, -1)}>▲</button>
                <button type="button" className="text-xs text-gray-400 hover:text-blue-500 disabled:opacity-20"
                  disabled={i === stations.length - 1} onClick={() => moveStation(i, 1)}>▼</button>
              </div>
              <div className="flex-1 min-w-0">
                <div className={`text-sm font-bold truncate ${textMain}`}>{st.label || st.station}</div>
                <div className="text-[11px] text-gray-400">
                  <span className="text-blue-400 font-semibold">{st.line}</span> · {st.station} · {st.section_name}/{st.group_name}
                </div>
                <div className="text-[11px] text-gray-400">
                  {st.modbus_host}:{st.modbus_port} · unit {st.unit_id} · {st.register_type} {st.start_address} × {st.word_count} · {st.byte_order}
                </div>
              </div>
              <button type="button" className={btnGhost} onClick={() => { setForm({ ...EMPTY_FORM, ...st }); setTestResult(null); }}>
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
    );
  };

  // ---------- render ----------
  const wrapper = embedded
    ? "space-y-5 pb-10"
    : `min-h-screen p-4 sm:p-6 space-y-5 ${isDarkMode ? "bg-[#0F172A]" : "bg-[#F4F6F8]"}`;

  const header = (
    <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
      <div>
        <h2 className={`text-2xl font-bold ${isDarkMode ? "text-white" : "text-gray-900"}`}>MES Update</h2>
        <p className={`text-xs mt-1 ${isDarkMode ? "text-slate-400" : "text-gray-500"}`}>
          สแกน QR จาก Keyence แล้ว update route ใน MES ตาม station ที่เลือก
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

  // เปิดเต็มจอที่ /MES -> หน้า login แบบเดียวกับ Login.jsx
  if (!mesAuth && !embedded) {
    return (
      <MesLogin
        onLoggedIn={applyOperatorAuth}
        onOpenSettings={openSettings}
        terminal={terminal}
        message={message?.type === "error" ? message.text : ""}
      />
    );
  }

  if (!mesAuth) {
    return (
      <div className={wrapper}>
        {header}
        <form onSubmit={handleOperatorLogin} className={`rounded-2xl border p-6 space-y-4 max-w-sm mx-auto mt-10 ${card}`}>
          <div className={`text-lg font-bold text-center ${textMain}`}>เข้าสู่ระบบ Operator</div>
          <p className="text-[11px] text-gray-400 text-center">กรอกหรือสแกนรหัสพนักงาน (ต้องเคยทำข้อสอบในระบบ)</p>
          <input
            className={`${input} w-full text-center text-base tracking-widest`}
            value={loginId}
            onChange={(e) => setLoginId(e.target.value)}
            placeholder="รหัสพนักงาน"
            autoFocus
            inputMode="numeric"
          />
          {messageBar}
          <button type="submit" className={`${btnPrimary} w-full py-3`} disabled={loginBusy || !loginId.trim()}>
            {loginBusy ? "กำลังตรวจสอบ..." : "เข้าสู่ระบบ"}
          </button>
          <p className="text-[10px] text-gray-400 text-center">ระบบจะออกจากระบบอัตโนมัติเวลา 07:40 และ 19:40</p>
        </form>
      </div>
    );
  }

  return (
    <div className={wrapper}>
      {header}
      {messageBar}

      {stations.length === 0 ? (
        <div className={`rounded-2xl border p-10 text-center text-xs text-gray-400 ${card}`}>
          {terminal
            ? `เครื่อง "${terminal}" ยังไม่มี station — ให้ ME / Admin กด "⚙ ตั้งค่า" เพื่อเพิ่ม`
            : `เครื่องนี้ยังไม่ได้ตั้งชื่อ — ให้ ME / Admin กด "⚙ ตั้งค่า" เพื่อตั้งชื่อเครื่องและเลือก Line / Station`}
        </div>
      ) : (
        <div className="space-y-3">
          {stations.map((st, i) => {
            const isLocked = locked.has(st.id);
            const rt = runtime[st.id];
            const mos = moByLine[st.line] || [];
            return (
              <div
                key={st.id}
                className={`rounded-2xl border p-4 flex flex-col lg:flex-row lg:items-center gap-3 ${card} ${
                  isLocked ? "ring-2 ring-emerald-500/60" : ""
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
                  <div className="flex items-center gap-2">
                    {isLocked ? statusPill(rt) : <span className="text-[11px] text-gray-400">ยังไม่ Lock</span>}
                    {rt?.sn && <span className={`text-xs font-mono font-bold truncate ${textMain}`}>{rt.sn}</span>}
                  </div>
                  {isLocked && rt?.text && (
                    <div className={`text-[11px] truncate ${rt.status === "error" ? "text-rose-500" : "text-gray-400"}`} title={rt.text}>
                      {rt.text}
                    </div>
                  )}
                </div>

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
              {logs.map((l) => (
                <tr key={l.id} className={`border-t ${isDarkMode ? "border-slate-700/60" : "border-gray-100"}`}>
                  <td className="px-4 py-2 whitespace-nowrap">{formatTime(l.created_at)}</td>
                  <td className="px-4 py-2 whitespace-nowrap">{l.line} / {l.station}</td>
                  <td className="px-4 py-2">{l.mo}</td>
                  <td className="px-4 py-2 font-mono">{l.sn}</td>
                  <td className="px-4 py-2 whitespace-nowrap">{l.emp_name || l.emp_no}</td>
                  <td className="px-4 py-2" title={l.mes_response || ""}>
                    {l.success
                      ? <span className="px-2 py-0.5 rounded-md text-[10px] font-black bg-emerald-600 text-white">OK</span>
                      : <span className="px-2 py-0.5 rounded-md text-[10px] font-black bg-rose-600 text-white">FAIL</span>}
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
