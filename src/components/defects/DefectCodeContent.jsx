import { useState, useEffect, useMemo, useCallback } from "react";

// 🧯 Defect Code — อาการงานเสียของแต่ละ Station ของ MES (ใช้ใน popup "งานเสีย" ของหน้า /MES)
//  ข้อมูลเก็บใน automation_lines.defect_codes (API: src/api/routes/defects.js)
//  แก้ไขได้: admin, me, q / Station ดึงจาก MES (/api/mes/lineinfo) — ชื่อต้องตรงกับ Station ใน MES
const API_URL = "/api";
const EDIT_ROLES = ["admin", "me", "q"];
const EMPTY_FORM = { id: null, defect_code: "", description: "", is_active: true };

const authHeaders = () => {
  const token = localStorage.getItem("token") || localStorage.getItem("sessionToken");
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
};

export default function DefectCodeContent({ isDarkMode = false, userRole = "" }) {
  const canEdit = EDIT_ROLES.includes(userRole);
  const [mesStations, setMesStations] = useState([]); // [{ line, station }]
  const [mesError, setMesError] = useState("");
  const [codes, setCodes] = useState([]);
  const [lineFilter, setLineFilter] = useState("");
  const [search, setSearch] = useState("");
  const [station, setStation] = useState("");
  const [manualStation, setManualStation] = useState("");
  const [form, setForm] = useState(EMPTY_FORM);
  const [message, setMessage] = useState(null);
  const [saving, setSaving] = useState(false);
  // คัดลอกไป Station อื่น: เลือกแถว (ไม่เลือก = ทั้งหมด) + Station ปลายทางหลายตัว
  const [selected, setSelected] = useState(() => new Set());
  const [copy, setCopy] = useState(null); // { line, search, targets: Set, manual }

  const loadCodes = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/defect-codes`, { headers: authHeaders() });
      const data = await res.json().catch(() => ({}));
      if (data.success) setCodes(data.data);
      else setMessage({ type: "error", text: data.message || `โหลดรายการไม่ได้ (HTTP ${res.status})` });
    } catch (err) {
      setMessage({ type: "error", text: `โหลดรายการไม่ได้: ${err.message}` });
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(loadCodes, 0);
    (async () => {
      try {
        const res = await fetch(`${API_URL}/mes/lineinfo`, { headers: authHeaders() });
        const data = await res.json().catch(() => ({}));
        if (data.success) setMesStations(data.data.map((r) => ({ line: r.line, station: r.station })));
        else setMesError(data.message || `HTTP ${res.status}`);
      } catch (err) {
        setMesError(err.message);
      }
    })();
    return () => clearTimeout(timer);
  }, [loadCodes]);

  const lines = useMemo(() => [...new Set(mesStations.map((s) => s.line))].sort(), [mesStations]);
  const countByStation = useMemo(() => {
    const m = {};
    codes.forEach((c) => {
      m[c.station_name] = (m[c.station_name] || 0) + 1;
    });
    return m;
  }, [codes]);

  // รายชื่อ Station: จาก MES (กรองตาม Line) + Station ที่มีอาการอยู่แล้วแต่ไม่อยู่ใน MES ตอนนี้
  const stationList = useMemo(() => {
    const fromMes = mesStations.filter((s) => !lineFilter || s.line === lineFilter).map((s) => s.station);
    const extra = lineFilter ? [] : Object.keys(countByStation);
    const q = search.trim().toLowerCase();
    return [...new Set([...fromMes, ...extra])].filter((s) => !q || s.toLowerCase().includes(q)).sort();
  }, [mesStations, lineFilter, countByStation, search]);

  const stationCodes = codes.filter((c) => c.station_name === station);

  const selectStation = (name) => {
    setStation(name);
    setForm(EMPTY_FORM);
    setMessage(null);
    setSelected(new Set());
    setCopy(null);
  };

  const toggleSelected = (id) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Station ปลายทางที่เลือกได้ (จาก MES + ที่มีอาการอยู่แล้ว) ไม่รวม Station ต้นทาง
  const copyCandidates = useMemo(() => {
    if (!copy) return [];
    const fromMes = mesStations.filter((s) => !copy.line || s.line === copy.line).map((s) => s.station);
    const extra = copy.line ? [] : Object.keys(countByStation);
    const q = copy.search.trim().toLowerCase();
    return [...new Set([...fromMes, ...extra])].filter((s) => s !== station && (!q || s.toLowerCase().includes(q))).sort();
  }, [copy, mesStations, countByStation, station]);

  const toggleTarget = (name) =>
    setCopy((prev) => {
      const targets = new Set(prev.targets);
      if (targets.has(name)) targets.delete(name);
      else targets.add(name);
      return { ...prev, targets };
    });

  const doCopy = async () => {
    const targets = [...copy.targets];
    if (targets.length === 0) return;
    const ids = selected.size > 0 ? [...selected] : null;
    const count = ids ? ids.length : stationCodes.length;
    if (!window.confirm(`คัดลอก ${count} อาการ จาก ${station} ไป ${targets.length} Station:\n${targets.join(", ")}\n\n(รหัสที่ปลายทางมีอยู่แล้วจะข้าม ไม่ทับของเดิม)`)) return;
    setSaving(true);
    try {
      const res = await fetch(`${API_URL}/defect-codes/copy`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ from_station: station, to_stations: targets, ids }),
      });
      const data = await res.json().catch(() => ({}));
      if (!data.success) throw new Error(data.message || `HTTP ${res.status}`);
      const skipped = count * targets.length - data.inserted;
      setMessage({ type: "ok", text: `คัดลอกแล้ว ${data.inserted} รายการ ไป ${targets.length} Station${skipped > 0 ? ` (ข้าม ${skipped} รายการที่มีอยู่แล้ว)` : ""}` });
      setCopy(null);
      setSelected(new Set());
      loadCodes();
    } catch (err) {
      setMessage({ type: "error", text: `คัดลอกไม่สำเร็จ: ${err.message}` });
    } finally {
      setSaving(false);
    }
  };

  const save = async (e) => {
    e.preventDefault();
    if (!station) return;
    setSaving(true);
    try {
      const res = await fetch(`${API_URL}/defect-codes${form.id ? `/${form.id}` : ""}`, {
        method: form.id ? "PUT" : "POST",
        headers: authHeaders(),
        body: JSON.stringify({ station_name: station, defect_code: form.defect_code, description: form.description, is_active: form.is_active }),
      });
      const data = await res.json().catch(() => ({}));
      if (!data.success) throw new Error(data.message || `HTTP ${res.status}`);
      setMessage({ type: "ok", text: form.id ? "แก้ไขแล้ว" : `เพิ่ม ${data.data.defect_code} แล้ว` });
      setForm(EMPTY_FORM);
      loadCodes();
    } catch (err) {
      setMessage({ type: "error", text: `บันทึกไม่สำเร็จ: ${err.message}` });
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (c) => {
    const res = await fetch(`${API_URL}/defect-codes/${c.id}`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ ...c, is_active: !c.is_active }),
    });
    const data = await res.json().catch(() => ({}));
    if (!data.success) setMessage({ type: "error", text: data.message || "แก้ไขไม่สำเร็จ" });
    loadCodes();
  };

  const remove = async (c) => {
    if (!window.confirm(`ลบ ${c.defect_code} — ${c.description} ?\n(ประวัติงานเสียเดิมยังอยู่)`)) return;
    const res = await fetch(`${API_URL}/defect-codes/${c.id}`, { method: "DELETE", headers: authHeaders() });
    const data = await res.json().catch(() => ({}));
    if (!data.success) setMessage({ type: "error", text: data.message || "ลบไม่สำเร็จ" });
    if (form.id === c.id) setForm(EMPTY_FORM);
    loadCodes();
  };

  // ---------- styles ----------
  const card = isDarkMode ? "bg-[#1E293B] border-slate-700/60" : "bg-white border-gray-200";
  const textMain = isDarkMode ? "text-slate-100" : "text-gray-800";
  const input = `px-3 py-2 rounded-xl border text-sm outline-none focus:border-blue-500 ${
    isDarkMode ? "bg-slate-900 border-slate-700 text-slate-100" : "bg-white border-gray-300 text-gray-800"
  }`;
  const btnPrimary = "px-4 py-2 rounded-xl text-sm font-bold bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-40";
  const btnGhost = `px-3 py-1.5 rounded-lg text-xs font-bold border ${isDarkMode ? "border-slate-600 text-slate-300" : "border-gray-300 text-gray-600"}`;

  return (
    <div className="space-y-4">
      <div>
        <h2 className={`text-2xl font-bold ${textMain}`}>Defect Code</h2>
        <p className="text-xs text-gray-400 mt-1">
          อาการงานเสียของแต่ละ Station ของ MES — หน้า /MES กด "งานเสีย" ที่ Station แล้วเลือกจากรายการนี้ ส่งไป MES เป็น testData
          <span className="font-mono"> [SN/FAIL];[รหัส/อาการ];[รหัสพนักงาน]</span>
          {!canEdit && " · ดูได้อย่างเดียว (แก้ไขได้เฉพาะ Admin / ME / Q)"}
        </p>
      </div>

      {message && (
        <div className={`px-4 py-2 rounded-xl text-sm font-bold ${message.type === "ok" ? "bg-emerald-500/15 text-emerald-500" : "bg-rose-500/15 text-rose-500"}`}>
          {message.text}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
        {/* Station */}
        <div className={`rounded-2xl border p-4 space-y-3 ${card}`}>
          <div className={`text-sm font-bold ${textMain}`}>Station (จาก MES)</div>
          <div className="flex gap-2">
            <select className={`${input} w-32`} value={lineFilter} onChange={(e) => setLineFilter(e.target.value)}>
              <option value="">ทุก Line</option>
              {lines.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
            <input className={`${input} flex-1 min-w-0`} placeholder="ค้นหา Station" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          {mesError && (
            <div className="text-[11px] text-amber-500">
              ดึง Station จาก MES ไม่ได้ ({mesError}) — พิมพ์ชื่อ Station เองได้ด้านล่าง
            </div>
          )}
          <div className="max-h-[55vh] overflow-y-auto space-y-1">
            {stationList.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => selectStation(s)}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm text-left ${
                  station === s ? "bg-blue-600 text-white font-bold" : `${textMain} ${isDarkMode ? "hover:bg-slate-800" : "hover:bg-gray-100"}`
                }`}
              >
                <span className="truncate">{s}</span>
                {countByStation[s] > 0 && (
                  <span className={`text-[11px] px-2 rounded-full ${station === s ? "bg-white/25" : "bg-rose-500/15 text-rose-500"}`}>{countByStation[s]}</span>
                )}
              </button>
            ))}
            {stationList.length === 0 && <div className="text-xs text-gray-400">ไม่พบ Station</div>}
          </div>
          <form
            className="flex gap-2 pt-2 border-t border-gray-500/20"
            onSubmit={(e) => {
              e.preventDefault();
              if (manualStation.trim()) selectStation(manualStation.trim());
              setManualStation("");
            }}
          >
            <input className={`${input} flex-1 min-w-0`} placeholder="พิมพ์ชื่อ Station ตาม MES" value={manualStation} onChange={(e) => setManualStation(e.target.value)} />
            <button type="submit" className={btnGhost}>เลือก</button>
          </form>
        </div>

        {/* อาการของ Station ที่เลือก */}
        <div className={`rounded-2xl border p-4 space-y-4 ${card}`}>
          {!station ? (
            <div className="text-sm text-gray-400 py-10 text-center">เลือก Station ทางซ้าย</div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className={`text-lg font-black ${textMain}`}>
                  อาการเสียของ Station <span className="text-blue-500">{station}</span>
                </div>
                {canEdit && stationCodes.length > 0 && !copy && (
                  <button type="button" className={btnGhost}
                    onClick={() => setCopy({ line: lineFilter, search: "", targets: new Set(), manual: "" })}>
                    ⧉ คัดลอกไป Station อื่น {selected.size > 0 ? `(${selected.size} ที่เลือก)` : "(ทั้งหมด)"}
                  </button>
                )}
              </div>

              {copy && (
                <div className={`rounded-xl border-2 border-dashed border-blue-500/50 p-3 space-y-2 ${isDarkMode ? "bg-slate-900/40" : "bg-blue-50/40"}`}>
                  <div className={`text-sm font-bold ${textMain}`}>
                    คัดลอก {selected.size > 0 ? `${selected.size} อาการที่เลือก` : `ทั้งหมด ${stationCodes.length} อาการ`} ไปที่ Station
                    <span className="text-xs font-normal text-gray-400"> — ติ๊กเลือกแถวในตารางด้านล่างถ้าต้องการบางอาการ / รหัสที่ปลายทางมีอยู่แล้วจะข้าม</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <select className={`${input} w-32`} value={copy.line} onChange={(e) => setCopy({ ...copy, line: e.target.value })}>
                      <option value="">ทุก Line</option>
                      {lines.map((l) => <option key={l} value={l}>{l}</option>)}
                    </select>
                    <input className={`${input} flex-1 min-w-[160px]`} placeholder="ค้นหา Station" value={copy.search}
                      onChange={(e) => setCopy({ ...copy, search: e.target.value })} />
                    <button type="button" className={btnGhost}
                      onClick={() => setCopy({ ...copy, targets: new Set([...copy.targets, ...copyCandidates]) })}>เลือกทั้งหมดที่แสดง</button>
                    <button type="button" className={btnGhost} onClick={() => setCopy({ ...copy, targets: new Set() })}>ล้าง</button>
                  </div>
                  <div className="max-h-48 overflow-y-auto grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-1">
                    {copyCandidates.map((s) => (
                      <label key={s} className={`flex items-center gap-2 px-2 py-1 rounded-lg text-xs cursor-pointer ${textMain} ${
                        copy.targets.has(s) ? "bg-blue-600/15 font-bold" : isDarkMode ? "hover:bg-slate-800" : "hover:bg-gray-100"
                      }`}>
                        <input type="checkbox" checked={copy.targets.has(s)} onChange={() => toggleTarget(s)} />
                        <span className="truncate">{s}</span>
                        {countByStation[s] > 0 && <span className="text-[10px] text-rose-500">({countByStation[s]})</span>}
                      </label>
                    ))}
                    {copyCandidates.length === 0 && <div className="text-xs text-gray-400">ไม่พบ Station</div>}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <input className={`${input} w-56`} placeholder="หรือพิมพ์ชื่อ Station เอง" value={copy.manual}
                      onChange={(e) => setCopy({ ...copy, manual: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && copy.manual.trim()) {
                          e.preventDefault();
                          setCopy({ ...copy, manual: "", targets: new Set([...copy.targets, copy.manual.trim()]) });
                        }
                      }} />
                    <div className="flex-1 text-xs text-gray-400 truncate">
                      ปลายทาง {copy.targets.size} Station{copy.targets.size > 0 ? `: ${[...copy.targets].join(", ")}` : ""}
                    </div>
                    <button type="button" className={btnGhost} onClick={() => setCopy(null)}>ยกเลิก</button>
                    <button type="button" className={btnPrimary} disabled={saving || copy.targets.size === 0} onClick={doCopy}>
                      คัดลอก
                    </button>
                  </div>
                </div>
              )}

              {canEdit && (
                <form onSubmit={save} className="flex flex-wrap items-end gap-2">
                  <div>
                    <div className="text-[11px] font-bold text-gray-400 mb-1">รหัสอาการ</div>
                    <input className={`${input} w-40 font-mono`} placeholder="FMFT00001" value={form.defect_code}
                      onChange={(e) => setForm({ ...form, defect_code: e.target.value })} required maxLength={50} />
                  </div>
                  <div className="flex-1 min-w-[220px]">
                    <div className="text-[11px] font-bold text-gray-400 mb-1">อาการ / คำอธิบาย</div>
                    <input className={`${input} w-full`} placeholder="Function Test - No turn" value={form.description}
                      onChange={(e) => setForm({ ...form, description: e.target.value })} required maxLength={200} />
                  </div>
                  <button type="submit" className={btnPrimary} disabled={saving}>{form.id ? "บันทึกการแก้ไข" : "+ เพิ่มอาการ"}</button>
                  {form.id && <button type="button" className={btnGhost} onClick={() => setForm(EMPTY_FORM)}>ยกเลิก</button>}
                </form>
              )}

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-gray-400 text-left text-xs">
                    <tr>
                      {canEdit && (
                        <th className="px-3 py-2 w-8">
                          <input type="checkbox" title="เลือกทั้งหมด (สำหรับคัดลอก)"
                            checked={stationCodes.length > 0 && stationCodes.every((c) => selected.has(c.id))}
                            onChange={(e) => setSelected(e.target.checked ? new Set(stationCodes.map((c) => c.id)) : new Set())} />
                        </th>
                      )}
                      <th className="px-3 py-2">รหัส</th>
                      <th className="px-3 py-2">อาการ</th>
                      <th className="px-3 py-2">สถานะ</th>
                      {canEdit && <th className="px-3 py-2 text-right">จัดการ</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {stationCodes.map((c) => (
                      <tr key={c.id} className={`border-t ${isDarkMode ? "border-slate-700/60" : "border-gray-100"} ${c.is_active ? "" : "opacity-50"}`}>
                        {canEdit && (
                          <td className="px-3 py-2">
                            <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleSelected(c.id)} />
                          </td>
                        )}
                        <td className={`px-3 py-2 font-mono font-bold ${textMain}`}>{c.defect_code}</td>
                        <td className={`px-3 py-2 ${textMain}`}>{c.description}</td>
                        <td className="px-3 py-2">
                          <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${c.is_active ? "bg-emerald-500/15 text-emerald-500" : "bg-gray-500/15 text-gray-400"}`}>
                            {c.is_active ? "ใช้งาน" : "ปิดใช้งาน"}
                          </span>
                        </td>
                        {canEdit && (
                          <td className="px-3 py-2 text-right whitespace-nowrap space-x-1">
                            <button type="button" className={btnGhost}
                              onClick={() => setForm({ id: c.id, defect_code: c.defect_code, description: c.description, is_active: c.is_active })}>แก้ไข</button>
                            <button type="button" className={btnGhost} onClick={() => toggleActive(c)}>{c.is_active ? "ปิด" : "เปิด"}</button>
                            <button type="button" className={`${btnGhost} text-rose-500`} onClick={() => remove(c)}>ลบ</button>
                          </td>
                        )}
                      </tr>
                    ))}
                    {stationCodes.length === 0 && (
                      <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-400 text-xs">ยังไม่มีอาการเสียของ Station นี้</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
