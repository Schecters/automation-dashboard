import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { socket } from "../socket";

// 🟢 Import คอมโพเนนต์ย่อย
import OverallContent from "../components/dashboard/OverallContent";
import TaskContent from "../components/dashboard/TaskContent";
import RepairTaskContent from "../components/dashboard/RepairTaskContent";
import KnowledgeContent from "../components/dashboard/KnowledgeContent";
import OperatorContent from "../components/dashboard/OperatorContent";
import LayoutEditorContent from "../components/dashboard/LayoutEditorContent";
import UserManagementContent from "../components/dashboard/UserManagementContent";
import AuditLogContent from "../components/dashboard/AuditLogContent";
import LinesAndStation from "../components/dashboard/LinesAndStation";
import NotificationBell from "../components/common/NotificationBell";
import DarkModeToggle from "../components/common/DarkModeToggle";

function Admin({ isDarkMode, setIsDarkMode }) {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("overall");
  
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [adminUser, setAdminUser] = useState({
    name: "Admin",
    employeeId: "",
  });

  const verifyAdminAuth = () => {
    const token = localStorage.getItem("token") || localStorage.getItem("sessionToken");
    const rawRole = localStorage.getItem("userRole") || "";
    const currentRole = rawRole.toLowerCase().trim();
    const empId = localStorage.getItem("employeeId");
    const name = localStorage.getItem("userName");

    if (!token || !currentRole || !empId) {
      setIsAuthorized(false);
      navigate("/", { replace: true });
      return false;
    }

    if (currentRole !== "admin") {
      setIsAuthorized(false);
      if (currentRole === "engineer") {
        navigate("/engineer", { replace: true });
      } else if (currentRole === "production") {
        navigate("/production", { replace: true });
      } else if (currentRole === "operator") {
        navigate("/operator", { replace: true });
      } else {
        navigate("/", { replace: true });
      }
      return false;
    }

    setAdminUser({
      name: name || "Admin",
      employeeId: empId,
    });
    setIsAuthorized(true);
    return true;
  };

  useEffect(() => {
    verifyAdminAuth();

    const handlePageShow = (event) => {
      if (event.persisted) {
        verifyAdminAuth();
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
      id: "overall",
      label: "Overall",
      category: "System",
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 012-2h2a2 2 0 012 2v6a2 2 0 01-2 2h-2a2 2 0 01-2-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
      ),
    },
    {
      id: "lines_station",
      label: "Lines & Stations",
      category: "System",
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
        </svg>
      ),
    },
    {
      id: "users",
      label: "User Management",
      category: "Administration",
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
        </svg>
      ),
    },
    {
      id: "audit",
      label: "Audit Log",
      category: "Administration",
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      ),
    },
    {
      id: "operator",
      label: "Operator List",
      category: "Production",
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
        </svg>
      ),
    },
    {
      id: "layout",
      label: "Layout Editor",
      category: "Production",
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
        </svg>
      ),
    },
    {
      id: "task",
      label: "Task Board",
      category: "Engineering",
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
        </svg>
      ),
    },
    {
      id: "repair",
      label: "Create Task",
      category: "Engineering",
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 4a2 2 0 114 0v1a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-1a2 2 0 100 4h1a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-1a2 2 0 10-4 0v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-3a1 1 0 00-1-1H4a2 2 0 110-4h1a1 1 0 011-1V7a1 1 0 011-1h3a1 1 0 001-1V4z" />
        </svg>
      ),
    },
    {
      id: "knowledge",
      label: "Knowledge Hub",
      category: "Engineering",
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
              AD
            </div>
            <div>
              <h1 className={`font-bold text-sm leading-tight ${isDarkMode ? "text-blue-400" : "text-blue-900"}`}>
                DELTA MSH
              </h1>
              <p className="text-[11px] text-gray-400">Admin Central Portal</p>
            </div>
          </div>

          {/* Navigation Menu by Categories */}
          <div className="p-4 space-y-4 overflow-y-auto max-h-[calc(100vh-140px)]">
            {["System", "Administration", "Production", "Engineering"].map((cat) => {
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

        {/* Footer Sidebar */}
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
              Admin Central Portal
            </span>
          </div>

          <div className="flex items-center gap-3">
            {/* 🔔 Notifications Component */}
            <NotificationBell isDarkMode={isDarkMode} />

            {/* 🌓 Dark Mode Toggle Component */}
            <DarkModeToggle isDarkMode={isDarkMode} setIsDarkMode={setIsDarkMode} />

            <div className="h-4 w-[1px] bg-slate-600 mx-1"></div>

            {/* 👤 Admin Profile Badge */}
            <div className="flex items-center gap-2 pl-2">
              <div className="w-7 h-7 bg-blue-500 text-white rounded-full flex items-center justify-center font-bold text-xs">
                {adminUser.name.charAt(0).toUpperCase()}
              </div>
              <div className="text-left text-xs">
                <p className="font-semibold text-white leading-tight">{adminUser.name}</p>
                <p className="text-[10px] text-gray-400">ID: {adminUser.employeeId || "Admin"}</p>
              </div>
            </div>
          </div>
        </header>

        {/* Dynamic Content */}
        <main className="flex-1 overflow-y-auto p-8">
          {activeTab === "overall" && <OverallContent isDarkMode={isDarkMode} />}
          {activeTab === "lines_station" && <LinesAndStation isDarkMode={isDarkMode} />}
          {activeTab === "users" && <UserManagementContent isDarkMode={isDarkMode} />}
          {activeTab === "audit" && <AuditLogContent isDarkMode={isDarkMode} />}
          {activeTab === "operator" && <OperatorContent isDarkMode={isDarkMode} canEdit={true} />}
          {activeTab === "layout" && <LayoutEditorContent isDarkMode={isDarkMode} />}
          {activeTab === "task" && <TaskContent isDarkMode={isDarkMode} />}
          {activeTab === "repair" && <RepairTaskContent isDarkMode={isDarkMode} />}
          {activeTab === "knowledge" && <KnowledgeContent isDarkMode={isDarkMode} />}
        </main>
      </div>
    </div>
  );
}

export default Admin;