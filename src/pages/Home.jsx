import React, { useState, useEffect, useMemo, useCallback, lazy, Suspense } from "react";
import { useNavigate } from "react-router-dom";
import { socket } from "../socket";

// 🟢 Components (lazy load: โหลดไฟล์ของแต่ละหน้าเฉพาะตอนเปิดแท็บนั้น ทำให้เปิดเว็บครั้งแรกเร็วขึ้น
//    เช่น Konva ของหน้า Layout จะไม่ถูกโหลดถ้าไม่ได้เปิดหน้า Layout)
const OverallContent = lazy(() => import("../components/dashboard/OverallContent"));
const LinesAndStation = lazy(() => import("../components/dashboard/LinesAndStation"));
const UserManagementContent = lazy(() => import("../components/dashboard/UserManagementContent"));
const AuditLogContent = lazy(() => import("../components/dashboard/AuditLogContent"));
const OperatorContent = lazy(() => import("../components/dashboard/OperatorContent"));
const LayoutViewerContent = lazy(() => import("../components/dashboard/LayoutViewerContent"));
const LayoutEditorContent = lazy(() => import("../components/dashboard/LayoutEditorContent"));
const TaskContent = lazy(() => import("../components/dashboard/TaskContent"));
const RepairTaskContent = lazy(() => import("../components/dashboard/RepairTaskContent"));
const KnowledgeContent = lazy(() => import("../components/dashboard/KnowledgeContent"));
const ExcelSearchContent = lazy(() => import("../components/dashboard/ExcelSearchContent"));
const PhotoOperator = lazy(() => import("../components/dashboard/PhotoOperator"));
const AutoTriggerExcel = lazy(() => import("../components/dashboard/AutoTriggerExcel"));
const StepCustom = lazy(() => import("../components/dashboard/StepCustom"));
const Api = lazy(() => import("../components/dashboard/ApiDocContent")); // 🟢 Api
const DailyCheckList = lazy(() => import("../components/dashboard/DailyCheckList"));
const PmChecklistBuilder = lazy(() => import("../components/dashboard/PmChecklistBuilder"));

// 🟢 Common
import NotificationBell from "../components/common/NotificationBell";
import DarkModeToggle from "../components/common/DarkModeToggle";

// 🟢 Sub-component สำหรับแสดงรูปโปรไฟล์มุมขวาบน
function CurrentUserAvatar({ email, name }) {
  const [imgSrc, setImgSrc] = useState(null);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    let isMounted = true;
    if (!email || !email.trim()) {
      setImgSrc(null);
      return;
    }

    const fetchPhoto = async () => {
      try {
        const res = await fetch(`/api/users/photo-by-email?email=${encodeURIComponent(email.trim())}`);
        if (!res.ok) {
          if (isMounted) setHasError(true);
          return;
        }

        const blob = await res.blob();
        if (blob.size === 0) {
          if (isMounted) setHasError(true);
          return;
        }

        if (isMounted) {
          setImgSrc(URL.createObjectURL(blob));
          setHasError(false);
        }
      } catch {
        if (isMounted) setHasError(true);
      }
    };

    fetchPhoto();

    return () => {
      isMounted = false;
      if (imgSrc) URL.revokeObjectURL(imgSrc);
    };
  }, [email]);

  if (imgSrc && !hasError) {
    return (
      <img
        src={imgSrc}
        alt={name || "User Avatar"}
        className="w-7 h-7 rounded-full object-cover border border-blue-400/40 shadow-sm"
        onError={() => setHasError(true)}
      />
    );
  }

  const initial = name ? name.trim().charAt(0).toUpperCase() : "?";
  return (
    <div className="w-7 h-7 bg-blue-500 text-white rounded-full flex items-center justify-center font-bold text-xs shadow-sm">
      {initial}
    </div>
  );
}

