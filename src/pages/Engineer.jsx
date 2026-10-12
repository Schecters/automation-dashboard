import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { socket } from "../socket";

// 🟢 Import คอมโพเนนต์ย่อยสำหรับเนื้อหา
import TaskContent from "../components/dashboard/TaskContent";
import RepairTaskContent from "../components/dashboard/RepairTaskContent";
import LinesAndStation from "../components/dashboard/LinesAndStation";
import OverallContent from "../components/dashboard/OverallContent";
import KnowledgeContent from "../components/dashboard/KnowledgeContent";

// 🟢 Import คอมโพเนนต์ส่วนกลาง (Common Components)
import NotificationBell from "../components/common/NotificationBell";
import DarkModeToggle from "../components/common/DarkModeToggle";

export default function Engineer({ isDarkMode, setIsDarkMode }) {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("task");
  
  // 🔐 State สำหรับตรวจสอบสิทธิ์
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [engineerUser, setEngineerUser] = useState({
    name: "Engineer",
    employeeId: "",
  });

  const verifyEngineerAuth = () => {
    const token = localStorage.getItem("token") || localStorage.getItem("sessionToken");
    const rawRole = localStorage.getItem("userRole") || "";
    const role = rawRole.toLowerCase().trim();
    const empId = localStorage.getItem("employeeId");
    const name = localStorage.getItem("userName");

    // 1. ถ้าไม่มี Token หรือข้อมูลผู้ใช้ -> ส่งกลับหน้า Login
    if (!token || !empId) {
      setIsAuthorized(false);
      navigate("/", { replace: true });
      return false;
    }

    // 2. อนุญาตทั้ง role engineer และ admin ให้เปิดหน้านี้ได้
    if (role !== "engineer" && role !== "admin") {
      setIsAuthorized(false);
      if (role === "production") {
        navigate("/production", { replace: true });
      } else {
        navigate("/", { replace: true });
      }
      return false;
    }

    // 3. ผ่านการตรวจสอบสิทธิ์
    setEngineerUser({
      name: name || "Engineer",
      employeeId: empId,
    });
    setIsAuthorized(true);
    return true;
  };

  useEffect(() => {
    // ตรวจสอบสิทธิ์ตอน Component Mount
    verifyEngineerAuth();

    // 🛡️ ดักฟัง pageshow เพื่อป้องกันปัญหา Back-Forward Cache (bfcache)
    const handlePageShow = (event) => {
      if (event.persisted) {
        verifyEngineerAuth();
      }
    };

    window.addEventListener("pageshow", handlePageShow);
    return () => window.removeEventListener("pageshow", handlePageShow);
  }, [navigate]);

  const handleLogout = () => {
    localStorage.setItem("logout-event", Date.now().toString());
    localStorage.clear();

    if (socket && socket.connected) {
      socket.disconnect();
    }

    // 🔄 ล้าง History Stack แล้วแทนที่ด้วยหน้า Login ทันที
    window.location.replace("/");
  };

  if (!isAuthorized) {
    return (
      <div className={`h-screen w-screen flex items-center justify-center ${
        isDarkMode ? "bg-[#0F172A] text-slate-400" : "bg-[#F4F6F8] text-gray-500"
      }`}>
        <div className="flex flex-col items-center gap-2">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
          <span className="text-xs font-medium">Checking authorization...</span>
        </div>
      </div>
    );
  }

  const tabs = [
    {
      id: "task",
      label: "Task Board",
      category: "Engineering Tasks",
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
        </svg>
      ),
    },
    {
      id: "repair",
      label: "Create Task",
      category: "Engineering Tasks",
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 4a2 2 0 114 0v1a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-1a2 2 0 100 4h1a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-1a2 2 0 10-4 0v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-3a1 1 0 00-1-1H4a2 2 0 110-4h1a1 1 0 011-1V7a1 1 0 011-1h3a1 1 0 001-1V4z" />
        </svg>
      ),
    },
    {
      id: "lines_station",
      label: "Lines & Stations",
      category: "System Overview",
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
        </svg>
      ),
    },
    {
      id: "overall",
      label: "System Health",
      category: "System Overview",
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 012-2h2a2 2 0 012 2v6a2 2 0 01-2 2h-2a2 2 0 01-2-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
      ),
    },
    {
      id: "knowledge",
      label: "Knowledge Hub",
      category: "Documentation",
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
        </svg>
      ),
    },
  ];

  return (
    <div className={`flex h-screen font-sans antialiased transition-colors duration-200 ${
      isDarkMode ? "bg-[#0F172A] text-slate-100" : "bg-[#F4F6F8] text-gray-800"
    }`}>
      {/* Sidebar */}
      <aside className={`w-64 border-r flex flex-col justify-between transition-colors ${
        isDarkMode ? "bg-[#1E293B] border-slate-700/60" : "bg-white border-gray-200"
      }`}>
        <div>
          {/* Logo Section */}
          <div className={`flex items-center gap-3 p-5 border-b select-none ${
            isDarkMode ? "border-slate-700/60" : "border-gray-100"
          }`}>
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center font-bold text-white shadow-sm">
              EN
            </div>
            <div>
              <h1 className={`font-bold text-sm leading-tight ${isDarkMode ? "text-blue-400" : "text-blue-900"}`}>
                DELTA MSH
              </h1>
              <p className="text-[11px] text-gray-400">Engineer Portal</p>
            </div>
          </div>

          {/* Navigation Menu */}
          <div className="p-4 space-y-4 overflow-y-auto max-h-[calc(100vh-140px)]">
            {["Engineering Tasks", "System Overview", "Documentation"].map((cat) => {
              const catTabs = tabs.filter((t) => t.category === cat);
              if (catTabs.length === 0) return null;

              return (
                <div key={cat}>
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2 px-3">
                    {cat}
                  </p>
                  <nav className="space-y-1">
                    {catTabs.map((tab) => {
                      const isActive = activeTab === tab.id;
                      return (
                        <button
                          key={tab.id}
                          onClick={() => setActiveTab(tab.id)}
                          className={`w-full flex items-center gap-3 px-3.5 py-2 rounded-xl font-medium text-xs transition-all ${
                            isActive
                              ? "bg-blue-600 text-white shadow-md shadow-blue-500/20"
                              : isDarkMode
                              ? "text-slate-300 hover:bg-slate-700/50"
                              : "text-gray-600 hover:bg-gray-100"
                          }`}
                        >
                          {tab.icon}
                          {tab.label}
                        </button>
                      );
                    })}
                  </nav>
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer Logout */}
        <div className={`p-4 border-t space-y-3 ${isDarkMode ? "border-slate-700/60" : "border-gray-100"}`}>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-rose-500 hover:bg-rose-500/10 rounded-lg transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            Logout
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header Bar */}
        <header className="bg-[#1E293B] text-white px-8 py-3.5 flex items-center justify-between shadow-sm border-b border-slate-700/50">
          <div className="flex items-center gap-6 flex-1 max-w-xl">
            <span className="font-bold text-xs tracking-wider uppercase text-blue-300 whitespace-nowrap">
              Engineer Workstation
            </span>
          </div>

          <div className="flex items-center gap-3">
            {/* 🔔 Notifications Component */}
            <NotificationBell isDarkMode={isDarkMode} />

            {/* 🌓 Dark Mode Toggle Component */}
            <DarkModeToggle isDarkMode={isDarkMode} setIsDarkMode={setIsDarkMode} />

            <div className="h-4 w-[1px] bg-slate-600 mx-1"></div>

            {/* 👤 Engineer Profile Badge */}
            <div className="flex items-center gap-2 pl-2">
              <div className="w-7 h-7 bg-blue-500 text-white rounded-full flex items-center justify-center font-bold text-xs">
                {engineerUser.name.charAt(0).toUpperCase()}
              </div>
              <div className="text-left text-xs">
                <p className="font-semibold text-white leading-tight">{engineerUser.name}</p>
                <p className="text-[10px] text-gray-400">ID: {engineerUser.employeeId}</p>
              </div>
            </div>
          </div>
        </header>

        {/* Dynamic Main Content */}
        <main className="flex-1 overflow-y-auto p-8">
          {activeTab === "task" && <TaskContent isDarkMode={isDarkMode} />}
          {activeTab === "repair" && <RepairTaskContent isDarkMode={isDarkMode} />}
          {activeTab === "lines_station" && <LinesAndStation isDarkMode={isDarkMode} />}
          {activeTab === "overall" && <OverallContent isDarkMode={isDarkMode} />}
          {activeTab === "knowledge" && <KnowledgeContent isDarkMode={isDarkMode} />}
        </main>
      </div>
    </div>
  );
}