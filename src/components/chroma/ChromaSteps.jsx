import { useState } from "react";
import { station, stepKey, subQuery, eng, ui } from "./chromaApi";
import WaveChart from "./WaveChart";

// 🧩 Memory + Steps ของคอมเทส: อ่านรายชื่อ memory → โหลด / บันทึกทับ, แก้ parameter ราย step, กราฟ IWT + SAMPLE GET
//  เลียนแบบหน้า Steps ของโปรแกรมทดสอบเดิม (D:\Chroma DCR\src\Chroma19036.Web\wwwroot\steps.html)
const IMPULSE = ["IWT", "ICOMPARE"];
const HV = ["AC", "DC", "IR", "IWT", "ICOMPARE"];
const ZONE_KEYS = ["AREA", "DAR", "FLUT", "LAPL"];

function hint(p) {
  const parts = [];
  if (p.min != null || p.max != null) {
    const f = (v) => (p.percent ? `${(v * 100).toFixed(1)}%` : eng(v) + (p.unit || ""));
    parts.push(`ช่วง ${p.min != null ? f(p.min) : "…"} – ${p.max != null ? f(p.max) : "…"}`);
  }
  if (p.tokens && p.tokens.length) parts.push(`หรือ ${p.tokens.join(" / ")}`);
  if (p.note) parts.push(p.note);
  return parts.join(" · ");
}

