import React, { useState, useEffect, useMemo, useCallback } from "react";
import { socket } from "../../socket";

// 📋 Create Daily PM Checklist: สร้าง/แก้ไข แม่แบบเช็คลิสต์ (Line, Process, รายการเช็ค, ลำดับผู้อนุมัติ)
const API_URL = "/api";

const getHeaders = () => {
  const token = localStorage.getItem("token") || localStorage.getItem("sessionToken");
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
    "x-session-token": token,
  };
};

const newItem = (checkType = "pass_fail") => ({
  key: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
  label: "",
  description: "",
  check_type: checkType,
  unit: "",
  min_value: "",
  max_value: "",
  is_required: true,
});

const emptyForm = () => ({
  id: null,
  name: "",
  line_id: "",
  process: "",
  description: "",
  approval_steps: [],
  items: [newItem()],
});

const moveInArray = (arr, index, delta) => {
  const target = index + delta;
  if (target < 0 || target >= arr.length) return arr;
  const copy = [...arr];
  [copy[index], copy[target]] = [copy[target], copy[index]];
  return copy;
};

export default function PmChecklistBuilder({ isDarkMode }) {
  const userRole = (localStorage.getItem("userRole") || "").toLowerCase().trim();
  const canEdit = ["admin", "me"].includes(userRole);

  const [templates, setTemplates] = useState([]);
  const [lines, setLines] = useState([]);
  const [positions, setPositions] = useState([]);
  const [stations, setStations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  const [filterLine, setFilterLine] = useState("");
  const [search, setSearch] = useState("");
  const [form, setForm] = useState(emptyForm);

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

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      try {
        const [resLines, resPositions] = await Promise.all([
          fetch(`${API_URL}/lines`, { headers: getHeaders() }),
          fetch(`${API_URL}/pm/positions`, { headers: getHeaders() }),
        ]);
        const linesData = await resLines.json();
        const positionsData = await resPositions.json();
        setLines(Array.isArray(linesData) ? linesData : []);
        if (positionsData.success) setPositions(positionsData.data);
        await loadTemplates();
      } catch (err) {
        console.error("Init PM builder error:", err);
        setMessage({ type: "error", text: "โหลดข้อมูลไม่สำเร็จ" });
      } finally {
        setLoading(false);
      }
    };
    init();

    const handlePmUpdated = (payload) => {
      if (payload?.type === "template") loadTemplates();
    };
    socket.on("pm_updated", handlePmUpdated);
    return () => socket.off("pm_updated", handlePmUpdated);
  }, [loadTemplates]);

  // โหลด Station ของ Line ที่เลือก ไว้เป็นตัวช่วยกรอก Process
  useEffect(() => {
    if (!form.line_id) {
      setStations([]);
      return;
    }
    let cancelled = false;
    fetch(`${API_URL}/lines/${encodeURIComponent(form.line_id)}/stations`, { headers: getHeaders() })
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setStations(data.success && Array.isArray(data.data) ? data.data : []);
      })
      .catch(() => !cancelled && setStations([]));
    return () => {
      cancelled = true;
    };
  }, [form.line_id]);

  const filteredTemplates = useMemo(() => {
    const q = search.trim().toLowerCase();
    return templates.filter((t) => {
      if (filterLine && t.line_id !== filterLine) return false;
      if (!q) return true;
      return [t.name, t.process, t.line_id].some((v) => String(v || "").toLowerCase().includes(q));
    });
  }, [templates, filterLine, search]);

  const updateForm = (patch) => setForm((prev) => ({ ...prev, ...patch }));

  const updateItem = (index, patch) =>
    setForm((prev) => ({
      ...prev,
      items: prev.items.map((it, i) => (i === index ? { ...it, ...patch } : it)),
    }));

  const handleEdit = (t) => {
    setMessage(null);
    setForm({
      id: t.id,
      name: t.name,
      line_id: t.line_id,
      process: t.process,
      description: t.description || "",
      approval_steps: Array.isArray(t.approval_steps) ? t.approval_steps : [],
      items: (t.items || []).map((it) => ({
        key: `item_${it.id}`,
        label: it.label,
        description: it.description || "",
        check_type: it.check_type,
        unit: it.unit || "",
        min_value: it.min_value ?? "",
        max_value: it.max_value ?? "",
        is_required: it.is_required !== false,
      })),
    });
  };

  const handleDuplicate = (t) => {
    handleEdit(t);
    setForm((prev) => ({ ...prev, id: null, name: `${prev.name} (สำเนา)` }));
  };

  const handleNew = () => {
    setMessage(null);
    setForm({ ...emptyForm(), line_id: filterLine || "" });
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setMessage(null);
    setSaving(true);
    try {
      const payload = {
        name: form.name,
        line_id: form.line_id,
        process: form.process,
        description: form.description,
        approval_steps: form.approval_steps,
        items: form.items.map((it) => ({
          label: it.label,
          description: it.description,
          check_type: it.check_type,
          unit: it.unit,
          min_value: it.min_value,
          max_value: it.max_value,
          is_required: it.is_required,
        })),
      };
      const isEdit = Boolean(form.id);
      const res = await fetch(`${API_URL}/pm/templates${isEdit ? `/${form.id}` : ""}`, {
        method: isEdit ? "PUT" : "POST",
        headers: getHeaders(),
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "บันทึกไม่สำเร็จ");

      setMessage({ type: "success", text: data.message });
      await loadTemplates();
      if (data.data) handleEdit(data.data);
    } catch (err) {
      setMessage({ type: "error", text: err.message });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!form.id) return;
    if (!window.confirm(`ลบแม่แบบ "${form.name}" ?\n(ใบเช็คที่บันทึกไปแล้วจะยังอยู่ในประวัติ)`)) return;
    setSaving(true);
    try {
      const res = await fetch(`${API_URL}/pm/templates/${form.id}`, { method: "DELETE", headers: getHeaders() });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "ลบไม่สำเร็จ");
      setMessage({ type: "success", text: data.message });
      setForm(emptyForm());
      await loadTemplates();
    } catch (err) {
      setMessage({ type: "error", text: err.message });
    } finally {
      setSaving(false);
    }
  };

  // ---------- styles ----------
  const card = isDarkMode ? "bg-[#1E293B] border-slate-700/60" : "bg-white border-gray-200";
  const input = `w-full px-3 py-2 rounded-xl border text-xs outline-none focus:border-blue-500 ${
    isDarkMode ? "bg-slate-900 border-slate-700 text-slate-100 placeholder-slate-500" : "bg-gray-50 border-gray-200 text-gray-800 placeholder-gray-400"
  }`;
  const label = `text-[11px] font-bold block mb-1 ${isDarkMode ? "text-slate-400" : "text-gray-500"}`;
  const iconBtn = `w-7 h-7 rounded-lg border text-xs flex items-center justify-center transition-colors disabled:opacity-30 ${
    isDarkMode ? "border-slate-700 hover:bg-slate-700 text-slate-300" : "border-gray-200 hover:bg-gray-100 text-gray-600"
  }`;

  if (!canEdit) {
    return (
      <div className={`p-8 rounded-2xl border text-center text-sm ${card} ${isDarkMode ? "text-slate-400" : "text-gray-500"}`}>
        หน้านี้สำหรับ ADMIN และ ME เท่านั้น
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-10">
      <div>
        <h2 className={`text-2xl font-bold ${isDarkMode ? "text-white" : "text-gray-900"}`}>Create Daily PM Checklist</h2>
        <p className={`text-xs mt-1 ${isDarkMode ? "text-slate-400" : "text-gray-500"}`}>
          สร้างแม่แบบเช็คลิสต์ PM ประจำวัน แยกตาม Line และ Process กำหนดรายการที่ต้องเช็ค และลำดับผู้อนุมัติ
        </p>
      </div>

      {message && (
        <div
          className={`p-3 rounded-xl border text-xs font-semibold ${
            message.type === "success"
              ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/30"
              : "bg-rose-500/10 text-rose-500 border-rose-500/30"
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[320px_1fr] gap-5">
        {/* รายการแม่แบบ */}
        <div className={`rounded-2xl border p-4 space-y-3 h-fit ${card}`}>
          <div className="flex items-center justify-between">
            <span className={`text-sm font-bold ${isDarkMode ? "text-white" : "text-gray-800"}`}>
              แม่แบบทั้งหมด ({filteredTemplates.length})
            </span>
            <button
              type="button"
              onClick={handleNew}
              className="px-3 py-1.5 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white"
            >
              + สร้างใหม่
            </button>
          </div>
          <select value={filterLine} onChange={(e) => setFilterLine(e.target.value)} className={input}>
            <option value="">ทุก Line</option>
            {lines.map((l) => (
              <option key={l.id} value={l.id}>{l.id}</option>
            ))}
          </select>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ค้นหาชื่อ / Process..." className={input} />

          <div className="space-y-1.5 max-h-[60vh] overflow-y-auto pr-1 custom-scrollbar">
            {loading ? (
              <div className="py-6 text-center text-xs text-gray-400">กำลังโหลด...</div>
            ) : filteredTemplates.length === 0 ? (
              <div className="py-6 text-center text-xs text-gray-400">ยังไม่มีแม่แบบเช็คลิสต์</div>
            ) : (
              filteredTemplates.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => handleEdit(t)}
                  className={`w-full text-left p-3 rounded-xl border text-xs transition-colors ${
                    form.id === t.id
                      ? "border-blue-500 bg-blue-500/10"
                      : isDarkMode
                      ? "border-slate-700 hover:bg-slate-800"
                      : "border-gray-200 hover:bg-gray-50"
                  }`}
                >
                  <div className={`font-bold truncate ${isDarkMode ? "text-slate-100" : "text-gray-800"}`}>{t.name}</div>
                  <div className="text-[10px] text-gray-400 mt-0.5">
                    <span className="text-blue-400 font-semibold">{t.line_id}</span> · {t.process} ·{" "}
                    {(t.items || []).filter((it) => it.check_type !== "section").length} รายการ
                  </div>
                  <div className="text-[10px] text-gray-400 mt-0.5 truncate">
                    อนุมัติ: {t.approval_steps?.length ? t.approval_steps.map(positionLabel).join(" → ") : "ไม่ต้องอนุมัติ"}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* ฟอร์มแม่แบบ */}
        <form onSubmit={handleSave} className={`rounded-2xl border p-5 space-y-5 ${card}`}>
          <div className="flex items-center justify-between gap-2">
            <span className={`text-sm font-bold ${isDarkMode ? "text-white" : "text-gray-800"}`}>
              {form.id ? `แก้ไขแม่แบบ #${form.id}` : "สร้างแม่แบบใหม่"}
            </span>
            {form.id && (
              <button
                type="button"
                onClick={() => {
                  const t = templates.find((x) => x.id === form.id);
                  if (t) handleDuplicate(t);
                }}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold border ${
                  isDarkMode ? "border-slate-700 text-slate-300 hover:bg-slate-800" : "border-gray-200 text-gray-600 hover:bg-gray-50"
                }`}
              >
                ทำสำเนาเป็นแม่แบบใหม่
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className={label}>ชื่อเช็คลิสต์ *</label>
              <input
                required
                value={form.name}
                onChange={(e) => updateForm({ name: e.target.value })}
                placeholder="เช่น Daily PM เครื่อง Screw ก่อนเริ่มกะ"
                className={input}
              />
            </div>
            <div>
              <label className={label}>Line *</label>
              <select required value={form.line_id} onChange={(e) => updateForm({ line_id: e.target.value })} className={input}>
                <option value="">-- เลือก Line --</option>
                {lines.map((l) => (
                  <option key={l.id} value={l.id}>{l.id}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={label}>Process *</label>
              <input
                required
                list="pm-process-options"
                value={form.process}
                onChange={(e) => updateForm({ process: e.target.value })}
                placeholder={form.line_id ? "เลือก Station หรือพิมพ์ชื่อ Process" : "เลือก Line ก่อน"}
                className={input}
              />
              <datalist id="pm-process-options">
                {stations.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </datalist>
            </div>
            <div className="md:col-span-2">
              <label className={label}>รายละเอียด / วิธีการเช็ค (ไม่บังคับ)</label>
              <textarea
                rows={2}
                value={form.description}
                onChange={(e) => updateForm({ description: e.target.value })}
                className={input}
              />
            </div>
          </div>

          {/* ลำดับผู้อนุมัติ */}
          <div className={`p-4 rounded-xl border space-y-3 ${isDarkMode ? "border-slate-700 bg-slate-900/40" : "border-gray-200 bg-gray-50"}`}>
            <div>
              <span className={`text-xs font-bold ${isDarkMode ? "text-slate-200" : "text-gray-700"}`}>ลำดับผู้อนุมัติ</span>
              <p className="text-[10px] text-gray-400">
                กดเลือกตำแหน่งตามลำดับที่ต้องอนุมัติ (ไม่เลือกเลย = บันทึกแล้วไม่ต้องอนุมัติ) · ตำแหน่ง Line = Owner/Leader/Supervisor ของ Line นั้น ·
                Admin อนุมัติแทนได้ทุกขั้น
              </p>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {positions.map((p) => {
                const selected = form.approval_steps.includes(p.key);
                return (
                  <button
                    key={p.key}
                    type="button"
                    disabled={selected}
                    onClick={() => updateForm({ approval_steps: [...form.approval_steps, p.key] })}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors ${
                      selected
                        ? "opacity-40 cursor-not-allowed border-transparent bg-gray-500/10 text-gray-400"
                        : p.kind === "line"
                        ? "border-amber-500/40 text-amber-500 hover:bg-amber-500/10"
                        : "border-purple-500/40 text-purple-400 hover:bg-purple-500/10"
                    }`}
                  >
                    + {p.label}
                  </button>
                );
              })}
            </div>

            {form.approval_steps.length === 0 ? (
              <div className="text-[11px] text-gray-400 italic">ไม่ต้องอนุมัติ</div>
            ) : (
              <div className="space-y-1.5">
                {form.approval_steps.map((key, i) => (
                  <div
                    key={key}
                    className={`flex items-center gap-2 p-2 rounded-lg border ${isDarkMode ? "border-slate-700 bg-slate-800/60" : "border-gray-200 bg-white"}`}
                  >
                    <span className="w-6 h-6 rounded-full bg-blue-600 text-white text-[10px] font-bold flex items-center justify-center shrink-0">
                      {i + 1}
                    </span>
                    <span className={`flex-1 text-xs font-semibold ${isDarkMode ? "text-slate-200" : "text-gray-700"}`}>{positionLabel(key)}</span>
                    <button type="button" className={iconBtn} disabled={i === 0} onClick={() => updateForm({ approval_steps: moveInArray(form.approval_steps, i, -1) })}>↑</button>
                    <button type="button" className={iconBtn} disabled={i === form.approval_steps.length - 1} onClick={() => updateForm({ approval_steps: moveInArray(form.approval_steps, i, 1) })}>↓</button>
                    <button type="button" className={`${iconBtn} hover:!text-rose-500`} onClick={() => updateForm({ approval_steps: form.approval_steps.filter((k) => k !== key) })}>✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* รายการที่ต้องเช็ค */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className={`text-xs font-bold ${isDarkMode ? "text-slate-200" : "text-gray-700"}`}>
                รายการที่ต้องเช็ค ({form.items.filter((it) => it.check_type !== "section").length})
              </span>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => updateForm({ items: [...form.items, newItem("section")] })}
                  className="px-3 py-1.5 rounded-xl text-xs font-bold border border-amber-500/40 text-amber-500 hover:bg-amber-500/10"
                >
                  + เพิ่มหัวข้อย่อย
                </button>
                <button
                  type="button"
                  onClick={() => updateForm({ items: [...form.items, newItem()] })}
                  className="px-3 py-1.5 rounded-xl text-xs font-bold border border-blue-500/40 text-blue-500 hover:bg-blue-500/10"
                >
                  + เพิ่มรายการ
                </button>
              </div>
            </div>
            <p className="text-[10px] text-gray-400">
              หัวข้อย่อย = ใช้จัดกลุ่มและอธิบายรายการที่อยู่ด้านล่าง (เช่น "ระบบลม", "ระบบไฟฟ้า") ไม่ต้องเช็ค
            </p>

            {form.items.map((it, i) =>
              it.check_type === "section" ? (
                <div
                  key={it.key}
                  className={`p-3 rounded-xl border-l-4 border-amber-500 border space-y-2 ${
                    isDarkMode ? "border-y-slate-700 border-r-slate-700 bg-amber-500/5" : "border-y-gray-200 border-r-gray-200 bg-amber-50"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-black text-amber-500 shrink-0 w-14">หัวข้อย่อย</span>
                    <input
                      required
                      value={it.label}
                      onChange={(e) => updateItem(i, { label: e.target.value })}
                      placeholder="ชื่อหัวข้อ เช่น ระบบลม (Pneumatic)"
                      className={`${input} font-bold`}
                    />
                    <button type="button" className={iconBtn} disabled={i === 0} onClick={() => updateForm({ items: moveInArray(form.items, i, -1) })}>↑</button>
                    <button type="button" className={iconBtn} disabled={i === form.items.length - 1} onClick={() => updateForm({ items: moveInArray(form.items, i, 1) })}>↓</button>
                    <button
                      type="button"
                      className={`${iconBtn} hover:!text-rose-500`}
                      onClick={() => updateForm({ items: form.items.filter((_, idx) => idx !== i) })}
                    >
                      ✕
                    </button>
                  </div>
                  <textarea
                    rows={2}
                    value={it.description}
                    onChange={(e) => updateItem(i, { description: e.target.value })}
                    placeholder="คำอธิบายหัวข้อนี้ (ไม่บังคับ) เช่น เช็คก่อนเปิดเครื่อง, ต้องปิดลมก่อนเช็ค"
                    className={`${input} ml-0 sm:ml-16 sm:w-[calc(100%-4rem)]`}
                  />
                </div>
              ) : (
              <div
                key={it.key}
                className={`p-3 rounded-xl border space-y-2 ${isDarkMode ? "border-slate-700 bg-slate-900/40" : "border-gray-200 bg-gray-50"}`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold text-gray-400 w-6 shrink-0">
                    {form.items.slice(0, i + 1).filter((x) => x.check_type !== "section").length}.
                  </span>
                  <input
                    required
                    value={it.label}
                    onChange={(e) => updateItem(i, { label: e.target.value })}
                    placeholder="สิ่งที่ต้องเช็ค เช่น แรงดันลม, ไฟสถานะ Sensor"
                    className={input}
                  />
                  <button type="button" className={iconBtn} disabled={i === 0} onClick={() => updateForm({ items: moveInArray(form.items, i, -1) })}>↑</button>
                  <button type="button" className={iconBtn} disabled={i === form.items.length - 1} onClick={() => updateForm({ items: moveInArray(form.items, i, 1) })}>↓</button>
                  <button
                    type="button"
                    className={`${iconBtn} hover:!text-rose-500`}
                    disabled={form.items.filter((x) => x.check_type !== "section").length === 1}
                    onClick={() => updateForm({ items: form.items.filter((_, idx) => idx !== i) })}
                  >
                    ✕
                  </button>
                </div>

                <div className="pl-8">
                  <input
                    value={it.description}
                    onChange={(e) => updateItem(i, { description: e.target.value })}
                    placeholder="คำอธิบาย / วิธีเช็ค (ไม่บังคับ) เช่น ดูเกจหน้าเครื่อง ต้องอยู่ในโซนสีเขียว"
                    className={input}
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2 pl-8">
                  <select
                    value={it.check_type}
                    onChange={(e) => updateItem(i, { check_type: e.target.value })}
                    className={`${input} !w-auto`}
                  >
                    <option value="pass_fail">ถูก / ผิด (OK / NG)</option>
                    <option value="number">ตัวเลข (มีเกณฑ์ Min / Max)</option>
                  </select>

                  {it.check_type === "number" && (
                    <>
                      <input
                        type="number"
                        step="any"
                        value={it.min_value}
                        onChange={(e) => updateItem(i, { min_value: e.target.value })}
                        placeholder="Min"
                        className={`${input} !w-24`}
                      />
                      <input
                        type="number"
                        step="any"
                        value={it.max_value}
                        onChange={(e) => updateItem(i, { max_value: e.target.value })}
                        placeholder="Max"
                        className={`${input} !w-24`}
                      />
                      <input
                        value={it.unit}
                        onChange={(e) => updateItem(i, { unit: e.target.value })}
                        placeholder="หน่วย เช่น bar, °C"
                        className={`${input} !w-32`}
                      />
                    </>
                  )}

                  <label className="flex items-center gap-1.5 text-[11px] text-gray-400 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={it.is_required}
                      onChange={(e) => updateItem(i, { is_required: e.target.checked })}
                    />
                    บังคับกรอก
                  </label>
                </div>
                {it.check_type === "number" && (
                  <p className="pl-8 text-[10px] text-gray-400">
                    ค่าที่กรอกอยู่นอกช่วง Min–Max จะถูกตัดสินเป็น NG อัตโนมัติ (เว้นว่างได้ถ้าไม่มีขอบเขตด้านนั้น)
                  </p>
                )}
              </div>
              )
            )}
          </div>

          <div className={`flex flex-wrap items-center justify-between gap-2 pt-4 border-t ${isDarkMode ? "border-slate-700" : "border-gray-100"}`}>
            <div>
              {form.id && (
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={saving}
                  className="px-4 py-2 rounded-xl text-xs font-bold border border-rose-500/40 text-rose-500 hover:bg-rose-500/10"
                >
                  ลบแม่แบบ
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleNew}
                className={`px-4 py-2 rounded-xl text-xs font-semibold border ${
                  isDarkMode ? "border-slate-700 text-slate-300" : "border-gray-200 text-gray-600"
                }`}
              >
                ล้างฟอร์ม
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-5 py-2 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white shadow-md shadow-blue-500/20 disabled:opacity-60"
              >
                {saving ? "กำลังบันทึก..." : form.id ? "บันทึกการแก้ไข" : "สร้างแม่แบบ"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
