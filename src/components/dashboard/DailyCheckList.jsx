import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { socket } from "../../socket";

// 📋 Daily PM Checklist: กรอกเช็คลิสต์ประจำวันตามแม่แบบ + ดูประวัติ + อนุมัติทีละขั้น
const API_URL = "/api";

const getHeaders = () => {
  const token = localStorage.getItem("token") || localStorage.getItem("sessionToken");
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
    "x-session-token": token,
  };
};

const todayBangkok = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
const daysAgoBangkok = (n) =>
  new Date(Date.now() - n * 86400000).toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });

const formatDateTime = (v) =>
  v
    ? new Date(v).toLocaleString("th-TH", {
        timeZone: "Asia/Bangkok",
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "-";

const formatDate = (ymd) => {
  if (!ymd) return "-";
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("th-TH", { year: "numeric", month: "short", day: "numeric" });
};

const rangeText = (min, max, unit) => {
  const u = unit ? ` ${unit}` : "";
  if (min !== null && min !== undefined && max !== null && max !== undefined) return `${min} – ${max}${u}`;
  if (min !== null && min !== undefined) return `≥ ${min}${u}`;
  if (max !== null && max !== undefined) return `≤ ${max}${u}`;
  return unit ? `(${unit})` : "ไม่มีเกณฑ์";
};

// ตัดสินผลฝั่งหน้าเว็บ (ให้เห็นทันทีตอนกรอก) ฝั่ง API ตัดสินซ้ำอีกครั้งตอนบันทึก
const judge = (item, value) => {
  if (item.check_type === "pass_fail") {
    if (value?.value_bool === true) return "OK";
    if (value?.value_bool === false) return "NG";
    return null;
  }
  const raw = value?.value_number;
  if (raw === undefined || raw === null || String(raw).trim() === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  if (item.min_value !== null && item.min_value !== undefined && n < item.min_value) return "NG";
  if (item.max_value !== null && item.max_value !== undefined && n > item.max_value) return "NG";
  return "OK";
};

const isSection = (item) => item?.check_type === "section";
const countCheckItems = (items) => (items || []).filter((it) => !isSection(it)).length;
// ลำดับข้อ (นับเฉพาะรายการเช็ค ไม่นับหัวข้อย่อย)
const itemNumber = (items, index) => items.slice(0, index + 1).filter((it) => !isSection(it)).length;

export default function DailyCheckList({ isDarkMode }) {
  const userRole = (localStorage.getItem("userRole") || "").toLowerCase().trim();
  const canSubmit = Boolean(userRole) && userRole !== "view";
  const isAdmin = userRole === "admin";

  const [tab, setTab] = useState("fill");
  const [lines, setLines] = useState([]);
  const [positions, setPositions] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [message, setMessage] = useState(null);

  // ----- แท็บกรอกเช็คลิสต์ -----
  const [fillDate, setFillDate] = useState(todayBangkok);
  const [fillLine, setFillLine] = useState("");
  const [dayRecords, setDayRecords] = useState([]);
  const [activeTemplate, setActiveTemplate] = useState(null);
  const [values, setValues] = useState({});
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // ----- แท็บประวัติ / อนุมัติ -----
  const [histFrom, setHistFrom] = useState(() => daysAgoBangkok(7));
  const [histTo, setHistTo] = useState(todayBangkok);
  const [histLine, setHistLine] = useState("");
  const [histStatus, setHistStatus] = useState("");
  const [exporting, setExporting] = useState(false);
  const [onlyMine, setOnlyMine] = useState(false);
  const [records, setRecords] = useState([]);
  const [loadingRecords, setLoadingRecords] = useState(false);
  const [myPendingCount, setMyPendingCount] = useState(0);

  // ----- Modal รายละเอียด -----
  const [detail, setDetail] = useState(null);
  const [reviewComment, setReviewComment] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const detailIdRef = useRef(null);
  useEffect(() => {
    detailIdRef.current = detail?.id ?? null;
  }, [detail]);

  const positionLabel = useCallback(
    (key) => positions.find((p) => p.key === key)?.label || key,
    [positions]
  );

  const loadTemplates = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/pm/templates`, { headers: getHeaders() });
      const data = await res.json();
      if (res.ok && data.success) setTemplates(data.data);
    } catch (err) {
      console.error("Load PM templates error:", err);
    }
  }, []);

  const loadDayRecords = useCallback(async () => {
    try {
      const qs = new URLSearchParams({ date_from: fillDate, date_to: fillDate });
      const res = await fetch(`${API_URL}/pm/records?${qs}`, { headers: getHeaders() });
      const data = await res.json();
      if (res.ok && data.success) setDayRecords(data.data);
    } catch (err) {
      console.error("Load PM day records error:", err);
    }
  }, [fillDate]);

  const loadRecords = useCallback(async () => {
    setLoadingRecords(true);
    try {
      const qs = new URLSearchParams();
      if (histFrom) qs.set("date_from", histFrom);
      if (histTo) qs.set("date_to", histTo);
      if (histLine) qs.set("line", histLine);
      if (histStatus) qs.set("status", histStatus);
      const res = await fetch(`${API_URL}/pm/records?${qs}`, { headers: getHeaders() });
      const data = await res.json();
      if (res.ok && data.success) setRecords(data.data);
    } catch (err) {
      console.error("Load PM records error:", err);
    } finally {
      setLoadingRecords(false);
    }
  }, [histFrom, histTo, histLine, histStatus]);

  // จำนวนใบที่รอ "ฉัน" อนุมัติ (ทุกวันที่) แสดงเป็นตัวเลขบนแท็บ
  const loadMyPending = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/pm/records?status=pending`, { headers: getHeaders() });
      const data = await res.json();
      if (res.ok && data.success) setMyPendingCount(data.data.filter((r) => r.can_approve).length);
    } catch {
      // ไม่กระทบการใช้งานหลัก
    }
  }, []);

  const openDetail = useCallback(async (id) => {
    setReviewComment("");
    try {
      const res = await fetch(`${API_URL}/pm/records/${id}`, { headers: getHeaders() });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "โหลดรายละเอียดไม่สำเร็จ");
      setDetail(data.data);
    } catch (err) {
      setMessage({ type: "error", text: err.message });
    }
  }, []);

  useEffect(() => {
    Promise.all([
      fetch(`${API_URL}/lines`, { headers: getHeaders() }).then((r) => r.json()),
      fetch(`${API_URL}/pm/positions`, { headers: getHeaders() }).then((r) => r.json()),
    ])
      .then(([linesData, positionsData]) => {
        setLines(Array.isArray(linesData) ? linesData : []);
        if (positionsData.success) setPositions(positionsData.data);
      })
      .catch((err) => console.error("Init PM daily error:", err));
    loadTemplates();
    loadMyPending();
  }, [loadTemplates, loadMyPending]);

  useEffect(() => {
    loadDayRecords();
  }, [loadDayRecords]);

  useEffect(() => {
    if (tab === "history") loadRecords();
  }, [tab, loadRecords]);

  // อัปเดตแบบ real-time เมื่อมีคนบันทึก/อนุมัติ
  useEffect(() => {
    const handlePmUpdated = (payload) => {
      if (payload?.type === "template") loadTemplates();
      if (payload?.type === "record") {
        loadDayRecords();
        loadMyPending();
        if (tab === "history") loadRecords();
        if (detailIdRef.current === payload.id) openDetail(payload.id);
      }
    };
    socket.on("pm_updated", handlePmUpdated);
    return () => socket.off("pm_updated", handlePmUpdated);
  }, [tab, loadTemplates, loadDayRecords, loadMyPending, loadRecords, openDetail]);

  const lineTemplates = useMemo(
    () => templates.filter((t) => !fillLine || t.line_id === fillLine),
    [templates, fillLine]
  );

  // สถานะของแต่ละแม่แบบ ในวันที่เลือก (ใบล่าสุดที่ไม่ถูก Reject)
  const recordForTemplate = (templateId) => {
    const list = dayRecords.filter((r) => r.template_id === templateId);
    return list.find((r) => r.status !== "rejected") || list[0] || null;
  };

  const startFill = (t) => {
    setMessage(null);
    setActiveTemplate(t);
    setValues({});
    setNote("");
  };

  const setValue = (itemId, patch) =>
    setValues((prev) => ({ ...prev, [itemId]: { ...prev[itemId], ...patch } }));

  const fillProgress = useMemo(() => {
    if (!activeTemplate) return { done: 0, total: 0, ng: 0 };
    let done = 0;
    let ng = 0;
    for (const item of activeTemplate.items) {
      if (isSection(item)) continue;
      const r = judge(item, values[item.id]);
      if (r) done++;
      if (r === "NG") ng++;
    }
    return { done, total: countCheckItems(activeTemplate.items), ng };
  }, [activeTemplate, values]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!activeTemplate) return;

    const missing = activeTemplate.items.filter((it) => !isSection(it) && it.is_required && !judge(it, values[it.id]));
    if (missing.length > 0) {
      setMessage({ type: "error", text: `ยังไม่ได้เช็ค: ${missing.map((m) => m.label).join(", ")}` });
      return;
    }
    if (fillProgress.ng > 0 && !window.confirm(`มี ${fillProgress.ng} รายการเป็น NG ยืนยันส่งเช็คลิสต์?`)) return;

    setSubmitting(true);
    setMessage(null);
    try {
      const payload = {
        template_id: activeTemplate.id,
        check_date: fillDate,
        note,
        values: activeTemplate.items.filter((it) => !isSection(it)).map((it) => ({
          item_id: it.id,
          value_bool: values[it.id]?.value_bool ?? null,
          value_number: values[it.id]?.value_number ?? null,
          remark: values[it.id]?.remark || "",
        })),
      };
      const res = await fetch(`${API_URL}/pm/records`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "บันทึกไม่สำเร็จ");

      setMessage({ type: "success", text: data.message });
      setActiveTemplate(null);
      loadDayRecords();
      loadMyPending();
    } catch (err) {
      setMessage({ type: "error", text: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  const handleReview = async (action) => {
    if (!detail) return;
    if (action === "reject" && !reviewComment.trim()) {
      setMessage({ type: "error", text: "กรุณาระบุเหตุผลที่ไม่อนุมัติ" });
      return;
    }
    setReviewing(true);
    try {
      const res = await fetch(`${API_URL}/pm/records/${detail.id}/review`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({ action, comment: reviewComment }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "บันทึกการอนุมัติไม่สำเร็จ");
      setMessage({ type: "success", text: data.message });
      setReviewComment("");
      await openDetail(detail.id);
      loadRecords();
      loadDayRecords();
      loadMyPending();
    } catch (err) {
      setMessage({ type: "error", text: err.message });
    } finally {
      setReviewing(false);
    }
  };

  const handleDeleteRecord = async () => {
    if (!detail || !window.confirm(`ลบใบเช็คลิสต์ "${detail.template_name}" วันที่ ${formatDate(detail.check_date)} ?`)) return;
    try {
      const res = await fetch(`${API_URL}/pm/records/${detail.id}`, { method: "DELETE", headers: getHeaders() });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "ลบไม่สำเร็จ");
      setMessage({ type: "success", text: data.message });
      setDetail(null);
      loadRecords();
      loadDayRecords();
      loadMyPending();
    } catch (err) {
      setMessage({ type: "error", text: err.message });
    }
  };

  // Export CSV ตามช่วงวันที่ + Line + สถานะ ที่เลือกอยู่ (1 แถว = 1 รายการเช็ค)
  const handleExportCsv = async () => {
    if (!histFrom || !histTo) {
      setMessage({ type: "error", text: "กรุณาเลือกช่วงวันที่ (ตั้งแต่ - ถึง) ก่อน Export" });
      return;
    }
    setExporting(true);
    try {
      const qs = new URLSearchParams({ date_from: histFrom, date_to: histTo });
      if (histLine) qs.set("line", histLine);
      if (histStatus) qs.set("status", histStatus);
      const res = await fetch(`${API_URL}/pm/export.csv?${qs}`, { headers: getHeaders() });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "Export CSV ไม่สำเร็จ");
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") || "";
      const fileName = disposition.match(/filename="([^"]+)"/)?.[1] || `PM_Checklist_${histFrom}_to_${histTo}.csv`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setMessage({ type: "error", text: err.message });
    } finally {
      setExporting(false);
    }
  };

  const visibleRecords = onlyMine ? records.filter((r) => r.can_approve) : records;

  // ---------- styles ----------
  const card = isDarkMode ? "bg-[#1E293B] border-slate-700/60" : "bg-white border-gray-200";
  const input = `px-3 py-2 rounded-xl border text-xs outline-none focus:border-blue-500 ${
    isDarkMode ? "bg-slate-900 border-slate-700 text-slate-100 placeholder-slate-500" : "bg-gray-50 border-gray-200 text-gray-800 placeholder-gray-400"
  }`;
  const textMain = isDarkMode ? "text-slate-100" : "text-gray-800";

  const statusBadge = (r) => {
    if (r.status === "approved")
      return <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-500/15 text-emerald-500 border border-emerald-500/30">อนุมัติแล้ว</span>;
    if (r.status === "rejected")
      return <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-rose-500/15 text-rose-500 border border-rose-500/30">ไม่อนุมัติ</span>;
    const total = r.approval_steps?.length || 0;
    return (
      <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-500/15 text-amber-500 border border-amber-500/30">
        รอ {positionLabel(r.pending_position)} ({r.current_step + 1}/{total})
      </span>
    );
  };

  // หัวข้อย่อย: แถบหัวเรื่องจัดกลุ่ม + คำอธิบาย (ไม่ต้องเช็ค)
  const renderSection = (item) => (
    <div
      key={`section_${item.id}`}
      className={`pt-3 pb-2 px-3 rounded-xl border-l-4 border-amber-500 ${isDarkMode ? "bg-amber-500/5" : "bg-amber-50"}`}
    >
      <div className={`text-sm font-bold ${textMain}`}>{item.label}</div>
      {item.description && (
        <p className={`text-[11px] mt-0.5 whitespace-pre-wrap ${isDarkMode ? "text-slate-400" : "text-gray-600"}`}>{item.description}</p>
      )}
    </div>
  );

  const resultBadge = (result) =>
    result === "NG" ? (
      <span className="px-2 py-0.5 rounded-md text-[10px] font-black bg-rose-600 text-white">NG</span>
    ) : result === "OK" ? (
      <span className="px-2 py-0.5 rounded-md text-[10px] font-black bg-emerald-600 text-white">OK</span>
    ) : (
      <span className="text-[10px] text-gray-400">-</span>
    );

  return (
    <div className="space-y-5 pb-10">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h2 className={`text-2xl font-bold ${isDarkMode ? "text-white" : "text-gray-900"}`}>Daily PM Checklist</h2>
          <p className={`text-xs mt-1 ${isDarkMode ? "text-slate-400" : "text-gray-500"}`}>
            เช็คลิสต์ PM ประจำวันแยกตาม Line / Process พร้อมส่งอนุมัติตามลำดับตำแหน่ง
          </p>
        </div>
        <div className={`inline-flex p-1 rounded-xl border ${card}`}>
          {[
            { id: "fill", label: "ทำเช็คลิสต์" },
            { id: "history", label: "ประวัติ / อนุมัติ" },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 ${
                tab === t.id ? "bg-blue-600 text-white" : isDarkMode ? "text-slate-400 hover:text-white" : "text-gray-500 hover:text-gray-800"
              }`}
            >
              {t.label}
              {t.id === "history" && myPendingCount > 0 && (
                <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] flex items-center justify-center">
                  {myPendingCount}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {message && (
        <div
          className={`p-3 rounded-xl border text-xs font-semibold flex items-center justify-between gap-2 ${
            message.type === "success"
              ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/30"
              : "bg-rose-500/10 text-rose-500 border-rose-500/30"
          }`}
        >
          <span>{message.text}</span>
          <button type="button" onClick={() => setMessage(null)} className="opacity-60 hover:opacity-100">✕</button>
        </div>
      )}

      {/* ===================== แท็บ: ทำเช็คลิสต์ ===================== */}
      {tab === "fill" && !activeTemplate && (
        <div className="space-y-4">
          <div className={`rounded-2xl border p-4 flex flex-wrap items-end gap-3 ${card}`}>
            <div>
              <label className="text-[11px] font-bold text-gray-400 block mb-1">วันที่</label>
              <input type="date" value={fillDate} max={todayBangkok()} onChange={(e) => setFillDate(e.target.value)} className={input} />
            </div>
            <div>
              <label className="text-[11px] font-bold text-gray-400 block mb-1">Line</label>
              <select value={fillLine} onChange={(e) => setFillLine(e.target.value)} className={input}>
                <option value="">ทุก Line</option>
                {lines.map((l) => (
                  <option key={l.id} value={l.id}>{l.id}</option>
                ))}
              </select>
            </div>
          </div>

          {lineTemplates.length === 0 ? (
            <div className={`rounded-2xl border p-10 text-center text-xs text-gray-400 ${card}`}>
              ยังไม่มีแม่แบบเช็คลิสต์{fillLine ? ` สำหรับ Line ${fillLine}` : ""} (สร้างได้ที่เมนู Create Daily PM Checklist)
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-3">
              {lineTemplates.map((t) => {
                const rec = recordForTemplate(t.id);
                const done = rec && rec.status !== "rejected";
                return (
                  <div key={t.id} className={`rounded-2xl border p-4 space-y-3 ${card}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className={`text-sm font-bold truncate ${textMain}`}>{t.name}</div>
                        <div className="text-[11px] text-gray-400 mt-0.5">
                          <span className="text-blue-400 font-semibold">{t.line_id}</span> · {t.process} · {countCheckItems(t.items)} รายการ
                        </div>
                      </div>
                      {rec ? statusBadge(rec) : <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-gray-500/10 text-gray-400 border border-gray-500/20 shrink-0">ยังไม่เช็ค</span>}
                    </div>
                    <div className="text-[10px] text-gray-400">
                      อนุมัติ: {t.approval_steps?.length ? t.approval_steps.map(positionLabel).join(" → ") : "ไม่ต้องอนุมัติ"}
                    </div>
                    <div className="flex gap-2">
                      {done ? (
                        <button
                          type="button"
                          onClick={() => openDetail(rec.id)}
                          className="flex-1 py-2 rounded-xl text-xs font-bold border border-blue-500/40 text-blue-500 hover:bg-blue-500/10"
                        >
                          ดูผล {rec.overall_result === "NG" ? "(มี NG)" : ""}
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={!canSubmit}
                          onClick={() => startFill(t)}
                          className="flex-1 py-2 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          {rec?.status === "rejected" ? "เช็คใหม่ (ใบเดิมไม่อนุมัติ)" : "เริ่มเช็ค"}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {!canSubmit && <p className="text-[11px] text-gray-400">บัญชีสิทธิ์ View ดูได้อย่างเดียว ไม่สามารถบันทึกเช็คลิสต์ได้</p>}
        </div>
      )}

      {/* ฟอร์มกรอกเช็คลิสต์ */}
      {tab === "fill" && activeTemplate && (
        <form onSubmit={handleSubmit} className={`rounded-2xl border p-5 space-y-4 ${card}`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className={`text-base font-bold ${textMain}`}>{activeTemplate.name}</div>
              <div className="text-[11px] text-gray-400 mt-0.5">
                Line <span className="text-blue-400 font-semibold">{activeTemplate.line_id}</span> · Process {activeTemplate.process} ·
                วันที่ {formatDate(fillDate)}
              </div>
              {activeTemplate.description && (
                <p className={`text-xs mt-2 whitespace-pre-wrap ${isDarkMode ? "text-slate-300" : "text-gray-600"}`}>{activeTemplate.description}</p>
              )}
            </div>
            <div className="text-right">
              <div className={`text-xs font-bold ${textMain}`}>เช็คแล้ว {fillProgress.done}/{fillProgress.total}</div>
              {fillProgress.ng > 0 && <div className="text-[11px] font-bold text-rose-500">NG {fillProgress.ng} รายการ</div>}
            </div>
          </div>

          <div className="space-y-2">
            {activeTemplate.items.map((item, i) => {
              if (isSection(item)) return renderSection(item);
              const v = values[item.id] || {};
              const result = judge(item, v);
              return (
                <div
                  key={item.id}
                  className={`p-3 rounded-xl border space-y-2 ${
                    result === "NG"
                      ? "border-rose-500/50 bg-rose-500/5"
                      : result === "OK"
                      ? "border-emerald-500/40 bg-emerald-500/5"
                      : isDarkMode
                      ? "border-slate-700"
                      : "border-gray-200"
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex-1 min-w-[200px]">
                      <div className={`text-xs font-semibold ${textMain}`}>
                        {itemNumber(activeTemplate.items, i)}. {item.label} {item.is_required && <span className="text-rose-500">*</span>}
                      </div>
                      {item.description && (
                        <div className={`text-[11px] mt-0.5 whitespace-pre-wrap ${isDarkMode ? "text-slate-400" : "text-gray-500"}`}>
                          {item.description}
                        </div>
                      )}
                      {item.check_type === "number" && (
                        <div className="text-[10px] text-gray-400">เกณฑ์: {rangeText(item.min_value, item.max_value, item.unit)}</div>
                      )}
                    </div>

                    {item.check_type === "pass_fail" ? (
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => setValue(item.id, { value_bool: true })}
                          className={`px-4 py-1.5 rounded-lg text-xs font-black border ${
                            v.value_bool === true ? "bg-emerald-600 border-emerald-600 text-white" : "border-emerald-500/40 text-emerald-500 hover:bg-emerald-500/10"
                          }`}
                        >
                          OK
                        </button>
                        <button
                          type="button"
                          onClick={() => setValue(item.id, { value_bool: false })}
                          className={`px-4 py-1.5 rounded-lg text-xs font-black border ${
                            v.value_bool === false ? "bg-rose-600 border-rose-600 text-white" : "border-rose-500/40 text-rose-500 hover:bg-rose-500/10"
                          }`}
                        >
                          NG
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          step="any"
                          inputMode="decimal"
                          value={v.value_number ?? ""}
                          onChange={(e) => setValue(item.id, { value_number: e.target.value })}
                          placeholder="กรอกค่า"
                          className={`${input} w-28 text-right font-mono`}
                        />
                        {item.unit && <span className="text-[11px] text-gray-400">{item.unit}</span>}
                        <span className="w-9 text-center">{resultBadge(result)}</span>
                      </div>
                    )}
                  </div>
                  <input
                    value={v.remark || ""}
                    onChange={(e) => setValue(item.id, { remark: e.target.value })}
                    placeholder={result === "NG" ? "หมายเหตุ / สิ่งที่พบ (แนะนำให้ระบุเมื่อเป็น NG)" : "หมายเหตุ (ไม่บังคับ)"}
                    className={`${input} w-full`}
                  />
                </div>
              );
            })}
          </div>

          <div>
            <label className="text-[11px] font-bold text-gray-400 block mb-1">หมายเหตุรวม (ไม่บังคับ)</label>
            <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} className={`${input} w-full`} />
          </div>

          <div className={`flex justify-end gap-2 pt-3 border-t ${isDarkMode ? "border-slate-700" : "border-gray-100"}`}>
            <button
              type="button"
              onClick={() => setActiveTemplate(null)}
              className={`px-4 py-2 rounded-xl text-xs font-semibold border ${isDarkMode ? "border-slate-700 text-slate-300" : "border-gray-200 text-gray-600"}`}
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white shadow-md shadow-blue-500/20 disabled:opacity-60"
            >
              {submitting ? "กำลังบันทึก..." : "บันทึกและส่งอนุมัติ"}
            </button>
          </div>
        </form>
      )}

      {/* ===================== แท็บ: ประวัติ / อนุมัติ ===================== */}
      {tab === "history" && (
        <div className="space-y-4">
          <div className={`rounded-2xl border p-4 flex flex-wrap items-end gap-3 ${card}`}>
            <div>
              <label className="text-[11px] font-bold text-gray-400 block mb-1">ตั้งแต่</label>
              <input type="date" value={histFrom} onChange={(e) => setHistFrom(e.target.value)} className={input} />
            </div>
            <div>
              <label className="text-[11px] font-bold text-gray-400 block mb-1">ถึง</label>
              <input type="date" value={histTo} onChange={(e) => setHistTo(e.target.value)} className={input} />
            </div>
            <div>
              <label className="text-[11px] font-bold text-gray-400 block mb-1">Line</label>
              <select value={histLine} onChange={(e) => setHistLine(e.target.value)} className={input}>
                <option value="">ทุก Line</option>
                {lines.map((l) => (
                  <option key={l.id} value={l.id}>{l.id}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[11px] font-bold text-gray-400 block mb-1">สถานะ</label>
              <select value={histStatus} onChange={(e) => setHistStatus(e.target.value)} className={input}>
                <option value="">ทั้งหมด</option>
                <option value="pending">รออนุมัติ</option>
                <option value="approved">อนุมัติแล้ว</option>
                <option value="rejected">ไม่อนุมัติ</option>
              </select>
            </div>
            <label className="flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer select-none pb-2">
              <input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} />
              เฉพาะที่รอฉันอนุมัติ
            </label>
            <div className="ml-auto flex gap-2">
              <button
                type="button"
                onClick={handleExportCsv}
                disabled={exporting}
                title="ดาวน์โหลด CSV ตามช่วงวันที่ / Line / สถานะ ที่เลือก (เปิดด้วย Excel ได้)"
                className="px-4 py-2 rounded-xl text-xs font-bold border border-emerald-500/50 text-emerald-500 hover:bg-emerald-500/10 disabled:opacity-50"
              >
                {exporting ? "กำลัง Export..." : "⬇ Export CSV"}
              </button>
              <button
                type="button"
                onClick={loadRecords}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white"
              >
                {loadingRecords ? "กำลังโหลด..." : "Refresh"}
              </button>
            </div>
          </div>

          <div className={`rounded-2xl border overflow-hidden ${card}`}>
            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full text-left text-xs whitespace-nowrap">
                <thead className={`uppercase text-[10px] tracking-wider border-b ${isDarkMode ? "bg-slate-800/60 text-slate-400 border-slate-700" : "bg-gray-50 text-gray-500 border-gray-200"}`}>
                  <tr>
                    <th className="p-3 pl-4">วันที่ / กะ</th>
                    <th className="p-3">Line / Process</th>
                    <th className="p-3">เช็คลิสต์</th>
                    <th className="p-3 text-center">ผล</th>
                    <th className="p-3">สถานะ</th>
                    <th className="p-3">ผู้เช็ค</th>
                    <th className="p-3 pr-4"></th>
                  </tr>
                </thead>
                <tbody className={`divide-y ${isDarkMode ? "divide-slate-700/50" : "divide-gray-100"}`}>
                  {visibleRecords.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-8 text-center text-gray-400">
                        {loadingRecords ? "กำลังโหลด..." : "ไม่พบใบเช็คลิสต์"}
                      </td>
                    </tr>
                  ) : (
                    visibleRecords.map((r) => (
                      <tr key={r.id} className={isDarkMode ? "hover:bg-slate-700/30" : "hover:bg-gray-50"}>
                        <td className={`p-3 pl-4 ${textMain}`}>
                          {formatDate(r.check_date)}
                        </td>
                        <td className="p-3">
                          <span className="text-blue-400 font-semibold">{r.line_id}</span> <span className="text-gray-400">/ {r.process}</span>
                        </td>
                        <td className={`p-3 max-w-[260px] truncate ${textMain}`}>{r.template_name}</td>
                        <td className="p-3 text-center">
                          {resultBadge(r.overall_result)}
                          {r.ng_count > 0 && <div className="text-[10px] text-rose-400 mt-0.5">{r.ng_count} NG</div>}
                        </td>
                        <td className="p-3">
                          <div className="flex items-center gap-1.5">
                            {statusBadge(r)}
                            {r.can_approve && <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" title="รอคุณอนุมัติ" />}
                          </div>
                        </td>
                        <td className="p-3 text-gray-400">{r.checked_by_name || `#${r.checked_by}`}</td>
                        <td className="p-3 pr-4 text-right">
                          <button
                            type="button"
                            onClick={() => openDetail(r.id)}
                            className={`px-3 py-1 rounded-lg text-[11px] font-bold border ${
                              r.can_approve
                                ? "bg-amber-500 border-amber-500 text-white hover:bg-amber-600"
                                : "border-blue-500/40 text-blue-500 hover:bg-blue-500/10"
                            }`}
                          >
                            {r.can_approve ? "อนุมัติ" : "Details"}
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ===================== Modal: รายละเอียดใบเช็ค ===================== */}
      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className={`w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl border p-6 space-y-5 shadow-2xl ${card}`}>
            <div className={`flex items-start justify-between gap-3 pb-3 border-b ${isDarkMode ? "border-slate-700" : "border-gray-200"}`}>
              <div>
                <div className={`text-base font-bold ${textMain}`}>{detail.template_name}</div>
                <div className="text-[11px] text-gray-400 mt-0.5">
                  Line <span className="text-blue-400 font-semibold">{detail.line_id}</span> · {detail.process} · {formatDate(detail.check_date)} ·
                  เช็คโดย {detail.checked_by_name || `#${detail.checked_by}`} ({formatDateTime(detail.created_at)})
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {resultBadge(detail.overall_result)}
                {statusBadge(detail)}
                <button type="button" onClick={() => setDetail(null)} className="ml-1 opacity-60 hover:opacity-100 text-sm">✕</button>
              </div>
            </div>

            {/* ผลการเช็ค */}
            <div className="space-y-1.5">
              {detail.values.map((v, i) => isSection(v) ? renderSection(v) : (
                <div
                  key={v.id}
                  className={`flex flex-wrap items-center gap-3 p-2.5 rounded-xl border text-xs ${
                    v.result === "NG" ? "border-rose-500/40 bg-rose-500/5" : isDarkMode ? "border-slate-700" : "border-gray-200"
                  }`}
                >
                  <div className="flex-1 min-w-[200px]">
                    <div className={`font-semibold ${textMain}`}>{itemNumber(detail.values, i)}. {v.label}</div>
                    {v.description && <div className="text-[10px] text-gray-400 whitespace-pre-wrap">{v.description}</div>}
                    {v.check_type === "number" && (
                      <div className="text-[10px] text-gray-400">เกณฑ์: {rangeText(v.min_value, v.max_value, v.unit)}</div>
                    )}
                    {v.remark && <div className="text-[11px] text-amber-500 mt-0.5">หมายเหตุ: {v.remark}</div>}
                  </div>
                  {v.check_type === "number" && (
                    <span className={`font-mono font-bold ${textMain}`}>
                      {v.value_number ?? "-"} {v.unit || ""}
                    </span>
                  )}
                  <span className="w-9 text-center">{resultBadge(v.result)}</span>
                </div>
              ))}
            </div>

            {detail.note && (
              <div className={`p-3 rounded-xl border text-xs whitespace-pre-wrap ${isDarkMode ? "border-slate-700 text-slate-300" : "border-gray-200 text-gray-600"}`}>
                <span className="font-bold text-gray-400 block mb-1">หมายเหตุรวม</span>
                {detail.note}
              </div>
            )}

            {/* ขั้นตอนการอนุมัติ */}
            <div className="space-y-2">
              <span className={`text-xs font-bold ${textMain}`}>ขั้นตอนการอนุมัติ</span>
              {detail.approval_steps.length === 0 ? (
                <div className="text-[11px] text-gray-400">แม่แบบนี้ไม่ต้องอนุมัติ</div>
              ) : (
                <div className="space-y-1.5">
                  {detail.approval_steps.map((pos, idx) => {
                    const act = [...detail.approvals].reverse().find((a) => a.step_index === idx);
                    const isCurrent = detail.status === "pending" && detail.current_step === idx;
                    return (
                      <div
                        key={`${pos}_${idx}`}
                        className={`flex flex-wrap items-center gap-3 p-2.5 rounded-xl border text-xs ${
                          act?.action === "approve"
                            ? "border-emerald-500/40 bg-emerald-500/5"
                            : act?.action === "reject"
                            ? "border-rose-500/40 bg-rose-500/5"
                            : isCurrent
                            ? "border-amber-500/50 bg-amber-500/5"
                            : isDarkMode
                            ? "border-slate-700"
                            : "border-gray-200"
                        }`}
                      >
                        <span className="w-6 h-6 rounded-full bg-blue-600 text-white text-[10px] font-bold flex items-center justify-center shrink-0">{idx + 1}</span>
                        <span className={`font-semibold w-32 ${textMain}`}>{positionLabel(pos)}</span>
                        <span className="flex-1 text-gray-400">
                          {act ? (
                            <>
                              <span className={act.action === "approve" ? "text-emerald-500 font-bold" : "text-rose-500 font-bold"}>
                                {act.action === "approve" ? "อนุมัติ" : "ไม่อนุมัติ"}
                              </span>{" "}
                              โดย {act.approver_name || `#${act.approved_by}`} · {formatDateTime(act.created_at)}
                              {act.comment && <span className="block text-[11px] mt-0.5">"{act.comment}"</span>}
                            </>
                          ) : isCurrent ? (
                            <span className="text-amber-500 font-semibold">รออนุมัติ</span>
                          ) : (
                            "-"
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {detail.can_approve && (
              <div className={`p-4 rounded-xl border space-y-2 ${isDarkMode ? "border-amber-500/40 bg-amber-500/5" : "border-amber-300 bg-amber-50"}`}>
                <span className={`text-xs font-bold ${textMain}`}>คุณเป็นผู้อนุมัติขั้นนี้ ({positionLabel(detail.pending_position)})</span>
                <textarea
                  rows={2}
                  value={reviewComment}
                  onChange={(e) => setReviewComment(e.target.value)}
                  placeholder="ความเห็น (บังคับเมื่อไม่อนุมัติ)"
                  className={`${input} w-full`}
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    disabled={reviewing}
                    onClick={() => handleReview("reject")}
                    className="px-4 py-2 rounded-xl text-xs font-bold border border-rose-500/50 text-rose-500 hover:bg-rose-500/10 disabled:opacity-50"
                  >
                    ไม่อนุมัติ
                  </button>
                  <button
                    type="button"
                    disabled={reviewing}
                    onClick={() => handleReview("approve")}
                    className="px-5 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50"
                  >
                    {reviewing ? "กำลังบันทึก..." : "อนุมัติ"}
                  </button>
                </div>
              </div>
            )}

            <div className={`flex justify-between pt-3 border-t ${isDarkMode ? "border-slate-700" : "border-gray-200"}`}>
              <div>
                {isAdmin && (
                  <button
                    type="button"
                    onClick={handleDeleteRecord}
                    className="px-4 py-2 rounded-xl text-xs font-bold border border-rose-500/40 text-rose-500 hover:bg-rose-500/10"
                  >
                    ลบใบนี้ (Admin)
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => setDetail(null)}
                className="px-5 py-2 rounded-xl text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white"
              >
                ปิด
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
