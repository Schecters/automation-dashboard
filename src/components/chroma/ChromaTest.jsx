import { useState } from "react";
import { station, fmtRaw, ui } from "./chromaApi";

// ⚡ ทดสอบจากเว็บ (โหมด Manual): SN → START (ยืนยันไฟแรงสูง + token) → ค่าสด → ผลราย step / STOP ได้ตลอด
//  โหมด Auto (PLC สั่ง): ปุ่ม START ปิด แต่ดูค่าสด / ผล และกด STOP ได้
const RESULT_CLS = {
  PASS: "bg-emerald-500/15 text-emerald-500",
  FAIL: "bg-rose-500/15 text-rose-500",
  ABORT: "bg-violet-500/15 text-violet-500",
  ABORTED: "bg-violet-500/15 text-violet-500", // outcome ราย step จากคอมเทส: Pass / Fail / Aborted / Skip / Incomplete
  ERROR: "bg-amber-500/15 text-amber-500",
};

export const ResultBadge = ({ r, big }) => (
  <span className={`inline-block rounded-lg font-black ${big ? "px-6 py-2 text-4xl" : "px-2 py-0.5 text-xs"} ${RESULT_CLS[String(r || "").toUpperCase()] || "bg-gray-500/15 text-gray-400"}`}>
    {r || "-"}
  </span>
);

const liveValues = (live) => {
  if (!live || typeof live !== "object") return [];
  if (Array.isArray(live.mets)) return live.mets.map((m) => [m.label, fmtRaw(m.raw, m.unit)]);
  return Object.entries(live)
    .filter(([k, v]) => !["step", "mode", "remaining", "tle"].includes(k.toLowerCase()) && v !== null && typeof v !== "object")
    .map(([k, v]) => [k.toUpperCase(), typeof v === "number" ? fmtRaw(v) : String(v)]);
};

