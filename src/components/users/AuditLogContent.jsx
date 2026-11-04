import React, { useState, useEffect, useMemo, useRef } from "react";
import { socket } from "../../socket";

export default function AuditLogContent({ isDarkMode }) {
  const [logs, setLogs] = useState([]);
  const [filterAction, setFilterAction] = useState("all");
  const [isLoading, setIsLoading] = useState(true);
  const [highlightedId, setHighlightedId] = useState(null);

  const API_URL = `/api`;

  const getAuthHeaders = () => {
    const token = localStorage.getItem("token") || localStorage.getItem("sessionToken");
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "x-session-token": token,
    };
  };

  const handleAuthError = (status) => {
    if (status === 401 || status === 403) {
      alert("Session หมดอายุ หรือไม่มีสิทธิ์เข้าถึงข้อมูล Audit Log กรุณาเข้าสู่ระบบใหม่");
      localStorage.clear();
      if (socket && socket.connected) {
        socket.disconnect();
      }
      window.location.replace("/");
      return true;
    }
    return false;
  };

  const fetchLogs = async () => {
    try {
      const response = await fetch(`${API_URL}/audit-logs`, {
        headers: getAuthHeaders(),
      });

      if (handleAuthError(response.status)) return;

      const data = await response.json();
      if (response.ok) {
        setLogs(Array.isArray(data) ? data : []);
      } else {
        console.error("Failed to fetch logs:", data.message);
      }
    } catch (err) {
      console.error("Fetch logs error:", err);
    } finally {
      setIsLoading(false);
    }
  };

  // 🟢 ผูก Socket Event แบบ Real-time ครบทุกช่องทาง
  useEffect(() => {
    fetchLogs();

    if (!socket) return;

    // เชื่อมต่อ socket ให้ชัวร์ถ้ายังไม่ต่อ
    if (!socket.connected) {
      socket.connect();
    }

    const handleNewAuditLog = (newLog) => {
      if (!newLog || !newLog.id) {
        // กรณีส่งมาเป็น signal ให้ re-fetch
        fetchLogs();
        return;
      }

      setLogs((prev) => {
        // ป้องกัน log ซ้ำกัน
        if (prev.some((item) => item.id === newLog.id)) {
          return prev;
        }
        return [newLog, ...prev];
      });

      // ไฮไลต์แถวที่เพิ่งเข้ามาใหม่ 2.5 วินาที
      setHighlightedId(newLog.id);
      setTimeout(() => {
        setHighlightedId(null);
      }, 2500);
    };

    // 🟢 ดักฟัง Event "new_audit_log" จาก Backend
    socket.on("new_audit_log", handleNewAuditLog);
    socket.on("audit_log_created", handleNewAuditLog);

    // 🟢 ดัก Event กิจกรรมหลักอื่นๆ สำรองไว้ เพื่อ re-fetch ทันที
    socket.on("task_updated", fetchLogs);
    socket.on("user_updated", fetchLogs);
    socket.on("line_updated", fetchLogs);

    return () => {
      socket.off("new_audit_log", handleNewAuditLog);
      socket.off("audit_log_created", handleNewAuditLog);
      socket.off("task_updated", fetchLogs);
      socket.off("user_updated", fetchLogs);
      socket.off("line_updated", fetchLogs);
    };
  }, []);

  const getActionBadge = (action) => {
    switch (action) {
      case "UPDATE_USER":
      case "UPDATE_LINE":
      case "UPDATE_LINE_STATIONS":
      case "UPDATE_STATION":
      case "UPDATE_TASK":
      case "ADMIN_OVERRIDE_TASK":
        return isDarkMode
          ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
          : "bg-amber-50 text-amber-800 border-amber-300 shadow-sm";
      case "CREATE_TASK":
      case "USER_REGISTERED":
      case "CREATE_LINE":
      case "CREATE_STATION":
        return isDarkMode
          ? "bg-blue-500/15 text-blue-400 border-blue-500/30"
          : "bg-blue-50 text-blue-800 border-blue-300 shadow-sm";
      case "DELETE_USER":
      case "DELETE_TASK":
      case "DELETE_LINE":
      case "DELETE_STATION":
        return isDarkMode
          ? "bg-rose-500/15 text-rose-400 border-rose-500/30"
          : "bg-rose-50 text-rose-800 border-rose-300 shadow-sm";
      case "COMPLETE_TASK":
      case "USER_LOGIN":
      case "MICROSOFT_SSO_LOGIN":
        return isDarkMode
          ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
          : "bg-emerald-50 text-emerald-800 border-emerald-300 shadow-sm";
      case "ACCEPT_TASK":
        return isDarkMode
          ? "bg-cyan-500/15 text-cyan-400 border-cyan-500/30"
          : "bg-cyan-50 text-cyan-800 border-cyan-300 shadow-sm";
      case "USER_LOGOUT":
      default:
        return isDarkMode
          ? "bg-slate-500/15 text-slate-400 border-slate-500/30"
          : "bg-gray-100 text-gray-700 border-gray-300 shadow-sm";
    }
  };

  const filteredLogs = useMemo(() => {
    if (filterAction === "all") return logs;
    return logs.filter((l) => l.action === filterAction);
  }, [logs, filterAction]);

  return (
    <div className="space-y-6 select-none">
      {/* Top Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-gray-200 dark:border-slate-700/60">
        <div className="flex items-center gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className={`text-xl font-bold ${isDarkMode ? "text-slate-100" : "text-gray-900"}`}>
                System Audit Log
              </h2>
              {/* จุดเขียวแสดงสถานะ Live */}
              <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping"></span>
                LIVE
              </span>
            </div>
            <p className={`text-xs mt-0.5 ${isDarkMode ? "text-gray-400" : "text-gray-600"}`}>
              ประวัติการแก้ไขข้อมูล การบันทึก และกิจกรรมสำคัญภายในระบบแบบ Real-time
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <select
            value={filterAction}
            onChange={(e) => setFilterAction(e.target.value)}
            className={`px-3 py-2 rounded-xl border text-xs font-semibold focus:outline-none cursor-pointer transition-all ${
              isDarkMode 
                ? "bg-slate-800 border-slate-700 text-white" 
                : "bg-white border-gray-300 text-gray-800 shadow-sm focus:border-blue-500"
            }`}
          >
            <option value="all">All Activities (กิจกรรมทั้งหมด)</option>
            <option value="USER_LOGIN">User Logins (เข้าสู่ระบบ)</option>
            <option value="MICROSOFT_SSO_LOGIN">Microsoft SSO Login</option>
            <option value="USER_LOGOUT">User Logouts (ออกจากระบบ)</option>
            <option value="USER_REGISTERED">User Registered (สมัครสมาชิก)</option>
            <option value="UPDATE_USER">User Updated (แก้ไขสิทธิ์ผู้ใช้)</option>
            <option value="DELETE_USER">User Deleted (ลบผู้ใช้)</option>
            <option value="CREATE_TASK">Task Created (สร้างงานซ่อม)</option>
            <option value="ACCEPT_TASK">Task Accepted (รับงานซ่อม)</option>
            <option value="COMPLETE_TASK">Task Completed (ปิดงานซ่อม)</option>
            <option value="UPDATE_TASK">Task Updated (แก้ไขงานซ่อม)</option>
            <option value="ADMIN_OVERRIDE_TASK">Admin Override Task</option>
            <option value="DELETE_TASK">Task Deleted (ลบงานซ่อม)</option>
            <option value="CREATE_LINE">Line Created (สร้าง Line)</option>
            <option value="UPDATE_LINE">Line Updated (แก้ไข Line)</option>
            <option value="DELETE_LINE">Line Deleted (ลบ Line)</option>
            <option value="CREATE_STATION">Station Created (สร้าง Station)</option>
            <option value="UPDATE_STATION">Station Updated (แก้ไข Station)</option>
            <option value="DELETE_STATION">Station Deleted (ลบ Station)</option>
          </select>
        </div>
      </div>

      {/* Logs Table */}
      <div
        className={`rounded-2xl border shadow-sm overflow-hidden ${
          isDarkMode ? "bg-[#1E293B] border-slate-700/60 text-slate-300" : "bg-white border-gray-200 text-gray-800"
        }`}
      >
        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full text-left text-xs">
            <thead
              className={`font-bold uppercase tracking-wider border-b ${
                isDarkMode
                  ? "bg-slate-800/60 text-slate-400 border-slate-700/60"
                  : "bg-gray-50 text-gray-600 border-gray-200"
              }`}
            >
              <tr>
                <th className="p-4 pl-6 w-24">LOG ID</th>
                <th className="p-4 w-44">USER</th>
                <th className="p-4 text-center w-36">ACTION</th>
                <th className="p-4 w-48">TARGET / RESOURCE</th>
                <th className="p-4">DETAILS</th>
                <th className="p-4 w-32">IP ADDRESS</th>
                <th className="p-4 pr-6 w-44">TIMESTAMP</th>
              </tr>
            </thead>
            <tbody className={`divide-y ${isDarkMode ? "divide-slate-700/50" : "divide-gray-100"}`}>
              {isLoading ? (
                <tr>
                  <td colSpan="7" className={`p-8 text-center ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>
                    กำลังโหลดประวัติ Audit Log...
                  </td>
                </tr>
              ) : filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan="7" className={`p-8 text-center ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>
                    ไม่พบประวัติกิจกรรมตามตัวกรองที่เลือก
                  </td>
                </tr>
              ) : (
                filteredLogs.map((log) => {
                  const isNew = highlightedId === log.id;
                  return (
                    <tr
                      key={log.id}
                      className={`transition-all duration-700 ${
                        isNew
                          ? isDarkMode
                            ? "bg-blue-600/30 ring-1 ring-blue-500"
                            : "bg-blue-100/80 ring-1 ring-blue-400"
                          : isDarkMode
                          ? "hover:bg-slate-700/30"
                          : "hover:bg-gray-50/80"
                      }`}
                    >
                      <td className={`p-4 pl-6 font-mono font-bold ${isDarkMode ? "text-slate-400" : "text-gray-500"}`}>
                        #{log.id}
                      </td>

                      <td className="p-4">
                        <p className={`font-bold text-xs ${isDarkMode ? "text-slate-100" : "text-gray-900"}`}>
                          {log.user_name}
                        </p>
                        <span className={`text-[10px] font-bold uppercase ${isDarkMode ? "text-slate-400" : "text-gray-500"}`}>
                          {log.role}
                        </span>
                      </td>

                      <td className="p-4 text-center">
                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold border ${getActionBadge(log.action)}`}>
                          {log.action}
                        </span>
                      </td>

                      <td className={`p-4 font-bold text-xs ${isDarkMode ? "text-blue-400" : "text-blue-600"}`}>
                        {log.target}
                      </td>

                      <td className={`p-4 leading-relaxed max-w-md break-words ${isDarkMode ? "text-slate-300" : "text-gray-800"}`}>
                        {log.details}
                      </td>

                      <td className={`p-4 font-mono text-[11px] ${isDarkMode ? "text-slate-400" : "text-gray-600 font-medium"}`}>
                        {log.ip_address}
                      </td>

                      <td className={`p-4 pr-6 whitespace-nowrap text-[11px] ${isDarkMode ? "text-slate-400" : "text-gray-600 font-medium"}`}>
                        {new Date(log.created_at).toLocaleString("th-TH")}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}