import React, { useState, useEffect, useMemo } from "react";

export default function KnowledgeContent({ isDarkMode }) {
  const [tasks, setTasks] = useState([]);
  const [linesList, setLinesList] = useState([]);
  const [stationsList, setStationsList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Filter States
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedLine, setSelectedLine] = useState("all");
  const [selectedStation, setSelectedStation] = useState("all");
  const [selectedType, setSelectedType] = useState("all");

  // Modal Detail & Lightbox State
  const [selectedDetailTask, setSelectedDetailTask] = useState(null);
  const [lightboxImages, setLightboxImages] = useState([]);
  const [lightboxIndex, setLightboxIndex] = useState(0);

  const API_URL = `/api`;

  const getHeaders = () => {
    const token = localStorage.getItem("token") || localStorage.getItem("sessionToken");
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "x-session-token": token,
    };
  };

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

  const fetchKnowledgeData = async () => {
    setLoading(true);
    setError(null);
    try {
      const headers = getHeaders();
      const [resTasks, resLines, resStations] = await Promise.all([
        fetch(`${API_URL}/tasks`, { headers }),
        fetch(`${API_URL}/lines`, { headers }),
        fetch(`${API_URL}/stations`, { headers }),
      ]);

      if (!resTasks.ok) throw new Error("ไม่สามารถดึงข้อมูลรายการงานซ่อมได้");

      const tasksData = await resTasks.json();
      const allTasks = Array.isArray(tasksData) ? tasksData : [];
      // กรองเก็บเฉพาะงานที่ Complete แล้วเท่านั้นสำหรับทำ Knowledge Base
      setTasks(allTasks.filter((t) => t.status === "complete"));

      if (resLines.ok) {
        const linesData = await resLines.json();
        setLinesList(Array.isArray(linesData) ? linesData : linesData.data || []);
      }
      if (resStations.ok) {
        const stationsData = await resStations.json();
        setStationsList(Array.isArray(stationsData) ? stationsData : stationsData.data || []);
      }
    } catch (err) {
      console.error("Fetch Knowledge Error:", err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchKnowledgeData();
  }, []);

  const formatDate = (dateStr) => {
    if (!dateStr) return "-";
    const d = new Date(dateStr);
    return d.toLocaleString("th-TH", {
      timeZone: "Asia/Bangkok",
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getTaskTypeBadge = (type) => {
    switch (type) {
      case "pd_call_me":
        return {
          label: "PD Call ME",
          style: "bg-red-500/15 text-red-500 dark:text-red-400 border-red-500/30 font-bold",
        };
      case "shift_handover":
        return {
          label: "ส่งต่อกะ",
          style: "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border-indigo-500/30 font-bold",
        };
      case "improvement":
        return {
          label: "Improvement",
          style: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30 font-bold",
        };
      case "product_issue":
        return {
          label: "Product Issue",
          style: "bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/30 font-bold",
        };
      default:
        return {
          label: "แจ้งซ่อมทั่วไป",
          style: "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30 font-bold",
        };
    }
  };

  // 🟢 กรองตามคำค้นหา (ครอบคลุม Task ID, Problem, Solution, ชื่อ และ รหัสผู้ปิดงาน), Line, Station และ Type
  const filteredTasks = useMemo(() => {
    const q = searchTerm.toLowerCase().trim();

    return tasks.filter((t) => {
      // 1. Search Query
      const matchId = String(t.task_id || "").toLowerCase().includes(q);
      const matchProblem = String(t.problem || "").toLowerCase().includes(q);
      const matchSolution = String(t.solution || "").toLowerCase().includes(q);
      const matchAcceptorName = String(t.accepted_by_name || "").toLowerCase().includes(q);
      const matchAcceptorId = String(t.accepted_by || "").toLowerCase().includes(q);
      const matchSearch =
        !q ||
        matchId ||
        matchProblem ||
        matchSolution ||
        matchAcceptorName ||
        matchAcceptorId;

      // 2. Line Filter
      const matchLine =
        selectedLine === "all" ||
        String(t.lines).toUpperCase() === String(selectedLine).toUpperCase();

      // 3. Station Filter
      const targetStation = t.station_id || t.station;
      const matchStation =
        selectedStation === "all" ||
        String(targetStation).toUpperCase() === String(selectedStation).toUpperCase();

      // 4. Task Type Filter
      const matchType =
        selectedType === "all" || (t.task_type || "general") === selectedType;

      return matchSearch && matchLine && matchStation && matchType;
    });
  }, [tasks, searchTerm, selectedLine, selectedStation, selectedType]);

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12 select-none">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-gray-200 dark:border-slate-700/60">
        <div>
          <div className="flex items-center gap-2">
            <h2 className={`text-xl font-bold ${isDarkMode ? "text-white" : "text-gray-900"}`}>
              Maintenance Knowledge Base
            </h2>
            <span
              className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${
                isDarkMode
                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                  : "bg-emerald-50 text-emerald-800 border-emerald-200"
              }`}
            >
              Resolved Cases Archive
            </span>
          </div>
          <p className={`text-xs mt-1 ${isDarkMode ? "text-slate-400" : "text-gray-600"}`}>
            คลังข้อมูลประวัติการแก้ไขและสาเหตุปัญหาเครื่องจักร สำหรับค้นหาแนวทางแก้ไขปัญหาที่เคยเกิดขึ้น
          </p>
        </div>

        <button
          onClick={fetchKnowledgeData}
          disabled={loading}
          title="รีเฟรชข้อมูล"
          className={`p-2 px-3.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition-all ${
            isDarkMode
              ? "bg-[#1E293B] border-slate-700 hover:bg-slate-700 text-slate-200"
              : "bg-white border-gray-300 hover:bg-gray-100 text-gray-700 shadow-sm"
          }`}
        >
          <svg
            className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
          <span>รีเฟรช</span>
        </button>
      </div>

      {/* Control & Search Bar */}
      <div
        className={`p-4 rounded-2xl border shadow-sm flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 ${
          isDarkMode ? "bg-[#1E293B] border-slate-700/60" : "bg-white border-gray-200"
        }`}
      >
        {/* ค้นหาคำสำคัญในปัญหา, วิธีแก้ไข และผู้ปิดงาน */}
        <div className="relative flex-1">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="ค้นหาข้อความปัญหา, วิธีแก้ไข (Solution), ชื่อ/รหัสผู้ปิดงาน หรือ Task ID..."
            className={`w-full pl-9 pr-8 py-2.5 rounded-xl border text-xs outline-none transition-all ${
              isDarkMode
                ? "bg-slate-900 border-slate-700 text-white placeholder-slate-500 focus:border-blue-500"
                : "bg-gray-50 border-gray-300 text-gray-900 placeholder-gray-400 focus:bg-white focus:border-blue-500"
            }`}
          />
          <svg
            className="w-4 h-4 absolute left-3 top-3 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          {searchTerm && (
            <button
              onClick={() => setSearchTerm("")}
              className="absolute right-3 top-2.5 text-gray-400 hover:text-gray-600 dark:hover:text-white text-xs font-bold"
            >
              ✕
            </button>
          )}
        </div>

        {/* Dropdown Filters */}
        <div className="flex flex-wrap items-center gap-2">
          {/* เลือก Line */}
          <select
            value={selectedLine}
            onChange={(e) => setSelectedLine(e.target.value)}
            className={`px-3 py-2.5 rounded-xl border text-xs font-semibold outline-none cursor-pointer ${
              isDarkMode
                ? "bg-slate-900 border-slate-700 text-slate-200"
                : "bg-gray-50 border-gray-300 text-gray-800"
            }`}
          >
            <option value="all">Line: ทั้งหมด</option>
            {linesList.map((l) => (
              <option key={l.id} value={l.id}>
                Line: {l.id}
              </option>
            ))}
          </select>

          {/* เลือก Station */}
          <select
            value={selectedStation}
            onChange={(e) => setSelectedStation(e.target.value)}
            className={`px-3 py-2.5 rounded-xl border text-xs font-semibold outline-none cursor-pointer ${
              isDarkMode
                ? "bg-slate-900 border-slate-700 text-slate-200"
                : "bg-gray-50 border-gray-300 text-gray-800"
            }`}
          >
            <option value="all">Station: ทั้งหมด</option>
            {stationsList.map((st) => (
              <option key={st.id} value={st.id}>
                {st.id} - {st.name}
              </option>
            ))}
          </select>

          {/* เลือกประเภทงาน */}
          <select
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value)}
            className={`px-3 py-2.5 rounded-xl border text-xs font-semibold outline-none cursor-pointer ${
              isDarkMode
                ? "bg-slate-900 border-slate-700 text-slate-200"
                : "bg-gray-50 border-gray-300 text-gray-800"
            }`}
          >
            <option value="all">ประเภทงาน: ทั้งหมด</option>
            <option value="general">แจ้งซ่อมทั่วไป</option>
            <option value="pd_call_me">PD Call ME</option>
            <option value="shift_handover">ส่งต่อกะ</option>
            <option value="improvement">Improvement</option>
            <option value="product_issue">Product Issue</option>
          </select>
        </div>
      </div>

      {/* สรุปจำนวน Case ที่ค้นพบ */}
      <div className="flex items-center justify-between text-xs px-1">
        <span className={`font-semibold ${isDarkMode ? "text-gray-400" : "text-gray-600"}`}>
          พบเคสการซ่อมบำรุงที่ปิดงานแล้วทั้งหมด{" "}
          <strong className={isDarkMode ? "text-white" : "text-gray-900"}>
            {filteredTasks.length}
          </strong>{" "}
          รายการ
        </span>
      </div>

      {/* Grid รายการความรู้ (Knowledge Cards) */}
      {loading ? (
        <div className="py-20 flex flex-col items-center justify-center gap-2">
          <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
          <span className="text-xs text-gray-500">กำลังโหลดคลังข้อมูล...</span>
        </div>
      ) : filteredTasks.length === 0 ? (
        <div
          className={`p-12 text-center rounded-2xl border ${
            isDarkMode
              ? "bg-[#1E293B] border-slate-700/60 text-slate-400"
              : "bg-white border-gray-200 text-gray-500"
          }`}
        >
          <p className="text-sm font-semibold">ไม่พบเคสการซ่อมที่ตรงกับเงื่อนไขการค้นหา</p>
          <p className="text-xs mt-1">ลองเปลี่ยนคำค้นหา ชื่อผู้ปิดงาน หรือเลือกตัวกรอง Line และ Station อื่น</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredTasks.map((t) => {
            const typeInfo = getTaskTypeBadge(t.task_type);
            const taskImages = extractTaskImages(t);
            const solutionImages = extractSolutionImages(t);

            return (
              <div
                key={t.task_id}
                onClick={() => setSelectedDetailTask(t)}
                className={`p-5 rounded-2xl border shadow-sm hover:shadow-md cursor-pointer transition-all flex flex-col justify-between gap-4 ${
                  isDarkMode
                    ? "bg-[#1E293B] border-slate-700/70 hover:border-blue-500/50"
                    : "bg-white border-gray-200 hover:border-blue-400"
                }`}
              >
                <div className="space-y-3">
                  {/* Top Metadata */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="px-2 py-0.5 rounded font-mono font-bold text-xs bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
                        #{t.task_id}
                      </span>
                      <span className={`px-2 py-0.5 rounded text-[10px] border ${typeInfo.style}`}>
                        {typeInfo.label}
                      </span>
                      <span className={`text-xs font-bold ${isDarkMode ? "text-slate-200" : "text-gray-800"}`}>
                        Line {t.lines}
                      </span>
                      <span className="text-xs text-gray-500 font-mono">({t.station_id || t.station})</span>
                    </div>

                    <span className="text-[10px] text-gray-400 shrink-0 font-mono">
                      {formatDate(t.end_at || t.created_at)}
                    </span>
                  </div>

                  {/* Problem Description */}
                  <div>
                    <span className="text-[11px] font-bold text-rose-600 dark:text-rose-400 block uppercase tracking-wider mb-1">
                      Problem:
                    </span>
                    <p
                      className={`text-xs line-clamp-2 leading-relaxed font-medium ${
                        isDarkMode ? "text-slate-200" : "text-gray-800"
                      }`}
                      title={t.problem}
                    >
                      {t.problem}
                    </p>
                  </div>

                  {/* Solution Preview */}
                  <div
                    className={`p-3 rounded-xl border ${
                      isDarkMode
                        ? "bg-slate-900/50 border-slate-700/60"
                        : "bg-emerald-50/50 border-emerald-200"
                    }`}
                  >
                    <span className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400 block uppercase tracking-wider mb-1">
                      Action Taken / Solution:
                    </span>
                    <p
                      className={`text-xs line-clamp-2 leading-relaxed ${
                        isDarkMode ? "text-slate-300" : "text-emerald-950 font-medium"
                      }`}
                      title={t.solution}
                    >
                      {t.solution || "ไม่มีการระบุข้อความรายละเอียดการแก้ไข"}
                    </p>
                  </div>
                </div>

                {/* Bottom Bar: รูปภาพประกอบ & ผู้ดำเนินการ */}
                <div
                  className={`pt-3 border-t flex items-center justify-between text-xs ${
                    isDarkMode ? "border-slate-700/50" : "border-gray-100"
                  }`}
                >
                  <div className="flex items-center gap-3 text-[11px] text-gray-500">
                    <span>
                      ก่อนซ่อม: <strong>{taskImages.length}</strong> รูป
                    </span>
                    <span>•</span>
                    <span>
                      หลังซ่อม: <strong>{solutionImages.length}</strong> รูป
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-gray-400">ปิดงานโดย:</span>
                    <span
                      className={`font-semibold text-xs ${
                        isDarkMode ? "text-blue-400" : "text-blue-700 font-bold"
                      }`}
                    >
                      {t.accepted_by_name || (t.accepted_by ? `#${t.accepted_by}` : "-")}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* MODAL: รายละเอียด Case การซ่อม (Before & After Solution) */}
      {selectedDetailTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn">
          <div
            className={`w-full max-w-3xl rounded-2xl p-6 border shadow-2xl transition-all max-h-[90vh] overflow-y-auto ${
              isDarkMode ? "bg-[#1E293B] border-slate-700 text-white" : "bg-white border-gray-200 text-gray-900"
            }`}
          >
            {/* Modal Header */}
            <div
              className={`flex items-center justify-between pb-3 border-b mb-4 ${
                isDarkMode ? "border-slate-700" : "border-gray-200"
              }`}
            >
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-bold">Case Study Record:</h3>
                  <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
                    #{selectedDetailTask.task_id}
                  </span>
                </div>
                <p className={`text-xs mt-0.5 ${isDarkMode ? "text-slate-400" : "text-gray-500"}`}>
                  Line: <strong className="text-blue-600 dark:text-blue-400">{selectedDetailTask.lines}</strong> | Station:{" "}
                  <strong className="text-purple-600 dark:text-purple-400">
                    {selectedDetailTask.station_id || selectedDetailTask.station}
                  </strong>{" "}
                  (กะ {String(selectedDetailTask.shift || "a").toUpperCase()})
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedDetailTask(null)}
                className="p-1 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-white"
              >
                ✕
              </button>
            </div>

            {/* Modal Body */}
            <div className="space-y-5 text-xs">
              {/* 1. Problem Details */}
              <div className="space-y-2">
                <span className="font-bold text-rose-600 dark:text-rose-400 uppercase tracking-wider block">
                  1. ข้อมูลปัญหาเครื่องจักรที่พบ (Problem Details)
                </span>
                <div
                  className={`p-3.5 rounded-xl border leading-relaxed break-words whitespace-pre-wrap font-medium ${
                    isDarkMode
                      ? "bg-[#0F172A] border-slate-700/80 text-slate-200"
                      : "bg-gray-50 border-gray-200 text-gray-800"
                  }`}
                >
                  {selectedDetailTask.problem}
                </div>

                {/* รูปภาพตอนแจ้งปัญหา */}
                <div>
                  <span className="text-[11px] font-semibold text-gray-500 block mb-1.5">
                    รูปภาพก่อนซ่อม (Before Repair): {extractTaskImages(selectedDetailTask).length} รูป
                  </span>
                  {extractTaskImages(selectedDetailTask).length > 0 ? (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 p-3 rounded-xl border border-dashed border-gray-300 dark:border-slate-700 bg-gray-50 dark:bg-black/20">
                      {extractTaskImages(selectedDetailTask).map((imgUrl, idx) => (
                        <div
                          key={idx}
                          onClick={() => openLightbox(extractTaskImages(selectedDetailTask), idx)}
                          className="relative group aspect-video rounded-lg overflow-hidden border border-gray-300 dark:border-slate-700 bg-black/20 cursor-pointer shadow-sm"
                        >
                          <img
                            src={imgUrl}
                            alt={`Problem ${idx + 1}`}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                          />
                          <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white font-bold text-[10px] transition-opacity">
                            คลิกดูรูป
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="p-3 rounded-xl border border-dashed text-center text-gray-400 italic text-[11px] border-gray-300 dark:border-slate-700">
                      ไม่มีการแนบรูปภาพตอนแจ้งปัญหา
                    </div>
                  )}
                </div>
              </div>

              {/* 2. Solution Details */}
              <div
                className={`space-y-2 pt-3 border-t ${
                  isDarkMode ? "border-slate-700/60" : "border-gray-200"
                }`}
              >
                <span className="font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider block">
                  2. วิธีการแก้ไขปัญหาและผลการดำเนินงาน (Solution / Root Cause)
                </span>
                <div
                  className={`p-3.5 rounded-xl border leading-relaxed break-words whitespace-pre-wrap font-medium ${
                    isDarkMode
                      ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-200"
                      : "bg-emerald-50 border-emerald-200 text-emerald-950"
                  }`}
                >
                  {selectedDetailTask.solution || "ไม่มีการระบุข้อความรายละเอียดการแก้ไข"}
                </div>

                {/* รูปภาพหลังซ่อม */}
                <div>
                  <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 block mb-1.5">
                    รูปภาพผลการแก้ไขปัญหา (After Repair): {extractSolutionImages(selectedDetailTask).length} รูป
                  </span>
                  {extractSolutionImages(selectedDetailTask).length > 0 ? (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 p-3 rounded-xl border border-dashed border-emerald-300 dark:border-emerald-500/30 bg-emerald-50/50 dark:bg-emerald-950/20">
                      {extractSolutionImages(selectedDetailTask).map((imgUrl, idx) => (
                        <div
                          key={idx}
                          onClick={() => openLightbox(extractSolutionImages(selectedDetailTask), idx)}
                          className="relative group aspect-video rounded-lg overflow-hidden border border-emerald-300 dark:border-emerald-500/40 bg-black/20 cursor-pointer shadow-sm"
                        >
                          <img
                            src={imgUrl}
                            alt={`Solution ${idx + 1}`}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                          />
                          <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white font-bold text-[10px] transition-opacity">
                            คลิกดูรูป
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="p-3 rounded-xl border border-dashed text-center text-gray-400 italic text-[11px] border-emerald-200 dark:border-emerald-500/20">
                      ไม่มีการแนบรูปภาพผลการซ่อม
                    </div>
                  )}
                </div>
              </div>

              {/* 3. Metadata */}
              <div
                className={`grid grid-cols-2 sm:grid-cols-3 gap-3 p-3.5 rounded-xl border text-[11px] ${
                  isDarkMode
                    ? "bg-[#0F172A] border-slate-700/60 text-slate-400"
                    : "bg-gray-50 border-gray-200 text-gray-600"
                }`}
              >
                <div>
                  <span className="font-semibold block text-gray-500">สร้างเมื่อ:</span>
                  <span className={`font-medium ${isDarkMode ? "text-slate-200" : "text-gray-900"}`}>
                    {formatDate(selectedDetailTask.created_at)}
                  </span>
                </div>
                <div>
                  <span className="font-semibold block text-gray-500">ปิดงานเมื่อ:</span>
                  <span className="font-medium text-emerald-600 dark:text-emerald-400">
                    {formatDate(selectedDetailTask.end_at)}
                  </span>
                </div>
                <div>
                  <span className="font-semibold block text-gray-500">ผู้รับผิดชอบ (ปิดงาน):</span>
                  <span className="font-medium text-blue-600 dark:text-blue-400">
                    {selectedDetailTask.accepted_by_name || (selectedDetailTask.accepted_by ? `#${selectedDetailTask.accepted_by}` : "-")}
                  </span>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div
              className={`flex justify-end pt-4 mt-4 border-t ${
                isDarkMode ? "border-slate-700" : "border-gray-200"
              }`}
            >
              <button
                type="button"
                onClick={() => setSelectedDetailTask(null)}
                className="px-5 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-sm transition-all"
              >
                ปิดหน้าต่าง
              </button>
            </div>
          </div>
        </div>
      )}

      {/* LIGHTBOX MODAL: ดูรูปภาพขนาดเต็ม */}
      {lightboxImages.length > 0 && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fadeIn select-none"
          onClick={closeLightbox}
        >
          <div
            className="relative max-w-4xl max-h-[90vh] flex flex-col items-center"
            onClick={(e) => e.stopPropagation()}
          >
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