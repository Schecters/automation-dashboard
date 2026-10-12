import React, { useState, useEffect, useRef } from "react";

export default function RepairTaskContent({ isDarkMode }) {
  const [linesList, setLinesList] = useState([]);
  const [stationsList, setStationsList] = useState([]);
  const [myRecentTasks, setMyRecentTasks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingStations, setLoadingStations] = useState(false);
  const [loadingRecent, setLoadingRecent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState(null);

  // ดึง role ของผู้ใช้ปัจจุบัน
  const userRole = (localStorage.getItem("userRole") || "").toLowerCase().trim();

  // State ฟอร์มหลัก
  const [formData, setFormData] = useState({
    lines: "",
    station: "",
    problem: "",
    task_type: userRole === "pd" ? "pd_call_me" : "general",
    shift: "a",
  });

  // State สำหรับจัดการหลายรูปภาพ (Multiple Images)
  const [selectedImages, setSelectedImages] = useState([]);
  const [imagePreviews, setImagePreviews] = useState([]);

  // State Modal สำหรับแก้ไข Task
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [editFormData, setEditFormData] = useState({
    lines: "",
    station: "",
    problem: "",
    task_type: "general",
    shift: "a",
  });
  const [editStationsList, setEditStationsList] = useState([]);

  // Modal ดูรายละเอียด Solution & Task Details (Before & After)
  const [viewDetailModalOpen, setViewDetailModalOpen] = useState(false);
  const [taskDetail, setTaskDetail] = useState(null);

  // Lightbox Modal ดูรูปขนาดเต็ม (รองรับการเลื่อนดูรูป)
  const [lightboxImages, setLightboxImages] = useState([]);
  const [lightboxIndex, setLightboxIndex] = useState(0);

  const [lineSearch, setLineSearch] = useState("");
  const [lineOpen, setLineOpen] = useState(false);

  const [stationSearch, setStationSearch] = useState("");
  const [stationOpen, setStationOpen] = useState(false);

  const lineDropdownRef = useRef(null);
  const stationDropdownRef = useRef(null);

  const API_URL = `/api`;

  const getSafeImageUrl = (url) => {
    if (!url) return "";
    let clean = String(url).trim().replace(/^["']|["']$/g, "");
    if (!clean) return "";
    if (clean.startsWith("http://") || clean.startsWith("https://")) {
      try {
        const parsed = new URL(clean);
        return parsed.pathname;
      } catch {
        return clean;
      }
    }
    return clean.startsWith("/") ? clean : `/${clean}`;
  };

  const parsePostgresArray = (data) => {
    if (!data) return [];
    if (Array.isArray(data)) {
      return data
        .flat(Infinity)
        .map((item) => String(item).trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
    }
    if (typeof data === "string") {
      let str = data.trim();
      if (str === "{}" || str === "[]" || str === "" || str === '""') return [];

      if (str.startsWith("{") && str.endsWith("}")) {
        str = str.slice(1, -1);
        return str
          .split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/)
          .map((s) => s.replace(/\\"/g, '"').replace(/^["']|["']$/g, "").trim())
          .filter(Boolean);
      }
      try {
        const parsed = JSON.parse(str);
        if (Array.isArray(parsed)) {
          return parsed.map((s) => String(s).replace(/^["']|["']$/g, "").trim()).filter(Boolean);
        }
        return [String(parsed).replace(/^["']|["']$/g, "").trim()];
      } catch {
        return [str.replace(/^["']|["']$/g, "").trim()];
      }
    }
    return [];
  };

  const extractTaskImages = (task) => {
    if (!task) return [];
    let list = parsePostgresArray(task.images);
    if (list.length === 0 && task.image_url) {
      list = [task.image_url];
    }
    return list.map((img) => getSafeImageUrl(img)).filter(Boolean);
  };

  const extractSolutionImages = (task) => {
    if (!task) return [];
    const rawData = task.solution_images || task.solutionImages || [];
    let list = parsePostgresArray(rawData);
    if (list.length === 0 && task.solution_image_url) {
      list = [task.solution_image_url];
    }
    return list.map((img) => getSafeImageUrl(img)).filter(Boolean);
  };

  const openLightbox = (imageList, initialIndex = 0) => {
    if (!imageList || imageList.length === 0) return;
    setLightboxImages(imageList);
    setLightboxIndex(initialIndex);
  };

  const closeLightbox = () => {
    setLightboxImages([]);
    setLightboxIndex(0);
  };

  const nextLightboxImage = (e) => {
    e?.stopPropagation();
    setLightboxIndex((prev) => (prev + 1) % lightboxImages.length);
  };

  const prevLightboxImage = (e) => {
    e?.stopPropagation();
    setLightboxIndex((prev) => (prev - 1 + lightboxImages.length) % lightboxImages.length);
  };

  const getHeaders = (isMultipart = false) => {
    const token = localStorage.getItem("token") || localStorage.getItem("sessionToken");
    const headers = {
      Authorization: `Bearer ${token}`,
      "x-session-token": token,
    };
    if (!isMultipart) {
      headers["Content-Type"] = "application/json";
    }
    return headers;
  };

  const fetchLines = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/lines`, { headers: getHeaders() });
      if (res.ok) {
        const linesRaw = await res.json();
        const linesData = Array.isArray(linesRaw) ? linesRaw : linesRaw.data || [];
        setLinesList(linesData);
      }
    } catch (err) {
      console.error("Fetch Lines Error:", err);
    } finally {
      setLoading(false);
    }
  };

  const fetchStationsByLine = async (lineId, isForEdit = false) => {
    if (!lineId) {
      if (isForEdit) setEditStationsList([]);
      else {
        setStationsList([]);
        setFormData((prev) => ({ ...prev, station: "" }));
      }
      return;
    }

    if (!isForEdit) setLoadingStations(true);
    try {
      const res = await fetch(`${API_URL}/lines/${encodeURIComponent(lineId)}/stations`, {
        headers: getHeaders(),
      });
      const result = await res.json();
      const stationsData = result.success && Array.isArray(result.data) ? result.data : [];
      if (isForEdit) {
        setEditStationsList(stationsData);
      } else {
        setStationsList(stationsData);
      }
    } catch (err) {
      console.error("Fetch Stations Error:", err);
      if (isForEdit) setEditStationsList([]);
      else setStationsList([]);
    } finally {
      if (!isForEdit) setLoadingStations(false);
    }
  };

  const fetchMyRecentTasks = async () => {
    setLoadingRecent(true);
    try {
      const res = await fetch(`${API_URL}/tasks/my-recent`, { headers: getHeaders() });
      if (res.ok) {
        const tasks = await res.json();
        setMyRecentTasks(Array.isArray(tasks) ? tasks : []);
      }
    } catch (err) {
      console.error("Fetch Recent Tasks Error:", err);
    } finally {
      setLoadingRecent(false);
    }
  };

  useEffect(() => {
    fetchLines();
    fetchMyRecentTasks();

    const handleClickOutside = (e) => {
      if (lineDropdownRef.current && !lineDropdownRef.current.contains(e.target)) {
        setLineOpen(false);
      }
      if (stationDropdownRef.current && !stationDropdownRef.current.contains(e.target)) {
        setStationOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelectLine = (lineId) => {
    setFormData((prev) => ({ ...prev, lines: lineId, station: "" }));
    setLineOpen(false);
    setLineSearch("");
    setStationSearch("");
    fetchStationsByLine(lineId);
  };

  const handleSelectStation = (stationId) => {
    setFormData((prev) => ({ ...prev, station: stationId }));
    setStationOpen(false);
    setStationSearch("");
  };

  // รับไฟล์ทุกประเภท แล้วกรองเฉพาะรูปภาพด้วย JavaScript
  const handleImageChange = (e) => {
    const rawFiles = e.target.files;
    if (!rawFiles || rawFiles.length === 0) return;

    const files = Array.from(rawFiles);
    const validFiles = [];

    for (const file of files) {
      const isImage = file.type.startsWith("image/") || /\.(jpe?g|png|webp|bmp|gif)$/i.test(file.name);
      if (!isImage) {
        alert(`⚠️ ไฟล์ ${file.name} ไม่ใช่ไฟล์รูปภาพ`);
        continue;
      }
      validFiles.push(file);
    }

    if (validFiles.length === 0) return;

    const combined = [...selectedImages, ...validFiles].slice(0, 5);
    setSelectedImages(combined);
    setImagePreviews(combined.map((file) => URL.createObjectURL(file)));
  };

  const handleRemoveSpecificImage = (indexToRemove) => {
    const updatedImages = selectedImages.filter((_, idx) => idx !== indexToRemove);
    const updatedPreviews = imagePreviews.filter((_, idx) => idx !== indexToRemove);
    setSelectedImages(updatedImages);
    setImagePreviews(updatedPreviews);
  };

  const handleClearForm = () => {
    setFormData({
      lines: "",
      station: "",
      problem: "",
      task_type: userRole === "pd" ? "pd_call_me" : "general",
      shift: "a",
    });
    setStationsList([]);
    setLineSearch("");
    setStationSearch("");
    setSelectedImages([]);
    setImagePreviews([]);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.lines || !formData.station || !formData.problem.trim()) {
      alert("กรุณาเลือก Line, Station และระบุรายละเอียดปัญหาให้ครบถ้วน");
      return;
    }

    setSubmitting(true);
    setMessage(null);

    try {
      const payload = new FormData();
      payload.append("lines", formData.lines);
      payload.append("station", formData.station);
      payload.append("problem", formData.problem);
      payload.append("task_type", formData.task_type);
      payload.append("shift", formData.shift);

      selectedImages.forEach((file) => {
        payload.append("images", file);
      });

      const res = await fetch(`${API_URL}/tasks`, {
        method: "POST",
        headers: getHeaders(true),
        body: payload,
      });

      if (res.status === 413) {
        throw new Error("ขนาดไฟล์รูปภาพรวมใหญ่เกินไป กรุณาลดจำนวนรูปภาพ");
      }

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "สร้าง Task ไม่สำเร็จ");

      setMessage({ type: "success", text: `สร้างงาน ${data.task?.task_id || ""} สำเร็จเรียบร้อย` });
      handleClearForm();
      await fetchMyRecentTasks();
    } catch (err) {
      setMessage({ type: "error", text: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenEditModal = async (task) => {
    if (task.status !== "pending") {
      alert("Task นี้มีผู้รับงานหรือปิดงานไปแล้ว ไม่สามารถแก้ไขได้");
      return;
    }
    setEditingTask(task);
    setEditFormData({
      lines: task.lines || "",
      station: task.station_id || task.station || "",
      problem: task.problem || "",
      task_type: task.task_type || "general",
      shift: task.shift || "a",
    });
    await fetchStationsByLine(task.lines, true);
    setEditModalOpen(true);
  };

  const handleSaveEditTask = async (e) => {
    e.preventDefault();
    if (!editingTask) return;

    try {
      const res = await fetch(`${API_URL}/tasks/${editingTask.task_id}`, {
        method: "PUT",
        headers: getHeaders(),
        body: JSON.stringify(editFormData),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "แก้ไข Task ไม่สำเร็จ");

      alert("✅ อัปเดตข้อมูล Task เรียบร้อยแล้ว");
      setEditModalOpen(false);
      setEditingTask(null);
      fetchMyRecentTasks();
    } catch (err) {
      alert(`⚠️ ${err.message}`);
    }
  };

  const handleDeleteTask = async (taskId, status) => {
    if (status !== "pending") {
      alert("Task นี้มีผู้รับงานหรือปิดงานไปแล้ว ไม่สามารถลบได้");
      return;
    }
    if (!window.confirm(`ยืนยันที่จะลบ Task ID: ${taskId} หรือไม่?`)) return;

    try {
      const res = await fetch(`${API_URL}/tasks/${taskId}`, {
        method: "DELETE",
        headers: getHeaders(),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "ลบ Task ไม่สำเร็จ");

      alert("✅ ลบ Task สำเร็จเรียบร้อย");
      fetchMyRecentTasks();
    } catch (err) {
      alert(`⚠️ ${err.message}`);
    }
  };

  const handleOpenViewDetails = (task) => {
    const currentTask = myRecentTasks.find((t) => String(t.task_id) === String(task.task_id)) || task;
    setTaskDetail(currentTask);
    setViewDetailModalOpen(true);
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return "-";
    const d = new Date(dateStr);
    return d.toLocaleString("th-TH", {
      timeZone: "Asia/Bangkok",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getTaskTypeBadge = (type) => {
    switch (type) {
      case "pd_call_me":
        return {
          label: "🚨 PD Call ME",
          style: "bg-red-500/15 text-red-400 border-red-500/30 animate-pulse font-extrabold",
        };
      case "shift_handover":
        return {
          label: "🔄 ส่งต่อกะ",
          style: "bg-indigo-500/10 text-indigo-400 border-indigo-500/30 font-bold",
        };
      case "improvement":
        return {
          label: "💡 Improvement",
          style: "bg-amber-500/10 text-amber-400 border-amber-500/30 font-bold",
        };
      case "product_issue":
        return {
          label: "📦 Product Issue",
          style: "bg-rose-500/10 text-rose-400 border-rose-500/30 font-bold",
        };
      default:
        return {
          label: "🛠️ แจ้งซ่อม",
          style: "bg-blue-500/10 text-blue-400 border-blue-500/30 font-bold",
        };
    }
  };

  const filteredLines = linesList.filter((line) => {
    const query = lineSearch.toLowerCase();
    const lineMatch = line.id?.toLowerCase().includes(query);
    const ownerMatch = line.owners?.some((o) => o.name?.toLowerCase().includes(query));
    return lineMatch || ownerMatch;
  });

  const filteredStations = stationsList.filter((st) => {
    const query = stationSearch.toLowerCase();
    return st.id?.toLowerCase().includes(query) || st.name?.toLowerCase().includes(query);
  });

  const selectedStationObj = stationsList.find((s) => s.id === formData.station);

  return (
    <div className="space-y-8 max-w-5xl mx-auto select-none pb-12">
      {/* Header */}
      <div>
        <h2 className={`text-2xl font-bold ${isDarkMode ? "text-white" : "text-gray-900"}`}>
          Create Task & Work Order
        </h2>
        <p className={`text-xs mt-1 ${isDarkMode ? "text-slate-400" : "text-gray-500"}`}>
          แจ้งงานซ่อม, ส่งต่องานระหว่างกะ, PD เรียก ME และรายงานปัญหาชิ้นงาน
        </p>
      </div>

      {/* Alert Notification */}
      {message && (
        <div
          className={`p-4 rounded-xl text-xs font-medium flex items-center justify-between transition-all ${
            message.type === "success"
              ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400"
              : "bg-rose-500/10 border border-rose-500/20 text-rose-400"
          }`}
        >
          <span>{message.type === "success" ? "✅" : "⚠️"} {message.text}</span>
          <button onClick={() => setMessage(null)} className="opacity-70 hover:opacity-100 text-sm">✕</button>
        </div>
      )}

      {/* Main Form Section */}
      <div
        className={`rounded-2xl border p-6 sm:p-8 shadow-sm transition-colors ${
          isDarkMode ? "bg-[#1E293B] border-slate-700/60 text-slate-100" : "bg-white border-gray-200 text-gray-800"
        }`}
      >
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* 1. Category & Shift */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider mb-2 text-gray-400">
                Task Category (ประเภทงาน) *
              </label>
              <select
                value={formData.task_type}
                onChange={(e) => setFormData((prev) => ({ ...prev, task_type: e.target.value }))}
                className={`w-full rounded-xl px-4 py-3 text-xs border font-semibold outline-none transition-all cursor-pointer ${
                  isDarkMode
                    ? "bg-[#0F172A] border-slate-700 text-white focus:border-blue-500"
                    : "bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500"
                }`}
              >
                <option value="pd_call_me">🚨 PD Call ME</option>
                <option value="general">🛠️ งานแจ้งซ่อมทั่วไป</option>
                <option value="product_issue">📦 ปัญหาชิ้นงาน (Product Issue)</option>
                {userRole !== "pd" && (
                  <>
                    <option value="shift_handover">🔄 งานส่งต่อกะ</option>
                    <option value="improvement">💡 งานปรับปรุง (Improvement)</option>
                  </>
                )}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider mb-2 text-gray-400">
                Current Shift (กะที่กำลังแจ้ง) *
              </label>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setFormData((prev) => ({ ...prev, shift: "a" }))}
                  className={`flex-1 py-2.5 rounded-xl text-xs font-bold border transition-all ${
                    formData.shift === "a"
                      ? "bg-amber-500 text-slate-900 border-amber-500 shadow-md font-extrabold"
                      : isDarkMode
                      ? "border-slate-700 text-slate-400 hover:bg-slate-800"
                      : "border-gray-200 text-gray-600 hover:bg-gray-100"
                  }`}
                >
                  กะ A (Shift A)
                </button>
                <button
                  type="button"
                  onClick={() => setFormData((prev) => ({ ...prev, shift: "b" }))}
                  className={`flex-1 py-2.5 rounded-xl text-xs font-bold border transition-all ${
                    formData.shift === "b"
                      ? "bg-indigo-600 text-white border-indigo-600 shadow-md font-extrabold"
                      : isDarkMode
                      ? "border-slate-700 text-slate-400 hover:bg-slate-800"
                      : "border-gray-200 text-gray-600 hover:bg-gray-100"
                  }`}
                >
                  กะ B (Shift B)
                </button>
              </div>
            </div>
          </div>

          {/* 2. Line & Station Dropdown */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="relative" ref={lineDropdownRef}>
              <label className="block text-xs font-bold uppercase tracking-wider mb-2 text-gray-400">
                Production Line *
              </label>
              <button
                type="button"
                onClick={() => setLineOpen((prev) => !prev)}
                disabled={loading}
                className={`w-full rounded-xl px-4 py-3 text-xs border text-left flex items-center justify-between font-semibold transition-all ${
                  isDarkMode
                    ? "bg-[#0F172A] border-slate-700 text-white focus:border-blue-500"
                    : "bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500"
                }`}
              >
                <span className="truncate">
                  {formData.lines ? `Line: ${formData.lines}` : "-- กรุณาเลือก Production Line --"}
                </span>
                <span className="text-[10px] opacity-60">▼</span>
              </button>

              {lineOpen && (
                <div
                  className={`absolute z-30 mt-2 w-full rounded-2xl border shadow-xl overflow-hidden animate-in fade-in duration-150 ${
                    isDarkMode ? "bg-[#1E293B] border-slate-700 text-slate-200" : "bg-white border-gray-200 text-gray-800"
                  }`}
                >
                  <div className="p-2.5 border-b border-slate-700/40">
                    <input
                      type="text"
                      autoFocus
                      placeholder="พิมพ์ค้นหาชื่อ Line หรือ Owner..."
                      value={lineSearch}
                      onChange={(e) => setLineSearch(e.target.value)}
                      className={`w-full px-3 py-2 text-xs rounded-xl border outline-none ${
                        isDarkMode ? "bg-[#0F172A] border-slate-700 text-white placeholder-slate-500" : "bg-gray-50 border-gray-200"
                      }`}
                    />
                  </div>

                  <div className="max-h-52 overflow-y-auto divide-y divide-slate-700/20">
                    {filteredLines.map((line) => (
                      <button
                        type="button"
                        key={line.id}
                        onClick={() => handleSelectLine(line.id)}
                        className={`w-full px-4 py-2.5 text-left text-xs flex flex-col transition-colors ${
                          formData.lines === line.id
                            ? "bg-blue-600/10 text-blue-400 font-bold"
                            : isDarkMode
                            ? "hover:bg-slate-700/50"
                            : "hover:bg-gray-100"
                        }`}
                      >
                        <span className="font-bold">{line.id}</span>
                        {line.owners?.length > 0 && (
                          <span className="text-[10px] opacity-70">
                            Owners: {line.owners.map((o) => o.name).join(", ")}
                          </span>
                        )}
                      </button>
                    ))}
                    {filteredLines.length === 0 && (
                      <div className="p-4 text-center text-xs text-gray-400">
                        ไม่พบ Line ที่ค้นหา
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="relative" ref={stationDropdownRef}>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-400">
                  Target Station / Machine *
                </label>
                {loadingStations && (
                  <span className="text-[10px] text-blue-400 font-medium animate-pulse">
                    กำลังโหลด Stations...
                  </span>
                )}
              </div>

              <button
                type="button"
                onClick={() => {
                  if (!formData.lines) {
                    alert("กรุณาเลือก Production Line ก่อนเลือก Station");
                    return;
                  }
                  setStationOpen((prev) => !prev);
                }}
                disabled={!formData.lines || loadingStations}
                className={`w-full rounded-xl px-4 py-3 text-xs border text-left flex items-center justify-between font-semibold transition-all ${
                  isDarkMode
                    ? "bg-[#0F172A] border-slate-700 text-white focus:border-blue-500 disabled:opacity-50"
                    : "bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500 disabled:opacity-50"
                }`}
              >
                <span className="truncate">
                  {selectedStationObj
                    ? `${selectedStationObj.id} - ${selectedStationObj.name}`
                    : !formData.lines
                    ? "-- กรุณาเลือก Line ก่อน --"
                    : "-- กรุณาเลือก Target Station --"}
                </span>
                <span className="text-[10px] opacity-60">▼</span>
              </button>

              {stationOpen && formData.lines && (
                <div
                  className={`absolute z-30 mt-2 w-full rounded-2xl border shadow-xl overflow-hidden animate-in fade-in duration-150 ${
                    isDarkMode ? "bg-[#1E293B] border-slate-700 text-slate-200" : "bg-white border-gray-200 text-gray-800"
                  }`}
                >
                  <div className="p-2.5 border-b border-slate-700/40">
                    <input
                      type="text"
                      autoFocus
                      placeholder="พิมพ์ค้นหารหัส หรือชื่อ Station..."
                      value={stationSearch}
                      onChange={(e) => setStationSearch(e.target.value)}
                      className={`w-full px-3 py-2 text-xs rounded-xl border outline-none ${
                        isDarkMode ? "bg-[#0F172A] border-slate-700 text-white placeholder-slate-500" : "bg-gray-50 border-gray-200"
                      }`}
                    />
                  </div>

                  <div className="max-h-52 overflow-y-auto divide-y divide-slate-700/20">
                    {filteredStations.map((st) => (
                      <button
                        type="button"
                        key={st.id}
                        onClick={() => handleSelectStation(st.id)}
                        className={`w-full px-4 py-2.5 text-left text-xs flex flex-col transition-colors ${
                          formData.station === st.id
                            ? "bg-blue-600/10 text-blue-400 font-bold"
                            : isDarkMode
                            ? "hover:bg-slate-700/50"
                            : "hover:bg-gray-100"
                        }`}
                      >
                        <span className="font-bold">{st.id}</span>
                        <span className="text-[10px] opacity-75">{st.name}</span>
                      </button>
                    ))}
                    {filteredStations.length === 0 && (
                      <div className="p-4 text-center text-xs text-gray-400">
                        {stationsList.length === 0
                          ? "⚠️ Line นี้ยังไม่มี Station ที่ผูกไว้"
                          : "ไม่พบ Station ที่ค้นหา"}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider mb-2 text-gray-400">
              Description / Problem Details *
            </label>
            <textarea
              name="problem"
              rows={4}
              required
              placeholder="ระบุรายละเอียด เช่น จุดที่เครื่องจักรขัดข้อง, ข้อความส่งต่องาน, หรือเหตุผลที่เรียก ME..."
              value={formData.problem}
              onChange={(e) => setFormData((prev) => ({ ...prev, problem: e.target.value }))}
              className={`w-full rounded-xl p-4 text-xs border outline-none leading-relaxed resize-none transition-all ${
                isDarkMode
                  ? "bg-[#0F172A] border-slate-700 text-white placeholder-slate-500 focus:border-blue-500"
                  : "bg-gray-50 border-gray-300 text-gray-900 placeholder-gray-400 focus:border-blue-500"
              }`}
            />
          </div>

          {/* Attach Photos (เปิด System File Manager ของ Android/PC โดยตรง) */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-xs font-bold uppercase tracking-wider text-gray-400">
                Attach Photos / ภาพถ่ายหน้างาน <span className="normal-case font-normal text-slate-500">(สูงสุด 5 รูป)</span>
              </label>
              {selectedImages.length > 0 && (
                <span className="text-[11px] text-blue-400 font-bold">
                  เลือกแล้ว {selectedImages.length} / 5 รูป
                </span>
              )}
            </div>

            {/* Input เลือกไฟล์ (ไม่ใส่ accept เพื่อบังคับให้เปิด Files Manager) */}
            <div className="mb-3">
              <label className="cursor-pointer block">
                <div
                  className={`flex flex-col items-center justify-center border-2 border-dashed rounded-2xl p-6 shadow-sm transition-all ${
                    selectedImages.length >= 5
                      ? "opacity-40 pointer-events-none"
                      : isDarkMode
                      ? "border-slate-700 hover:border-blue-500 bg-[#0F172A]/40 hover:bg-[#0F172A]"
                      : "border-gray-300 hover:border-blue-500 bg-gray-50 hover:bg-blue-50/20"
                  }`}
                >
                  <svg className="w-8 h-8 text-gray-400 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <span className="text-xs font-semibold text-blue-400">
                    {selectedImages.length > 0
                      ? `แตะเพื่อเพิ่มรูปภาพ (${5 - selectedImages.length} รูปที่เหลือ)`
                      : "แตะเพื่อเลือกไฟล์รูปภาพ (ถ่ายสดหรือเลือกจากเครื่อง)"}
                  </span>
                  <span className="text-[10px] text-gray-400 mt-1">
                    รองรับไฟล์รูปภาพ สูงสุด 5 รูป
                  </span>
                </div>
                <input
                  key={`repair-file-${selectedImages.length}`}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={handleImageChange}
                  disabled={selectedImages.length >= 5}
                />
              </label>
            </div>

            {/* Grid แสดง Preview ภาพที่เลือก */}
            {imagePreviews.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
                {imagePreviews.map((previewUrl, idx) => (
                  <div key={idx} className="relative group border rounded-xl overflow-hidden shadow-sm aspect-video bg-black/10">
                    <img src={previewUrl} alt={`Preview ${idx + 1}`} className="w-full h-full object-cover" />
                    <button
                      type="button"
                      onClick={() => handleRemoveSpecificImage(idx)}
                      className="absolute top-1.5 right-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-full p-1 shadow-md transition-colors"
                      title="ลบรูปนี้"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                    <span className="absolute bottom-1 left-1 bg-black/60 text-white text-[9px] px-1.5 py-0.5 rounded font-mono">
                      #{idx + 1}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-200 dark:border-slate-700/60">
            <button
              type="button"
              onClick={handleClearForm}
              className="px-5 py-2.5 rounded-xl text-xs font-semibold text-gray-400 hover:bg-gray-500/10 transition-colors"
            >
              Clear Form
            </button>
            <button
              type="submit"
              disabled={submitting || !formData.lines || !formData.station}
              className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold shadow-md shadow-blue-500/20 transition-all disabled:opacity-50"
            >
              {submitting ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  <span>Saving...</span>
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
                  </svg>
                  <span>Submit Task</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      {/* 3. ส่วนแสดงรายการ Task ล่าสุด 5 รายการ */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className={`text-sm font-bold flex items-center gap-2 ${isDarkMode ? "text-slate-200" : "text-gray-700"}`}>
            <span>📋</span>
            <span>My Recent Tasks (5 รายการล่าสุดที่คุณสร้าง)</span>
          </h3>
          <button
            onClick={fetchMyRecentTasks}
            title="Refresh Recent Tasks"
            className="p-1.5 text-gray-400 hover:text-blue-500 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>

        <div className={`overflow-x-auto rounded-2xl border shadow-sm ${
          isDarkMode ? "bg-[#1E293B] border-slate-700/60 text-slate-300" : "bg-white border-gray-100 text-gray-600"
        }`}>
          <table className="w-full text-left text-xs">
            <thead
              className={`font-bold uppercase tracking-wider border-b ${
                isDarkMode ? "bg-slate-800/50 text-slate-400 border-slate-700/60" : "bg-gray-50/50 text-gray-400 border-gray-100"
              }`}
            >
              <tr>
                <th className="p-4 pl-6 w-32">TASK ID</th>
                <th className="p-4 w-44">LINE / STATION</th>
                <th className="p-4 w-36">CATEGORY</th>
                <th className="p-4">PROBLEM / DETAILS</th>
                <th className="p-4 text-center w-24">PHOTOS</th>
                <th className="p-4 text-center w-40">STATUS</th>
                <th className="p-4 pr-6 text-right w-36">ACTIONS</th>
              </tr>
            </thead>
            <tbody className={`divide-y ${isDarkMode ? "divide-slate-700/50" : "divide-gray-100"}`}>
              {loadingRecent ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-gray-400">
                    <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
                    กำลังโหลดข้อมูล...
                  </td>
                </tr>
              ) : myRecentTasks.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-gray-400">
                    ยังไม่มี Task ที่คุณสร้างล่าสุด
                  </td>
                </tr>
              ) : (
                myRecentTasks.map((t) => {
                  const typeInfo = getTaskTypeBadge(t.task_type);
                  const taskImages = extractTaskImages(t);

                  return (
                    <tr
                      key={t.task_id}
                      className={`transition-colors ${
                        isDarkMode ? "hover:bg-slate-700/30" : "hover:bg-gray-50/50"
                      }`}
                    >
                      <td className="p-4 pl-6 font-mono font-bold text-blue-500">
                        {t.task_id}
                      </td>

                      <td className="p-4">
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-blue-400">{t.lines}</span>
                            <span
                              className={`px-1.5 py-0.2 rounded text-[9px] font-bold border ${
                                t.shift === "b"
                                  ? "bg-indigo-500/15 text-indigo-300 border-indigo-500/30"
                                  : "bg-amber-500/15 text-amber-300 border-amber-500/30"
                              }`}
                            >
                              กะ {String(t.shift || "a").toUpperCase()}
                            </span>
                          </div>
                          <span
                            className={`text-[11px] truncate max-w-[150px] ${
                              isDarkMode ? "text-slate-400" : "text-gray-500"
                            }`}
                            title={t.station_name || t.station_id || t.station}
                          >
                            {t.station_id || t.station} {t.station_name ? `(${t.station_name})` : ""}
                          </span>
                        </div>
                      </td>

                      <td className="p-4">
                        <span className={`px-2.5 py-0.5 rounded-lg text-[10px] border inline-block whitespace-nowrap ${typeInfo.style}`}>
                          {typeInfo.label}
                        </span>
                      </td>

                      <td className="p-4">
                        <div className="font-medium leading-relaxed max-w-xs truncate" title={t.problem}>
                          {t.problem}
                        </div>
                      </td>

                      {/* Thumbnail & Badge รูปภาพปัญหา */}
                      <td className="p-4 text-center">
                        {taskImages.length > 0 ? (
                          <button
                            type="button"
                            onClick={() => openLightbox(taskImages, 0)}
                            className="relative group inline-block rounded-lg overflow-hidden border border-slate-700/50 hover:border-blue-500 transition-all shadow-sm"
                            title={`ดูรูปภาพปัญหา (${taskImages.length} รูป)`}
                          >
                            <img
                              src={taskImages[0]}
                              alt="Problem Thumbnail"
                              className="w-10 h-10 object-cover group-hover:scale-110 transition-transform duration-200"
                            />
                            {taskImages.length > 1 && (
                              <span className="absolute bottom-0 right-0 bg-blue-600/90 text-white font-mono text-[9px] font-bold px-1 rounded-tl">
                                +{taskImages.length - 1}
                              </span>
                            )}
                            <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white text-[10px] font-bold transition-opacity">
                              🔍
                            </div>
                          </button>
                        ) : (
                          <span className="text-gray-400 opacity-40">-</span>
                        )}
                      </td>

                      <td className="p-4 text-center">
                        <span className={`px-2.5 py-1 rounded-lg font-bold text-[10px] uppercase border ${
                          t.status === "pending"
                            ? "bg-slate-500/10 text-slate-400 border-slate-500/20"
                            : t.status === "in_progress"
                            ? "bg-amber-500/10 text-amber-500 border-amber-500/20"
                            : "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
                        }`}>
                          {t.status}
                        </span>
                      </td>

                      <td className="p-4 pr-6 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* ปุ่ม Details เปิดดู Before & After Photos */}
                          <button
                            type="button"
                            onClick={() => handleOpenViewDetails(t)}
                            className="px-2.5 py-1 text-[11px] font-bold text-emerald-400 hover:bg-emerald-500/10 border border-emerald-500/30 rounded-lg flex items-center gap-1 transition-all"
                            title="ดูรายละเอียดงานและรูปภาพทั้งหมด"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                            </svg>
                            <span>Details</span>
                          </button>

                          {t.status === "pending" && (
                            <>
                              <button
                                type="button"
                                onClick={() => handleOpenEditModal(t)}
                                className="p-1.5 text-blue-400 hover:bg-blue-500/10 rounded-lg border border-blue-500/20 transition-colors"
                                title="แก้ไข Task"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                </svg>
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteTask(t.task_id, t.status)}
                                className="p-1.5 text-rose-400 hover:bg-rose-500/10 rounded-lg border border-rose-500/20 transition-colors"
                                title="ลบ Task"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 4. Modal สำหรับดูรายละเอียด Solution & Task Details */}
      {viewDetailModalOpen && taskDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn">
          <div
            className={`w-full max-w-3xl rounded-2xl p-6 border shadow-2xl transition-all max-h-[90vh] overflow-y-auto ${
              isDarkMode ? "bg-[#1E293B] border-slate-700 text-white" : "bg-white border-gray-200 text-gray-900"
            }`}
          >
            <div className="flex items-center justify-between mb-4 border-b pb-3 border-gray-200 dark:border-slate-700">
              <div className="flex items-center gap-2.5">
                <span className="text-xl">📋</span>
                <div>
                  <h3 className="text-base font-bold flex items-center gap-2">
                    <span>Task Details:</span>
                    <span className="text-xs font-mono text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded border border-blue-500/20 font-bold">
                      {taskDetail.task_id}
                    </span>
                  </h3>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className={`px-1.5 py-0.2 rounded text-[9px] font-bold border ${getTaskTypeBadge(taskDetail.task_type).style}`}>
                      {getTaskTypeBadge(taskDetail.task_type).label}
                    </span>
                    <span className="text-xs text-gray-400">
                      Line: <strong className="text-blue-400">{taskDetail.lines}</strong> | Station: <strong className="text-purple-400">{taskDetail.station_id || taskDetail.station}</strong> (กะ {String(taskDetail.shift || 'a').toUpperCase()})
                    </span>
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setViewDetailModalOpen(false)}
                className="p-1.5 rounded-lg opacity-60 hover:opacity-100 transition-opacity"
              >
                ✕
              </button>
            </div>

            <div className="space-y-5 text-xs">
              {/* Problem Details */}
              <div className="space-y-2">
                <span className="font-bold text-rose-400 uppercase tracking-wider flex items-center gap-1.5 text-xs">
                  <span>🔴</span>
                  <span>Problem Details / ข้อมูลปัญหาแจ้งซ่อม</span>
                </span>
                <div
                  className={`p-3.5 rounded-xl border leading-relaxed break-words whitespace-pre-wrap ${
                    isDarkMode ? "bg-[#0F172A] border-slate-700/70 text-slate-200" : "bg-gray-50 border-gray-200 text-gray-800"
                  }`}
                >
                  {taskDetail.problem}
                </div>

                {/* Gallery: Before Repair Photos */}
                <div>
                  <span className="text-[11px] font-semibold text-gray-400 mb-1.5 block">
                    📷 รูปภาพตอนแจ้งปัญหา (Before Repair) : {extractTaskImages(taskDetail).length > 0 ? `${extractTaskImages(taskDetail).length} รูป` : "ไม่มีรูปภาพแนบ"}
                  </span>
                  {extractTaskImages(taskDetail).length > 0 ? (
                    <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 gap-2.5 border rounded-xl p-3 bg-black/20">
                      {extractTaskImages(taskDetail).map((imgUrl, idx) => (
                        <div
                          key={idx}
                          onClick={() => openLightbox(extractTaskImages(taskDetail), idx)}
                          className="relative group aspect-video rounded-lg overflow-hidden border border-slate-700/60 bg-black/30 cursor-pointer shadow-sm"
                        >
                          <img
                            src={imgUrl}
                            alt={`Before Repair ${idx + 1}`}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                          />
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white text-[11px] font-bold transition-opacity">
                            🔍 Before #{idx + 1}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="p-3 rounded-xl border border-dashed border-slate-700/60 text-center text-gray-500 italic text-[11px]">
                      ไม่มีการแนบรูปภาพปัญหา
                    </div>
                  )}
                </div>
              </div>

              {/* Solution Details */}
              <div className="space-y-2 pt-3 border-t border-slate-700/50">
                <span className="font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5 text-xs">
                  <span>🛠️</span>
                  <span>Solution / วิธีการแก้ไขและผลการดำเนินงาน</span>
                </span>
                <div
                  className={`p-3.5 rounded-xl border leading-relaxed font-medium break-words whitespace-pre-wrap ${
                    isDarkMode
                      ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-200"
                      : "bg-emerald-50 border-emerald-200 text-emerald-900"
                  }`}
                >
                  {taskDetail.solution || "ยังไม่มีการบันทึกรายละเอียดการดำเนินการ (งานอาจกำลังอยู่ระหว่างดำเนินการ)"}
                </div>

                {/* Gallery: After Repair Photos */}
                <div>
                  <span className="text-[11px] font-semibold text-emerald-400 mb-1.5 block">
                    ✨ รูปภาพผลการแก้ไขปัญหา (After Repair) : {extractSolutionImages(taskDetail).length > 0 ? `${extractSolutionImages(taskDetail).length} รูป` : "ไม่มีรูปภาพแนบ"}
                  </span>
                  {extractSolutionImages(taskDetail).length > 0 ? (
                    <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 gap-2.5 border border-emerald-500/30 rounded-xl p-3 bg-emerald-950/20">
                      {extractSolutionImages(taskDetail).map((imgUrl, idx) => (
                        <div
                          key={idx}
                          onClick={() => openLightbox(extractSolutionImages(taskDetail), idx)}
                          className="relative group aspect-video rounded-lg overflow-hidden border border-emerald-500/50 bg-black/30 cursor-pointer shadow-sm"
                        >
                          <img
                            src={imgUrl}
                            alt={`After Repair ${idx + 1}`}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                          />
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white text-[11px] font-bold transition-opacity">
                            🔍 After #{idx + 1}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="p-3 rounded-xl border border-dashed border-emerald-500/20 text-center text-gray-500 italic text-[11px]">
                      ไม่มีการแนบรูปภาพผลการซ่อม
                    </div>
                  )}
                </div>
              </div>

              {/* Timestamps & Operator */}
              <div className={`grid grid-cols-2 sm:grid-cols-4 gap-3 p-3.5 rounded-xl border text-[11px] ${
                isDarkMode ? "bg-[#0F172A]/50 border-slate-700 text-slate-400" : "bg-gray-50 border-gray-200 text-gray-600"
              }`}>
                <div>
                  <span className="font-semibold block text-gray-500">Created At:</span>
                  <span className="font-medium text-slate-200">{formatDate(taskDetail.created_at)}</span>
                </div>
                <div>
                  <span className="font-semibold block text-gray-500">Handled By:</span>
                  <span className="text-blue-400 font-medium">{taskDetail.accepted_by_name || `#${taskDetail.accepted_by || "-"}`}</span>
                </div>
                <div>
                  <span className="font-semibold block text-gray-500">Accepted At:</span>
                  <span className="text-blue-400 font-medium">{formatDate(taskDetail.accepted_at)}</span>
                </div>
                <div>
                  <span className="font-semibold block text-gray-500">Completed At:</span>
                  <span className="text-emerald-400 font-medium">{formatDate(taskDetail.end_at)}</span>
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-4 mt-4 border-t border-gray-200 dark:border-slate-700/60">
              <button
                type="button"
                onClick={() => setViewDetailModalOpen(false)}
                className="px-5 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-sm transition-all"
              >
                ปิดหน้าต่าง
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 5. Modal สำหรับแก้ไข Task */}
      {editModalOpen && editingTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn">
          <div className={`w-full max-w-xl rounded-2xl p-6 border shadow-2xl transition-all ${
            isDarkMode ? "bg-[#1E293B] border-slate-700 text-white" : "bg-white border-gray-200 text-gray-900"
          }`}>
            <div className="flex items-center justify-between pb-3 border-b border-gray-200 dark:border-slate-700/60 mb-4">
              <h3 className="text-base font-bold flex items-center gap-2">
                <span>✏️</span>
                <span>แก้ไข Task: {editingTask.task_id}</span>
              </h3>
              <button onClick={() => setEditModalOpen(false)} className="text-gray-400 hover:text-gray-200 text-sm">✕</button>
            </div>

            <form onSubmit={handleSaveEditTask} className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block font-semibold mb-1 text-gray-400">Production Line</label>
                  <select
                    value={editFormData.lines}
                    onChange={(e) => {
                      const newL = e.target.value;
                      setEditFormData((prev) => ({ ...prev, lines: newL, station: "" }));
                      fetchStationsByLine(newL, true);
                    }}
                    className={`w-full p-2.5 rounded-xl border font-semibold outline-none ${
                      isDarkMode ? "bg-[#0F172A] border-slate-700 text-white" : "bg-gray-50 border-gray-300 text-gray-900"
                    }`}
                  >
                    {linesList.map((l) => (
                      <option key={l.id} value={l.id}>{l.id}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-semibold mb-1 text-gray-400">Station</label>
                  <select
                    value={editFormData.station}
                    onChange={(e) => setEditFormData((prev) => ({ ...prev, station: e.target.value }))}
                    className={`w-full p-2.5 rounded-xl border font-semibold outline-none ${
                      isDarkMode ? "bg-[#0F172A] border-slate-700 text-white" : "bg-gray-50 border-gray-300 text-gray-900"
                    }`}
                  >
                    {editStationsList.map((s) => (
                      <option key={s.id} value={s.id}>{s.id} - {s.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block font-semibold mb-1 text-gray-400">Task Category</label>
                  <select
                    value={editFormData.task_type}
                    onChange={(e) => setEditFormData((prev) => ({ ...prev, task_type: e.target.value }))}
                    className={`w-full p-2.5 rounded-xl border font-semibold outline-none ${
                      isDarkMode ? "bg-[#0F172A] border-slate-700 text-white" : "bg-gray-50 border-gray-300 text-gray-900"
                    }`}
                  >
                    <option value="pd_call_me">🚨 PD Call ME</option>
                    <option value="general">🛠️ งานแจ้งซ่อมทั่วไป</option>
                    <option value="product_issue">📦 ปัญหาชิ้นงาน (Product Issue)</option>
                    {userRole !== "pd" && (
                      <>
                        <option value="shift_handover">🔄 งานส่งต่อกะ</option>
                        <option value="improvement">💡 งานปรับปรุง (Improvement)</option>
                      </>
                    )}
                  </select>
                </div>

                <div>
                  <label className="block font-semibold mb-1 text-gray-400">Shift</label>
                  <select
                    value={editFormData.shift}
                    onChange={(e) => setEditFormData((prev) => ({ ...prev, shift: e.target.value }))}
                    className={`w-full p-2.5 rounded-xl border font-semibold outline-none ${
                      isDarkMode ? "bg-[#0F172A] border-slate-700 text-white" : "bg-gray-50 border-gray-300 text-gray-900"
                    }`}
                  >
                    <option value="a">กะ A (Shift A)</option>
                    <option value="b">กะ B (Shift B)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-semibold mb-1 text-gray-400">Description / Problem Details</label>
                <textarea
                  rows={3}
                  required
                  value={editFormData.problem}
                  onChange={(e) => setEditFormData((prev) => ({ ...prev, problem: e.target.value }))}
                  className={`w-full p-3 rounded-xl border outline-none resize-none ${
                    isDarkMode ? "bg-[#0F172A] border-slate-700 text-white" : "bg-gray-50 border-gray-300 text-gray-900"
                  }`}
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-gray-200 dark:border-slate-700/60">
                <button
                  type="button"
                  onClick={() => setEditModalOpen(false)}
                  className="px-4 py-2 font-medium rounded-xl hover:bg-gray-500/10 text-gray-400 transition-colors"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-sm transition-colors"
                >
                  บันทึกการแก้ไข
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 6. Lightbox Modal ดูรูปขนาดเต็ม */}
      {lightboxImages.length > 0 && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fadeIn select-none"
          onClick={closeLightbox}
        >
          <div className="relative max-w-4xl max-h-[90vh] flex flex-col items-center" onClick={(e) => e.stopPropagation()}>
            <img
              src={lightboxImages[lightboxIndex]}
              alt={`Fullscreen ${lightboxIndex + 1}`}
              className="max-w-full max-h-[80vh] rounded-2xl object-contain shadow-2xl border border-white/20"
            />

            {lightboxImages.length > 1 && (
              <div className="mt-3 px-3 py-1 bg-black/60 text-white text-xs font-mono font-bold rounded-full border border-white/20">
                {lightboxIndex + 1} / {lightboxImages.length}
              </div>
            )}

            {lightboxImages.length > 1 && (
              <button
                type="button"
                onClick={prevLightboxImage}
                className="absolute left-2 sm:-left-12 top-1/2 -translate-y-1/2 bg-white/20 hover:bg-white/40 text-white rounded-full p-2.5 shadow-lg transition-all"
                title="รูปก่อนหน้า"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            )}

            {lightboxImages.length > 1 && (
              <button
                type="button"
                onClick={nextLightboxImage}
                className="absolute right-2 sm:-right-12 top-1/2 -translate-y-1/2 bg-white/20 hover:bg-white/40 text-white rounded-full p-2.5 shadow-lg transition-all"
                title="รูปถัดไป"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5l7 7-7 7" />
                </svg>
              </button>
            )}

            <button
              type="button"
              onClick={closeLightbox}
              className="absolute -top-3 -right-3 bg-rose-600 hover:bg-rose-700 text-white rounded-full p-2 shadow-lg transition-colors"
              title="ปิด"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  );
}