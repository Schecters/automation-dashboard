import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { socket } from "../socket";

// 🟢 Import คอมโพเนนต์ย่อยจากโฟลเดอร์ src/components/dashboard
import OperatorContent from "../components/dashboard/OperatorContent";
import LayoutEditorContent from "../components/dashboard/LayoutEditorContent";

function Production({ isDarkMode, setIsDarkMode }) {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("operator");

  // 🔐 1. State ตรวจสอบการอนุญาต (เริ่มต้นเป็น false เพื่อป้องกันหน้าแวบ)
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [productionUser, setProductionUser] = useState({
    name: "Production",
    employeeId: "",
  });

  useEffect(() => {
  const token = localStorage.getItem("token") || localStorage.getItem("sessionToken");
  const role = localStorage.getItem("userRole");
  const empId = localStorage.getItem("employeeId");
  const name = localStorage.getItem("userName");

  // 1. ถ้าไม่มี Token, Role หรือ ID -> ส่งกลับไปหน้าแรก/หน้า Login
  if (!token || !role || !empId) {
    navigate("/", { replace: true });
    return;
  }

  const currentRole = role.toLowerCase().trim();

  // 2. ถ้าล็อกอินแล้วแต่ไม่ใช่ production (และไม่ใช่ admin) -> ส่งไปหน้ารูทของ Role ตัวเอง
  if (currentRole !== "production" && currentRole !== "admin") {
    if (currentRole === "engineer") {
      navigate("/engineer", { replace: true });
    } else if (currentRole === "operator") {
      navigate("/operator", { replace: true });
    } else {
      navigate("/", { replace: true });
    }
    return;
  }

  // 3. อนุญาตให้เข้าใช้งาน
  setProductionUser({
    name: name || "Production",
    employeeId: empId,
  });
  setIsAuthorized(true);
}, [navigate]);

  const handleLogout = () => {
  // 1. ส่งสัญญาณบอกแท็บอื่นในเบราว์เซอร์เดียวกัน
  localStorage.setItem("logout-event", Date.now().toString());

  // 2. ล้างข้อมูล Session ทั้งหมดของเครื่องนี้
  localStorage.removeItem("token");
  localStorage.removeItem("sessionToken");
  localStorage.removeItem("user");
  localStorage.removeItem("userRole");
  localStorage.removeItem("employeeId");
  localStorage.removeItem("userName");

  // 3. สั่งตัด Socket
  if (socket.connected) {
    socket.disconnect();
  }

  // 4. บังคับ Refresh กลับไปหน้า Login ทันที
  window.location.href = "/";
};

  // 🚫 3. Early Return: ถ้ายังไม่ได้รับอนุญาต ไม่วาด UI ออกมาเด็ดขาด
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
      id: "operator",
      label: "Operator",
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
        </svg>
      ),
    },
    {
      id: "layout",
      label: "Layout Editor",
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
        </svg>
      ),
    },
  ];

  return (
    <div className={`flex h-screen font-sans antialiased transition-colors duration-200 ${
      isDarkMode ? "bg-[#0F172A] text-slate-100" : "bg-[#F4F6F8] text-gray-800"
    }`}>
      {/* Sidebar ด้านซ้าย */}
      <aside className={`w-64 border-r flex flex-col justify-between transition-colors ${
        isDarkMode ? "bg-[#1E293B] border-slate-700/60" : "bg-white border-gray-200"
      }`}>
        <div>
          {/* Logo Section */}
          <div className={`flex items-center gap-3 p-5 border-b select-none ${
            isDarkMode ? "border-slate-700/60" : "border-gray-100"
          }`}>
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center font-bold text-white shadow-sm">
              P
            </div>
            <div>
              <h1 className={`font-bold text-sm leading-tight ${isDarkMode ? "text-blue-400" : "text-blue-900"}`}>
                DELTA MSH
              </h1>
              <p className="text-[11px] text-gray-400">Production</p>
            </div>
          </div>

          {/* Navigation Menu */}
          <div className="p-4">
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-3 px-3">
              Main Navigation
            </p>
            <nav className="space-y-1.5">
              {tabs.map((tab) => {
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl font-medium text-sm transition-all ${
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
        </div>

        {/* Footer Sidebar (Logout) */}
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
              Production Portal
            </span>
          </div>

          <div className="flex items-center gap-3">
            {/* 🌙 ปุ่ม Toggle Dark / Light Mode */}
            <button
              onClick={() => setIsDarkMode(!isDarkMode)}
              className="p-2 hover:bg-[#334155] rounded-lg text-gray-300 transition-colors flex items-center gap-1.5 text-xs font-medium"
              title="Toggle Dark/Light Mode"
            >
              {isDarkMode ? (
                <>
                  <svg className="w-4 h-4 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                  </svg>
                  <span>Light</span>
                </>
              ) : (
                <>
                  <svg className="w-4 h-4 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                  </svg>
                  <span>Dark</span>
                </>
              )}
            </button>

            <button className="p-2 hover:bg-[#334155] rounded-lg text-gray-300 transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 01-6 0v-1m6 0H9" />
              </svg>
            </button>

            <div className="h-4 w-[1px] bg-slate-600 mx-1"></div>

            {/* 👤 แสดงข้อมูล Production User */}
            <div className="flex items-center gap-2 pl-2">
              <div className="w-7 h-7 bg-blue-500 text-white rounded-full flex items-center justify-center font-bold text-xs">
                {productionUser.name.charAt(0).toUpperCase()}
              </div>
              <div className="text-left text-xs">
                <p className="font-semibold text-white leading-tight">{productionUser.name}</p>
                <p className="text-[10px] text-gray-400">ID: {productionUser.employeeId || "Production"}</p>
              </div>
            </div>
          </div>
        </header>

        {/* Dynamic Content */}
        <main className="flex-1 overflow-y-auto p-8">
          {activeTab === "operator" && <OperatorContent isDarkMode={isDarkMode} canEdit={false} />}
          {activeTab === "layout" && <LayoutEditorContent isDarkMode={isDarkMode} />}
        </main>
      </div>
    </div>
  );
}

export default Production;