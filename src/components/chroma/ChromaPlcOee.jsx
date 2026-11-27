import { useEffect, useState } from "react";
import { station, chromaApi, todayBkk, addDays, workRange, SHIFT_LABEL, ui } from "./chromaApi";

// 🏭 PLC Delta (Modbus TCP) + OEE: ตั้ง address ส่งไปคอมเทส (PUT /config/plc) และดู OEE รายวัน / กะ
//  สัญญาณ handshake ตาม D:\Chroma DCR\CLAUDE.md — Delta DVP: M = coil 0x0800+n, D = holding 0x1000+n
const SIGNALS = [
  ["start", "Start", "PLC → App", "M", 100],
  ["stop", "Stop", "PLC → App", "M", 104],
  ["busy", "Busy", "App → PLC", "M", 101],
  ["done", "Done", "App → PLC", "M", 102],
  ["error", "Error", "App → PLC", "M", 103],
  ["result", "Result (1 PASS 2 FAIL 3 ABORT 4 ERROR)", "App → PLC", "D", 200],
  ["failStep", "Fail step", "App → PLC", "D", 201],
  ["failCode", "Fail code / Error 90xx", "App → PLC", "D", 202],
  ["memoryNo", "Memory no.", "App → PLC", "D", 203],
  ["heartbeat", "Heartbeat (+1 ทุก 1 วิ)", "App → PLC", "D", 210],
];
const OEE = [
  ["run", "เครื่องเดิน", "M", 300],
  ["alarm", "Alarm", "M", 301],
  ["plannedStop", "หยุดตามแผน", "M", 302],
  ["alarmCode", "Alarm code", "D", 300],
  ["total", "ยอดรวม", "D32", 310],
  ["ok", "ยอดดี", "D32", 312],
  ["ng", "ยอดเสีย", "D32", 314],
  ["idealCtMs", "Ideal cycle time (ms)", "D", 320],
];
const SERIES_BASE = { DVP: { mCoilBase: 2048, dRegBase: 4096 } };

const defaults = () => ({
  ip: "192.168.1.10", port: 502, unitId: 1, series: "DVP", mCoilBase: 2048, dRegBase: 4096, pollMs: 100, oeePollMs: 1000,
  signals: Object.fromEntries(SIGNALS.map(([k, , , t, a]) => [k, { type: t, addr: a }])),
  oee: Object.fromEntries(OEE.map(([k, , t, a]) => [k, { type: t, addr: a }])),
  timeouts: { startToRunningMs: 3000, doneAckMs: 10000 },
});

const modbusAddr = (cfg, sig) => {
  if (!sig || sig.addr === "" || sig.addr == null) return "";
  const n = Number(sig.addr);
  const base = sig.type === "M" ? Number(cfg.mCoilBase) : Number(cfg.dRegBase);
  if (Number.isNaN(n) || Number.isNaN(base)) return "";
  const a = base + n;
  return `${sig.type === "M" ? "coil" : "holding"} ${a} (0x${a.toString(16).toUpperCase().padStart(4, "0")})${sig.type === "D32" ? ` +${a + 1}` : ""}`;
};

const pct = (v) => (v == null ? "-" : `${(v * 100).toFixed(1)}%`);

