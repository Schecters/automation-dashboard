import { useState, useEffect, useCallback, useRef } from "react";
import { socket } from "../../socket";

// 📊 MES Output — ยอด OK / NG ที่ส่งจากหน้า /MES แยก Line / Station (แท็บใน Home)
//  - ยอดตั้งต้น: GET /api/mes/output-summary (นับจากไฟล์ CSV ของ service MES, เฉพาะที่ส่ง MES สำเร็จ)
//  - real time: /MES ส่งเสร็จ -> server ส่ง socket "mes_updated" -> บวกยอดทันที
//  - วันทำงาน / กะ: 07:40-19:40 = กะเช้า / 19:40-07:40 = กะดึก นับเป็นวันที่เริ่มกะ (เหมือน API)
//  - ไม่มียอดรวมข้าม station (ชิ้นเดียวกันยิงหลาย station = นับซ้ำ) ดูทีละ station เท่านั้น
const API_URL = "/api";
const RELOAD_MS = 5 * 60 * 1000; // โหลดใหม่ทั้งชุดกันคลาดเคลื่อน
const FLASH_MS = 1500;

const authHeaders = () => {
  const token = localStorage.getItem("token") || localStorage.getItem("sessionToken");
  return { Authorization: `Bearer ${token}` };
};

const bkk = (d = new Date()) => new Date(d.getTime() + 7 * 3600000).toISOString(); // อ่านแบบ UTC = เวลาไทย
const addDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
// วันทำงาน + กะ ของเวลานี้
const workShiftOf = (d = new Date()) => {
  const t = bkk(d);
  const date = t.slice(0, 10);
  const minutes = Number(t.slice(11, 13)) * 60 + Number(t.slice(14, 16));
  if (minutes >= 460 && minutes < 1180) return { date, shift: "day" };
  return { date: minutes < 460 ? addDays(date, -1) : date, shift: "night" };
};
const todayWork = () => workShiftOf().date;
const SHIFT_LABEL = { day: "เช้า", night: "ดึก" };
const EMPTY = { total: { ok: 0, ng: 0 }, lines: [], days: [], models: [] };

const pct = (ok, ng) => (ok + ng > 0 ? `${((ok / (ok + ng)) * 100).toFixed(1)}%` : "-");
const fmt = (n) => Number(n || 0).toLocaleString("en-US");

// บวกยอด 1 ชิ้นจาก socket เข้าในข้อมูลที่แสดงอยู่ (คืน object ใหม่)
const applyEvent = (data, ev, ws) => {
  const field = ev.result === "FAIL" ? "ng" : "ok";
  const inc = (o) => ({ ...o, [field]: o[field] + 1 });

  let lines = data.lines;
  let line = lines.find((l) => l.line === ev.line);
  if (!line) {
    line = { line: ev.line, ok: 0, ng: 0, stations: [] };
    lines = [...lines, line].sort((a, b) => a.line.localeCompare(b.line));
  }
  let stations = line.stations;
  if (!stations.some((s) => s.station === ev.station)) {
    stations = [...stations, { station: ev.station, group: ev.group || "", ok: 0, ng: 0 }].sort((a, b) => a.station.localeCompare(b.station));
  }
  stations = stations.map((s) => (s.station === ev.station ? inc(s) : s));
  lines = lines.map((l) => (l.line === ev.line ? { ...inc(l), stations } : l));

  const dayKey = (d) => `${d.date}|${d.shift}|${d.line}|${d.station}`;
  const evKey = `${ws.date}|${ws.shift}|${ev.line}|${ev.station}`;
  let days = data.days.some((d) => dayKey(d) === evKey)
    ? data.days.map((d) => (dayKey(d) === evKey ? inc(d) : d))
    : [...data.days, inc({ date: ws.date, shift: ws.shift, line: ev.line, station: ev.station, ok: 0, ng: 0 })];
  days = [...days].sort((a, b) => dayKey(a).localeCompare(dayKey(b)));

  const modelKey = (m) => `${m.line}|${m.station}|${m.model}|${m.mo}`;
  const evModel = `${ev.line}|${ev.station}|${ev.model || ""}|${ev.mo || ""}`;
  const models = data.models.some((m) => modelKey(m) === evModel)
    ? data.models.map((m) => (modelKey(m) === evModel ? inc(m) : m))
    : [...data.models, inc({ line: ev.line, station: ev.station, model: ev.model || "", mo: ev.mo || "", ok: 0, ng: 0 })];

  return { total: inc(data.total), lines, days, models };
};

