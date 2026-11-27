import { useEffect, useState } from "react";
import { chromaApi, todayBkk, addDays, workRange, SHIFT_LABEL, fmtTime, fmtRaw, downloadCsv, ui } from "./chromaApi";
import { ResultBadge } from "./ChromaTest";

// 📜 ประวัติ: สรุป PASS / FAIL, FAIL step บ่อยสุด (Pareto), ผลเทสราย SN, การแก้ parameter (ใคร / เมื่อไร / ค่าเดิม → ค่าใหม่)
const KIND_LABEL = {
  param: "แก้ค่า", memory_save: "บันทึก memory", memory_recall: "โหลด memory", step_delete: "ลบ step",
  sample_get: "SAMPLE GET", mode_change: "เปลี่ยนโหมด", plc_config: "ตั้งค่า PLC",
};

export default function ChromaHistory({ stationId, stations, isDarkMode, refreshKey, toast }) {
  const u = ui(isDarkMode);
  const [f, setF] = useState({ from: addDays(todayBkk(), -6), to: todayBkk(), shift: "", station: stationId || "", sn: "", result: "" });
  const [view, setView] = useState("summary");
  const [summary, setSummary] = useState(null);
  const [runs, setRuns] = useState(null);
  const [changes, setChanges] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);

  // อ่าน 3 ชุดพร้อมกัน (component นี้ใส่ key = เครื่อง → เปลี่ยนเครื่องแล้วเริ่มใหม่ด้วยตัวกรองเครื่องนั้น)
  const fetchAll = (q) => {
    const w = workRange(q.from, q.to);
    const base = `from=${encodeURIComponent(w.from)}&to=${encodeURIComponent(w.to)}${q.station ? `&station=${q.station}` : ""}`;
    return Promise.all([
      chromaApi(`/summary?${base}${q.shift ? `&shift=${q.shift}` : ""}`),
      chromaApi(`/runs?${base}${q.result ? `&result=${q.result}` : ""}${q.sn ? `&sn=${encodeURIComponent(q.sn)}` : ""}&limit=2000`),
      chromaApi(`/param-changes?${base}`),
    ])
      .then(([s, r, c]) => {
        setSummary(s);
        setRuns(r.runs || []);
        setChanges(c.changes || []);
      })
      .catch((e) => toast(e.message, true))
      .finally(() => setLoading(false));
  };

  const load = (q = f) => {
    setLoading(true);
    return fetchAll(q);
  };

  // โหลดครั้งแรก + เมื่อมีผลเทส / การแก้ใหม่ (refreshKey)
  useEffect(() => {
    fetchAll(f);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const openRun = async (id) => {
    try {
      setDetail(await chromaApi(`/runs/${id}`));
    } catch (e) {
      toast(e.message, true);
    }
  };

  const exportCsv = () => {
    const tag = `${f.from}_${f.to}`;
    if (view === "changes") {
      downloadCsv(`chroma_param_changes_${tag}.csv`, ["เวลา", "เครื่อง", "ผู้แก้", "ที่มา", "ชนิด", "memory", "step", "mode", "parameter", "ค่าเดิม", "ค่าใหม่"],
        (changes || []).map((c) => [fmtTime(c.at), c.station_name, c.employee_name || c.employee_id, c.source, KIND_LABEL[c.kind] || c.kind,
          c.memory_no ? `#${c.memory_no} ${c.memory_name || ""}` : "", c.step ?? "", c.mode, c.label || c.path, c.old_value, c.new_value]));
    } else {
      downloadCsv(`chroma_runs_${tag}.csv`, ["เวลาจบ", "เครื่อง", "SN", "memory", "ผล", "FAIL step", "fail code", "สาเหตุ", "ที่มา"],
        (runs || []).map((r) => [fmtTime(r.ended_at), r.station_name, r.sn, r.memory_no ? `#${r.memory_no} ${r.memory_name || ""}` : "", r.result,
          r.fail_step ?? "", r.fail_code ?? "", r.fail_text ?? "", r.source]));
    }
  };

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const maxFail = Math.max(1, ...(summary?.failSteps || []).map((x) => x.count));
  const t = summary?.total;

  return (
    <div className="space-y-4">
      <form onSubmit={(e) => { e.preventDefault(); load(); }} className={`rounded-2xl border p-4 flex flex-wrap items-end gap-2 ${u.card}`}>
        <div><div className={u.lbl}>ตั้งแต่ (วันทำงาน)</div><input type="date" className={u.input} value={f.from} onChange={set("from")} /></div>
        <div><div className={u.lbl}>ถึง</div><input type="date" className={u.input} value={f.to} onChange={set("to")} /></div>
        <div>
          <div className={u.lbl}>กะ</div>
          <select className={u.input} value={f.shift} onChange={set("shift")}><option value="">ทั้งหมด</option><option value="day">เช้า</option><option value="night">ดึก</option></select>
        </div>
        <div>
          <div className={u.lbl}>เครื่อง</div>
          <select className={u.input} value={f.station} onChange={set("station")}>
            <option value="">ทั้งหมด</option>
            {stations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div><div className={u.lbl}>SN</div><input className={`${u.input} w-36`} value={f.sn} onChange={set("sn")} /></div>
        <div>
          <div className={u.lbl}>ผล</div>
          <select className={u.input} value={f.result} onChange={set("result")}><option value="">ทั้งหมด</option><option>PASS</option><option>FAIL</option><option>ABORT</option></select>
        </div>
        <button type="submit" className={u.primary} disabled={loading}>{loading ? "กำลังโหลด..." : "ค้นหา"}</button>
        <button type="button" className={`${u.btn} ml-auto`} onClick={exportCsv}>ดาวน์โหลด CSV</button>
      </form>

      {t && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[["เทสทั้งหมด", t.total, u.text], ["PASS", t.pass, "text-emerald-500"], ["FAIL", t.fail, "text-rose-500"], ["ABORT / อื่น ๆ", t.abort, "text-violet-500"]].map(([l, v, c]) => (
            <div key={l} className={`rounded-2xl border p-4 ${u.card}`}>
              <div className="text-xs font-bold text-gray-400">{l}</div>
              <div className={`text-3xl font-black tabular-nums ${c}`}>{Number(v || 0).toLocaleString("en-US")}</div>
              {l === "PASS" && t.total > 0 && <div className="text-xs text-gray-400">{((t.pass / t.total) * 100).toFixed(1)}%</div>}
            </div>
          ))}
        </div>
      )}

      <div className={`rounded-2xl border ${u.card}`}>
        <div className={`flex gap-1 p-2 border-b ${u.row}`}>
          {[["summary", "สรุป / FAIL step"], ["runs", `ผลเทส${runs ? ` (${runs.length})` : ""}`], ["changes", `การแก้ parameter${changes ? ` (${changes.length})` : ""}`]].map(([k, l]) => (
            <button key={k} type="button" onClick={() => setView(k)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold ${view === k ? "bg-blue-600 text-white" : isDarkMode ? "text-slate-400 hover:bg-slate-700/40" : "text-gray-500 hover:bg-gray-100"}`}>
              {l}
            </button>
          ))}
        </div>

        {view === "summary" && summary && (
          <div className="grid gap-4 p-4 lg:grid-cols-2">
            <div>
              <div className="text-sm font-bold mb-2">FAIL บ่อยที่สุด (step)</div>
              {summary.failSteps.length === 0 && <div className="text-sm text-gray-400">ไม่มี FAIL ในช่วงนี้</div>}
              {summary.failSteps.slice(0, 15).map((x) => (
                <div key={`${x.memoryNo}-${x.step}`} className="mb-2">
                  <div className="flex justify-between text-sm">
                    <span>memory #{x.memoryNo ?? "?"} {x.memoryName || ""} · <b>step {x.step}</b></span>
                    <span className="font-bold tabular-nums">{x.count}</span>
                  </div>
                  <div className="h-2 rounded bg-gray-500/20"><div className="h-2 rounded bg-rose-500" style={{ width: `${(x.count / maxFail) * 100}%` }} /></div>
                  <div className="text-[11px] text-gray-400">
                    {Object.entries(x.codes).map(([code, v]) => `${code} ${v.text} ×${v.count}`).join(" · ")}
                  </div>
                </div>
              ))}
            </div>
            <div className="overflow-x-auto">
              <div className="text-sm font-bold mb-2">แยกวัน / กะ</div>
              <table className="w-full">
                <thead><tr>{["วันที่", "กะ", "รวม", "PASS", "FAIL", "ABORT", "Yield"].map((h) => <th key={h} className={u.th}>{h}</th>)}</tr></thead>
                <tbody>
                  {summary.days.map((d) => (
                    <tr key={`${d.date}${d.shift}`} className={`border-t ${u.row}`}>
                      <td className={u.td}>{d.date}</td>
                      <td className={u.td}>{SHIFT_LABEL[d.shift]}</td>
                      <td className={u.td}>{d.total}</td>
                      <td className={`${u.td} text-emerald-500`}>{d.pass}</td>
                      <td className={`${u.td} text-rose-500`}>{d.fail}</td>
                      <td className={u.td}>{d.abort}</td>
                      <td className={u.td}>{d.total ? `${((d.pass / d.total) * 100).toFixed(1)}%` : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="text-sm font-bold mt-4 mb-2">แยก memory</div>
              <table className="w-full">
                <thead><tr>{["memory", "รวม", "PASS", "FAIL", "ABORT"].map((h) => <th key={h} className={u.th}>{h}</th>)}</tr></thead>
                <tbody>
                  {summary.memories.map((m) => (
                    <tr key={String(m.memoryNo)} className={`border-t ${u.row}`}>
                      <td className={u.td}>#{m.memoryNo ?? "?"} {m.memoryName || ""}</td>
                      <td className={u.td}>{m.total}</td>
                      <td className={`${u.td} text-emerald-500`}>{m.pass}</td>
                      <td className={`${u.td} text-rose-500`}>{m.fail}</td>
                      <td className={u.td}>{m.abort}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {view === "runs" && runs && (
          <div className="overflow-x-auto max-h-[600px]">
            <table className="w-full">
              <thead><tr>{["เวลาจบ", "เครื่อง", "SN", "memory", "ผล", "FAIL step", "สาเหตุ", "ที่มา"].map((h) => <th key={h} className={u.th}>{h}</th>)}</tr></thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} className={`border-t cursor-pointer hover:bg-blue-500/5 ${u.row}`} onClick={() => openRun(r.id)}>
                    <td className={u.td}>{fmtTime(r.ended_at)}</td>
                    <td className={u.td}>{r.station_name}</td>
                    <td className={`${u.td} font-mono`}>{r.sn}</td>
                    <td className={u.td}>{r.memory_no ? `#${r.memory_no} ${r.memory_name || ""}` : ""}</td>
                    <td className={u.td}><ResultBadge r={r.result} /></td>
                    <td className={u.td}>{r.fail_step || ""}</td>
                    <td className={u.td}>{r.fail_text || ""} <span className="font-mono text-xs text-gray-400">{r.fail_code || ""}</span></td>
                    <td className={u.td}>{r.source}</td>
                  </tr>
                ))}
                {runs.length === 0 && <tr><td colSpan={8} className="py-8 text-center text-sm text-gray-400">ไม่มีผลเทสในช่วงนี้</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        {view === "changes" && changes && (
          <div className="overflow-x-auto max-h-[600px]">
            <table className="w-full">
              <thead><tr>{["เวลา", "เครื่อง", "ผู้แก้", "ชนิด", "memory", "step", "parameter", "ค่าเดิม", "ค่าใหม่"].map((h) => <th key={h} className={u.th}>{h}</th>)}</tr></thead>
              <tbody>
                {changes.map((c) => (
                  <tr key={c.id} className={`border-t ${u.row}`}>
                    <td className={u.td}>{fmtTime(c.at)}</td>
                    <td className={u.td}>{c.station_name}</td>
                    <td className={u.td}>{c.employee_name || c.employee_id || (c.source === "LOCAL" ? "หน้าเครื่อง" : "")}</td>
                    <td className={u.td}>{KIND_LABEL[c.kind] || c.kind}</td>
                    <td className={u.td}>{c.memory_no ? `#${c.memory_no} ${c.memory_name || ""}` : ""}</td>
                    <td className={u.td}>{c.step ?? ""} {c.mode || ""}</td>
                    <td className={u.td}>{c.label || c.path || ""}</td>
                    <td className={`${u.td} font-mono text-xs`}>{c.kind === "plc_config" ? "" : c.old_value}</td>
                    <td className={`${u.td} font-mono text-xs max-w-xs truncate`} title={c.new_value || ""}>{c.new_value}</td>
                  </tr>
                ))}
                {changes.length === 0 && <tr><td colSpan={9} className="py-8 text-center text-sm text-gray-400">ไม่มีการแก้ในช่วงนี้</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {detail && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setDetail(null)}>
          <div className={`rounded-2xl border p-4 max-w-4xl w-full max-h-[85vh] overflow-auto ${u.card}`} onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-start mb-3">
              <div>
                <h3 className={`text-lg font-bold ${u.text}`}>รอบเทส #{detail.run.id} <ResultBadge r={detail.run.result} /></h3>
                <div className="text-sm text-gray-400">{fmtTime(detail.run.ended_at)} · SN {detail.run.sn || "-"} · memory #{detail.run.memory_no} {detail.run.memory_name} · {detail.run.source}</div>
              </div>
              <button className={u.btn} onClick={() => setDetail(null)}>ปิด</button>
            </div>
            <table className="w-full">
              <thead><tr>{["Step", "Mode", "ผล", "รายละเอียด", "ค่าวัด", "วินาที"].map((h) => <th key={h} className={u.th}>{h}</th>)}</tr></thead>
              <tbody>
                {detail.steps.map((s) => (
                  <tr key={s.step_no} className={`border-t ${u.row}`}>
                    <td className={u.td}>{s.step_no}</td>
                    <td className={u.td}>{s.mode}</td>
                    <td className={u.td}><ResultBadge r={s.outcome} /></td>
                    <td className={u.td}>{s.text} <span className="font-mono text-xs text-gray-400">{s.state_codes}</span></td>
                    <td className={u.td}>
                      {(s.mets || []).filter((m) => fmtRaw(m.raw) !== "OFF" && m.raw !== "").map((m) => (
                        <span key={m.label} className={`inline-block mr-1 mb-1 px-2 py-0.5 rounded text-xs ${u.soft}`}>{m.label}: <b>{fmtRaw(m.raw, m.unit)}</b></span>
                      ))}
                    </td>
                    <td className={u.td}>{s.test_time ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
