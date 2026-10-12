import React, { useState, useEffect, useMemo } from "react";

export default function AutoTriggerExcel({ isDarkMode }) {
  const [configs, setConfigs] = useState([]);
  const [selectedKeys, setSelectedKeys] = useState(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [status, setStatus] = useState("ระบบพร้อมทำงาน");
  const [searchTerm, setSearchTerm] = useState("");

  const SYNC_DURATION_MS = 25000; // แช่โหลด 25 วินาทีเพื่อให้ Forms ดึงข้อมูลลงตาราง

  const getAuthHeaders = () => {
    const token =
      localStorage.getItem("token") ||
      localStorage.getItem("sessionToken");
    return {
      "Content-Type": "application/json",
      Authorization: token ? `Bearer ${token}` : "",
      "x-session-token": token || "",
    };
  };

  const fetchConfigs = async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/excel-configs", {
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        const list = Array.isArray(data.data) ? data.data : [];
        setConfigs(list);
        // ค่าเริ่มต้น: ติ๊กเลือกไฟล์ที่มี Web URL ทั้งหมดไว้ก่อน
        const initialReady = new Set(
          list
            .filter((c) => c.web_url && c.web_url.trim().startsWith("http"))
            .map((c) => c.config_key)
        );
        setSelectedKeys(initialReady);
      }
    } catch (err) {
      console.error("Fetch Configs Error:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchConfigs();
  }, []);

  // กรองเฉพาะรายการที่พร้อมซิงก์ (มี URL) ทั้งหมดในระบบ
  const validConfigs = useMemo(
    () => configs.filter((c) => c.web_url && c.web_url.trim().startsWith("http")),
    [configs]
  );

  // ค้นหารายการตาม Key หรือ ชื่อไฟล์
  const filteredConfigs = useMemo(() => {
    const q = searchTerm.toLowerCase().trim();
    if (!q) return configs;
    return configs.filter(
      (c) =>
        (c.config_key || "").toLowerCase().includes(q) ||
        (c.file_name || "").toLowerCase().includes(q)
    );
  }, [configs, searchTerm]);

  // 🟢 รายการที่ผ่านการกรองค้นหา และ "พร้อมซิงก์ (มี URL)"
  const filteredValidConfigs = useMemo(
    () => filteredConfigs.filter((c) => c.web_url && c.web_url.trim().startsWith("http")),
    [filteredConfigs]
  );

  // การจัดการ Checkbox รายตัว
  const handleToggleOne = (key) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // 🟢 เลือกทั้งหมดเฉพาะที่ตรงตามคำค้นหา (Filtered Results)
  const handleSelectAllInSearch = () => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      filteredValidConfigs.forEach((c) => next.add(c.config_key));
      return next;
    });
  };

  // 🟢 ยกเลิกเฉพาะที่ตรงตามคำค้นหา (Filtered Results)
  const handleDeselectInSearch = () => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      filteredConfigs.forEach((c) => next.delete(c.config_key));
      return next;
    });
  };

  // เป้าหมายที่จะถูกสั่งรัน (เฉพาะที่เลือกไว้และมี URL)
  const targetsToRun = useMemo(
    () => validConfigs.filter((c) => selectedKeys.has(c.config_key)),
    [validConfigs, selectedKeys]
  );

  // 🟢 ฟังก์ชันสั่งเปิดพร้อมกันทั้งหมดทีเดียว
  const executeSync = (targetList) => {
    if (!targetList || targetList.length === 0) {
      alert("กรุณาติ๊กเลือกไฟล์ที่มี Web URL อย่างน้อย 1 รายการ");
      return;
    }

    setIsSyncing(true);
    setStatus(`กำลังเปิด ${targetList.length} ไฟล์พร้อมกัน... (รอประมวลผล 25 วินาที)`);

    // ส่งหน้าต่างไปอยู่มุมล่างขวาสุดของหน้าจอ พร้อมตั้งขนาดเล็กสุด
    const screenW = window.screen.availWidth || window.screen.width;
    const screenH = window.screen.availHeight || window.screen.height;
    const popW = 100;
    const popH = 100;
    const posX = screenW - popW;
    const posY = screenH - popH;

    const windowFeatures = `width=${popW},height=${popH},left=${posX},top=${posY},resizable=no,scrollbars=no,status=no,toolbar=no,menubar=no,location=no`;
    const openedWindows = [];

    // 1. สั่งเปิดทุกไฟล์พร้อมกันทันทีในรอบเดียว
    for (let i = 0; i < targetList.length; i++) {
      try {
        const win = window.open(targetList[i].web_url, "_blank", windowFeatures);
        if (win) {
          openedWindows.push(win);
          if (win.blur) win.blur();
        }
      } catch (err) {
        console.error("Popup error:", err);
      }
    }

    // ดึงโฟกัสกลับมาที่หน้าเว็บหลักทันที
    if (window.focus) window.focus();

    // ตรวจสอบกรณีโดนบล็อกป๊อปอัป
    if (openedWindows.length < targetList.length) {
      alert(
        `เบราว์เซอร์อนุญาตให้เปิดได้เพียง ${openedWindows.length} จาก ${targetList.length} หน้าต่าง!\n\nกรุณาคลิกไอคอนที่มุมขวาบนของช่อง URL เลือก "Always allow pop-ups" เพื่อให้เปิดได้ครบพร้อมกันทั้งหมด`
      );
    }

    // 2. แช่ไว้ 25 วินาที แล้วสั่งปิดพร้อมกันทั้งหมด
    setTimeout(() => {
      openedWindows.forEach((win) => {
        try {
          if (win && !win.closed) win.close();
        } catch (e) {
          console.error("Window close error:", e);
        }
      });

      setIsSyncing(false);
      setStatus(`กระตุ้นการซิงก์ครบทั้ง ${targetList.length} ไฟล์เรียบร้อยแล้ว (ปิดหน้าต่างทั้งหมดแล้ว)`);
    }, SYNC_DURATION_MS);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-4 select-none">
      {/* ส่วนควบคุมและสถานะ */}
      <div
        className={`p-5 rounded-2xl border shadow-sm ${
          isDarkMode ? "bg-[#1E293B] border-slate-700/60" : "bg-white border-gray-200"
        }`}
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-emerald-500/10 text-emerald-500 rounded-xl">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </div>
            <div>
              <h2 className={`text-base font-bold flex items-center gap-2 ${isDarkMode ? "text-white" : "text-gray-900"}`}>
                Forms Auto-Sync Control
                <span className={`text-[10px] px-2 py-0.5 rounded font-mono ${
                  isDarkMode ? "bg-blue-500/10 text-blue-400 border border-blue-500/20" : "bg-blue-50 text-blue-700 border border-blue-200"
                }`}>
                  เลือกแล้ว {targetsToRun.length} / {validConfigs.length} ไฟล์
                </span>
              </h2>
              <p className="text-xs text-gray-400">
                เลือกชุดข้อสอบที่ต้องการ แล้วกดเพื่อเปิดซิงก์พร้อมกันทั้งหมดในรอบเดียว
              </p>
            </div>
          </div>

          <div className="flex gap-2 shrink-0">
            <button
              onClick={() => executeSync(targetsToRun)}
              disabled={isSyncing || targetsToRun.length === 0}
              className={`px-5 py-2.5 text-white text-xs font-semibold rounded-xl shadow-md transition-all flex items-center gap-2 ${
                isSyncing || targetsToRun.length === 0
                  ? "bg-slate-500 cursor-not-allowed opacity-60"
                  : "bg-blue-600 hover:bg-blue-700 shadow-blue-500/20 active:scale-95"
              }`}
            >
              {isSyncing ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  กำลังซิงก์...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  ซิงก์พร้อมกันทันที ({targetsToRun.length} ไฟล์)
                </>
              )}
            </button>
          </div>
        </div>

        {/* แถบสถานะการทำงาน */}
        <div
          className={`mt-4 p-3 rounded-xl flex items-center justify-between border ${
            isDarkMode ? "bg-slate-800/60 border-slate-700" : "bg-gray-50 border-gray-100"
          }`}
        >
          <div className="space-y-0.5">
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">สถานะ</span>
            <p className={`text-xs font-medium ${isSyncing ? "text-amber-400" : "text-emerald-400"}`}>
              {status}
            </p>
          </div>
        </div>
      </div>

      {/* กล่องตารางรายการ + ตัวกรองเลือกไฟล์ */}
      <div
        className={`p-5 rounded-2xl border shadow-sm space-y-4 ${
          isDarkMode ? "bg-[#1E293B] border-slate-700/60" : "bg-white border-gray-200"
        }`}
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          {/* 🟢 ปุ่มเลือกและยกเลิกอิงตามผลการค้นหา */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSelectAllInSearch}
              disabled={isSyncing || filteredValidConfigs.length === 0}
              className={`px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors disabled:opacity-40 ${
                isDarkMode ? "border-slate-700 hover:bg-slate-800 text-slate-300" : "border-gray-200 hover:bg-gray-100 text-gray-700"
              }`}
            >
              {searchTerm ? `เลือกที่ค้นหา (${filteredValidConfigs.length})` : "เลือกทั้งหมด"}
            </button>
            <button
              type="button"
              onClick={handleDeselectInSearch}
              disabled={isSyncing || filteredConfigs.length === 0}
              className={`px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors disabled:opacity-40 ${
                isDarkMode ? "border-slate-700 hover:bg-slate-800 text-slate-300" : "border-gray-200 hover:bg-gray-100 text-gray-700"
              }`}
            >
              {searchTerm ? "ยกเลิกที่ค้นหา" : "ยกเลิกทั้งหมด"}
            </button>
          </div>

          {/* ช่องค้นหาไฟล์ */}
          <div className="flex items-center gap-2">
            <div className="relative">
              <input
                type="text"
                placeholder="ค้นหาชื่อข้อสอบหรือไฟล์..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className={`px-3 py-1.5 pr-6 rounded-xl border text-xs outline-none focus:border-blue-500 transition-colors w-56 ${
                  isDarkMode ? "bg-slate-900 border-slate-700 text-white placeholder-slate-500" : "bg-gray-50 border-gray-200 text-gray-800"
                }`}
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm("")}
                  className="absolute right-2 top-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xs font-bold"
                >
                  ✕
                </button>
              )}
            </div>
            <button
              onClick={fetchConfigs}
              disabled={isSyncing}
              className="text-xs text-blue-400 hover:underline p-1"
              title="รีเฟรชข้อมูล"
            >
              รีเฟรช
            </button>
          </div>
        </div>

        {/* ตารางรายการไฟล์ */}
        {isLoading ? (
          <div className="text-center py-8 text-xs text-gray-400">กำลังโหลดข้อมูล...</div>
        ) : filteredConfigs.length === 0 ? (
          <div className="text-center py-8 text-xs text-gray-400">ไม่พบข้อมูลที่ตรงกับคำค้นหา</div>
        ) : (
          <div className="overflow-x-auto max-h-96 overflow-y-auto pr-1">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-inherit backdrop-blur-md">
                <tr className={`border-b ${isDarkMode ? "border-slate-700 text-slate-400" : "border-gray-200 text-gray-500"}`}>
                  <th className="py-2.5 px-3 w-10 text-center">เลือก</th>
                  <th className="py-2.5 px-3">Config Key</th>
                  <th className="py-2.5 px-3">ชื่อไฟล์ Excel</th>
                  <th className="py-2.5 px-3 text-right">การจัดการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/30">
                {filteredConfigs.map((item) => {
                  const hasUrl = item.web_url && item.web_url.trim().startsWith("http");
                  const isChecked = selectedKeys.has(item.config_key);

                  return (
                    <tr
                      key={item.config_key}
                      onClick={() => hasUrl && !isSyncing && handleToggleOne(item.config_key)}
                      className={`transition-colors cursor-pointer ${
                        !hasUrl
                          ? "opacity-40 cursor-not-allowed"
                          : isChecked
                          ? isDarkMode
                            ? "bg-blue-950/20 hover:bg-blue-950/30"
                            : "bg-blue-50/50 hover:bg-blue-50/80"
                          : isDarkMode
                          ? "hover:bg-slate-800/40"
                          : "hover:bg-gray-50"
                      }`}
                    >
                      <td className="py-3 px-3 text-center" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          disabled={!hasUrl || isSyncing}
                          onChange={() => handleToggleOne(item.config_key)}
                          className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 cursor-pointer disabled:cursor-not-allowed"
                        />
                      </td>
                      <td className={`py-3 px-3 font-mono font-bold ${
                        isDarkMode ? "text-purple-400" : "text-purple-600"
                      }`}>
                        {item.config_key}
                      </td>
                      <td className={`py-3 px-3 font-medium ${isDarkMode ? "text-white" : "text-gray-800"}`}>
                        {item.file_name}
                      </td>
                      <td className="py-3 px-3 text-right" onClick={(e) => e.stopPropagation()}>
                        {hasUrl ? (
                          <div className="inline-flex items-center gap-2">
                            <a
                              href={item.web_url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-gray-400 hover:text-blue-400 hover:underline text-[11px]"
                              title="เปิดดูไฟล์ในแท็บใหม่"
                            >
                              เปิดดู
                            </a>
                            <button
                              type="button"
                              onClick={() => executeSync([item])}
                              disabled={isSyncing}
                              className={`px-2.5 py-1 text-[11px] font-semibold rounded-lg border transition-all ${
                                isDarkMode
                                  ? "bg-slate-800 border-slate-600 text-slate-200 hover:bg-slate-700"
                                  : "bg-gray-100 border-gray-300 text-gray-700 hover:bg-gray-200"
                              } disabled:opacity-40`}
                            >
                              ซิงก์เฉพาะไฟล์นี้
                            </button>
                          </div>
                        ) : (
                          <span className="text-gray-400 italic text-[11px]">ไม่มี Web URL</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}