export default function MesOutputContent({ isDarkMode = false }) {
  const [filters, setFilters] = useState(() => ({ from: todayWork(), to: todayWork(), line: "", shift: "" }));
  const [applied, setApplied] = useState(filters); // ตัวกรองของข้อมูลที่แสดงอยู่ (ใช้กรอง event real time)
  const [data, setData] = useState(EMPTY);
  const [view, setView] = useState("station"); // station | day | model
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [live, setLive] = useState(socket.connected);
  const [flash, setFlash] = useState({}); // "line|station" -> เวลาที่เพิ่ง +1
  const [lastEventAt, setLastEventAt] = useState(null);
  const appliedRef = useRef(applied);

  const load = useCallback(async (f) => {
    setLoading(true);
    setError("");
    const q = new URLSearchParams({ from: f.from, to: f.to });
    if (f.line.trim()) q.set("line", f.line.trim());
    if (f.shift) q.set("shift", f.shift);
    try {
      const res = await fetch(`${API_URL}/mes/output-summary?${q}`, { headers: authHeaders() });
      const json = await res.json().catch(() => ({}));
      if (!json.success) throw new Error(json.message || `HTTP ${res.status}`);
      appliedRef.current = f;
      setApplied(f);
      setData(json.data);
    } catch (err) {
      setError(`โหลดยอดไม่ได้: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  // โหลดครั้งแรก + โหลดใหม่ทุก 5 นาที
  useEffect(() => {
    const first = setTimeout(() => load(appliedRef.current), 0);
    const timer = setInterval(() => load(appliedRef.current), RELOAD_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [load]);

  // real time: /MES ส่ง MES เสร็จ -> บวกยอด / socket ต่อกลับ -> โหลดใหม่ทั้งชุด (กันพลาด event ระหว่างหลุด)
  useEffect(() => {
    const onUpdated = (ev) => {
      if (!ev?.success || !ev.line || !ev.station || !ev.at) return;
      const f = appliedRef.current;
      const ws = workShiftOf(new Date(ev.at));
      if (ws.date < f.from || ws.date > f.to) return;
      if (f.line.trim() && ev.line !== f.line.trim()) return;
      if (f.shift && ws.shift !== f.shift) return;
      setData((prev) => applyEvent(prev, ev, ws));
      setLastEventAt(ev.at);
      const key = `${ev.line}|${ev.station}`;
      setFlash((prev) => ({ ...prev, [key]: Date.now() }));
      setTimeout(() => setFlash((prev) => {
        const next = { ...prev };
        if (Date.now() - (next[key] || 0) >= FLASH_MS - 50) delete next[key];
        return next;
      }), FLASH_MS);
    };
    const onConnect = () => {
      setLive(true);
      load(appliedRef.current);
    };
    const onDisconnect = () => setLive(false);
    socket.on("mes_updated", onUpdated);
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    return () => {
      socket.off("mes_updated", onUpdated);
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
    };
  }, [load]);

  const quick = (kind) => {
    const today = todayWork();
    const from = kind === "7d" ? addDays(today, -6) : kind === "month" ? `${today.slice(0, 8)}01` : today;
    const next = { ...filters, from, to: today };
    setFilters(next);
    load(next);
  };

  const exportCsv = () => {
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    let head;
    let body;
    if (view === "day") {
      head = ["วันที่", "กะ", "Line", "Station", "OK", "NG", "รวม", "Yield"];
      body = data.days.map((d) => [d.date, SHIFT_LABEL[d.shift], d.line, d.station, d.ok, d.ng, d.ok + d.ng, pct(d.ok, d.ng)]);
    } else if (view === "model") {
      head = ["Line", "Station", "Model", "WO", "OK", "NG", "รวม", "Yield"];
      body = data.models.map((m) => [m.line, m.station, m.model, m.mo, m.ok, m.ng, m.ok + m.ng, pct(m.ok, m.ng)]);
    } else {
      head = ["Line", "Station", "OK", "NG", "รวม", "Yield"];
      body = data.lines.flatMap((l) => l.stations.map((s) => [l.line, s.station, s.ok, s.ng, s.ok + s.ng, pct(s.ok, s.ng)]));
    }
    const csv = "﻿" + [head, ...body].map((r) => r.map(esc).join(",")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = `mes_output_${view}_${applied.from}_${applied.to}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  // ---------- styles ----------
  const card = isDarkMode ? "bg-[#1E293B] border-slate-700/60" : "bg-white border-gray-200";
  const textMain = isDarkMode ? "text-slate-100" : "text-gray-800";
  const input = `px-3 py-2 rounded-xl border text-sm outline-none focus:border-blue-500 ${
    isDarkMode ? "bg-slate-900 border-slate-700 text-slate-100" : "bg-white border-gray-300 text-gray-800"
  }`;
  const lbl = "text-[11px] font-bold text-gray-400 mb-1";
  const th = `py-2 px-3 text-[11px] font-bold uppercase ${isDarkMode ? "text-slate-400" : "text-gray-500"}`;
  const td = "py-2 px-3 text-sm";
  const num = `${td} text-right tabular-nums font-bold`;
  const rowBorder = isDarkMode ? "border-slate-700/50" : "border-gray-100";
  const set = (k) => (e) => setFilters({ ...filters, [k]: e.target.value });
  const lineOptions = [...new Set([...data.lines.map((l) => l.line), applied.line].filter(Boolean))].sort();

  const yieldCls = (o, n) => (o + n === 0 ? "text-gray-400" : o / (o + n) >= 0.98 ? "text-emerald-500" : o / (o + n) >= 0.9 ? "text-amber-500" : "text-rose-500");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className={`text-2xl font-bold ${textMain}`}>MES Output</h2>
          <p className="text-xs text-gray-400 mt-1">
            ยอด OK / NG ที่ส่งจากหน้า /MES (เฉพาะที่ส่ง MES สำเร็จ) — กะเช้า 07:40-19:40 / กะดึก 19:40-07:40 นับเป็นวันที่เริ่มกะ
          </p>
        </div>
        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold ${live ? "bg-emerald-500/15 text-emerald-500" : "bg-rose-500/15 text-rose-500"}`}>
          <span className={`w-2 h-2 rounded-full ${live ? "bg-emerald-500 animate-pulse" : "bg-rose-500"}`} />
          {live ? "Live" : "ขาดการเชื่อมต่อ (ยอดไม่อัปเดตเอง)"}
          {lastEventAt && <span className="font-normal text-gray-400">· ล่าสุด {new Date(lastEventAt).toLocaleTimeString("th-TH", { timeZone: "Asia/Bangkok" })}</span>}
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          load(filters);
        }}
        className={`rounded-2xl border p-4 flex flex-wrap items-end gap-2 ${card}`}
      >
        <div><div className={lbl}>ตั้งแต่ (วันทำงาน)</div><input type="date" className={input} value={filters.from} onChange={set("from")} /></div>
        <div><div className={lbl}>ถึง</div><input type="date" className={input} value={filters.to} onChange={set("to")} /></div>
        <div>
          <div className={lbl}>Line</div>
          <input className={`${input} w-32`} list="mes-output-lines" value={filters.line} onChange={set("line")} placeholder="ทั้งหมด" />
          <datalist id="mes-output-lines">{lineOptions.map((l) => <option key={l} value={l} />)}</datalist>
        </div>
        <div>
          <div className={lbl}>กะ</div>
          <select className={input} value={filters.shift} onChange={set("shift")}>
            <option value="">ทั้งหมด</option>
            <option value="day">เช้า</option>
            <option value="night">ดึก</option>
          </select>
        </div>
        <button type="submit" className="px-4 py-2 rounded-xl text-sm font-bold bg-blue-600 hover:bg-blue-700 text-white" disabled={loading}>
          {loading ? "กำลังโหลด..." : "ค้นหา"}
        </button>
        {[["today", "วันนี้"], ["7d", "7 วัน"], ["month", "เดือนนี้"]].map(([k, t]) => (
          <button key={k} type="button" onClick={() => quick(k)}
            className={`px-3 py-2 rounded-xl text-sm font-bold border ${isDarkMode ? "border-slate-600 text-slate-300" : "border-gray-300 text-gray-600"}`}>
            {t}
          </button>
        ))}
        <button type="button" onClick={exportCsv}
          className={`ml-auto px-4 py-2 rounded-xl text-sm font-bold border ${isDarkMode ? "border-slate-600 text-slate-300" : "border-gray-300 text-gray-600"}`}>
          ดาวน์โหลด CSV
        </button>
      </form>

      {error && <div className="px-4 py-2 rounded-xl text-sm font-bold bg-rose-500/15 text-rose-500">{error}</div>}

      <div className={`rounded-2xl border ${card}`}>
        <div className={`flex gap-1 p-2 border-b ${rowBorder}`}>
          {[["station", "แยก Line / Station"], ["day", "แยกวัน / กะ"], ["model", "แยก Model / WO"]].map(([k, t]) => (
            <button key={k} type="button" onClick={() => setView(k)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold ${view === k ? "bg-blue-600 text-white" : isDarkMode ? "text-slate-400 hover:bg-slate-700/40" : "text-gray-500 hover:bg-gray-100"}`}>
              {t}
            </button>
          ))}
        </div>

        <div className="overflow-x-auto">
          {data.lines.length === 0 ? (
            <div className="py-10 text-center text-sm text-gray-400">{loading ? "กำลังโหลด..." : "ยังไม่มีงานที่ส่งจาก /MES ในช่วงนี้"}</div>
          ) : view === "station" ? (
            <table className="w-full">
              <thead>
                <tr className={`border-b text-left ${rowBorder}`}>
                  <th className={th}>Line</th><th className={th}>Station</th>
                  <th className={`${th} text-right`}>OK</th><th className={`${th} text-right`}>NG</th>
                  <th className={`${th} text-right`}>รวม</th><th className={`${th} text-right`}>Yield</th>
                </tr>
              </thead>
              <tbody>
                {data.lines.map((l) =>
                  l.stations.map((s, idx) => {
                    const flashing = flash[`${l.line}|${s.station}`];
                    return (
                      <tr key={`${l.line}|${s.station}`}
                        className={`transition-colors duration-700 ${idx === l.stations.length - 1 ? `border-b-2 ${isDarkMode ? "border-slate-600" : "border-gray-200"}` : `border-b ${rowBorder}`} ${flashing ? "bg-emerald-500/20" : ""}`}>
                        <td className={`${td} font-bold text-blue-500`}>{idx === 0 ? l.line : ""}</td>
                        <td className={`${td} ${textMain}`}>{s.station}</td>
                        <td className={`${num} text-emerald-500`}>{fmt(s.ok)}</td>
                        <td className={`${num} text-rose-500`}>{fmt(s.ng)}</td>
                        <td className={`${num} ${textMain}`}>{fmt(s.ok + s.ng)}</td>
                        <td className={`${num} ${yieldCls(s.ok, s.ng)}`}>{pct(s.ok, s.ng)}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          ) : view === "day" ? (
            <table className="w-full">
              <thead>
                <tr className={`border-b text-left ${rowBorder}`}>
                  <th className={th}>วันที่</th><th className={th}>กะ</th><th className={th}>Line</th><th className={th}>Station</th>
                  <th className={`${th} text-right`}>OK</th><th className={`${th} text-right`}>NG</th>
                  <th className={`${th} text-right`}>รวม</th><th className={`${th} text-right`}>Yield</th>
                </tr>
              </thead>
              <tbody>
                {data.days.map((d) => (
                  <tr key={`${d.date}|${d.shift}|${d.line}|${d.station}`} className={`border-b ${rowBorder}`}>
                    <td className={`${td} ${textMain}`}>{d.date}</td>
                    <td className={`${td} ${textMain}`}>{SHIFT_LABEL[d.shift]}</td>
                    <td className={`${td} font-bold text-blue-500`}>{d.line}</td>
                    <td className={`${td} ${textMain}`}>{d.station}</td>
                    <td className={`${num} text-emerald-500`}>{fmt(d.ok)}</td>
                    <td className={`${num} text-rose-500`}>{fmt(d.ng)}</td>
                    <td className={`${num} ${textMain}`}>{fmt(d.ok + d.ng)}</td>
                    <td className={`${num} ${yieldCls(d.ok, d.ng)}`}>{pct(d.ok, d.ng)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="w-full">
              <thead>
                <tr className={`border-b text-left ${rowBorder}`}>
                  <th className={th}>Line</th><th className={th}>Station</th><th className={th}>Model</th><th className={th}>WO</th>
                  <th className={`${th} text-right`}>OK</th><th className={`${th} text-right`}>NG</th>
                  <th className={`${th} text-right`}>รวม</th><th className={`${th} text-right`}>Yield</th>
                </tr>
              </thead>
              <tbody>
                {data.models.map((m) => (
                  <tr key={`${m.line}|${m.station}|${m.model}|${m.mo}`} className={`border-b ${rowBorder}`}>
                    <td className={`${td} font-bold text-blue-500`}>{m.line}</td>
                    <td className={`${td} ${textMain}`}>{m.station}</td>
                    <td className={`${td} ${textMain}`}>{m.model || "-"}</td>
                    <td className={`${td} font-mono ${textMain}`}>{m.mo || "-"}</td>
                    <td className={`${num} text-emerald-500`}>{fmt(m.ok)}</td>
                    <td className={`${num} text-rose-500`}>{fmt(m.ng)}</td>
                    <td className={`${num} ${textMain}`}>{fmt(m.ok + m.ng)}</td>
                    <td className={`${num} ${yieldCls(m.ok, m.ng)}`}>{pct(m.ok, m.ng)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      <p className="text-[11px] text-gray-400">
        ยอดของแต่ละ station แยกกัน (ชิ้นเดียวกันยิงหลาย station จึงไม่รวมยอดข้าม station) · นับจากประวัติการส่งของหน้า /MES เท่านั้น (โปรแกรมอื่นที่ยิง MES เองไม่รวม) · ยอดอัปเดตทันทีเมื่อมีการส่ง และโหลดใหม่ทุก 5 นาที
      </p>
    </div>
  );
}
