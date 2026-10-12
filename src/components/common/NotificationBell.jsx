// src/components/common/NotificationBell.jsx
import React, { useState, useEffect, useRef } from "react";
import { socket } from "../../socket";

export default function NotificationBell({ isDarkMode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const dropdownRef = useRef(null);

  const API_URL = "/api";

  const getHeaders = () => {
    const token = localStorage.getItem("token") || localStorage.getItem("sessionToken");
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "x-session-token": token,
    };
  };

  // 1. ดึงประวัติการแจ้งเตือนจากฐานข้อมูลตอนเข้าสู่ระบบ
  const fetchNotifications = async () => {
    const token = localStorage.getItem("token") || localStorage.getItem("sessionToken");
    if (!token) return;

    try {
      const res = await fetch(`${API_URL}/notifications`, {
        headers: getHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          setNotifications(
            data.map((item) => ({
              id: item.id,
              title: item.title,
              message: item.message,
              problem: item.problem,
              taskId: item.task_id,
              time: new Date(item.created_at).toLocaleString("th-TH", {
                timeZone: "Asia/Bangkok",
                month: "numeric",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              }),
              read: item.is_read,
            }))
          );
        }
      }
    } catch (err) {
      console.error("Fetch Notifications Error:", err);
    }
  };

  useEffect(() => {
    fetchNotifications();

    // 2. ดักรับแจ้งเตือนเพิ่มเข้ามาในกระดิ่งแบบ Real-time
    const handleIncomingAlert = (data) => {
      const newAlert = {
        id: data.id || Date.now(),
        title: data.title || "Incident Alert",
        message: data.message || "",
        problem: data.problem || "",
        taskId: data.taskId || "",
        time: new Date().toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" }),
        read: false,
      };

      setNotifications((prev) => [newAlert, ...prev]);
    };

    socket.on("new_notification", handleIncomingAlert);

    return () => {
      socket.off("new_notification", handleIncomingAlert);
    };
  }, []);

  // ปิด Dropdown เมื่อคลิกนอกพื้นที่
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const unreadCount = notifications.filter((n) => !n.read).length;

  // 3. เมื่อเปิดดูกระดิ่ง จะมาร์กว่าอ่านแล้วทั้งหมด (ส่งไปอัปเดตใน DB ด้วย)
  const markAllAsRead = async () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    try {
      await fetch(`${API_URL}/notifications/mark-read`, {
        method: "PUT",
        headers: getHeaders(),
      });
    } catch (err) {
      console.error("Mark Read Error:", err);
    }
  };

  // 4. ลบการแจ้งเตือนทั้งหมด
  const clearAllNotifications = async () => {
    setNotifications([]);
    setIsOpen(false);
    try {
      await fetch(`${API_URL}/notifications`, {
        method: "DELETE",
        headers: getHeaders(),
      });
    } catch (err) {
      console.error("Clear Notifications Error:", err);
    }
  };

  const handleToggle = () => {
    if (!isOpen && unreadCount > 0) {
      markAllAsRead();
    }
    setIsOpen(!isOpen);
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* 🔔 ปุ่มกระดิ่ง */}
      <button
        type="button"
        onClick={handleToggle}
        className={`relative p-2 rounded-xl border transition-all ${
          isDarkMode
            ? "bg-[#1E293B] border-slate-700 text-slate-300 hover:text-white hover:bg-slate-700/50"
            : "bg-white border-gray-200 text-gray-600 hover:text-gray-900 hover:bg-gray-100 shadow-sm"
        }`}
        title="Notifications"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
          />
        </svg>

        {/* 🔴 Badge แสดงจำนวนรายการที่ยังไม่อ่าน */}
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white shadow-sm animate-pulse">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {/* 📋 Dropdown รายการแจ้งเตือน */}
      {isOpen && (
        <div
          className={`absolute right-0 mt-2 w-80 sm:w-96 rounded-2xl border shadow-2xl z-[9999] overflow-hidden transition-all animate-fadeIn ${
            isDarkMode ? "bg-[#1E293B] border-slate-700 text-white" : "bg-white border-gray-200 text-gray-900"
          }`}
        >
          {/* Header */}
          <div
            className={`flex items-center justify-between px-4 py-3 border-b ${
              isDarkMode ? "border-slate-700/80 bg-[#0F172A]/50" : "border-gray-100 bg-gray-50/80"
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold">Notifications</span>
              {notifications.length > 0 && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 font-bold border border-blue-500/20">
                  {notifications.length}
                </span>
              )}
            </div>
            {notifications.length > 0 && (
              <button
                onClick={clearAllNotifications}
                className="text-[11px] text-gray-400 hover:text-rose-400 transition-colors font-medium"
              >
                Clear all
              </button>
            )}
          </div>

          {/* List */}
          <div className="max-h-80 overflow-y-auto divide-y divide-gray-100 dark:divide-slate-700/50">
            {notifications.length === 0 ? (
              <div className="py-8 text-center text-xs text-gray-400">
                <span className="block text-2xl mb-1 opacity-50">🔕</span>
                ไม่มีการแจ้งเตือนในขณะนี้
              </div>
            ) : (
              notifications.map((item) => (
                <div
                  key={item.id}
                  className={`p-3.5 text-xs transition-colors flex gap-3 items-start ${
                    !item.read
                      ? isDarkMode
                        ? "bg-slate-800/60"
                        : "bg-blue-50/50"
                      : isDarkMode
                      ? "hover:bg-slate-700/30"
                      : "hover:bg-gray-50"
                  }`}
                >
                  <span className="text-base p-1.5 bg-rose-500/10 text-rose-400 rounded-lg shrink-0">
                    ⚠️
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1">
                      <p className="font-bold text-rose-400 truncate">{item.title}</p>
                      <span className="text-[10px] text-gray-400 shrink-0 font-mono">{item.time}</span>
                    </div>
                    <p className={`font-semibold mt-0.5 ${isDarkMode ? "text-slate-200" : "text-gray-700"}`}>
                      {item.message}
                    </p>
                    {item.problem && (
                      <p
                        className={`mt-1.5 p-2 rounded-lg border text-[11px] leading-relaxed break-words whitespace-pre-wrap line-clamp-2 ${
                          isDarkMode
                            ? "bg-[#0F172A] border-slate-700/80 text-slate-300"
                            : "bg-gray-50 border-gray-200 text-gray-600"
                        }`}
                      >
                        "{item.problem}"
                      </p>
                    )}
                    {item.taskId && (
                      <div className="mt-1.5 text-[10px] font-mono text-blue-400 font-bold">
                        Task: {item.taskId}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}