export default function ChromaPlcOee({ stationId, status, isDarkMode, ask, toast }) {
  const u = ui(isDarkMode);
  const [cfg, setCfg] = useState(null);
  const [saving, setSaving] = useState(false);
  const [range, setRange] = useState({ from: addDays(todayBkk(), -6), to: todayBkk() });
  const [oee, setOee] = useState(null);
  const locked = status?.mode === "Auto" || (status?.state && status.state !== "Idle");

  // (component นี้ใส่ key = เครื่อง → เปลี่ยนเครื่องแล้ว state เริ่มใหม่เอง)
  const loadCfg = () =>
    station(stationId, "/config/plc")
      .then((c) => {
        const d = defaults();
        setCfg({ ...d, ...c, signals: { ...d.signals, ...(c?.signals || {}) }, oee: { ...d.oee, ...(c?.oee || {}) }, timeouts: { ...d.timeouts, ...(c?.timeouts || {}) } });
      })
      .catch((e) => toast(e.message, true));

  const loadOee = (r = range) => {
    const w = workRange(r.from, r.to);
    return chromaApi(`/oee?station=${stationId}&from=${encodeURIComponent(w.from)}&to=${encodeURIComponent(w.to)}`)
      .then((data) => setOee(data.groups || []))
      .catch((e) => toast(e.message, true));
  };

  useEffect(() => {
    loadCfg();
    loadOee();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    const ok = await ask({ title: "ส่งค่า PLC ไปที่คอมเทส?", body: "คอมเทสจะใช้ address ชุดนี้ทันที (ส่งได้เฉพาะโหมด Manual ตอนเครื่องว่าง)", okText: "บันทึก" });
    if (!ok) return;
    setSaving(true);
    try {
      const body = {
        ...cfg,
        port: Number(cfg.port), unitId: Number(cfg.unitId), mCoilBase: Number(cfg.mCoilBase), dRegBase: Number(cfg.dRegBase),
        pollMs: Number(cfg.pollMs), oeePollMs: Number(cfg.oeePollMs),
        signals: Object.fromEntries(Object.entries(cfg.signals).map(([k, v]) => [k, { type: v.type, addr: Number(v.addr) }])),
        oee: Object.fromEntries(Object.entries(cfg.oee).filter(([, v]) => v.addr !== "" && v.addr != null).map(([k, v]) => [k, { type: v.type, addr: Number(v.addr) }])),
        timeouts: { startToRunningMs: Number(cfg.timeouts.startToRunningMs), doneAckMs: Number(cfg.timeouts.doneAckMs) },
      };
      await station(stationId, "/config/plc", { method: "PUT", body });
      toast("บันทึกค่า PLC แล้ว");
    } catch (e) {
      toast(e.message, true);
    } finally {
      setSaving(false);
    }
  };

  const set = (k) => (e) => setCfg({ ...cfg, [k]: e.target.value });
  const setSig = (group, k, field) => (e) => setCfg({ ...cfg, [group]: { ...cfg[group], [k]: { ...cfg[group][k], [field]: e.target.value } } });
  const setSeries = (e) => setCfg({ ...cfg, series: e.target.value, ...(SERIES_BASE[e.target.value] || {}) });

  const sigRow = (group, k, label, dir, types) => {
    const s = cfg[group][k] || { type: types[0], addr: "" };
    return (
      <tr key={`${group}-${k}`} className={`border-t ${u.row}`}>
        <td className={`${u.td} font-bold`}>{label}</td>
        {dir !== undefined && <td className={`${u.td} text-gray-400`}>{dir}</td>}
        <td className={u.td}>
          <select className={u.input} value={s.type} onChange={setSig(group, k, "type")} disabled={locked}>
            {types.map((t) => <option key={t}>{t}</option>)}
          </select>
        </td>
        <td className={u.td}><input className={`${u.input} w-24`} value={s.addr} onChange={setSig(group, k, "addr")} disabled={locked} /></td>
        <td className={`${u.td} font-mono text-xs text-gray-400`}>{modbusAddr(cfg, s)}</td>
      </tr>
    );
  };

  const live = status?.plc;

  return (
    <div className="space-y-4">
      <section className={`rounded-2xl border p-4 ${u.card}`}>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h3 className={`text-lg font-bold ${u.text}`}>PLC Delta (Modbus TCP)</h3>
          <div className="flex gap-2">
            <button className={u.btn} onClick={loadCfg}>อ่านจากคอมเทส</button>
            <button className={u.primary} onClick={save} disabled={!cfg || locked || saving}>{saving ? "กำลังบันทึก..." : "ส่งไปคอมเทส"}</button>
          </div>
        </div>
        {live && (
          <div className="flex flex-wrap gap-2 mb-3 text-xs">
            {Object.entries(live).map(([k, v]) => (
              <span key={k} className={`px-2 py-1 rounded-lg font-mono ${v ? "bg-emerald-500/15 text-emerald-500" : u.soft}`}>{k}: {String(v)}</span>
            ))}
          </div>
        )}
        {locked && <div className="mb-3 px-3 py-2 rounded-xl text-sm font-bold bg-amber-500/15 text-amber-600">แก้ค่า PLC ได้เฉพาะโหมด Manual ตอนเครื่องว่าง</div>}
        {!cfg ? (
          <div className="text-sm text-gray-400">กำลังอ่าน...</div>
        ) : (
          <>
            <div className="flex flex-wrap gap-3 mb-4">
              {[["ip", "IP PLC", "w-40"], ["port", "Port", "w-20"], ["unitId", "Unit ID", "w-20"]].map(([k, l, w]) => (
                <div key={k}><div className={u.lbl}>{l}</div><input className={`${u.input} ${w}`} value={cfg[k]} onChange={set(k)} disabled={locked} /></div>
              ))}
              <div>
                <div className={u.lbl}>รุ่น</div>
                <select className={u.input} value={cfg.series} onChange={setSeries} disabled={locked}>
                  <option value="DVP">DVP (M 0x0800 / D 0x1000)</option>
                  <option value="AS">AS (ใส่ base เอง)</option>
                  <option value="custom">กำหนดเอง</option>
                </select>
              </div>
              <div><div className={u.lbl}>M → coil base</div><input className={`${u.input} w-24`} value={cfg.mCoilBase} onChange={set("mCoilBase")} disabled={locked || cfg.series === "DVP"} /></div>
              <div><div className={u.lbl}>D → register base</div><input className={`${u.input} w-24`} value={cfg.dRegBase} onChange={set("dRegBase")} disabled={locked || cfg.series === "DVP"} /></div>
              <div><div className={u.lbl}>อ่าน Start ทุก (ms)</div><input className={`${u.input} w-24`} value={cfg.pollMs} onChange={set("pollMs")} disabled={locked} /></div>
              <div><div className={u.lbl}>Start→RUNNING (ms)</div><input className={`${u.input} w-24`} value={cfg.timeouts.startToRunningMs} onChange={(e) => setCfg({ ...cfg, timeouts: { ...cfg.timeouts, startToRunningMs: e.target.value } })} disabled={locked} /></div>
              <div><div className={u.lbl}>รอ PLC reset Start (ms)</div><input className={`${u.input} w-24`} value={cfg.timeouts.doneAckMs} onChange={(e) => setCfg({ ...cfg, timeouts: { ...cfg.timeouts, doneAckMs: e.target.value } })} disabled={locked} /></div>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="overflow-x-auto">
                <div className="text-sm font-bold mb-1">Handshake</div>
                <table className="w-full">
                  <thead><tr><th className={u.th}>สัญญาณ</th><th className={u.th}>ทิศทาง</th><th className={u.th}>ชนิด</th><th className={u.th}>เลข</th><th className={u.th}>Modbus</th></tr></thead>
                  <tbody>{SIGNALS.map(([k, l, dir]) => sigRow("signals", k, l, dir, ["M", "D"]))}</tbody>
                </table>
              </div>
              <div className="overflow-x-auto">
                <div className="text-sm font-bold mb-1">OEE (อ่านทุก {cfg.oeePollMs} ms สรุปรายนาที)</div>
                <table className="w-full">
                  <thead><tr><th className={u.th}>ข้อมูล</th><th className={u.th}>ชนิด</th><th className={u.th}>เลข</th><th className={u.th}>Modbus</th></tr></thead>
                  <tbody>{OEE.map(([k, l]) => sigRow("oee", k, l, undefined, ["M", "D", "D32"]))}</tbody>
                </table>
              </div>
            </div>
            <p className="text-[11px] text-gray-400 mt-2">D32 = 2 register (low word ก่อน — ตรวจกับ PLC จริง) · ชนิด D ของ handshake = ค่า 1 คือ ON</p>
          </>
        )}
      </section>

      <section className={`rounded-2xl border p-4 ${u.card}`}>
        <div className="flex flex-wrap items-end gap-2 mb-3">
          <h3 className={`text-lg font-bold mr-auto ${u.text}`}>OEE</h3>
          <div><div className={u.lbl}>ตั้งแต่ (วันทำงาน)</div><input type="date" className={u.input} value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></div>
          <div><div className={u.lbl}>ถึง</div><input type="date" className={u.input} value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></div>
          <button className={u.primary} onClick={() => loadOee()}>ดู</button>
        </div>
        {!oee ? (
          <div className="text-sm text-gray-400">กำลังโหลด...</div>
        ) : oee.length === 0 ? (
          <div className="text-sm text-gray-400">ยังไม่มีข้อมูล OEE ในช่วงนี้ (คอมเทสส่งข้อมูลรายนาทีเมื่อตั้ง address OEE แล้ว)</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr>{["วันที่", "กะ", "A", "P", "Q", "OEE", "เดิน (นาที)", "Alarm (นาที)", "ยอดรวม", "ดี", "เสีย", "Chroma PASS / FAIL"].map((h) => <th key={h} className={u.th}>{h}</th>)}</tr></thead>
              <tbody>
                {oee.map((g) => (
                  <tr key={`${g.date}${g.shift}`} className={`border-t ${u.row}`}>
                    <td className={u.td}>{g.date}</td>
                    <td className={u.td}>{SHIFT_LABEL[g.shift]}</td>
                    <td className={u.td}>{pct(g.availability)}</td>
                    <td className={u.td}>{pct(g.performance)}</td>
                    <td className={u.td}>{pct(g.quality)}</td>
                    <td className={`${u.td} font-black`}>
                      {pct(g.oee)}
                      {g.oee != null && <div className="h-1.5 mt-1 rounded bg-gray-500/20"><div className="h-1.5 rounded bg-blue-500" style={{ width: `${Math.round(g.oee * 100)}%` }} /></div>}
                    </td>
                    <td className={u.td}>{Math.round(g.runSec / 60)}</td>
                    <td className={u.td}>{Math.round(g.alarmSec / 60)}</td>
                    <td className={u.td}>{g.total}</td>
                    <td className={u.td}>{g.ok}</td>
                    <td className={u.td}>{g.ng}</td>
                    <td className={u.td}>{g.testerPass} / {g.testerFail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-[11px] text-gray-400 mt-2">A = เวลาเดิน ÷ เวลาตามแผน (หักหยุดตามแผน) · P = Ideal CT × ยอดรวม ÷ เวลาเดิน · Q = ดี ÷ รวม · กะเช้า 07:40-19:40 / ดึก 19:40-07:40</p>
          </div>
        )}
      </section>
    </div>
  );
}
