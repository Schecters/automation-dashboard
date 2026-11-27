// 🔌 เรียก API ของหน้า /chroma (service chroma 5006) — สั่งคอมเทสผ่าน /api/chroma/stations/:id/api/* เท่านั้น
const BASE = "/api/chroma";

const authHeaders = () => {
  const token = localStorage.getItem("token") || localStorage.getItem("sessionToken");
  return { Authorization: `Bearer ${token}` };
};

export async function chromaApi(path, { method = "GET", body } = {}) {
  const init = { method, headers: { ...authHeaders() } };
  if (body !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(`${BASE}${path}`, init);
  } catch {
    throw new Error("ติดต่อ server ไม่ได้");
  }
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) throw new Error((data && (data.message || data.error)) || `HTTP ${res.status}`);
  return data;
}

// คำสั่งไปคอมเทส: station(id, "/steps") → GET /api/chroma/stations/:id/api/steps
export const station = (id, path, opts) => chromaApi(`/stations/${id}/api${path}`, opts);

export const subQuery = (s) => (s.sub == null ? "" : `?sub=${s.sub}`);
export const stepKey = (s) => (s.sub == null ? `${s.main}` : `${s.main}.${s.sub}`);

// ---------- ตัวเลข ----------
const PREFIX = [[1e9, "G"], [1e6, "M"], [1e3, "k"], [1, ""], [1e-3, "m"], [1e-6, "µ"], [1e-9, "n"], [1e-12, "p"]];
export function eng(v) {
  if (v === 0) return "0";
  if (v == null || Number.isNaN(Number(v))) return "";
  const a = Math.abs(v);
  for (const [s, p] of PREFIX) if (a >= s * 0.9995 || s === 1e-12) return +(v / s).toPrecision(4) + p;
  return String(v);
}
export function fmtRaw(raw, unit) {
  if (raw === undefined || raw === null || raw === "") return "";
  const n = Number(String(raw).replace(/"/g, ""));
  if (Number.isNaN(n)) return String(raw);
  if (Math.abs(n - 9.91e37) < 1e35) return "OFF";
  if (Math.abs(n - 9.9e37) < 1e35) return "INF";
  return eng(n) + (unit ? ` ${unit}` : "");
}

// ---------- แปลงข้อมูลจากคอมเทส (C# Station App) ให้หน้าเว็บใช้รูปแบบเดียว ----------
// live: คอมเทสส่ง { live: { step, mode, mets, timeLeft }, elapsed }
export const normLive = (d) => {
  const lv = d && typeof d === "object" && d.live !== undefined ? d.live : d;
  if (!lv || typeof lv !== "object") return null;
  return { ...lv, remaining: lv.remaining ?? lv.timeLeft ?? null };
};
// ผลเทส: runCompleted = { runId, result, reason, steps: [{ index, mode, stateRaw, outcome, text, mets, testTime }], sn }
//        status.lastRun = { runId, at, result, failStep, failCode, failText, sn, source, memoryNo, reason }
export const normRun = (r) => {
  if (!r || typeof r !== "object") return null;
  const steps = (r.steps || []).map((s) => ({
    stepNo: s.stepNo ?? s.index,
    mode: s.mode,
    outcome: s.outcome,
    text: s.text,
    stateCodes: s.stateCodes ?? s.stateRaw,
    mets: s.mets || [],
    testTime: s.testTime,
  }));
  const firstFail = steps.find((s) => String(s.outcome || "").toUpperCase() === "FAIL");
  return {
    ...r,
    result: String(r.result || "").toUpperCase() || null,
    steps,
    failStep: r.failStep || firstFail?.stepNo || 0,
    failText: r.failText ?? firstFail?.text ?? r.reason ?? null,
    failCode: r.failCode || firstFail?.stateCodes || null,
  };
};
// idn: คอมเทสส่งข้อความ "Chroma,19036,<serial>,<FW>" / โปรแกรมอื่นส่ง object
export const firmwareOf = (idn) =>
  !idn ? "" : typeof idn === "string" ? (idn.split(",")[3] || "").trim() : idn.firmware || "";

// ---------- วันทำงาน / กะ (07:40-19:40 เช้า / 19:40-07:40 ดึก) ----------
const bkk = (d = new Date()) => new Date(d.getTime() + 7 * 3600000).toISOString();
export const todayBkk = () => bkk().slice(0, 10);
export const addDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
// วันที่ (เวลาไทย) → ช่วงเวลา ISO ของวันทำงาน: from 07:40 ของวันแรก ถึง 07:40 ของวันถัดจากวันสุดท้าย
export const workRange = (from, to) => ({
  from: new Date(Date.parse(`${from}T07:40:00+07:00`)).toISOString(),
  to: new Date(Date.parse(`${addDays(to, 1)}T07:40:00+07:00`)).toISOString(),
});
export const SHIFT_LABEL = { day: "เช้า", night: "ดึก" };
export const fmtTime = (t) => (t ? new Date(t).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" }) : "");

export function downloadCsv(name, head, rows) {
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = "﻿" + [head, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- สไตล์ร่วม ----------
export const ui = (dark) => ({
  card: dark ? "bg-[#1E293B] border-slate-700/60" : "bg-white border-gray-200",
  text: dark ? "text-slate-100" : "text-gray-800",
  muted: "text-gray-400",
  input: `px-3 py-2 rounded-xl border text-sm outline-none focus:border-blue-500 ${
    dark ? "bg-slate-900 border-slate-700 text-slate-100" : "bg-white border-gray-300 text-gray-800"
  }`,
  lbl: "text-[11px] font-bold text-gray-400 mb-1",
  btn: `px-3 py-2 rounded-xl text-sm font-bold border disabled:opacity-40 ${dark ? "border-slate-600 text-slate-300 hover:bg-slate-700/40" : "border-gray-300 text-gray-600 hover:bg-gray-50"}`,
  primary: "px-4 py-2 rounded-xl text-sm font-bold bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-40",
  danger: "px-4 py-2 rounded-xl text-sm font-bold bg-rose-600 hover:bg-rose-700 text-white disabled:opacity-40",
  th: `py-2 px-3 text-[11px] font-bold uppercase text-left ${dark ? "text-slate-400" : "text-gray-500"}`,
  td: "py-2 px-3 text-sm",
  row: dark ? "border-slate-700/50" : "border-gray-100",
  soft: dark ? "bg-slate-900/60" : "bg-gray-50",
});
