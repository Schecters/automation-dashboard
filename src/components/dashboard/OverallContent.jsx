import React, { useState, useEffect, useMemo } from "react";
import { socket } from "../../socket";

export default function OverallContent({ isDarkMode }) {
  const [tasks, setTasks] = useState([]);
  const [linesCount, setLinesCount] = useState(0);
  const [stationsCount, setStationsCount] = useState(0);
  const [usersCount, setUsersCount] = useState(0);
  const [loading, setLoading] = useState(true);

  // State สำหรับการเลือกช่วงเวลา (Date Range Filter)
  const [timeRange, setTimeRange] = useState("7days"); // today, 7days, 30days, custom
  const [customStartDate, setCustomStartDate] = useState("");
  const [customEndDate, setCustomEndDate] = useState("");

  const API_URL = `/api`;

  const getHeaders = () => {
    const token = localStorage.getItem("token") || localStorage.getItem("sessionToken");
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "x-session-token": token,
    };
  };

  const fetchDashboardData = async () => {
    setLoading(true);
    try {
      const headers = getHeaders();
      const [resTasks, resLines, resStations, resUsers] = await Promise.all([
        fetch(`${API_URL}/tasks`, { headers }),
        fetch(`${API_URL}/lines`, { headers }),
        fetch(`${API_URL}/stations`, { headers }),
        fetch(`${API_URL}/users`, { headers }),
      ]);

      if (resTasks.ok) {
        const raw = await resTasks.json();
        setTasks(Array.isArray(raw) ? raw : raw.data || []);
      }
      if (resLines.ok) {
        const raw = await resLines.json();
        const lData = Array.isArray(raw) ? raw : raw.data || [];
        setLinesCount(lData.length);
      }
      if (resStations.ok) {
        const raw = await resStations.json();
        const sData = Array.isArray(raw) ? raw : raw.data || [];
        setStationsCount(sData.length);
      }
      if (resUsers.ok) {
        const raw = await resUsers.json();
        const uData = Array.isArray(raw) ? raw : raw.data || [];
        setUsersCount(uData.length);
      }
    } catch (err) {
      console.error("Fetch Overall Stats Error:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();

    // 🟢 ฟัง Socket Event เพื่ออัปเดตสถิติแบบ Real-time ทันทีที่มีการเปลี่ยนแปลง
    const handleTaskCreated = (newTask) => {
      setTasks((prev) => [newTask, ...prev]);
    };

    const handleTaskUpdated = (updatedTask) => {
      setTasks((prev) =>
        prev.map((t) => (t.task_id === updatedTask.task_id ? { ...t, ...updatedTask } : t))
      );
    };

    const handleTaskDeleted = ({ task_id }) => {
      setTasks((prev) => prev.filter((t) => t.task_id !== task_id));
    };

    socket.on("task_created", handleTaskCreated);
    socket.on("task_status_updated", handleTaskUpdated);
    socket.on("task_deleted", handleTaskDeleted);

    return () => {
      socket.off("task_created", handleTaskCreated);
      socket.off("task_status_updated", handleTaskUpdated);
      socket.off("task_deleted", handleTaskDeleted);
    };
  }, []);

  // กรองงานซ่อมตามช่วงเวลาที่กำหนด
  const filteredTasks = useMemo(() => {
    if (!tasks || tasks.length === 0) return [];

    const now = new Date();

    return tasks.filter((t) => {
      if (!t.created_at) return false;
      const taskDate = new Date(t.created_at);

      if (timeRange === "today") {
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        return taskDate >= startOfToday;
      }

      if (timeRange === "7days") {
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(now.getDate() - 7);
        return taskDate >= sevenDaysAgo;
      }

      if (timeRange === "30days") {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(now.getDate() - 30);
        return taskDate >= thirtyDaysAgo;
      }

      if (timeRange === "custom") {
        if (!customStartDate && !customEndDate) return true;
        const start = customStartDate ? new Date(customStartDate) : new Date(0);
        const end = customEndDate ? new Date(customEndDate) : new Date();
        end.setHours(23, 59, 59, 999);
        return taskDate >= start && taskDate <= end;
      }

      return true;
    });
  }, [tasks, timeRange, customStartDate, customEndDate]);

  // คำนวณสถานะต่างๆ จากรายการที่กรองแล้ว
  const pendingTasks = useMemo(() => filteredTasks.filter((t) => t.status === "pending"), [filteredTasks]);
  const inProgressTasks = useMemo(() => filteredTasks.filter((t) => t.status === "in_progress"), [filteredTasks]);
  const completedTasks = useMemo(() => filteredTasks.filter((t) => t.status === "complete"), [filteredTasks]);

  const activeIssues = useMemo(() => [...pendingTasks, ...inProgressTasks].slice(0, 5), [pendingTasks, inProgressTasks]);

  const totalFiltered = filteredTasks.length;
  const pendingPct = totalFiltered ? Math.round((pendingTasks.length / totalFiltered) * 100) : 0;
  const inProgressPct = totalFiltered ? Math.round((inProgressTasks.length / totalFiltered) * 100) : 0;
  const completedPct = totalFiltered ? Math.round((completedTasks.length / totalFiltered) * 100) : 0;

  const formatDate = (dateStr) => {
    if (!dateStr) return "-";
    const d = new Date(dateStr);
    return d.toLocaleString("th-TH", {
      timeZone: "Asia/Bangkok",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-10 select-none">
      {/* Header Bar พร้อมตัวเลือกช่วงเวลา */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-gray-200 dark:border-slate-700/60">
        <div>
          <div className="flex items-center gap-2">
            <h2 className={`text-xl font-bold ${isDarkMode ? "text-white" : "text-gray-900"}`}>
              Overall Maintenance Overview
            </h2>
            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
              isDarkMode ? "bg-blue-500/10 text-blue-400 border border-blue-500/20" : "bg-blue-50 text-blue-800 border border-blue-200"
            }`}>
              Dashboard Monitor
            </span>
          </div>
          <p className={`text-xs mt-1 ${isDarkMode ? "text-slate-400" : "text-gray-600"}`}>
            ภาพรวมสถิติงานแจ้งซ่อมบำรุงและทรัพยากรระบบสายการผลิต
          </p>
        </div>

        {/* ตัวเลือกช่วงเวลา (Date Filter) */}
        <div className="flex flex-wrap items-center gap-2">
          <div className={`flex items-center p-1 rounded-xl border ${
            isDarkMode ? "bg-[#1E293B] border-slate-700/80" : "bg-gray-100 border-gray-200"
          }`}>
            {[
              { id: "today", label: "Today" },
              { id: "7days", label: "Last 7 Days" },
              { id: "30days", label: "Last 30 Days" },
              { id: "custom", label: "Custom" },
            ].map((btn) => {
              const isActive = timeRange === btn.id;
              return (
                <button
                  key={btn.id}
                  type="button"
                  onClick={() => setTimeRange(btn.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    isActive
                      ? "bg-blue-600 text-white shadow-sm"
                      : isDarkMode
                      ? "text-slate-400 hover:text-slate-200 hover:bg-slate-700/40"
                      : "text-gray-600 hover:text-gray-900 hover:bg-gray-200/60"
                  }`}
                >
                  {btn.label}
                </button>
              );
            })}
          </div>

          {/* ช่องเลือกวันที่แบบกำหนดเอง (Custom) */}
          {timeRange === "custom" && (
            <div className="flex items-center gap-1.5 animate-in fade-in duration-150">
              <input
                type="date"
                value={customStartDate}
                onChange={(e) => setCustomStartDate(e.target.value)}
                className={`px-2.5 py-1.5 rounded-xl border text-xs outline-none font-semibold ${
                  isDarkMode ? "bg-[#1E293B] border-slate-700 text-white" : "bg-white border-gray-300 text-gray-900 focus:border-blue-500"
                }`}
              />
              <span className={`text-xs font-bold ${isDarkMode ? "text-slate-400" : "text-gray-500"}`}>-</span>
              <input
                type="date"
                value={customEndDate}
                onChange={(e) => setCustomEndDate(e.target.value)}
                className={`px-2.5 py-1.5 rounded-xl border text-xs outline-none font-semibold ${
                  isDarkMode ? "bg-[#1E293B] border-slate-700 text-white" : "bg-white border-gray-300 text-gray-900 focus:border-blue-500"
                }`}
              />
            </div>
          )}

          <button
            onClick={fetchDashboardData}
            disabled={loading}
            title="รีเฟรชข้อมูล"
            className={`p-2 rounded-xl border transition-all ${
              isDarkMode
                ? "bg-[#1E293B] border-slate-700 hover:bg-slate-700 text-slate-200"
                : "bg-white border-gray-300 hover:bg-gray-100 text-gray-700 shadow-sm"
            }`}
          >
            <svg className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>
      </div>

      {/* 4 Cards: สถิติสถานะงาน */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Tasks */}
        <div className={`p-5 rounded-2xl border shadow-sm flex items-center justify-between transition-colors ${
          isDarkMode ? "bg-[#1E293B] border-slate-700/60" : "bg-white border-gray-200"
        }`}>
          <div>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider bg-slate-500/10 text-slate-600 dark:text-slate-400 border border-slate-500/20">
              Total Tasks
            </span>
            <p className={`text-2xl font-bold mt-2 tracking-tight ${isDarkMode ? "text-white" : "text-gray-900"}`}>
              {totalFiltered} <span className="text-xs font-normal text-gray-500">งาน</span>
            </p>
            <p className={`text-[11px] mt-0.5 ${isDarkMode ? "text-gray-400" : "text-gray-600"}`}>ในช่วงเวลาที่เลือก</p>
          </div>
          <div className={`w-10 h-10 rounded-xl border flex items-center justify-center font-mono font-bold text-xs ${
            isDarkMode ? "bg-slate-800 border-slate-700 text-slate-300" : "bg-gray-100 border-gray-300 text-gray-700"
          }`}>
            ALL
          </div>
        </div>

        {/* Pending Tasks */}
        <div className={`p-5 rounded-2xl border shadow-sm flex items-center justify-between transition-colors ${
          isDarkMode ? "bg-[#1E293B] border-slate-700/60" : "bg-white border-gray-200"
        }`}>
          <div>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider border ${
              isDarkMode ? "bg-rose-500/10 text-rose-400 border-rose-500/20" : "bg-rose-50 text-rose-700 border-rose-200"
            }`}>
              Pending Tasks
            </span>
            <p className={`text-2xl font-bold mt-2 tracking-tight ${isDarkMode ? "text-rose-400" : "text-rose-600"}`}>
              {pendingTasks.length} <span className="text-xs font-normal text-gray-500">งาน</span>
            </p>
            <p className={`text-[11px] mt-0.5 ${isDarkMode ? "text-gray-400" : "text-gray-600"}`}>รอดำเนินการ</p>
          </div>
          <div className={`w-10 h-10 rounded-xl border flex items-center justify-center font-mono font-bold text-xs ${
            isDarkMode ? "bg-rose-500/10 border-rose-500/20 text-rose-400" : "bg-rose-50 border-rose-200 text-rose-700"
          }`}>
            WAIT
          </div>
        </div>

        {/* In Progress */}
        <div className={`p-5 rounded-2xl border shadow-sm flex items-center justify-between transition-colors ${
          isDarkMode ? "bg-[#1E293B] border-slate-700/60" : "bg-white border-gray-200"
        }`}>
          <div>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider border ${
              isDarkMode ? "bg-amber-500/10 text-amber-400 border-amber-500/20" : "bg-amber-50 text-amber-800 border-amber-200"
            }`}>
              In Progress
            </span>
            <p className={`text-2xl font-bold mt-2 tracking-tight ${isDarkMode ? "text-amber-400" : "text-amber-700"}`}>
              {inProgressTasks.length} <span className="text-xs font-normal text-gray-500">งาน</span>
            </p>
            <p className={`text-[11px] mt-0.5 ${isDarkMode ? "text-gray-400" : "text-gray-600"}`}>กำลังดำเนินการ</p>
          </div>
          <div className={`w-10 h-10 rounded-xl border flex items-center justify-center font-mono font-bold text-xs ${
            isDarkMode ? "bg-amber-500/10 border-amber-500/20 text-amber-400" : "bg-amber-50 border-amber-200 text-amber-700"
          }`}>
            RUN
          </div>
        </div>

        {/* Completed */}
        <div className={`p-5 rounded-2xl border shadow-sm flex items-center justify-between transition-colors ${
          isDarkMode ? "bg-[#1E293B] border-slate-700/60" : "bg-white border-gray-200"
        }`}>
          <div>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider border ${
              isDarkMode ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-emerald-50 text-emerald-800 border-emerald-200"
            }`}>
              Completed
            </span>
            <p className={`text-2xl font-bold mt-2 tracking-tight ${isDarkMode ? "text-emerald-400" : "text-emerald-700"}`}>
              {completedTasks.length} <span className="text-xs font-normal text-gray-500">งาน</span>
            </p>
            <p className={`text-[11px] mt-0.5 ${isDarkMode ? "text-gray-400" : "text-gray-600"}`}>ปิดงานเรียบร้อย</p>
          </div>
          <div className={`w-10 h-10 rounded-xl border flex items-center justify-center font-mono font-bold text-xs ${
            isDarkMode ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" : "bg-emerald-50 border-emerald-200 text-emerald-700"
          }`}>
            DONE
          </div>
        </div>
      </div>

      {/* สัดส่วนงานซ่อมบำรุง และ ทรัพยากรระบบ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Task Distribution Progress Bar */}
        <div className={`lg:col-span-2 p-6 rounded-2xl border shadow-sm space-y-4 ${
          isDarkMode ? "bg-[#1E293B] border-slate-700/60" : "bg-white border-gray-200"
        }`}>
          <div className="flex items-center justify-between">
            <h3 className={`text-xs font-bold uppercase tracking-wider ${isDarkMode ? "text-gray-300" : "text-gray-700"}`}>
              Task Resolution Distribution
            </h3>
            <span className="text-xs font-mono font-bold text-gray-500">
              Total: {totalFiltered} Tasks
            </span>
          </div>

          <div className="h-3 w-full bg-gray-200 dark:bg-slate-700/40 rounded-full overflow-hidden flex">
            <div style={{ width: `${completedPct}%` }} className="bg-emerald-500 transition-all duration-500" title={`Completed: ${completedPct}%`} />
            <div style={{ width: `${inProgressPct}%` }} className="bg-amber-500 transition-all duration-500" title={`In Progress: ${inProgressPct}%`} />
            <div style={{ width: `${pendingPct}%` }} className="bg-rose-500 transition-all duration-500" title={`Pending: ${pendingPct}%`} />
          </div>

          <div className="grid grid-cols-3 gap-2 pt-2 text-xs text-center">
            <div className={`p-3 rounded-xl border ${
              isDarkMode ? "bg-emerald-500/10 border-emerald-500/20" : "bg-emerald-50 border-emerald-200"
            }`}>
              <span className={`font-bold block text-sm ${isDarkMode ? "text-emerald-400" : "text-emerald-700"}`}>{completedPct}%</span>
              <span className={`text-[11px] ${isDarkMode ? "text-gray-400" : "text-gray-600"}`}>Completed ({completedTasks.length})</span>
            </div>
            <div className={`p-3 rounded-xl border ${
              isDarkMode ? "bg-amber-500/10 border-amber-500/20" : "bg-amber-50 border-amber-200"
            }`}>
              <span className={`font-bold block text-sm ${isDarkMode ? "text-amber-400" : "text-amber-700"}`}>{inProgressPct}%</span>
              <span className={`text-[11px] ${isDarkMode ? "text-gray-400" : "text-gray-600"}`}>In Progress ({inProgressTasks.length})</span>
            </div>
            <div className={`p-3 rounded-xl border ${
              isDarkMode ? "bg-rose-500/10 border-rose-500/20" : "bg-rose-50 border-rose-200"
            }`}>
              <span className={`font-bold block text-sm ${isDarkMode ? "text-rose-400" : "text-rose-700"}`}>{pendingPct}%</span>
              <span className={`text-[11px] ${isDarkMode ? "text-gray-400" : "text-gray-600"}`}>Pending ({pendingTasks.length})</span>
            </div>
          </div>
        </div>

        {/* ข้อมูล Entity ภายในฐานข้อมูล (Lines, Stations, Users) */}
        <div className={`p-6 rounded-2xl border shadow-sm space-y-4 ${
          isDarkMode ? "bg-[#1E293B] border-slate-700/60" : "bg-white border-gray-200"
        }`}>
          <h3 className={`text-xs font-bold uppercase tracking-wider ${isDarkMode ? "text-gray-300" : "text-gray-700"}`}>
            System Resources
          </h3>

          <div className="space-y-3">
            <div className={`flex items-center justify-between p-3 rounded-xl border ${
              isDarkMode ? "border-slate-700/60 bg-slate-900/40" : "border-gray-200 bg-gray-50"
            }`}>
              <span className={`font-bold text-xs ${isDarkMode ? "text-slate-200" : "text-gray-800"}`}>Production Lines</span>
              <span className={`text-sm font-bold font-mono ${isDarkMode ? "text-blue-400" : "text-blue-700"}`}>{linesCount}</span>
            </div>

            <div className={`flex items-center justify-between p-3 rounded-xl border ${
              isDarkMode ? "border-slate-700/60 bg-slate-900/40" : "border-gray-200 bg-gray-50"
            }`}>
              <span className={`font-bold text-xs ${isDarkMode ? "text-slate-200" : "text-gray-800"}`}>Registered Stations</span>
              <span className={`text-sm font-bold font-mono ${isDarkMode ? "text-purple-400" : "text-purple-700"}`}>{stationsCount}</span>
            </div>

            <div className={`flex items-center justify-between p-3 rounded-xl border ${
              isDarkMode ? "border-slate-700/60 bg-slate-900/40" : "border-gray-200 bg-gray-50"
            }`}>
              <span className={`font-bold text-xs ${isDarkMode ? "text-slate-200" : "text-gray-800"}`}>Active User Accounts</span>
              <span className={`text-sm font-bold font-mono ${isDarkMode ? "text-emerald-400" : "text-emerald-700"}`}>{usersCount}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ตารางงานที่ยังค้างอยู่ (Active Tasks) */}
      <div className={`rounded-2xl border shadow-sm overflow-hidden ${
        isDarkMode ? "bg-[#1E293B] border-slate-700/60 text-slate-300" : "bg-white border-gray-200 text-gray-800"
      }`}>
        <div className={`p-5 border-b flex items-center justify-between ${
          isDarkMode ? "border-slate-700/60" : "border-gray-200"
        }`}>
          <div>
            <h3 className={`text-xs font-bold uppercase tracking-wider ${isDarkMode ? "text-rose-400" : "text-rose-700"}`}>
              Active Tasks Requiring Attention
            </h3>
            <p className={`text-[11px] mt-0.5 ${isDarkMode ? "text-gray-400" : "text-gray-600"}`}>
              รายการงานที่ยังไม่แล้วเสร็จ 5 ลำดับล่าสุด
            </p>
          </div>
          <span className="text-[11px] font-bold text-gray-500">
            แสดง {activeIssues.length} รายการ
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className={`border-b ${
                isDarkMode ? "bg-slate-900/50 border-slate-700/60 text-slate-400" : "bg-gray-50 border-gray-200 text-gray-600"
              }`}>
                <th className="py-3 px-4 font-semibold w-28">Task ID</th>
                <th className="py-3 px-4 font-semibold w-44">Line / Station</th>
                <th className="py-3 px-4 font-semibold">Problem</th>
                <th className="py-3 px-4 font-semibold w-36">Responsible</th>
                <th className="py-3 px-4 font-semibold text-center w-28">Status</th>
                <th className="py-3 px-4 font-semibold text-right w-36">Created</th>
              </tr>
            </thead>
            <tbody className={`divide-y ${isDarkMode ? "divide-slate-700/40" : "divide-gray-100"}`}>
              {activeIssues.map((t) => (
                <tr key={t.task_id} className={`transition-colors ${isDarkMode ? "hover:bg-slate-800/40" : "hover:bg-gray-50"}`}>
                  <td className="py-3 px-4 font-mono font-bold text-blue-600 dark:text-blue-400">
                    {t.task_id}
                  </td>
                  <td className="py-3 px-4">
                    <span className="font-bold text-blue-700 dark:text-blue-300">{t.lines}</span>
                    <span className={`text-[11px] ml-1 ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>
                      ({t.station_id || t.station})
                    </span>
                  </td>
                  <td className={`py-3 px-4 font-medium truncate max-w-sm ${isDarkMode ? "text-slate-200" : "text-gray-900"}`} title={t.problem}>
                    {t.problem}
                  </td>
                  <td className="py-3 px-4">
                    {t.accepted_by ? (
                      <span className={`font-semibold text-[11px] ${isDarkMode ? "text-amber-400" : "text-amber-800"}`}>
                        {t.accepted_by_name || `#${t.accepted_by}`}
                      </span>
                    ) : (
                      <span className={`italic text-[11px] ${isDarkMode ? "text-rose-400" : "text-rose-700"}`}>
                        Unassigned
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-center">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${
                      t.status === "pending"
                        ? isDarkMode ? "bg-rose-500/10 text-rose-400 border-rose-500/20" : "bg-rose-50 text-rose-700 border-rose-200"
                        : isDarkMode ? "bg-amber-500/10 text-amber-400 border-amber-500/20" : "bg-amber-50 text-amber-800 border-amber-200"
                    }`}>
                      {t.status}
                    </span>
                  </td>
                  <td className={`py-3 px-4 text-right text-[11px] ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>
                    {formatDate(t.created_at)}
                  </td>
                </tr>
              ))}
              {activeIssues.length === 0 && (
                <tr>
                  <td colSpan="6" className={`py-8 text-center text-xs ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>
                    ไม่มีรายการงานค้างในช่วงเวลาที่เลือก
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}