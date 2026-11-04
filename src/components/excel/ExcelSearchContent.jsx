import React, { useState, useEffect, useRef, useMemo } from "react";
import { socket } from "../../socket";

export default function ExcelSearchContent({ isDarkMode }) {
  // State: ค้นหาไฟล์ OneDrive
  const [fileName, setFileName] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [copiedKey, setCopiedKey] = useState("");

  // State: รายการ Saved Configs & Search Filter ในส่วนที่ 3
  const [savedConfigs, setSavedConfigs] = useState([]);
  const [configsLoading, setConfigsLoading] = useState(false);
  const [configSearchTerm, setConfigSearchTerm] = useState("");

  // State: ฟอร์ม Insert (เพิ่ม web_url เป็น optional)
  const [insertForm, setInsertForm] = useState({
    config_key: "",
    file_name: "",
    drive_id: "",
    drive_item_id: "",
    web_url: "", // 🟢 Optional URL
    table_name: "OfficeForms.Table",
    col_employee_id: "รหัสพนักงาน",
    col_name: "ชื่อ-นามสกุล",
    col_score: "Total points",
  });
  const [insertLoading, setInsertLoading] = useState(false);

  // State: Modal Edit
  const [editingItem, setEditingItem] = useState(null);

  // State: แจ้งเตือน & Microsoft Auth Popup
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [authPopup, setAuthPopup] = useState(null);
  const [copiedCode, setCopiedCode] = useState(false);

  const searchPollIntervalRef = useRef(null);

  const MAIN_API_URL = `/api`;       // DB Configs (Port 5000)
  const EXCEL_API_URL = `/publics`;  // Graph API & Device Auth (Port 5000)

  const getAuthHeaders = () => {
    const token = localStorage.getItem("token") || localStorage.getItem("sessionToken");
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "x-session-token": token,
    };
  };

  const copyToClipboard = async (text, key = "") => {
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        if (key) {
          setCopiedKey(key);
          setTimeout(() => setCopiedKey(""), 2000);
        }
        return true;
      } catch (err) {
        console.warn("Clipboard API failed, trying fallback...", err);
      }
    }

    try {
      const textArea = document.createElement("textarea");
      textArea.value = text;
      textArea.style.position = "fixed";
      textArea.style.left = "-999999px";
      textArea.style.top = "-999999px";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();

      const successful = document.execCommand("copy");
      document.body.removeChild(textArea);

      if (successful && key) {
        setCopiedKey(key);
        setTimeout(() => setCopiedKey(""), 2000);
      }
      return successful;
    } catch (err) {
      console.error("Fallback copy failed: ", err);
      return false;
    }
  };

  const copyDeviceCode = async () => {
    if (!authPopup?.code) return;
    const success = await copyToClipboard(authPopup.code);
    if (success) {
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    }
  };

  const fetchSavedConfigs = async () => {
    setConfigsLoading(true);
    try {
      const res = await fetch(`${MAIN_API_URL}/excel-configs`, {
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      if (res.ok && data.data) {
        setSavedConfigs(data.data);
      }
    } catch (err) {
      console.error("Fetch configs failed:", err);
    } finally {
      setConfigsLoading(false);
    }
  };

  const checkAuthStatus = async () => {
    try {
      const authRes = await fetch(`${EXCEL_API_URL}/check-auth`);
      if (!authRes.ok) return null;
      const authJson = await authRes.json();
      if (authJson.needsAuth && authJson.authData) {
        setAuthPopup(authJson.authData);
        return authJson.authData;
      }
      return null;
    } catch {
      return null;
    }
  };

  useEffect(() => {
    fetchSavedConfigs();
    checkAuthStatus();

    const handleAuthRequired = (authData) => {
      setAuthPopup(authData);
    };

    socket.on("device_auth_required", handleAuthRequired);

    return () => {
      socket.off("device_auth_required", handleAuthRequired);
      if (searchPollIntervalRef.current) {
        clearInterval(searchPollIntervalRef.current);
      }
    };
  }, []);

  const handleInsertSubmit = async (e) => {
    e.preventDefault();
    setInsertLoading(true);
    setErrorMsg("");
    setSuccessMsg("");

    try {
      const res = await fetch(`${MAIN_API_URL}/excel/save-config`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify(insertForm),
      });

      const data = await res.json();

      if (res.ok) {
        setSuccessMsg(`บันทึกการตั้งค่า "${insertForm.config_key}" สำเร็จ`);
        fetchSavedConfigs();
        setInsertForm({
          config_key: "",
          file_name: "",
          drive_id: "",
          drive_item_id: "",
          web_url: "",
          table_name: "OfficeForms.Table",
          col_employee_id: "รหัสพนักงาน",
          col_name: "ชื่อ-นามสกุล",
          col_score: "Total points",
        });
        setSelectedFile(null);
      } else {
        setErrorMsg(data.message || "ไม่สามารถบันทึกลงฐานข้อมูลได้");
      }
    } catch (err) {
      setErrorMsg("เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์");
    } finally {
      setInsertLoading(false);
    }
  };

  const handleUpdateSubmit = async (e) => {
    e.preventDefault();
    if (!editingItem) return;

    try {
      const res = await fetch(`${MAIN_API_URL}/excel-configs/${editingItem.config_key}`, {
        method: "PUT",
        headers: getAuthHeaders(),
        body: JSON.stringify(editingItem),
      });

      const data = await res.json();
      if (res.ok) {
        setSuccessMsg(`อัปเดต "${editingItem.config_key}" สำเร็จ`);
        setEditingItem(null);
        fetchSavedConfigs();
      } else {
        setErrorMsg(data.message || "อัปเดตไม่สำเร็จ");
      }
    } catch (err) {
      setErrorMsg("เกิดข้อผิดพลาดในการอัปเดต");
    }
  };

  const handleDeleteConfig = async (key) => {
    if (!window.confirm(`ยืนยันการลบการตั้งค่า "${key}" หรือไม่?`)) return;

    try {
      const res = await fetch(`${MAIN_API_URL}/excel-configs/${key}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      if (res.ok) {
        setSuccessMsg(`ลบ "${key}" เรียบร้อยแล้ว`);
        fetchSavedConfigs();
      } else {
        setErrorMsg(data.message || "ลบไม่สำเร็จ");
      }
    } catch (err) {
      setErrorMsg("เกิดข้อผิดพลาดในการลบ");
    }
  };

  const handleSearch = async (e) => {
    if (e) e.preventDefault();
    if (!fileName.trim()) return;

    setSearchLoading(true);
    setErrorMsg("");
    setSuccessMsg("");
    setSearchResults([]);
    setSelectedFile(null);

    if (searchPollIntervalRef.current) clearInterval(searchPollIntervalRef.current);
    searchPollIntervalRef.current = setInterval(async () => {
      const foundAuth = await checkAuthStatus();
      if (foundAuth) {
        clearInterval(searchPollIntervalRef.current);
      }
    }, 1000);
    checkAuthStatus();

    try {
      const res = await fetch(
        `${EXCEL_API_URL}/excel/search?filename=${encodeURIComponent(fileName.trim())}`,
        { headers: getAuthHeaders() }
      );

      const data = await res.json();

      if (res.status === 428 || data.authRequired) {
        setAuthPopup(data.authData);
        return;
      }

      if (res.ok) {
        const list = Array.isArray(data.data) ? data.data : (data.data ? [data.data] : []);
        setSearchResults(list);

        if (list.length === 1) {
          handleSelectFile(list[0]);
        }
        setAuthPopup(null);
      } else {
        setErrorMsg(data.message || "ไม่สามารถค้นหาไฟล์ได้");
      }
    } catch (err) {
      await checkAuthStatus();
      if (!authPopup) {
        setErrorMsg("ไม่สามารถเชื่อมต่อ API Server (Port 5000) ได้");
      }
    } finally {
      if (searchPollIntervalRef.current) {
        clearInterval(searchPollIntervalRef.current);
      }
      setSearchLoading(false);
    }
  };

  const handleSelectFile = (file) => {
    setSelectedFile(file);
    setInsertForm((prev) => ({
      ...prev,
      file_name: file.fileName,
      drive_id: file.driveId,
      drive_item_id: file.itemId,
      // ดึง webUrl หาก Graph API ส่งมาให้อัตโนมัติ
      web_url: file.webUrl || prev.web_url || "",
    }));
  };

  const filteredConfigs = useMemo(() => {
    const q = configSearchTerm.toLowerCase().trim();
    if (!q) return savedConfigs;
    return savedConfigs.filter((cfg) => {
      const matchKey = (cfg.config_key || "").toLowerCase().includes(q);
      const matchFile = (cfg.file_name || "").toLowerCase().includes(q);
      const matchTable = (cfg.table_name || "").toLowerCase().includes(q);
      return matchKey || matchFile || matchTable;
    });
  }, [savedConfigs, configSearchTerm]);

  return (
    <div className="space-y-6 max-w-5xl relative pb-12 select-none">
      {/* Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-gray-200 dark:border-slate-700/60">
        <div>
          <div className="flex items-center gap-2">
            <h2 className={`text-xl font-bold ${isDarkMode ? "text-white" : "text-gray-900"}`}>
              OneDrive Excel Manager
            </h2>
            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
              isDarkMode ? "bg-amber-500/10 text-amber-400 border border-amber-500/20" : "bg-amber-50 text-amber-700 border border-amber-200"
            }`}>
              Admin Only
            </span>
          </div>
          <p className={`text-xs mt-1 ${isDarkMode ? "text-slate-400" : "text-gray-600"}`}>
            จัดการบันทึกการตั้งค่า Drive ID / Item ID และกำหนดชื่อ Column ในตาราง Excel
          </p>
        </div>
      </div>

      {/* Notifications */}
      {errorMsg && (
        <div className="p-3.5 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 text-rose-700 dark:text-rose-400 rounded-xl text-xs flex items-center justify-between shadow-sm">
          <span>{errorMsg}</span>
          <button onClick={() => setErrorMsg("")} className="font-bold text-sm">✕</button>
        </div>
      )}

      {successMsg && (
        <div className="p-3.5 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 text-emerald-700 dark:text-emerald-400 rounded-xl text-xs flex items-center justify-between shadow-sm">
          <span>{successMsg}</span>
          <button onClick={() => setSuccessMsg("")} className="font-bold text-sm">✕</button>
        </div>
      )}

      {/* 1. ส่วนค้นหาไฟล์จาก OneDrive */}
      <div className={`p-5 rounded-2xl border shadow-sm space-y-4 ${
        isDarkMode ? "bg-[#1E293B] border-slate-700/60" : "bg-white border-gray-200"
      }`}>
        <div className="flex items-center justify-between">
          <h3 className={`text-xs font-bold uppercase tracking-wider ${isDarkMode ? "text-purple-400" : "text-purple-700"}`}>
            1. ค้นหา ID (Microsoft Graph API)
          </h3>
          <span className={`text-[11px] ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>
            ค้นหาไฟล์บน OneDrive เพื่อดึง Drive ID & Item ID อัตโนมัติ
          </span>
        </div>

        <form onSubmit={handleSearch} className="flex gap-2">
          <input
            type="text"
            value={fileName}
            onChange={(e) => setFileName(e.target.value)}
            placeholder="ระบุชื่อไฟล์ เช่น L3 - NC Control"
            className={`flex-1 px-4 py-2.5 text-xs rounded-xl border outline-none focus:border-blue-500 transition-colors ${
              isDarkMode
                ? "bg-slate-900 border-slate-700 text-slate-100 placeholder-slate-500"
                : "bg-gray-50 border-gray-300 text-gray-900 placeholder-gray-400 focus:bg-white"
            }`}
          />
          <button
            type="submit"
            disabled={searchLoading}
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-xl transition-all shadow-md shadow-blue-500/20 disabled:opacity-50"
          >
            {searchLoading ? "กำลังค้นหา..." : "ค้นหาไฟล์"}
          </button>
        </form>

        {searchResults.length > 0 && (
          <div className={`pt-4 border-t space-y-3 ${isDarkMode ? "border-slate-700/40" : "border-gray-200"}`}>
            <div className="flex items-center justify-between">
              <span className={`font-bold text-xs ${isDarkMode ? "text-slate-200" : "text-gray-900"}`}>
                พบไฟล์ทั้งหมด {searchResults.length} รายการ (คลิกที่ไฟล์เพื่อเลือกใช้งาน)
              </span>
            </div>

            <div className="grid grid-cols-1 gap-2 max-h-60 overflow-y-auto pr-1">
              {searchResults.map((file) => {
                const isSelected = selectedFile?.itemId === file.itemId;
                return (
                  <div
                    key={file.itemId}
                    onClick={() => handleSelectFile(file)}
                    className={`p-3 rounded-xl border cursor-pointer transition-all flex items-center justify-between ${
                      isSelected
                        ? isDarkMode
                          ? "bg-blue-950/40 border-blue-500 shadow-sm"
                          : "bg-blue-50/90 border-blue-500 shadow-sm"
                        : isDarkMode
                        ? "bg-slate-900/60 border-slate-700 hover:border-slate-500"
                        : "bg-gray-50 border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    <div className="flex items-center gap-2.5 overflow-hidden">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase ${
                        isSelected 
                          ? "bg-blue-600 text-white" 
                          : isDarkMode ? "bg-slate-800 text-slate-300 border border-slate-700" : "bg-gray-200 text-gray-700"
                      }`}>
                        FILE
                      </span>
                      <div className="truncate">
                        <p className={`font-semibold text-xs truncate ${
                          isSelected ? (isDarkMode ? "text-blue-400" : "text-blue-800 font-bold") : (isDarkMode ? "text-slate-200" : "text-gray-900")
                        }`}>
                          {file.fileName}
                        </p>
                        <p className="text-[10px] text-gray-500 font-mono truncate">
                          Item ID: {file.itemId}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {isSelected ? (
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                          isDarkMode ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" : "bg-emerald-50 text-emerald-800 border-emerald-300"
                        }`}>
                          เลือกอยู่
                        </span>
                      ) : (
                        <button
                          type="button"
                          className={`px-2.5 py-1 text-[10px] font-semibold rounded-lg border transition-colors ${
                            isDarkMode ? "border-slate-600 hover:bg-slate-700 text-slate-300" : "border-gray-300 hover:bg-gray-100 text-gray-700"
                          }`}
                        >
                          เลือกไฟล์นี้
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {selectedFile && (
              <div className={`mt-4 pt-3 border-t space-y-3 ${isDarkMode ? "border-slate-700/30" : "border-gray-200"}`}>
                <div className="flex items-center justify-between">
                  <span className={`text-xs font-bold ${isDarkMode ? "text-emerald-400" : "text-emerald-700"}`}>
                    ✓ ดึงค่าของ "{selectedFile.fileName}" ไปยังฟอร์มข้อ 2 เรียบร้อยแล้ว
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  <div className={`p-3 rounded-xl border ${isDarkMode ? "bg-slate-900/60 border-slate-700/40" : "bg-gray-50 border-gray-200"}`}>
                    <div className="flex justify-between items-center mb-1">
                      <span className={`font-semibold ${isDarkMode ? "text-gray-400" : "text-gray-600"}`}>DRIVE_ID</span>
                      <button type="button" onClick={() => copyToClipboard(selectedFile.driveId, "drive")} className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline font-semibold">
                        {copiedKey === "drive" ? "คัดลอกแล้ว!" : "Copy"}
                      </button>
                    </div>
                    <p className="font-mono text-[11px] text-blue-700 dark:text-blue-400 font-bold break-all select-all">{selectedFile.driveId}</p>
                  </div>

                  <div className={`p-3 rounded-xl border ${isDarkMode ? "bg-slate-900/60 border-slate-700/40" : "bg-gray-50 border-gray-200"}`}>
                    <div className="flex justify-between items-center mb-1">
                      <span className={`font-semibold ${isDarkMode ? "text-gray-400" : "text-gray-600"}`}>ITEM_ID</span>
                      <button type="button" onClick={() => copyToClipboard(selectedFile.itemId, "item")} className="text-[11px] text-purple-600 dark:text-purple-400 hover:underline font-semibold">
                        {copiedKey === "item" ? "คัดลอกแล้ว!" : "Copy"}
                      </button>
                    </div>
                    <p className="font-mono text-[11px] text-purple-700 dark:text-purple-400 font-bold break-all select-all">{selectedFile.itemId}</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 2. ฟอร์ม INSERT ข้อมูล */}
      <div className={`p-5 rounded-2xl border shadow-sm space-y-4 ${
        isDarkMode ? "bg-[#1E293B] border-slate-700/60" : "bg-white border-gray-200"
      }`}>
        <h3 className={`text-xs font-bold uppercase tracking-wider ${isDarkMode ? "text-emerald-400" : "text-emerald-700"}`}>
          2. เพิ่มชุดข้อสอบ
        </h3>

        <form onSubmit={handleInsertSubmit} className="space-y-3 text-xs">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className={`block font-semibold mb-1 ${isDarkMode ? "text-gray-400" : "text-gray-700"}`}>Config Key (Key อ้างอิง) *</label>
              <input
                type="text"
                value={insertForm.config_key}
                onChange={(e) => setInsertForm({ ...insertForm, config_key: e.target.value })}
                placeholder="เช่น exam_line1"
                className={`w-full px-3 py-2 rounded-xl border font-mono outline-none focus:border-blue-500 transition-colors ${
                  isDarkMode ? "bg-slate-900 border-slate-700 text-slate-100" : "bg-gray-50 border-gray-300 text-gray-900 focus:bg-white"
                }`}
                required
              />
            </div>
            <div>
              <label className={`block font-semibold mb-1 ${isDarkMode ? "text-gray-400" : "text-gray-700"}`}>File Name (ชื่อไฟล์) *</label>
              <input
                type="text"
                value={insertForm.file_name}
                onChange={(e) => setInsertForm({ ...insertForm, file_name: e.target.value })}
                placeholder="ชื่อไฟล์.xlsx"
                className={`w-full px-3 py-2 rounded-xl border outline-none focus:border-blue-500 transition-colors ${
                  isDarkMode ? "bg-slate-900 border-slate-700 text-slate-100" : "bg-gray-50 border-gray-300 text-gray-900 focus:bg-white"
                }`}
                required
              />
            </div>
            <div>
              <label className={`block font-semibold mb-1 ${isDarkMode ? "text-gray-400" : "text-gray-700"}`}>Table Name (ชื่อตารางใน Excel) *</label>
              <input
                type="text"
                value={insertForm.table_name}
                onChange={(e) => setInsertForm({ ...insertForm, table_name: e.target.value })}
                placeholder="เช่น OfficeForms.Table"
                className={`w-full px-3 py-2 rounded-xl border outline-none font-mono focus:border-blue-500 transition-colors ${
                  isDarkMode ? "bg-slate-900 border-slate-700 text-slate-100" : "bg-gray-50 border-gray-300 text-gray-900 focus:bg-white"
                }`}
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className={`block font-semibold mb-1 ${isDarkMode ? "text-gray-400" : "text-gray-700"}`}>DRIVE_ID *</label>
              <input
                type="text"
                value={insertForm.drive_id}
                onChange={(e) => setInsertForm({ ...insertForm, drive_id: e.target.value })}
                placeholder="ระบุรหัส Drive ID"
                className={`w-full px-3 py-2 rounded-xl font-mono text-[11px] border outline-none focus:border-blue-500 transition-colors ${
                  isDarkMode ? "bg-slate-900 border-slate-700 text-blue-400" : "bg-gray-50 border-gray-300 text-blue-700 focus:bg-white font-bold"
                }`}
                required
              />
            </div>
            <div>
              <label className={`block font-semibold mb-1 ${isDarkMode ? "text-gray-400" : "text-gray-700"}`}>DRIVE_ITEM_ID (Item ID) *</label>
              <input
                type="text"
                value={insertForm.drive_item_id}
                onChange={(e) => setInsertForm({ ...insertForm, drive_item_id: e.target.value })}
                placeholder="ระบุรหัส Item ID"
                className={`w-full px-3 py-2 rounded-xl font-mono text-[11px] border outline-none focus:border-purple-500 transition-colors ${
                  isDarkMode ? "bg-slate-900 border-slate-700 text-purple-400" : "bg-gray-50 border-gray-300 text-purple-700 focus:bg-white font-bold"
                }`}
                required
              />
            </div>
          </div>

          {/* 🟢 ส่วนเพิ่ม Web URL สำหรับการ Refresh/Sync (Optional) */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className={`font-semibold ${isDarkMode ? "text-gray-400" : "text-gray-700"}`}>
                Web URL (Excel Online / SharePoint Link)
              </label>
              <span className={`text-[10px] px-1.5 py-0.2 rounded border ${
                isDarkMode ? "bg-slate-800 text-slate-400 border-slate-700" : "bg-gray-100 text-gray-500 border-gray-200"
              }`}>
                ไม่บังคับ (Optional)
              </span>
            </div>
            <input
              type="url"
              value={insertForm.web_url}
              onChange={(e) => setInsertForm({ ...insertForm, web_url: e.target.value })}
              placeholder="https://deltao365-my.sharepoint.com/:x:/r/personal/..."
              className={`w-full px-3 py-2 rounded-xl font-mono text-[11px] border outline-none focus:border-blue-500 transition-colors ${
                isDarkMode ? "bg-slate-900 border-slate-700 text-slate-100" : "bg-gray-50 border-gray-300 text-gray-900 focus:bg-white"
              }`}
            />
            <span className="text-[10px] text-gray-400 mt-1 block">
              ลิงก์สำหรับใช้เปิดกระตุ้นการซิงก์ Forms Auto-Sync ของข้อสอบชุดนี้
            </span>
          </div>

          {/* กำหนดชื่อ Column Mapping */}
          <div className={`pt-3 border-t ${isDarkMode ? "border-slate-700/60" : "border-gray-200"}`}>
            <span className={`block text-[11px] font-bold uppercase tracking-wider mb-2.5 ${isDarkMode ? "text-gray-300" : "text-gray-700"}`}>
              กำหนดชื่อ Column ใน Excel (Header Mapping)
            </span>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className={`block mb-1 font-semibold ${isDarkMode ? "text-gray-400" : "text-gray-600"}`}>Column: รหัสพนักงาน</label>
                <input
                  type="text"
                  value={insertForm.col_employee_id}
                  onChange={(e) => setInsertForm({ ...insertForm, col_employee_id: e.target.value })}
                  placeholder="เช่น Employee ID, รหัสพนักงาน"
                  className={`w-full px-3 py-2 rounded-xl border outline-none focus:border-blue-500 transition-colors ${
                    isDarkMode ? "bg-slate-900 border-slate-700 text-slate-100" : "bg-gray-50 border-gray-300 text-gray-900 focus:bg-white"
                  }`}
                  required
                />
              </div>
              <div>
                <label className={`block mb-1 font-semibold ${isDarkMode ? "text-gray-400" : "text-gray-600"}`}>Column: ชื่อพนักงาน</label>
                <input
                  type="text"
                  value={insertForm.col_name}
                  onChange={(e) => setInsertForm({ ...insertForm, col_name: e.target.value })}
                  placeholder="เช่น Name, ชื่อ-นามสกุล"
                  className={`w-full px-3 py-2 rounded-xl border outline-none focus:border-blue-500 transition-colors ${
                    isDarkMode ? "bg-slate-900 border-slate-700 text-slate-100" : "bg-gray-50 border-gray-300 text-gray-900 focus:bg-white"
                  }`}
                  required
                />
              </div>
              <div>
                <label className={`block mb-1 font-semibold ${isDarkMode ? "text-gray-400" : "text-gray-600"}`}>Column: คะแนนสอบ</label>
                <input
                  type="text"
                  value={insertForm.col_score}
                  onChange={(e) => setInsertForm({ ...insertForm, col_score: e.target.value })}
                  placeholder="เช่น Score, Total Points, คะแนน"
                  className={`w-full px-3 py-2 rounded-xl border outline-none focus:border-blue-500 transition-colors ${
                    isDarkMode ? "bg-slate-900 border-slate-700 text-slate-100" : "bg-gray-50 border-gray-300 text-gray-900 focus:bg-white"
                  }`}
                  required
                />
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={insertLoading}
            className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl transition-all shadow-md shadow-blue-500/20 disabled:opacity-50 mt-2"
          >
            {insertLoading ? "กำลังบันทึก..." : "บันทึก Config"}
          </button>
        </form>
      </div>

      {/* 3. ตารางรายการ CONFIGS พร้อมแถบค้นหา */}
      <div className={`p-5 rounded-2xl border shadow-sm space-y-4 ${
        isDarkMode ? "bg-[#1E293B] border-slate-700/60" : "bg-white border-gray-200"
      }`}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h3 className={`text-xs font-bold uppercase tracking-wider ${isDarkMode ? "text-blue-400" : "text-blue-700"}`}>
            3. รายการข้อสอบ ({filteredConfigs.length})
          </h3>

          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <input
                type="text"
                value={configSearchTerm}
                onChange={(e) => setConfigSearchTerm(e.target.value)}
                placeholder="ค้นหา Key, ชื่อไฟล์ หรือ Table..."
                className={`w-full sm:w-64 px-3 py-1.5 text-xs rounded-xl border outline-none transition-colors ${
                  isDarkMode
                    ? "bg-slate-900 border-slate-700 text-slate-100 placeholder-slate-500 focus:border-blue-500"
                    : "bg-gray-50 border-gray-300 text-gray-900 placeholder-gray-400 focus:bg-white focus:border-blue-500"
                }`}
              />
              {configSearchTerm && (
                <button
                  type="button"
                  onClick={() => setConfigSearchTerm("")}
                  className="absolute right-2.5 top-1.5 text-gray-400 hover:text-gray-600 text-xs font-bold"
                >
                  ✕
                </button>
              )}
            </div>

            <button
              onClick={fetchSavedConfigs}
              className={`text-xs font-semibold px-3 py-1.5 rounded-xl border transition-colors ${
                isDarkMode
                  ? "border-slate-700 hover:bg-slate-800 text-slate-300"
                  : "border-gray-300 hover:bg-gray-100 text-gray-700 shadow-sm"
              }`}
            >
              รีเฟรชตาราง
            </button>
          </div>
        </div>

        {configsLoading ? (
          <p className="text-xs text-gray-500 text-center py-6">กำลังโหลดข้อมูล...</p>
        ) : filteredConfigs.length === 0 ? (
          <p className="text-xs text-gray-500 text-center py-6">
            {configSearchTerm ? `ไม่พบข้อสอบที่ตรงกับ "${configSearchTerm}"` : "ยังไม่มีข้อมูลใน Database"}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className={`border-b ${isDarkMode ? "border-slate-700 text-slate-400" : "border-gray-200 text-gray-600 bg-gray-50/50"}`}>
                  <th className="py-2.5 px-3">Config Key</th>
                  <th className="py-2.5 px-3">File Name</th>
                  <th className="py-2.5 px-3">Table Name</th>
                  <th className="py-2.5 px-3">Columns Mapping</th>
                  <th className="py-2.5 px-3">Web URL</th>
                  <th className="py-2.5 px-3">แก้ไขล่าสุด</th>
                  <th className="py-2.5 px-3 text-center">จัดการ</th>
                </tr>
              </thead>
              <tbody className={`divide-y ${isDarkMode ? "divide-slate-700/30" : "divide-gray-100"}`}>
                {filteredConfigs.map((cfg) => (
                  <tr key={cfg.config_key} className={isDarkMode ? "hover:bg-slate-800/50 text-slate-200" : "hover:bg-gray-50/80 text-gray-800"}>
                    <td className="py-3 px-3 font-mono font-bold text-purple-600 dark:text-purple-400">
                      {cfg.config_key}
                    </td>
                    <td className="py-3 px-3 font-semibold">{cfg.file_name}</td>
                    <td className="py-3 px-3 font-mono text-gray-500">{cfg.table_name}</td>
                    <td className="py-3 px-3">
                      <div className="flex flex-col gap-0.5 text-[10px] font-mono">
                        <span>
                          <b className="text-gray-500 font-sans">ID:</b>{" "}
                          <span className="font-bold text-blue-600 dark:text-blue-400">{cfg.col_employee_id || "Employee ID"}</span>
                        </span>
                        <span>
                          <b className="text-gray-500 font-sans">Name:</b>{" "}
                          <span className="font-bold text-emerald-600 dark:text-emerald-400">{cfg.col_name || "Name"}</span>
                        </span>
                        <span>
                          <b className="text-gray-500 font-sans">Score:</b>{" "}
                          <span className="font-bold text-amber-600 dark:text-amber-400">{cfg.col_score || "Score"}</span>
                        </span>
                      </div>
                    </td>
                    {/* แสดง Web URL พร้อมลิงก์เปิด */}
                    <td className="py-3 px-3 max-w-[140px] truncate">
                      {cfg.web_url ? (
                        <a
                          href={cfg.web_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-blue-500 hover:underline font-mono text-[11px] truncate block"
                          title={cfg.web_url}
                        >
                          เปิดลิงก์ไฟล์
                        </a>
                      ) : (
                        <span className="text-gray-400 text-[11px] italic">- ไม่มี URL -</span>
                      )}
                    </td>
                    <td className="py-3 px-3 text-gray-500 text-[11px]">
                      {new Date(cfg.updated_at).toLocaleString("th-TH")}
                    </td>
                    <td className="py-3 px-3 text-center space-x-1.5 whitespace-nowrap">
                      <button
                        onClick={() => setEditingItem({ 
                          ...cfg,
                          web_url: cfg.web_url || "",
                          col_employee_id: cfg.col_employee_id || "Employee ID",
                          col_name: cfg.col_name || "Name",
                          col_score: cfg.col_score || "Score",
                        })}
                        className={`px-2.5 py-1 text-[11px] font-semibold rounded-lg border transition-colors ${
                          isDarkMode
                            ? "bg-amber-500/10 text-amber-400 border-amber-500/30 hover:bg-amber-500/20"
                            : "bg-amber-50 text-amber-800 border-amber-300 hover:bg-amber-100"
                        }`}
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDeleteConfig(cfg.config_key)}
                        className={`px-2.5 py-1 text-[11px] font-semibold rounded-lg border transition-colors ${
                          isDarkMode
                            ? "bg-rose-500/10 text-rose-400 border-rose-500/30 hover:bg-rose-500/20"
                            : "bg-rose-50 text-rose-800 border-rose-300 hover:bg-rose-100"
                        }`}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal Edit Config */}
      {editingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fadeIn">
          <div className={`max-w-lg w-full p-6 rounded-2xl shadow-2xl border space-y-4 max-h-[90vh] overflow-y-auto ${
            isDarkMode ? "bg-[#1E293B] border-slate-700 text-slate-100" : "bg-white border-gray-200 text-gray-900"
          }`}>
            <div className={`flex items-center justify-between border-b pb-3 ${isDarkMode ? "border-slate-700/60" : "border-gray-200"}`}>
              <h3 className="font-bold text-sm">
                แก้ไข Config: <span className="font-mono text-purple-600 dark:text-purple-400">{editingItem.config_key}</span>
              </h3>
              <button onClick={() => setEditingItem(null)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">✕</button>
            </div>

            <form onSubmit={handleUpdateSubmit} className="space-y-3 text-xs">
              <div>
                <label className={`block font-semibold mb-1 ${isDarkMode ? "text-gray-400" : "text-gray-700"}`}>File Name</label>
                <input
                  type="text"
                  value={editingItem.file_name}
                  onChange={(e) => setEditingItem({ ...editingItem, file_name: e.target.value })}
                  className={`w-full px-3 py-2 rounded-xl border outline-none focus:border-blue-500 ${
                    isDarkMode ? "bg-slate-900 border-slate-700 text-white" : "bg-gray-50 border-gray-300 text-gray-900 focus:bg-white"
                  }`}
                  required
                />
              </div>

              <div>
                <label className={`block font-semibold mb-1 ${isDarkMode ? "text-gray-400" : "text-gray-700"}`}>DRIVE_ID</label>
                <input
                  type="text"
                  value={editingItem.drive_id}
                  onChange={(e) => setEditingItem({ ...editingItem, drive_id: e.target.value })}
                  className={`w-full px-3 py-2 rounded-xl font-mono text-[11px] border outline-none focus:border-blue-500 ${
                    isDarkMode ? "bg-slate-900 border-slate-700 text-blue-400" : "bg-gray-50 border-gray-300 text-blue-700 font-bold focus:bg-white"
                  }`}
                  required
                />
              </div>

              <div>
                <label className={`block font-semibold mb-1 ${isDarkMode ? "text-gray-400" : "text-gray-700"}`}>DRIVE_ITEM_ID</label>
                <input
                  type="text"
                  value={editingItem.drive_item_id}
                  onChange={(e) => setEditingItem({ ...editingItem, drive_item_id: e.target.value })}
                  className={`w-full px-3 py-2 rounded-xl font-mono text-[11px] border outline-none focus:border-purple-500 ${
                    isDarkMode ? "bg-slate-900 border-slate-700 text-purple-400" : "bg-gray-50 border-gray-300 text-purple-700 font-bold focus:bg-white"
                  }`}
                  required
                />
              </div>

              <div>
                <label className={`block font-semibold mb-1 ${isDarkMode ? "text-gray-400" : "text-gray-700"}`}>Table Name</label>
                <input
                  type="text"
                  value={editingItem.table_name}
                  onChange={(e) => setEditingItem({ ...editingItem, table_name: e.target.value })}
                  className={`w-full px-3 py-2 rounded-xl border outline-none font-mono focus:border-blue-500 ${
                    isDarkMode ? "bg-slate-900 border-slate-700 text-white" : "bg-gray-50 border-gray-300 text-gray-900 focus:bg-white"
                  }`}
                  required
                />
              </div>

              {/* แก้ไข Web URL ใน Modal */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className={`font-semibold ${isDarkMode ? "text-gray-400" : "text-gray-700"}`}>Web URL (Excel Online)</label>
                  <span className={`text-[10px] px-1.5 rounded border ${
                    isDarkMode ? "bg-slate-800 text-slate-400 border-slate-700" : "bg-gray-100 text-gray-500 border-gray-200"
                  }`}>Optional</span>
                </div>
                <input
                  type="url"
                  value={editingItem.web_url || ""}
                  onChange={(e) => setEditingItem({ ...editingItem, web_url: e.target.value })}
                  placeholder="https://deltao365-my.sharepoint.com/:x:/r/personal/..."
                  className={`w-full px-3 py-2 rounded-xl font-mono text-[11px] border outline-none focus:border-blue-500 ${
                    isDarkMode ? "bg-slate-900 border-slate-700 text-white" : "bg-gray-50 border-gray-300 text-gray-900 focus:bg-white"
                  }`}
                />
              </div>

              {/* Column Mapping ใน Modal */}
              <div className={`pt-3 border-t ${isDarkMode ? "border-slate-700/60" : "border-gray-200"}`}>
                <span className={`block text-[11px] font-bold uppercase tracking-wider mb-2.5 ${isDarkMode ? "text-gray-300" : "text-gray-700"}`}>
                  กำหนดชื่อ Column ใน Excel (Header Mapping)
                </span>
                <div className="space-y-2.5">
                  <div>
                    <label className={`block mb-1 font-semibold ${isDarkMode ? "text-gray-400" : "text-gray-600"}`}>Column: รหัสพนักงาน</label>
                    <input
                      type="text"
                      value={editingItem.col_employee_id}
                      onChange={(e) => setEditingItem({ ...editingItem, col_employee_id: e.target.value })}
                      placeholder="เช่น Employee ID"
                      className={`w-full px-3 py-2 rounded-xl border outline-none focus:border-blue-500 ${
                        isDarkMode ? "bg-slate-900 border-slate-700 text-white" : "bg-gray-50 border-gray-300 text-gray-900 focus:bg-white"
                      }`}
                      required
                    />
                  </div>
                  <div>
                    <label className={`block mb-1 font-semibold ${isDarkMode ? "text-gray-400" : "text-gray-600"}`}>Column: ชื่อพนักงาน</label>
                    <input
                      type="text"
                      value={editingItem.col_name}
                      onChange={(e) => setEditingItem({ ...editingItem, col_name: e.target.value })}
                      placeholder="เช่น Name"
                      className={`w-full px-3 py-2 rounded-xl border outline-none focus:border-blue-500 ${
                        isDarkMode ? "bg-slate-900 border-slate-700 text-white" : "bg-gray-50 border-gray-300 text-gray-900 focus:bg-white"
                      }`}
                      required
                    />
                  </div>
                  <div>
                    <label className={`block mb-1 font-semibold ${isDarkMode ? "text-gray-400" : "text-gray-600"}`}>Column: คะแนนสอบ</label>
                    <input
                      type="text"
                      value={editingItem.col_score}
                      onChange={(e) => setEditingItem({ ...editingItem, col_score: e.target.value })}
                      placeholder="เช่น Score"
                      className={`w-full px-3 py-2 rounded-xl border outline-none focus:border-blue-500 ${
                        isDarkMode ? "bg-slate-900 border-slate-700 text-white" : "bg-gray-50 border-gray-300 text-gray-900 focus:bg-white"
                      }`}
                      required
                    />
                  </div>
                </div>
              </div>

              <div className={`flex gap-2 pt-3 border-t ${isDarkMode ? "border-slate-700/60" : "border-gray-200"}`}>
                <button
                  type="button"
                  onClick={() => setEditingItem(null)}
                  className={`flex-1 py-2 text-xs font-semibold rounded-xl border transition-colors ${
                    isDarkMode ? "border-slate-700 hover:bg-slate-800 text-slate-300" : "border-gray-300 hover:bg-gray-100 text-gray-700"
                  }`}
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl shadow-md transition-all"
                >
                  บันทึกการแก้ไข
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Popup Microsoft Device Login */}
      {authPopup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className={`max-w-md w-full p-6 rounded-2xl shadow-2xl border space-y-5 animate-in fade-in zoom-in-95 duration-200 ${
            isDarkMode ? "bg-[#1E293B] border-slate-700 text-slate-100" : "bg-white border-gray-200 text-gray-900"
          }`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold text-xs">
                  MS
                </div>
                <h3 className="font-bold text-sm">ยืนยันตัวตน Microsoft Account</h3>
              </div>
              <button onClick={() => setAuthPopup(null)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-lg">✕</button>
            </div>

            <p className={`text-xs leading-relaxed ${isDarkMode ? "text-gray-400" : "text-gray-600"}`}>
              นำรหัสยืนยันตัวตนด้านล่างไปกรอกที่หน้าล็อกอินของ Microsoft เพื่อเชื่อมต่อสิทธิ์เข้าถึง OneDrive
            </p>

            <div className={`p-4 rounded-xl border text-center space-y-2 ${
              isDarkMode ? "bg-slate-900 border-slate-700" : "bg-gray-50 border-gray-200"
            }`}>
              <span className="text-[10px] uppercase font-bold tracking-wider text-gray-500">รหัสยืนยันตัวตน (Code)</span>
              <div className="text-2xl font-mono font-black tracking-widest text-blue-600 dark:text-blue-400 select-all">
                {authPopup.code || "--------"}
              </div>
              <button
                type="button"
                onClick={copyDeviceCode}
                className="text-xs text-blue-600 dark:text-blue-400 hover:underline font-semibold transition-colors"
              >
                {copiedCode ? "คัดลอกรหัสเรียบร้อย" : "กดเพื่อคัดลอกรหัส"}
              </button>
            </div>

            <div className="space-y-2">
              <a
                href={authPopup.url || "https://microsoft.com/devicelogin"}
                target="_blank"
                rel="noreferrer"
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-2 transition-all shadow-md shadow-blue-500/20"
              >
                <span>เปิดหน้าเว็บล็อกอิน Microsoft</span>
              </a>
              <button
                type="button"
                onClick={() => {
                  setAuthPopup(null);
                  handleSearch();
                }}
                className={`w-full py-2.5 text-xs font-semibold rounded-xl border transition-colors ${
                  isDarkMode ? "border-slate-700 hover:bg-slate-800 text-slate-300" : "border-gray-300 hover:bg-gray-100 text-gray-700"
                }`}
              >
                ล็อกอินสำเร็จแล้ว (กดเพื่อค้นหาใหม่)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}