export default function ChromaTest({ stationId, status, live, lastRun, isDarkMode, ask, hvConfirm, onStop, toast }) {
  const u = ui(isDarkMode);
  const [sn, setSn] = useState("");
  const [busy, setBusy] = useState(false);
  const auto = status?.mode === "Auto";
  // กำลังทำงาน = เทส / งานจ่ายไฟ (Disconnected / Connecting ไม่นับ แต่ START ก็กดไม่ได้เพราะยังไม่ Idle)
  const running = ["Starting", "Running", "Collecting", "Operation"].includes(status?.state);
  const idle = status?.state === "Idle";


  const start = async () => {
    const token = await hvConfirm(
      `เริ่มเทส — memory #${status?.memory?.no ?? "?"} ${status?.memory?.name ?? ""}`,
      <p>SN: <b>{sn || "(ไม่ระบุ)"}</b> · {status?.memory?.steps ?? "?"} step</p>
    );
    if (!token) return;
    setBusy(true);
    try {
      await station(stationId, "/start", { method: "POST", body: { token, sn } });
      toast("เริ่มเทสแล้ว");
    } catch (e) {
      toast(e.message, true);
    } finally {
      setBusy(false);
    }
  };

  const setMode = async (mode) => {
    if (mode === status?.mode) return;
    const ok = await ask({
      title: `เปลี่ยนเป็นโหมด ${mode}?`,
      body: mode === "Auto" ? "PLC จะสั่ง Start ได้ / หน้าเว็บกด START และแก้ค่าไม่ได้ (STOP ได้เสมอ)" : "PLC สั่ง Start ไม่ได้ / หน้าเว็บสั่งเทสและแก้ค่าได้",
      okText: `โหมด ${mode}`,
    });
    if (!ok) return;
    try {
      await station(stationId, "/mode", { method: "PUT", body: { mode } });
      toast(`เปลี่ยนเป็นโหมด ${mode} แล้ว`);
    } catch (e) {
      toast(e.message, true);
    }
  };

  const vals = liveValues(live);

  return (
    <div className="space-y-4">
      <section className={`rounded-2xl border p-4 ${u.card}`}>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <div className={u.lbl}>โหมด</div>
            <div className="flex rounded-xl overflow-hidden border border-gray-300/40">
              {["Manual", "Auto"].map((m) => (
                <button key={m} onClick={() => setMode(m)} disabled={running}
                  className={`px-4 py-2 text-sm font-bold disabled:opacity-60 ${status?.mode === m ? (m === "Auto" ? "bg-emerald-600 text-white" : "bg-blue-600 text-white") : isDarkMode ? "text-slate-300" : "text-gray-600"}`}>
                  {m}
                </button>
              ))}
            </div>
          </div>
          <div className="flex-1 min-w-[200px]">
            <div className={u.lbl}>SN / ป้ายของรอบนี้ (ไม่บังคับ)</div>
            <input className={`${u.input} w-full`} value={sn} onChange={(e) => setSn(e.target.value)} disabled={auto} placeholder={auto ? "โหมด Auto — PLC เป็นผู้สั่ง" : ""} />
          </div>
          <button className={`${u.primary} !px-8 !py-3 !text-base`} disabled={auto || !idle || busy} onClick={start}>START</button>
          <button className="px-8 py-3 rounded-xl text-base font-black bg-rose-600 hover:bg-rose-700 text-white" onClick={onStop}>STOP</button>
        </div>
        <p className="text-xs text-gray-400 mt-2">
          ⚡ เครื่องจ่ายไฟสูงสุด AC 5 kV / DC 6 kV — ถ้าหน้าเว็บหรือคอมเทสหลุด ให้กดปุ่ม STOP ที่ตัวเครื่อง
        </p>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <section className={`rounded-2xl border p-4 ${u.card}`}>
          <h3 className={`text-lg font-bold mb-2 ${u.text}`}>ค่าสด</h3>
          {running && live ? (
            <div className="space-y-2">
              <div className="text-sm">STEP <b className="text-2xl">{live.step ?? "-"}</b> <span className="ml-2 font-bold">{live.mode ?? ""}</span>
                {live.remaining != null && <span className="ml-3 text-gray-400">เหลือ {Number(live.remaining).toFixed(1)} วิ</span>}
              </div>
              <div className="flex flex-wrap gap-2">
                {vals.map(([k, v]) => (
                  <span key={k} className={`px-3 py-1 rounded-lg text-sm ${u.soft}`}>{k}: <b>{v}</b></span>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-sm text-gray-400">{running ? "กำลังเทส..." : "เครื่องว่าง"}</div>
          )}
        </section>

        <section className={`rounded-2xl border p-4 ${u.card}`}>
          <h3 className={`text-lg font-bold mb-2 ${u.text}`}>ผลล่าสุด</h3>
          {lastRun ? (
            <div className="flex flex-wrap items-center gap-4">
              <ResultBadge r={lastRun.result} big />
              <div className="text-sm">
                {lastRun.failStep ? <div>FAIL ที่ step <b>{lastRun.failStep}</b> {lastRun.failText || ""} <span className="font-mono text-gray-400">{lastRun.failCode || ""}</span></div> : null}
                <div className="text-gray-400">{lastRun.sn ? `SN ${lastRun.sn} · ` : ""}memory #{lastRun.memoryNo ?? ""} {lastRun.memoryName ?? ""}</div>
                {status?.today && <div className="text-gray-400">วันนี้ {status.today.total} ชิ้น · PASS {status.today.pass} · FAIL {status.today.fail}</div>}
              </div>
            </div>
          ) : (
            <div className="text-sm text-gray-400">ยังไม่มีผล</div>
          )}
        </section>
      </div>

      {lastRun?.steps?.length > 0 && (
        <section className={`rounded-2xl border ${u.card}`}>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr><th className={u.th}>Step</th><th className={u.th}>Mode</th><th className={u.th}>ผล</th><th className={u.th}>รายละเอียด</th><th className={u.th}>ค่าวัด</th><th className={u.th}>วินาที</th></tr></thead>
              <tbody>
                {lastRun.steps.map((s) => (
                  <tr key={s.stepNo} className={`border-t ${u.row}`}>
                    <td className={u.td}>{s.stepNo}</td>
                    <td className={u.td}>{s.mode}</td>
                    <td className={u.td}><ResultBadge r={s.outcome} /></td>
                    <td className={u.td}>{s.text} <span className="font-mono text-xs text-gray-400">{s.stateCodes}</span></td>
                    <td className={u.td}>
                      {(s.mets || []).filter((m) => fmtRaw(m.raw) !== "OFF" && m.raw !== "").map((m) => (
                        <span key={m.label} className={`inline-block mr-1 mb-1 px-2 py-0.5 rounded text-xs ${u.soft}`}>{m.label}: <b>{fmtRaw(m.raw, m.unit)}</b></span>
                      ))}
                    </td>
                    <td className={u.td}>{s.testTime ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
