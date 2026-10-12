import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { socket } from "../socket";

export default function Operator() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("exam");
  const [isModalOpen, setIsModalOpen] = useState(false);

  // 1. อ่านค่า Dark Mode ล่าสุดจาก localStorage
  const [isDarkMode, setIsDarkMode] = useState(() => {
    const savedMode = localStorage.getItem("isDarkMode");
    return savedMode ? JSON.parse(savedMode) : false;
  });

  // 2. บันทึกค่าลง localStorage ทุกครั้งที่มีการสลับโหมด
  useEffect(() => {
    localStorage.setItem("isDarkMode", JSON.stringify(isDarkMode));
  }, [isDarkMode]);

  const handleLogout = () => {
  // 1. ส่งสัญญาณบอกแท็บอื่นในเบราว์เซอร์เดียวกัน
  localStorage.setItem("logout-event", Date.now().toString());

  // 2. ล้างข้อมูล Session ทั้งหมดของเครื่องนี้
  localStorage.removeItem("userRole");
  localStorage.removeItem("employeeId");
  localStorage.removeItem("userName");
  localStorage.removeItem("sessionToken");

  // 3. สั่งตัด Socket
  if (socket.connected) {
    socket.disconnect();
  }

  // 4. สั่งเด้งและบังคับ Refresh หน้าเว็บกลับไปที่หน้า Login ทันที
  window.location.href = "/";
};
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
          <div className={`flex items-center gap-3 p-5 border-b ${
            isDarkMode ? "border-slate-700/60" : "border-gray-100"
          }`}>
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center font-bold text-white shadow-sm">
              O
            </div>
            <div>
              <h1 className={`font-bold text-sm leading-tight ${isDarkMode ? "text-blue-400" : "text-blue-900"}`}>
                DELTA MSH
              </h1>
              <p className="text-[11px] text-gray-400">Operator Portal</p>
            </div>
          </div>

          {/* Navigation Menu */}
          <div className="p-4">
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-3 px-3">
              Main Menu
            </p>
            <nav className="space-y-1.5">
              <button
                onClick={() => setActiveTab("exam")}
                className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl font-medium text-sm transition-all ${
                  activeTab === "exam"
                    ? "bg-blue-600 text-white shadow-md shadow-blue-500/20"
                    : isDarkMode
                    ? "text-slate-300 hover:bg-slate-700/50"
                    : "text-gray-600 hover:bg-gray-100"
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Exam Result
              </button>

              <button
                onClick={() => setActiveTab("ticket")}
                className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl font-medium text-sm transition-all ${
                  activeTab === "ticket"
                    ? "bg-blue-600 text-white shadow-md shadow-blue-500/20"
                    : isDarkMode
                    ? "text-slate-300 hover:bg-slate-700/50"
                    : "text-gray-600 hover:bg-gray-100"
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" />
                </svg>
                Ticket / Support
              </button>
            </nav>
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
        {/* Header แถบบน */}
        <header className="bg-[#1E293B] text-white px-8 py-3.5 flex items-center justify-between shadow-sm border-b border-slate-700/50">
          <div className="flex items-center gap-6 flex-1 max-w-xl">
            <span className="font-bold text-xs tracking-wider uppercase text-blue-300 whitespace-nowrap">
              Operator Portal
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

            <div className="h-4 w-[1px] bg-slate-600 mx-1"></div>

            <div className="flex items-center gap-2 pl-2">
              <div className="w-7 h-7 bg-blue-500 text-white rounded-full flex items-center justify-center font-bold text-xs">
                OP
              </div>
              <div className="text-left text-xs">
                <p className="font-semibold text-white leading-tight">พชรพล</p>
                <p className="text-[10px] text-gray-400">Operator</p>
              </div>
            </div>
          </div>
        </header>

        {/* Dynamic Content ข้างใน */}
        <main className="flex-1 overflow-y-auto p-8">
          {activeTab === "exam" ? (
            /* ================= PAGE: EXAM RESULT ================= */
            <div className="space-y-8">
              <div className={`rounded-2xl border shadow-sm overflow-hidden ${
                isDarkMode ? "bg-[#1E293B] border-slate-700/60 text-slate-300" : "bg-white border-gray-100 text-gray-600"
              }`}>
                <div className={`p-6 border-b flex items-center justify-between ${
                  isDarkMode ? "border-slate-700/60" : "border-gray-100"
                }`}>
                  <h3 className={`font-bold ${isDarkMode ? "text-slate-100" : "text-gray-900"}`}>Recent Exam Results</h3>
                  <button className="text-sm font-semibold text-blue-400 hover:text-blue-500">View all &gt;</button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className={`font-bold uppercase tracking-wider border-b ${
                      isDarkMode ? "bg-slate-800/50 text-slate-400 border-slate-700/60" : "bg-gray-50/50 text-gray-400 border-gray-100"
                    }`}>
                      <tr>
                        <th className="p-4 pl-6">EXAM NAME</th>
                        <th className="p-4">STATUS</th>
                        <th className="p-4 pr-6">DATE</th>
                      </tr>
                    </thead>
                    <tbody className={`divide-y ${isDarkMode ? "divide-slate-700/50" : "divide-gray-100"}`}>
                      <tr className={`transition-colors ${isDarkMode ? "hover:bg-slate-700/30" : "hover:bg-gray-50/50"}`}>
                        <td className={`p-4 pl-6 font-medium ${isDarkMode ? "text-slate-200" : "text-gray-800"}`}>Safety & Operation Standard v2</td>
                        <td className="p-4">
                          <span className="bg-emerald-500/10 text-emerald-500 font-bold px-2.5 py-1 rounded-md">PASSED</span>
                        </td>
                        <td className="p-4 pr-6 opacity-60">8/13/26, 3:45 PM</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : (
            /* ================= PAGE: TICKET ================= */
            <div className="space-y-6"> 
              {/* Header Action Bar พร้อมปุ่ม Create Ticket */}
              <div className="flex items-center justify-between">
                <div>
                  <h2 className={`text-xl font-bold ${isDarkMode ? "text-slate-100" : "text-gray-900"}`}>
                    Operator Support Tickets
                  </h2>
                  <p className="text-xs text-gray-400 mt-1">
                    รายการแจ้งปัญหาข้อมูลส่วนตัว ชื่อไม่ตรง รูปถ่ายไม่ขึ้น หรือผลสอบผิดพลาด
                  </p>
                </div>
                <button
                  onClick={() => setIsModalOpen(true)}
                  className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-xl text-sm font-semibold shadow-md shadow-blue-500/20 transition-all"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
                  </svg>
                  Report Issue
                </button>
              </div>

              {/* Table Data */}
              <div className={`rounded-2xl border shadow-sm overflow-hidden ${
                isDarkMode ? "bg-[#1E293B] border-slate-700/60 text-slate-300" : "bg-white border-gray-100 text-gray-600"
              }`}>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className={`font-bold uppercase tracking-wider border-b ${
                      isDarkMode ? "bg-slate-800/50 text-slate-400 border-slate-700/60" : "bg-gray-50/50 text-gray-400 border-gray-100"
                    }`}>
                      <tr>
                        <th className="p-4 pl-6">TICKET NO.</th>
                        <th className="p-4">CATEGORY</th>
                        <th className="p-4">PROBLEM / ISSUE</th>
                        <th className="p-4 text-center">STATUS</th>
                        <th className="p-4 pr-6">CREATED</th>
                      </tr>
                    </thead>
                    <tbody className={`divide-y ${isDarkMode ? "divide-slate-700/50" : "divide-gray-100"}`}>
                      {/* ตัวอย่าง Ticket ปัญหาชื่อไม่ตรง */}
                      <tr className={`transition-colors ${isDarkMode ? "hover:bg-slate-700/30" : "hover:bg-gray-50/50"}`}>
                        <td className="p-4 pl-6 font-semibold text-blue-400">TCK-2026-001</td>
                        <td className="p-4 font-bold text-amber-500">
                          ชื่อ-นามสกุลไม่ตรง
                        </td>
                        <td className={`p-4 font-bold ${isDarkMode ? "text-slate-200" : "text-gray-800"}`}>
                          ในระบบขึ้นเป็น พชรพล I. ขอสะกดเต็มเป็น "พชรพล อินทร์..."
                        </td>
                        <td className="p-4 text-center">
                          <span className="bg-amber-500/10 text-amber-500 font-bold px-2.5 py-1 rounded-md">In Progress</span>
                        </td>
                        <td className="p-4 pr-6 opacity-60">8/13/26, 4:25 PM</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* 🚀 Pop-up Modal Form สำหรับแจ้งปัญหาของ Operator */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className={`rounded-2xl border shadow-xl w-full max-w-lg overflow-hidden transition-colors ${
            isDarkMode ? "bg-[#1E293B] border-slate-700 text-slate-100" : "bg-white border-gray-100 text-gray-900"
          }`}>
            {/* Modal Header */}
            <div className={`flex items-center justify-between px-6 py-4 border-b ${
              isDarkMode ? "border-slate-700/60 bg-slate-800/40" : "border-gray-100 bg-gray-50/50"
            }`}>
              <h3 className="text-lg font-bold">Report Operator Issue</h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="opacity-60 hover:opacity-100 p-1 rounded-lg transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Modal Form Body */}
            <form onSubmit={(e) => { e.preventDefault(); setIsModalOpen(false); }} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider mb-1.5 opacity-80">
                  Issue Category (ประเภทปัญหา)
                </label>
                <select className={`w-full rounded-xl px-3.5 py-2 text-sm border focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all ${
                  isDarkMode ? "bg-slate-800 border-slate-700 text-white" : "bg-gray-50 border-gray-200 text-gray-800"
                }`}>
                  <option value="name">ชื่อ-นามสกุล สะกดไม่ถูกต้อง</option>
                  <option value="photo">รูปถ่ายประจำตัวไม่ขึ้น / ไม่ตรง</option>
                  <option value="exam">คะแนน / ผลการสอบไม่ถูกต้อง</option>
                  <option value="emp_id">Employee ID หรือข้อมูลส่วนตัวผิดพลาด</option>
                  <option value="other">อื่นๆ</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider mb-1.5 opacity-80">
                  Issue Details (รายละเอียดปัญหา)
                </label>
                <textarea
                  rows="4"
                  placeholder="ระบุรายละเอียดปัญหาที่ต้องการแก้ไข เช่น ชื่อที่ถูกต้องคือ..."
                  className={`w-full rounded-xl px-3.5 py-2 text-sm border focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all resize-none ${
                    isDarkMode ? "bg-slate-800 border-slate-700 text-white placeholder-slate-500" : "bg-gray-50 border-gray-200 text-gray-800 placeholder-gray-400"
                  }`}
                ></textarea>
              </div>

              {/* Modal Footer Buttons */}
              <div className={`flex items-center justify-end gap-3 pt-3 border-t ${
                isDarkMode ? "border-slate-700/60" : "border-gray-100"
              }`}>
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-sm font-semibold opacity-70 hover:opacity-100 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 shadow-md shadow-blue-500/20 transition-all"
                >
                  Send Report
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}