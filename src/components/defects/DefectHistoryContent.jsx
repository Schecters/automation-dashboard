import { useState, useEffect, useCallback } from "react";

// 📋 Defect History — ประวัติการส่งงานเสียจากหน้า /MES (automation_lines.defect_logs, API: src/api/routes/defects.js)
const API_URL = "/api";

const authHeaders = () => {
  const token = localStorage.getItem("token") || localStorage.getItem("sessionToken");
  return { Authorization: `Bearer ${token}` };
};

// วันที่วันนี้ตามเวลาไทย YYYY-MM-DD
const todayBkk = () => new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
const fmtTime = (v) =>
  new Date(v).toLocaleString("th-TH", { timeZone: "Asia/Bangkok", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" });

export default function DefectHistoryContent({ isDarkMode = false }) {
  const [filters, setFilters] = useState(() => ({ from: todayBkk(), to: todayBkk(), line: "", station: "", mo: "", sn: "", onlySuccess: true }));
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (f) => {
    setLoading(true);
    setError("");
    const q = new URLSearchParams({ from: f.from, to: f.to, limit: "1000" });
    ["line", "station", "mo", "sn"].forEach((k) => f[k].trim() && q.set(k, f[k].trim()));
    if (f.onlySuccess) q.set("success", "1");
    try {
      const res = await fetch(`${API_URL}/defect-logs?${q}`, { headers: authHeaders() });
      const data = await res.json().catch(() => ({}));
      if (!data.success) throw new Error(data.message || `HTTP ${res.status}`);
      setRows(data.data);
      setSummary(data.summary);
    } catch (err) {
      setError(`โหลดประวัติไม่ได้: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  // โหลดครั้งแรก (วันนี้) หลังจากนั้นกดค้นหา
  useEffect(() => {
    const timer = setTimeout(() => load({ from: todayBkk(), to: todayBkk(), line: "", station: "", mo: "", sn: "", onlySuccess: true }), 0);
    return () => clearTimeout(timer);
  }, [load]);

  const exportCsv = () => {
    const head = ["เวลา", "Line", "Station", "WO", "Model", "SN", "รหัสอาการ", "อาการ", "รหัสพนักงาน", "ชื่อ", "เครื่อง", "ส่ง MES"];
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const body = rows.map((r) =>
      [fmtTime(r.created_at), r.line, r.station, r.mo, r.model, r.sn, r.defect_code, r.description, r.emp_no, r.emp_name, r.terminal, r.success ? "สำเร็จ" : "ไม่สำเร็จ"].map(esc).join(",")
    );
    const blob = new Blob(["﻿" + [head.map(esc).join(","), ...body].join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `defect_${filters.from}_${filters.to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // ---------- styles ----------
  const card = isDarkMode ? "bg-[#1E293B] border-slate-700/60" : "bg-white border-gray-200";
  const textMain = isDarkMode ? "text-slate-100" : "text-gray-800";
  const input = `px-3 py-2 rounded-xl border text-sm outline-none focus:border-blue-500 ${
    isDarkMode ? "bg-slate-900 border-slate-700 text-slate-100" : "bg-white border-gray-300 text-gray-800"
  }`;
  const lbl = "text-[11px] font-bold text-gray-400 mb-1";
  const total = summary.reduce((n, s) => n + s.qty, 0);
  const maxQty = summary[0]?.qty || 1;
  const set = (k) => (e) => setFilters({ ...filters, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });

  return (
    <div className="space-y-4">
      <div>
        <h2 className={`text-2xl font-bold ${textMain}`}>Defect History</h2>
        <p className="text-xs text-gray-400 mt-1">ประวัติงานเสียที่ส่งจากหน้า /MES (อาการจากแท็บ Defect Code)</p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          load(filters);
        }}
        className={`rounded-2xl border p-4 flex flex-wrap items-end gap-2 ${card}`}
      >
        <div><div className={lbl}>ตั้งแต่</div><input type="date" className={input} value={filters.from} onChange={set("from")} /></div>
        <div><div className={lbl}>ถึง</div><input type="date" className={input} value={filters.to} onChange={set("to")} /></div>
        <div><div className={lbl}>Line</div><input className={`${input} w-28`} value={filters.line} onChange={set("line")} /></div>
        <div><div className={lbl}>Station</div><input className={`${input} w-32`} value={filters.station} onChange={set("station")} /></div>
        <div><div className={lbl}>WO</div><input className={`${input} w-36`} value={filters.mo} onChange={set("mo")} /></div>
        <div><div className={lbl}>SN</div><input className={`${input} w-44`} value={filters.sn} onChange={set("sn")} /></div>
        <label className={`flex items-center gap-1 text-xs pb-2 ${textMain}`}>
          <input type="checkbox" checked={filters.onlySuccess} onChange={set("onlySuccess")} /> เฉพาะที่ส่ง MES สำเร็จ
        </label>
        <button type="submit" className="px-4 py-2 rounded-xl text-sm font-bold bg-blue-600 hover:bg-blue-700 text-white" disabled={loading}>
          {loading ? "กำลังโหลด..." : "ค้นหา"}
        </button>
        <button type="button" onClick={exportCsv} disabled={rows.length === 0}
          className={`px-4 py-2 rounded-xl text-sm font-bold border disabled:opacity-40 ${isDarkMode ? "border-slate-600 text-slate-300" : "border-gray-300 text-gray-600"}`}>
          ดาวน์โหลด CSV
        </button>
      </form>

      {error && <div className="px-4 py-2 rounded-xl text-sm font-bold bg-rose-500/15 text-rose-500">{error}</div>}

      <div className="grid grid-cols-1 xl:grid-cols-[380px_1fr] gap-4">
        <div className={`rounded-2xl border p-4 space-y-3 ${card}`}>
          <div className="flex items-baseline justify-between">
            <div className={`text-sm font-bold ${textMain}`}>สรุปตามอาการ</div>
            <div className="text-3xl font-black text-rose-500 tabular-nums">{total}<span className="text-xs text-gray-400 ml-1">ชิ้น</span></div>
          </div>
          {summary.map((s) => (
            <div key={`${s.station}|${s.defect_code}`} className="space-y-1">
              <div className="flex justify-between gap-2 text-xs">
                <span className={`truncate ${textMain}`}>
                  <span className="text-blue-400 font-semibold">{s.station}</span> · {s.description}
                  <span className="text-gray-400 font-mono"> ({s.defect_code})</span>
                </span>
                <span className={`font-black tabular-nums ${textMain}`}>{s.qty}</span>
              </div>
              <div className={`h-2 rounded-full ${isDarkMode ? "bg-slate-800" : "bg-gray-100"}`}>
                <div className="h-full rounded-full bg-rose-500" style={{ width: `${(s.qty / maxQty) * 100}%` }} />
              </div>
            </div>
          ))}
          {summary.length === 0 && <div className="text-xs text-gray-400">ไม่มีงานเสียในช่วงนี้</div>}
        </div>

        <div className={`rounded-2xl border overflow-x-auto ${card}`}>
          <table className="w-full text-xs">
            <thead className="text-gray-400 text-left">
              <tr>
                {["เวลา", "Line / Station", "WO", "SN", "อาการ", "พนักงาน", "ส่ง MES"].map((h) => <th key={h} className="px-3 py-2 whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={`border-t ${isDarkMode ? "border-slate-700/60" : "border-gray-100"} ${textMain}`}>
                  <td className="px-3 py-2 whitespace-nowrap">{fmtTime(r.created_at)}</td>
                  <td className="px-3 py-2 whitespace-nowrap"><span className="text-blue-400">{r.line}</span> · {r.station}</td>
                  <td className="px-3 py-2 font-mono">{r.mo}</td>
                  <td className="px-3 py-2 font-mono font-bold">{r.sn}</td>
                  <td className="px-3 py-2">{r.description} <span className="text-gray-400 font-mono">({r.defect_code})</span></td>
                  <td className="px-3 py-2 whitespace-nowrap">{r.emp_name || "-"} <span className="text-gray-400">{r.emp_no}</span></td>
                  <td className="px-3 py-2">
                    <span className={`font-bold ${r.success ? "text-emerald-500" : "text-rose-500"}`} title={r.mes_response}>
                      {r.success ? "สำเร็จ" : "ไม่สำเร็จ"}
                    </span>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-gray-400">{loading ? "กำลังโหลด..." : "ไม่มีข้อมูล"}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