function StepCard({ s, stationId, locked, isDarkMode, ask, hvConfirm, onReplaced, onDeleted, toast }) {
  const u = ui(isDarkMode);
  const key = stepKey(s);
  const [edits, setEdits] = useState({}); // path → value ที่พิมพ์
  const [msgs, setMsgs] = useState({}); // path → { ok, text }
  const [busy, setBusy] = useState(false);
  const [waves, setWaves] = useState(null);
  const [showWave, setShowWave] = useState(false);
  const isImpulse = IMPULSE.includes(s.mode);

  const valueOf = (p) => (edits[p.path] !== undefined ? edits[p.path] : p.edit ?? "");
  const changed = s.params.filter((p) => p.kind !== "ReadOnly" && edits[p.path] !== undefined && edits[p.path] !== (p.edit ?? ""));

  const loadWaves = async () => {
    setBusy(true);
    try {
      setWaves(await station(stationId, `/steps/${s.main}/waves${subQuery(s)}`));
    } catch (e) {
      toast(e.message, true);
    } finally {
      setBusy(false);
    }
  };

  const write = async () => {
    if (!changed.length) return toast("ยังไม่ได้แก้ค่าใด");
    const values = Object.fromEntries(changed.map((p) => [p.path, valueOf(p)]));
    const ok = await ask({
      title: `เขียน STEP ${key} ลงเครื่อง?`,
      body: (
        <ul className="list-disc pl-5 text-sm">
          {Object.entries(values).map(([k, v]) => (
            <li key={k}><span className="font-mono">{k}</span> → <b>{v}</b></li>
          ))}
        </ul>
      ),
      okText: "เขียน",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const r = await station(stationId, `/steps/${s.main}${subQuery(s)}`, { method: "PUT", body: values });
      const m = {};
      let bad = 0;
      (r.results || []).forEach((x) => {
        m[x.path.toUpperCase()] = x.ok ? { ok: true, text: `✔ เขียนแล้ว (${x.display || ""})` } : { ok: false, text: `✖ ${x.error}` };
        if (!x.ok) bad++;
      });
      setMsgs(m);
      // ช่องที่เขียนไม่ผ่าน คงค่าที่พิมพ์ไว้ให้แก้ต่อ
      setEdits(Object.fromEntries(Object.entries(edits).filter(([k]) => m[k.toUpperCase()] && !m[k.toUpperCase()].ok)));
      if (r.step) onReplaced(r.step);
      toast(bad ? `เขียนไม่ผ่าน ${bad} ช่อง` : "เขียนลงเครื่องแล้ว", bad > 0);
      if (r.warning) toast(r.warning);
    } catch (e) {
      toast(e.message, true);
    } finally {
      setBusy(false);
    }
  };

  const reload = async () => {
    setBusy(true);
    try {
      onReplaced(await station(stationId, `/steps/${s.main}${subQuery(s)}`));
      setEdits({});
      setMsgs({});
    } catch (e) {
      toast(e.message, true);
    } finally {
      setBusy(false);
    }
  };

  const del = async () => {
    const ok = await ask({ title: `ลบ STEP ${key} (${s.mode})?`, body: "step ถัดไปจะเลื่อนขึ้นมาแทน / ยังไม่บันทึกลง memory จนกว่าจะกด บันทึกทับ", okText: "ลบ", danger: true });
    if (!ok) return;
    try {
      await station(stationId, `/steps/${s.main}${subQuery(s)}`, { method: "DELETE" });
      toast("ลบแล้ว");
      onDeleted();
    } catch (e) {
      toast(e.message, true);
    }
  };

  const sampleGet = async () => {
    const token = await hvConfirm(`SAMPLE GET — STEP ${key} (${s.mode})`, <p>ต่อ<b>ชิ้นงานตัวอย่างที่ดี</b>เข้ากับ fixture ก่อน — เครื่องจะจ่าย impulse เพื่อเก็บ waveform มาตรฐาน</p>);
    if (!token) return;
    try {
      await station(stationId, `/steps/${s.main}/sample${subQuery(s)}`, { method: "POST", body: { token } });
      toast("เริ่ม SAMPLE GET แล้ว — จบแล้วกด อ่านใหม่ ที่กราฟ");
      setShowWave(true);
      setTimeout(loadWaves, 3000);
    } catch (e) {
      toast(e.message, true);
    }
  };

  const zoneVal = (path) => {
    const p = s.params.find((x) => x.path.toUpperCase() === path);
    const n = parseInt(p ? valueOf(p) : "", 10);
    return Number.isFinite(n) ? n : null;
  };
  const zones = ZONE_KEYS.map((k) => ({ key: k, begin: zoneVal(`${k}:SCOP:BEG`), end: zoneVal(`${k}:SCOP:END`) }));

  const sections = {};
  s.params.forEach((p) => (sections[p.section || ""] ||= []).push(p));

  const input = (p) => {
    const v = valueOf(p);
    const isChanged = edits[p.path] !== undefined && edits[p.path] !== (p.edit ?? "");
    const bad = msgs[p.path.toUpperCase()] && !msgs[p.path.toUpperCase()].ok;
    const cls = `${u.input} w-full ${isChanged ? "!bg-amber-100 !text-gray-900 !border-amber-400" : ""} ${bad ? "!border-rose-500" : ""}`;
    const set = (val) => setEdits({ ...edits, [p.path]: val });
    if (p.kind === "ReadOnly") return <input className={cls} value={p.display ?? ""} disabled />;
    const dis = locked || busy;
    if (p.kind === "Bool")
      return (
        <select className={cls} value={v} disabled={dis} onChange={(e) => set(e.target.value)}>
          <option>ON</option>
          <option>OFF</option>
        </select>
      );
    if (p.kind === "Choice")
      return (
        <select className={cls} value={v} disabled={dis} onChange={(e) => set(e.target.value)}>
          {(p.choices || []).map((c) => <option key={c}>{c}</option>)}
        </select>
      );
    const listId = p.tokens && p.tokens.length ? `tok-${stationId}-${key}-${p.path}` : undefined;
    return (
      <>
        <input className={cls} value={v} disabled={dis} list={listId} autoComplete="off" onChange={(e) => set(e.target.value)} />
        {listId && <datalist id={listId}>{p.tokens.map((t) => <option key={t} value={t} />)}</datalist>}
      </>
    );
  };

  return (
    <section className={`rounded-2xl border p-4 ${u.card} ${HV.includes(s.mode) ? "border-l-4 !border-l-rose-500" : ""}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <h3 className={`text-lg font-bold ${u.text}`}>
          STEP {key} — {s.mode} <span className="text-xs font-normal text-gray-400">{s.modeLabel}{s.subCount ? ` · sub ${s.subCount}` : ""}</span>
        </h3>
        <div className="flex flex-wrap gap-2">
          {isImpulse && (
            <button className={u.btn} onClick={() => { setShowWave(!showWave); if (!waves && !showWave) loadWaves(); }}>
              📈 กราฟ Sample
            </button>
          )}
          {isImpulse && <button className={u.btn} disabled={locked || busy} onClick={sampleGet}>SAMPLE GET</button>}
          <button className={u.btn} disabled={busy} onClick={reload}>อ่านใหม่</button>
          <button className={u.primary} disabled={locked || busy || !changed.length} onClick={write}>
            เขียนลงเครื่อง{changed.length ? ` (${changed.length})` : ""}
          </button>
          <button className={u.btn} disabled={locked || busy} onClick={del}>ลบ step</button>
        </div>
      </div>

      {isImpulse && showWave && (
        <div className="mb-3">
          <div className="flex justify-end mb-1">
            <button className={`${u.btn} !py-1 !text-xs`} disabled={busy} onClick={loadWaves}>{busy ? "กำลังอ่าน..." : "อ่านกราฟใหม่"}</button>
          </div>
          <WaveChart sample={waves?.sample || null} last={waves?.last || null} zones={zones} />
        </div>
      )}

      {Object.entries(sections).map(([sec, items]) => (
        <div key={sec}>
          {sec && <div className="text-xs font-bold text-gray-400 mt-3 mb-1">{sec}</div>}
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))" }}>
            {items.map((p) => {
              const m = msgs[p.path.toUpperCase()];
              return (
                <div key={p.path}>
                  <div className="flex justify-between text-[11px] font-bold text-gray-400 mb-1">
                    <span>{p.label}{p.unit ? ` (${p.unit})` : ""}</span>
                    <span className="font-mono font-normal">{p.path}</span>
                  </div>
                  {input(p)}
                  {p.error && <div className="text-[11px] text-rose-500">{p.error}</div>}
                  <div className="text-[11px] text-gray-400">{hint(p)}</div>
                  {m && <div className={`text-[11px] font-bold ${m.ok ? "text-emerald-500" : "text-rose-500"}`}>{m.text}</div>}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </section>
  );
}

export default function ChromaSteps({ stationId, status, isDarkMode, ask, hvConfirm, toast }) {
  const u = ui(isDarkMode);
  const [steps, setSteps] = useState(null);
  const [loading, setLoading] = useState(false);
  const [pgFrom, setPgFrom] = useState(1);
  const [programs, setPrograms] = useState(null);
  const [pgLoading, setPgLoading] = useState(false);
  const locked = status?.mode === "Auto" || (status?.state && status.state !== "Idle");

  const readAll = async () => {
    setLoading(true);
    try {
      const r = await station(stationId, "/steps");
      setSteps(r.steps || []);
      toast(`อ่าน ${r.total ?? (r.steps || []).length} step แล้ว`);
    } catch (e) {
      toast(e.message, true);
    } finally {
      setLoading(false);
    }
  };

  const loadPrograms = async (from = pgFrom) => {
    setPgLoading(true);
    try {
      setPrograms(await station(stationId, `/programs?from=${from}&count=20`));
    } catch (e) {
      toast(e.message, true);
      setPrograms(null);
    } finally {
      setPgLoading(false);
    }
  };

  const recall = async (p) => {
    const ok = await ask({ title: `โหลด memory ${p.index} (${p.name})?`, body: "step ที่ใช้งานอยู่จะถูกแทนด้วย step ใน memory นี้ — โหมด Auto จะเทสด้วย memory นี้", okText: "โหลด" });
    if (!ok) return;
    try {
      const r = await station(stationId, `/programs/${p.index}/recall`, { method: "POST", body: {} });
      toast(r.ok === false ? (r.errors || []).join("; ") : `โหลดแล้ว (${r.total ?? ""} step)`, r.ok === false);
      readAll();
    } catch (e) {
      toast(e.message, true);
    }
  };

  const save = async (p) => {
    const name = window.prompt(`ชื่อ memory ${p.index} (ภาษาอังกฤษ / ตัวเลข, เว้นว่าง = ชื่อเดิม)`, p.name || "");
    if (name === null) return;
    const ok = await ask({ title: `บันทึก step ปัจจุบันทับ memory ${p.index}?`, body: "ของเดิมใน memory นี้จะถูกเขียนทับ (คอมเทสเก็บสำเนาก่อนบันทึก)", okText: "บันทึกทับ", danger: true });
    if (!ok) return;
    try {
      const r = await station(stationId, `/programs/${p.index}/save`, { method: "POST", body: { name } });
      toast(r.ok === false ? (r.errors || []).join("; ") : "บันทึกแล้ว", r.ok === false);
      loadPrograms();
    } catch (e) {
      toast(e.message, true);
    }
  };

  const page = (d) => {
    const f = Math.min(181, Math.max(1, pgFrom + d));
    setPgFrom(f);
    loadPrograms(f);
  };

  return (
    <div className="space-y-4">
      <section className={`rounded-2xl border p-4 ${u.card}`}>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <h3 className={`text-lg font-bold ${u.text}`}>โปรแกรม (memory 1-200)</h3>
          <div className="flex items-center gap-2">
            <button className={u.btn} onClick={() => page(-20)} disabled={pgFrom <= 1}>◀</button>
            <span className="font-mono text-sm">{pgFrom}-{Math.min(200, pgFrom + 19)}</span>
            <button className={u.btn} onClick={() => page(20)} disabled={pgFrom >= 181}>▶</button>
            <button className={u.btn} onClick={() => loadPrograms()} disabled={pgLoading}>{pgLoading ? "กำลังอ่าน..." : "อ่านรายชื่อ"}</button>
          </div>
        </div>
        {status?.memory && (
          <div className="text-sm mb-2">
            ใช้งานอยู่: <b>#{status.memory.no} {status.memory.name}</b> ({status.memory.steps} step)
          </div>
        )}
        {programs && (
          <div className="overflow-x-auto max-h-80">
            <table className="w-full">
              <thead><tr><th className={u.th}>#</th><th className={u.th}>ชื่อ</th><th className={u.th}>Steps</th><th className={u.th}></th></tr></thead>
              <tbody>
                {programs.map((p) => (
                  <tr key={p.index} className={`border-t ${u.row}`}>
                    <td className={u.td}>{p.index}</td>
                    <td className={u.td}>{p.name || <span className="text-gray-400">(ว่าง)</span>}</td>
                    <td className={u.td}>{p.steps ?? ""}</td>
                    <td className={`${u.td} flex gap-2`}>
                      <button className={`${u.btn} !py-1`} disabled={locked || !p.steps} onClick={() => recall(p)}>โหลด</button>
                      <button className={`${u.btn} !py-1`} disabled={locked} onClick={() => save(p)}>บันทึกทับ</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={`rounded-2xl border p-4 ${u.card}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className={`text-lg font-bold ${u.text}`}>Step การเทส (ค่าที่ใช้งานอยู่ในเครื่อง)</h3>
            <p className="text-xs text-gray-400 mt-1">
              แก้ค่าในช่อง (สีเหลือง = แก้แล้วยังไม่เขียน) → "เขียนลงเครื่อง" ส่งเฉพาะช่องที่เปลี่ยน · ใส่ prefix ได้ เช่น 1.5k, 3m, 50M, OFF, CONT, KEY, 10%
              · ถ้าจะเก็บถาวรต้องกด "บันทึกทับ" memory
            </p>
          </div>
          <button className={u.primary} onClick={readAll} disabled={loading}>{loading ? "กำลังอ่าน (~10 วิ)..." : "อ่าน step จากเครื่อง"}</button>
        </div>
        {locked && <div className="mt-2 px-3 py-2 rounded-xl text-sm font-bold bg-amber-500/15 text-amber-600">โหมด Auto / เครื่องไม่ว่าง — แก้ค่า / โหลด / บันทึกไม่ได้</div>}
      </section>

      {steps && steps.length === 0 && <div className="text-sm text-gray-400">เครื่องยังไม่มี step — โหลด memory ด้านบน</div>}
      {steps &&
        steps.map((s, i) => (
          <StepCard
            key={`${stepKey(s)}-${s.mode}`}
            s={s}
            stationId={stationId}
            locked={locked}
            isDarkMode={isDarkMode}
            ask={ask}
            hvConfirm={hvConfirm}
            toast={toast}
            onReplaced={(fresh) => setSteps((list) => list.map((x, j) => (j === i ? fresh : x)))}
            onDeleted={readAll}
          />
        ))}
    </div>
  );
}