export default function Home({ isDarkMode, setIsDarkMode }) {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("");
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [currentUser, setCurrentUser] = useState({ name: "", employeeId: "", role: "", email: "" });
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  const userRole = currentUser.role;

  // ==========================================
  // 🎯 รายการเมนูทั้งหมดและสิทธิ์เข้าถึง
  // ==========================================
  const tabsConfig = useMemo(
    () => [
      // ⚙️ System Overview
      {
        id: "overall",
        label: "Overall",
        category: "System Overview",
        roles: ["admin"],
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 012-2h2a2 2 0 012 2v6a2 2 0 01-2 2h-2a2 2 0 01-2-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
        ),
      },
      {
        id: "auto_trigger",
        label: "Forms Auto-Sync",
        category: "Administration",
        roles: ["admin"],
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        ),
      },
      {
        id: "lines_station",
        label: "Lines & Stations",
        category: "System Overview",
        roles: ["admin", "me", "ie", "pd", "q"],
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2h0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
        ),
      },
      {
        id: "layout_view",
        label: "Layout Overview",
        category: "System Overview",
        roles: ["admin", "me", "ie", "pd", "q", "view"],
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
          </svg>
        ),
      },

      // 🛠️ Engineering Tasks
      {
        id: "task",
        label: "Task Board",
        category: "Engineering Tasks",
        roles: ["admin", "me", "pd"],
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
        roles: ["admin", "me", "pd"],
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 4a2 2 0 114 0v1a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-1a2 2 0 100 4h1a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-1a2 2 0 10-4 0v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-3a1 1 0 00-1-1H4a2 2 0 110-4h1a1 1 0 011-1V7a1 1 0 011-1h3a1 1 0 001-1V4z" />
          </svg>
        ),
      },
      {
        id: "step_custom",
        label: "PLC Sequence Steps",
        category: "Engineering Tasks",
        roles: ["admin", "me"],
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        ),
      },

      // 🏭 Production Control
      {
        id: "operator",
        label: "Operator List",
        category: "Production Control",
        roles: ["admin", "pd", "me"],
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
          </svg>
        ),
      },
      {
        id: "photo_operator",
        label: "Photo Capture",
        category: "Production Control",
        roles: ["admin", "me"],
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        ),
      },
      {
        id: "pm_daily",
        label: "Daily PM Checklist",
        category: "Production Control",
        // ทุก role เข้าดู/อนุมัติได้ (ผู้อนุมัติอาจเป็น Leader/Supervisor ที่ role ใดก็ได้) แต่ View บันทึกไม่ได้
        roles: ["admin", "me", "ie", "pd", "q", "view"],
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
          </svg>
        ),
      },
      {
        id: "pm_create",
        label: "Create Daily PM Checklist",
        category: "Production Control",
        roles: ["admin", "me"],
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7v6m-3-3h6" />
          </svg>
        ),
      },
      {
        id: "layout",
        label: "Layout Editor",
        category: "Production Control",
        roles: ["admin"],
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
          </svg>
        ),
      },

      // 🛡️ Administration
      {
        id: "users",
        label: "User Management",
        category: "Administration",
        roles: ["admin"],
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
        roles: ["admin"],
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        ),
      },
      {
        id: "excel_search",
        label: "Excel OneDrive",
        category: "Administration",
        roles: ["admin"],
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        ),
      },

      // 📚 Documentation
      {
        id: "knowledge",
        label: "Knowledge Hub",
        category: "Documentation",
        roles: ["admin", "me"],
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
          </svg>
        ),
      },
      // 🟢 แท็บเมนู API Hub สำหรับทดสอบ/รวม API
      {
        id: "api_hub",
        label: "API Gateway",
        category: "Documentation",
        roles: ["admin", "me", "ie", "pd", "q", "view"],
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
          </svg>
        ),
      },
    ],
    []
  );

  const handleLogout = () => {
    localStorage.setItem("logout-event", Date.now().toString());
    localStorage.removeItem("userRole");
    localStorage.removeItem("employeeId");
    localStorage.removeItem("userName");
    localStorage.removeItem("userEmail");
    localStorage.removeItem("sessionToken");
    localStorage.removeItem("token");
    localStorage.removeItem("user");

    if (socket && socket.connected) {
      socket.disconnect();
    }

    setTimeout(() => {
      navigate("/", { replace: true });
    }, 20);
  };

  const checkAuth = useCallback(() => {
    const token = localStorage.getItem("token") || localStorage.getItem("sessionToken");
    const role = (localStorage.getItem("userRole") || "").toLowerCase().trim();
    const empId = localStorage.getItem("employeeId");
    const name = localStorage.getItem("userName");

    let email = localStorage.getItem("userEmail") || "";
    if (!email) {
      try {
        const savedUser = JSON.parse(localStorage.getItem("user") || "{}");
        email = savedUser.email || "";
      } catch {
        email = "";
      }
    }

    if (!token || !role || !empId) {
      setIsAuthorized(false);
      navigate("/", { replace: true });
      return;
    }

    setCurrentUser({
      name: name || "User",
      employeeId: empId,
      role: role,
      email: email,
    });

    const accessible = tabsConfig.filter((t) => t.roles.includes(role));
    if (accessible.length > 0) {
      setActiveTab((prev) => (accessible.some((t) => t.id === prev) ? prev : accessible[0].id));
      setIsAuthorized(true);
    } else {
      setIsAuthorized(true);
      setActiveTab("layout_view");
    }
  }, [navigate, tabsConfig]);

  useEffect(() => {
    checkAuth();
    const handlePageShow = (e) => {
      if (e.persisted) checkAuth();
    };
    window.addEventListener("pageshow", handlePageShow);
    return () => window.removeEventListener("pageshow", handlePageShow);
  }, [checkAuth]);

  // คัดกรองแท็บที่ผู้ใช้ปัจจุบันมีสิทธิ์เข้าถึง
  const accessibleTabs = useMemo(
    () => tabsConfig.filter((tab) => tab.roles.includes(userRole)),
    [tabsConfig, userRole]
  );
  
  const categories = useMemo(
    () => [...new Set(accessibleTabs.map((t) => t.category))],
    [accessibleTabs]
  );

  // ฟังก์ชันแยกสำหรับ Render Content ของแต่ละแท็บ
  const renderTabContent = (tabId) => {
    switch (tabId) {
      case "overall":
        return <OverallContent isDarkMode={isDarkMode} />;
      case "lines_station":
        return <LinesAndStation isDarkMode={isDarkMode} />;
      case "layout_view":
        return <LayoutViewerContent isDarkMode={isDarkMode} />;
      case "task":
        return <TaskContent isDarkMode={isDarkMode} />;
      case "repair":
        return <RepairTaskContent isDarkMode={isDarkMode} />;
      case "step_custom":
        return <StepCustom isDarkMode={isDarkMode} />;
      case "operator":
        return (
          <OperatorContent
            isDarkMode={isDarkMode}
            userRole={userRole}
            role={userRole}
            isAdmin={userRole === "admin"}
          />
        );
      case "photo_operator":
        return <PhotoOperator isDarkMode={isDarkMode} />;
      case "layout":
        return <LayoutEditorContent isDarkMode={isDarkMode} />;
      case "users":
        return <UserManagementContent isDarkMode={isDarkMode} />;
      case "audit":
        return <AuditLogContent isDarkMode={isDarkMode} />;
      case "excel_search":
        return <ExcelSearchContent isDarkMode={isDarkMode} />;
      case "knowledge":
        return <KnowledgeContent isDarkMode={isDarkMode} />;
      case "auto_trigger":
        return <AutoTriggerExcel isDarkMode={isDarkMode} />;
      case "api_hub":
        return <Api isDarkMode={isDarkMode} />; // 🟢 Render Api Component
      case "pm_daily":
        return <DailyCheckList isDarkMode={isDarkMode} />;
      case "pm_create":
        return <PmChecklistBuilder isDarkMode={isDarkMode} />;
      default:
        return null;
    }
  };

  if (!isAuthorized) {
    return (
      <div
        className={`h-screen w-screen flex items-center justify-center ${
          isDarkMode ? "bg-[#0F172A] text-slate-400" : "bg-[#F4F6F8] text-gray-500"
        }`}
      >
        <div className="flex flex-col items-center gap-2">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
          <span className="text-xs font-medium">Authenticating...</span>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`flex h-screen font-sans antialiased transition-colors duration-200 ${
        isDarkMode ? "bg-[#0F172A] text-slate-100" : "bg-[#F4F6F8] text-gray-800"
      }`}
    >
      {/* Sidebar */}
      <aside
        className={`border-r flex flex-col justify-between transition-all duration-300 relative select-none ${
          isSidebarCollapsed ? "w-20" : "w-64"
        } ${isDarkMode ? "bg-[#1E293B] border-slate-700/60" : "bg-white border-gray-200"}`}
      >
        <div>
          {/* Header Sidebar: Logo & Toggle */}
          <div
            className={`flex items-center justify-between p-4 border-b ${
              isDarkMode ? "border-slate-700/60" : "border-gray-100"
            }`}
          >
            <div className="flex items-center gap-3 overflow-hidden">
              <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center font-bold text-white shadow-sm uppercase shrink-0">
                {userRole ? userRole.substring(0, 2) : "US"}
              </div>
              {!isSidebarCollapsed && (
                <div className="truncate">
                  <h1 className={`font-bold text-sm leading-tight ${isDarkMode ? "text-blue-400" : "text-blue-900"}`}>
                    MSH SYSTEM
                  </h1>
                  <p className="text-[11px] text-gray-400 uppercase font-semibold">
                    {userRole} Portal
                  </p>
                </div>
              )}
            </div>

            <button
              onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
              className={`p-1.5 rounded-lg border transition-colors ${
                isDarkMode
                  ? "bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700"
                  : "bg-gray-100 border-gray-200 text-gray-600 hover:bg-gray-200"
              }`}
              title={isSidebarCollapsed ? "ขยายแถบเมนู" : "ย่อแถบเมนู"}
            >
              <svg
                className={`w-4 h-4 transition-transform duration-200 ${isSidebarCollapsed ? "rotate-180" : ""}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
              </svg>
            </button>
          </div>

          {/* Navigation Links */}
          <div className="p-3 space-y-4 overflow-y-auto max-h-[calc(100vh-140px)] overflow-x-hidden">
            {categories.map((cat) => {
              const catTabs = accessibleTabs.filter((t) => t.category === cat);
              return (
                <div key={cat}>
                  {!isSidebarCollapsed && (
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2 px-3 truncate">
                      {cat}
                    </p>
                  )}
                  <nav className="space-y-1">
                    {catTabs.map((tab) => {
                      const isActive = activeTab === tab.id;
                      return (
                        <button
                          key={tab.id}
                          onClick={() => setActiveTab(tab.id)}
                          title={isSidebarCollapsed ? tab.label : ""}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl font-medium text-xs transition-all ${
                            isActive
                              ? "bg-blue-600 text-white shadow-md shadow-blue-500/20"
                              : isDarkMode
                              ? "text-slate-300 hover:bg-slate-700/50"
                              : "text-gray-600 hover:bg-gray-100"
                          } ${isSidebarCollapsed ? "justify-center" : ""}`}
                        >
                          <span className="shrink-0">{tab.icon}</span>
                          {!isSidebarCollapsed && <span className="truncate">{tab.label}</span>}
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
        <div className={`p-3 border-t ${isDarkMode ? "border-slate-700/60" : "border-gray-100"}`}>
          <button
            onClick={handleLogout}
            title={isSidebarCollapsed ? "Logout" : ""}
            className={`w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-rose-500 hover:bg-rose-500/10 rounded-xl transition-colors ${
              isSidebarCollapsed ? "justify-center" : ""
            }`}
          >
            <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            {!isSidebarCollapsed && <span>Logout</span>}
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header Bar */}
        <header className="bg-[#1E293B] text-white px-8 py-3.5 flex items-center justify-between shadow-sm border-b border-slate-700/50">
          <div className="flex items-center gap-6 flex-1 max-w-xl">
            <span className="font-bold text-xs tracking-wider uppercase text-blue-300 whitespace-nowrap">
              {userRole} Workstation Dashboard
            </span>
          </div>

          <div className="flex items-center gap-3">
            {userRole !== "view" && <NotificationBell isDarkMode={isDarkMode} />}
            <DarkModeToggle isDarkMode={isDarkMode} setIsDarkMode={setIsDarkMode} />
            <div className="h-4 w-[1px] bg-slate-600 mx-1"></div>
            <div className="flex items-center gap-2 pl-2">
              <CurrentUserAvatar email={currentUser.email} name={currentUser.name} />
              <div className="text-left text-xs">
                <p className="font-semibold text-white leading-tight">{currentUser.name}</p>
                <p className="text-[10px] text-gray-400">ID: {currentUser.employeeId} ({userRole})</p>
              </div>
            </div>
          </div>
        </header>

        {/* Dynamic Content Render */}
        <main className="flex-1 overflow-y-auto p-8">
          {accessibleTabs.some((t) => t.id === activeTab) ? (
            <div className="h-full">
              <Suspense
                fallback={
                  <div className="py-12 text-center text-sm text-gray-400 animate-pulse">กำลังโหลด...</div>
                }
              >
                {renderTabContent(activeTab)}
              </Suspense>
            </div>
          ) : (
            <div className="text-center py-12 text-gray-400 text-sm">
              คุณไม่มีสิทธิ์เข้าถึงหน้านี้
            </div>
          )}
        </main>
      </div>
    </div>
  );
}