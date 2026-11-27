import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { socket } from "../../socket";
import { chromaApi, station, fmtTime, ui } from "./chromaApi";
import ChromaSteps from "./ChromaSteps";
import ChromaTest from "./ChromaTest";
import ChromaPlcOee from "./ChromaPlcOee";
import ChromaHistory from "./ChromaHistory";

// ==========================================
// 🔌 หน้า /chroma — Chroma Tester (admin, me)
//  สั่งเครื่อง Chroma 19036 ผ่านคอมเทสหน้าเครื่อง (C# Station App) — ทุกคำสั่งผ่าน service chroma (5006)
//  ข้อมูลสด: เรียก /watch ทุก 30 วิ → server ส่ง socket "chroma_event" { stationId, type, data } มาที่ห้องของผู้ใช้
//  ไม่ได้อยู่ในแท็บของหน้า Home (ไม่แตะสิทธิ์หน้า Home) — เปิดที่ https://<server>:5173/chroma
// ==========================================
const ROLES = ["admin", "me"];
const TABS = [
  ["steps", "Steps & IWT"],
  ["test", "ทดสอบ"],
  ["plc", "PLC & OEE"],
  ["history", "ประวัติ / สรุป"],
];

function Modal({ title, children, onClose, dark, danger }) {
  return (
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className={`rounded-2xl border p-5 w-full max-w-lg ${dark ? "bg-[#1E293B] border-slate-700 text-slate-100" : "bg-white border-gray-200 text-gray-800"} ${danger ? "!border-rose-500 border-2" : ""}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <h3 className="text-lg font-bold mb-3">{title}</h3>
        {children}
      </div>
    </div>
  );
}

export default function ChromaPage({ isDarkMode, setIsDarkMode }) {
  const navigate = useNavigate();
  const u = ui(isDarkMode);
  const role = String(localStorage.getItem("userRole") || "").toLowerCase();
  const loggedIn = Boolean(localStorage.getItem("token") || localStorage.getItem("sessionToken"));
  const allowed = loggedIn && ROLES.includes(role);

  const [stations, setStations] = useState([]);
  const [selId, setSelId] = useState(() => Number(localStorage.getItem("chromaStation")) || null);
  const [tab, setTab] = useState("steps");
  const [status, setStatus] = useState(null);
  const [statusErr, setStatusErr] = useState("");
  const [live, setLive] = useState(null);
  const [lastRun, setLastRun] = useState(null);
  const [streamOk, setStreamOk] = useState(false);
  const [historyKey, setHistoryKey] = useState(0);
  const [toasts, setToasts] = useState([]);
  const [dialog, setDialog] = useState(null); // { title, body, okText, danger, resolve }
  const [form, setForm] = useState(null); // ลงทะเบียน / แก้เครื่อง
  const [keyShow, setKeyShow] = useState(null); // { apiKey, stationId, name }
  const selRef = useRef(selId);

  // เปลี่ยนเครื่อง → ล้างข้อมูลของเครื่องเดิม
  const selectStation = (id) => {
    if (id === selId) return;
    selRef.current = id;
    setSelId(id);
    setStatus(null);
    setLive(null);
    setLastRun(null);
    setStatusErr("");
  };

  const toast = useCallback((text, err = false) => {
    const id = Math.random();
    setToasts((t) => [...t, { id, text, err }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), err ? 7000 : 3500);
  }, []);

  const ask = useCallback((opts) => new Promise((resolve) => setDialog({ ...opts, resolve })), []);
  const closeDialog = (v) => {
    dialog?.resolve(v);
    setDialog(null);
  };

  // ยืนยันก่อนจ่ายไฟ: ขอ token จากคอมเทสก่อน (อายุ 15 วิ ใช้ครั้งเดียว)
  const hvConfirm = useCallback(
    async (title, detail) => {
      let token;
      try {
        token = (await station(selRef.current, "/hv/prepare", { method: "POST", body: {} })).token;
      } catch (e) {
        toast(e.message, true);
        return null;
      }
      const ok = await ask({
        title,
        danger: true,
        okText: "ยืนยัน จ่ายไฟ",
        body: (
          <div className="space-y-3">
            {detail}
            <div className="px-3 py-2 rounded-xl bg-rose-500/15 text-rose-500 text-sm font-bold">
              ⚡ เครื่องจะจ่ายไฟแรงสูง (สูงสุด AC 5 kV / DC 6 kV) — ตรวจว่าไม่มีใครสัมผัสชิ้นงาน / สายทดสอบ / fixture · กด STOP หรือ Esc ได้ตลอด
            </div>
          </div>
        ),
      });
      return ok ? token : null;
    },
    [ask, toast]
  );

  const loadStations = useCallback(
    () =>
      chromaApi("/stations")
        .then((r) => {
          setStations(r.stations || []);
          if (!selRef.current && r.stations?.length) {
            selRef.current = r.stations[0].id;
            setSelId(r.stations[0].id);
          }
        })
        .catch((e) => toast(e.message, true)),
    [toast]
  );

  const loadStatus = useCallback(() => {
    const id = selRef.current;
    if (!id) return Promise.resolve();
    return station(id, "/status")
      .then((s) => {
        if (selRef.current !== id) return;
        setStatus(s);
        setStatusErr("");
        if (s.lastRun) setLastRun((cur) => cur || s.lastRun);
      })
      .catch((e) => {
        if (selRef.current === id) setStatusErr(e.message);
      });
  }, []);

  const sendStop = useCallback(async () => {
    if (!selRef.current) return;
    try {
      await station(selRef.current, "/stop", { method: "POST", body: {} });
      toast("ส่ง STOP แล้ว");
    } catch (e) {
      toast(`STOP: ${e.message} — ถ้าเครื่องจ่ายไฟอยู่ ให้กด STOP ที่ตัวเครื่อง`, true);
    }
  }, [toast]);

  useEffect(() => {
    if (allowed) loadStations();
  }, [allowed, loadStations]);

  // เลือกเครื่อง → อ่านสถานะ + ขอรับข้อมูลสด (ต่ออายุทุก 30 วิ)
  useEffect(() => {
    if (!allowed || !selId) return undefined;
    localStorage.setItem("chromaStation", String(selId));
    loadStatus();
    const watch = () =>
      chromaApi(`/stations/${selId}/watch`, { method: "POST", body: {} })
        .then((r) => setStreamOk(!!r.streaming))
        .catch(() => setStreamOk(false));
    watch();
    const t1 = setInterval(watch, 30000);
    const t2 = setInterval(loadStatus, 15000);
    return () => {
      clearInterval(t1);
      clearInterval(t2);
      chromaApi(`/stations/${selId}/watch`, { method: "DELETE" }).catch(() => {});
    };
  }, [allowed, selId, loadStatus]);

  useEffect(() => {
    const onEvent = (m) => {
      if (!m || m.stationId !== selRef.current) return;
      setStreamOk(m.type !== "stream_lost");
      switch (m.type) {
        case "status":
          setStatus((cur) => ({ ...(cur || {}), ...(m.data || {}) }));
          break;
        case "live":
          setLive(m.data);
          break;
        case "runStarted":
          setLive(null);
          break;
        case "runCompleted":
          setLastRun(m.data);
          setLive(null);
          setHistoryKey((k) => k + 1);
          break;
        case "operationDone":
          toast(`${m.data?.label || "งาน"} เสร็จแล้ว`);
          break;
        case "history_changed":
          setHistoryKey((k) => k + 1);
          break;
        default:
          break;
      }
    };
    socket.on("chroma_event", onEvent);
    return () => socket.off("chroma_event", onEvent);
  }, [toast]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape" && !dialog) sendStop();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sendStop, dialog]);

  // ---------- ลงทะเบียน / แก้เครื่อง ----------
  const probe = async () => {
    try {
      const r = await chromaApi("/stations/probe", { method: "POST", body: { ip: form.ip.trim(), port: Number(form.port) } });
      setForm({ ...form, probe: r });
    } catch (e) {
      toast(e.message, true);
    }
  };

  const saveStation = async () => {
    try {
      if (form.id) {
        const r = await chromaApi(`/stations/${form.id}`, {
          method: "PUT",
          body: { name: form.name, line: form.line, location: form.location, probeId: form.probe?.probeId },
        });
        toast(`บันทึก ${r.station.name} แล้ว`);
      } else {
        const r = await chromaApi("/stations", { method: "POST", body: { name: form.name, line: form.line, location: form.location, probeId: form.probe?.probeId } });
        setKeyShow({ apiKey: r.apiKey, stationId: r.stationId, name: r.station.name });
        selectStation(r.stationId);
      }
      setForm(null);
      loadStations();
    } catch (e) {
      toast(e.message, true);
    }
  };

  const rotateKey = async (s) => {
    const ok = await ask({ title: `สร้าง API key ใหม่ให้ ${s.name}?`, body: "key เดิมจะใช้ไม่ได้ทันที ต้องใส่ key ใหม่ที่คอมเทส", okText: "สร้าง key ใหม่", danger: true });
    if (!ok) return;
    try {
      const r = await chromaApi(`/stations/${s.id}/rotate-key`, { method: "POST", body: {} });
      setKeyShow({ apiKey: r.apiKey, stationId: r.stationId, name: s.name });
    } catch (e) {
      toast(e.message, true);
    }
  };

  const removeStation = async (s) => {
    const ok = await ask({ title: `ลบเครื่อง ${s.name}?`, body: "ประวัติผลเทส / การแก้ parameter ยังเก็บไว้ — คอมเทสจะส่งข้อมูลขึ้น server ไม่ได้จนกว่าจะลงทะเบียนใหม่", okText: "ลบ", danger: true });
    if (!ok) return;
    try {
      await chromaApi(`/stations/${s.id}`, { method: "DELETE" });
      if (selId === s.id) selectStation(null);
      loadStations();
    } catch (e) {
      toast(e.message, true);
    }
  };

  const copy = (t) => navigator.clipboard?.writeText(t).then(() => toast("คัดลอกแล้ว"), () => toast("คัดลอกไม่ได้ — เลือกแล้วกด Ctrl+C", true));

  if (!allowed) {
    return (
      <div className={`min-h-screen flex items-center justify-center p-6 ${isDarkMode ? "bg-[#0F172A] text-slate-100" : "bg-gray-50 text-gray-800"}`}>
        <div className={`rounded-2xl border p-6 max-w-md text-center ${u.card}`}>
          <h1 className="text-xl font-bold mb-2">Chroma Tester</h1>
          <p className="text-sm text-gray-400 mb-4">{loggedIn ? "หน้านี้สำหรับ ADMIN และ ME เท่านั้น" : "กรุณาเข้าสู่ระบบ Automation Dashboard ก่อน"}</p>
          <button className={u.primary} onClick={() => navigate(loggedIn ? "/home" : "/")}>{loggedIn ? "กลับหน้าหลัก" : "เข้าสู่ระบบ"}</button>
        </div>
      </div>
    );
  }

  const sel = stations.find((s) => s.id === selId) || null;
  const running = status?.state && status.state !== "Idle";

  return (
    <div className={`min-h-screen ${isDarkMode ? "bg-[#0F172A] text-slate-100" : "bg-gray-50 text-gray-800"}`}>
      <header className={`sticky top-0 z-40 border-b px-4 py-3 flex flex-wrap items-center gap-3 ${isDarkMode ? "bg-[#0F172A]/95 border-slate-800" : "bg-white/95 border-gray-200"}`}>
        <button className={u.btn} onClick={() => navigate("/home")}>← Dashboard</button>
        <h1 className="text-xl font-bold">Chroma Tester</h1>
        <span className="text-xs text-gray-400">Chroma 19036 ผ่านคอมเทสหน้าเครื่อง</span>
        <button className={`${u.btn} ml-auto`} onClick={() => setIsDarkMode?.(!isDarkMode)}>{isDarkMode ? "☀️" : "🌙"}</button>
      </header>

      <div className="p-4 grid gap-4 lg:grid-cols-[260px_1fr]">
        <aside className={`rounded-2xl border p-3 h-fit ${u.card}`}>
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-bold">เครื่อง (คอมเทส)</div>
            <button className={`${u.btn} !py-1 !text-xs`} onClick={() => setForm({ name: "", ip: "", port: 8443, line: "", location: "" })}>+ เพิ่ม</button>
          </div>
          {stations.length === 0 && <div className="text-xs text-gray-400">ยังไม่มีเครื่อง — กด + เพิ่ม</div>}
          <div className="space-y-2">
            {stations.map((s) => (
              <button
                key={s.id}
                onClick={() => selectStation(s.id)}
                className={`w-full text-left rounded-xl border px-3 py-2 ${s.id === selId ? "border-blue-500 bg-blue-500/10" : isDarkMode ? "border-slate-700" : "border-gray-200"}`}
              >
                <div className="flex items-center gap-2">
                  <span className={`w-2.5 h-2.5 rounded-full ${s.online ? "bg-emerald-500" : "bg-rose-500"}`} />
                  <span className="font-bold text-sm">{s.name}</span>
                </div>
                <div className="text-[11px] text-gray-400 font-mono">{s.ip}:{s.port}</div>
                <div className="text-[11px] text-gray-400">
                  {s.line || ""} {s.lastStatus?.mode ? `· ${s.lastStatus.mode}` : ""} {s.lastStatus?.memory ? `· #${s.lastStatus.memory.no}` : ""}
                </div>
              </button>
            ))}
          </div>
        </aside>

        <main className="space-y-4 min-w-0">
          {!sel ? (
            <div className={`rounded-2xl border p-8 text-center text-sm text-gray-400 ${u.card}`}>เลือกเครื่องทางซ้าย หรือเพิ่มเครื่องใหม่</div>
          ) : (
            <>
              <section className={`rounded-2xl border p-4 ${u.card}`}>
                <div className="flex flex-wrap items-start gap-3">
                  <div className="mr-auto">
                    <div className="flex items-center gap-2">
                      <h2 className="text-xl font-bold">{sel.name}</h2>
                      <span className="text-xs font-mono text-gray-400">{sel.ip}:{sel.port}</span>
                      {status?.mode && (
                        <span className={`px-2 py-0.5 rounded-lg text-xs font-bold ${status.mode === "Auto" ? "bg-emerald-500/15 text-emerald-500" : "bg-blue-500/15 text-blue-500"}`}>{status.mode}</span>
                      )}
                      {running && <span className="px-2 py-0.5 rounded-lg text-xs font-bold bg-rose-500/15 text-rose-500 animate-pulse">{status.state}</span>}
                    </div>
                    {statusErr ? (
                      <div className="text-sm text-rose-500 mt-1">{statusErr}</div>
                    ) : status ? (
                      <div className="text-xs text-gray-400 mt-1 flex flex-wrap gap-x-3">
                        {["chroma", "plc", "server"].map((k) => (
                          <span key={k}>
                            <span className={status.connected?.[k] ? "text-emerald-500" : "text-rose-500"}>●</span> {k === "chroma" ? "Chroma" : k === "plc" ? "PLC" : "Server"}
                          </span>
                        ))}
                        {status.idn && <span>FW {status.idn.firmware}</span>}
                        {status.memory && <span>memory #{status.memory.no} {status.memory.name} ({status.memory.steps} step)</span>}
                        {status.outboxPending > 0 && <span className="text-amber-500">log ค้างส่ง {status.outboxPending}</span>}
                        <span className={streamOk ? "text-emerald-500" : "text-amber-500"}>{streamOk ? "ข้อมูลสด ✓" : "ข้อมูลสดยังไม่ต่อ"}</span>
                      </div>
                    ) : (
                      <div className="text-xs text-gray-400 mt-1">กำลังอ่านสถานะ...</div>
                    )}
                    {status?.warning && <div className="mt-1 text-sm font-bold text-amber-500">⚠ {status.warning}</div>}
                    {!sel.online && <div className="text-xs text-gray-400 mt-1">ไม่ได้รับ heartbeat ตั้งแต่ {fmtTime(sel.lastSeen) || "ลงทะเบียน"}</div>}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button className={u.btn} onClick={() => setForm({ id: sel.id, name: sel.name, ip: sel.ip, port: sel.port, line: sel.line || "", location: sel.location || "", oldSha: sel.certSha256 })}>แก้ไขเครื่อง</button>
                    <button className={u.btn} onClick={() => rotateKey(sel)}>API key ใหม่</button>
                    <button className={u.btn} onClick={() => removeStation(sel)}>ลบเครื่อง</button>
                  </div>
                </div>
                <div className="flex gap-1 mt-3">
                  {TABS.map(([k, l]) => (
                    <button key={k} onClick={() => setTab(k)}
                      className={`px-4 py-2 rounded-xl text-sm font-bold ${tab === k ? "bg-blue-600 text-white" : isDarkMode ? "text-slate-400 hover:bg-slate-700/40" : "text-gray-500 hover:bg-gray-100"}`}>
                      {l}
                    </button>
                  ))}
                </div>
              </section>

              {tab === "steps" && <ChromaSteps key={sel.id} stationId={sel.id} status={status} isDarkMode={isDarkMode} ask={ask} hvConfirm={hvConfirm} toast={toast} />}
              {tab === "test" && (
                <ChromaTest stationId={sel.id} status={status} live={live} lastRun={lastRun} isDarkMode={isDarkMode} ask={ask} hvConfirm={hvConfirm} onStop={sendStop} toast={toast} />
              )}
              {tab === "plc" && <ChromaPlcOee key={sel.id} stationId={sel.id} status={status} isDarkMode={isDarkMode} ask={ask} toast={toast} />}
              {tab === "history" && <ChromaHistory key={sel.id} stationId={sel.id} stations={stations} isDarkMode={isDarkMode} refreshKey={historyKey} toast={toast} />}
            </>
          )}
        </main>
      </div>

      {sel && (
        <button
          onClick={sendStop}
          title="หยุดเทสทันที (ปุ่ม Esc)"
          className="fixed right-5 bottom-5 z-50 w-24 h-24 rounded-full bg-rose-600 hover:bg-rose-700 text-white font-black text-xl shadow-2xl border-4 border-rose-800 flex flex-col items-center justify-center"
        >
          STOP<span className="text-[10px] font-bold opacity-80">Esc</span>
        </button>
      )}

      <div className="fixed left-1/2 -translate-x-1/2 bottom-5 z-[70] space-y-2 w-[min(92vw,520px)]">
        {toasts.map((t) => (
          <div key={t.id} className={`px-4 py-2 rounded-xl text-sm font-bold shadow-lg ${t.err ? "bg-rose-600 text-white" : "bg-slate-800 text-white"}`}>{t.text}</div>
        ))}
      </div>

      {dialog && (
        <Modal title={dialog.title} dark={isDarkMode} danger={dialog.danger} onClose={() => closeDialog(false)}>
          <div className="text-sm">{dialog.body}</div>
          <div className="flex justify-end gap-2 mt-4">
            <button className={u.btn} autoFocus onClick={() => closeDialog(false)}>ยกเลิก</button>
            <button className={dialog.danger ? u.danger : u.primary} onClick={() => closeDialog(true)}>{dialog.okText || "ยืนยัน"}</button>
          </div>
        </Modal>
      )}

      {form && (
        <Modal title={form.id ? `แก้ไขเครื่อง ${form.name}` : "เพิ่มเครื่อง (คอมเทส)"} dark={isDarkMode} onClose={() => setForm(null)}>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="col-span-2"><div className={u.lbl}>ชื่อเครื่อง</div><input className={`${u.input} w-full`} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div><div className={u.lbl}>IP คอมเทส (WiFi)</div><input className={`${u.input} w-full`} value={form.ip} onChange={(e) => setForm({ ...form, ip: e.target.value, probe: null })} /></div>
            <div><div className={u.lbl}>Port HTTPS</div><input className={`${u.input} w-full`} value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value, probe: null })} /></div>
            <div><div className={u.lbl}>Line</div><input className={`${u.input} w-full`} value={form.line} onChange={(e) => setForm({ ...form, line: e.target.value })} /></div>
            <div><div className={u.lbl}>ตำแหน่ง</div><input className={`${u.input} w-full`} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></div>
          </div>
          <div className="mt-4">
            <button className={u.btn} onClick={probe} disabled={!form.ip}>ตรวจเครื่อง (อ่าน certificate)</button>
            {form.id && !form.probe && <div className="text-xs text-gray-400 mt-1">เปลี่ยน IP / port / certificate ต้องกดตรวจเครื่องใหม่ · fingerprint เดิม <span className="font-mono break-all">{form.oldSha}</span></div>}
            {form.probe && (
              <div className="mt-2 px-3 py-2 rounded-xl bg-amber-500/15 text-sm">
                <div className="font-bold">เทียบ fingerprint นี้กับที่แสดงบนจอคอมเทส ต้องตรงกันทุกตัว:</div>
                <div className="font-mono text-xs break-all mt-1">{form.probe.certSha256.match(/.{1,4}/g).join(" ")}</div>
                <div className="text-xs text-gray-400 mt-1">{form.probe.subject} · หมดอายุ {form.probe.validTo}</div>
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button className={u.btn} onClick={() => setForm(null)}>ยกเลิก</button>
            <button className={u.primary} disabled={!form.name.trim() || (!form.id && !form.probe)} onClick={saveStation}>
              {form.probe ? "fingerprint ตรงกัน — บันทึก" : "บันทึก"}
            </button>
          </div>
        </Modal>
      )}

      {keyShow && (
        <Modal title={`API key ของ ${keyShow.name}`} dark={isDarkMode} onClose={() => setKeyShow(null)}>
          <p className="text-sm mb-2">ใส่ค่านี้ในหน้าตั้งค่าของคอมเทส — <b>แสดงครั้งเดียว</b> ปิดแล้วดูอีกไม่ได้ (สร้างใหม่ได้)</p>
          <div className={`rounded-xl p-3 font-mono text-sm break-all ${u.soft}`}>
            <div>Station ID: <b>{keyShow.stationId}</b></div>
            <div>API key: <b>{keyShow.apiKey}</b></div>
            <div>Server URL: <b>{window.location.origin}</b></div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button className={u.btn} onClick={() => copy(keyShow.apiKey)}>คัดลอก key</button>
            <button className={u.primary} onClick={() => setKeyShow(null)}>ใส่ที่คอมเทสแล้ว</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
