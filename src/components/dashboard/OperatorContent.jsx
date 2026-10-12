import React, { useState, useEffect, useRef } from "react";

// ตัวแปรแคชระดับโมดูล
const operatorModuleCache = {
  operators: null,
  stationsList: null,
  configList: null,
  timestamp: 0,
};

export default function OperatorContent({ isDarkMode, userRole, role, isAdmin: isAdminProp }) {
  const [operators, setOperators] = useState(() => operatorModuleCache.operators || []);
  const [stationsList, setStationsList] = useState(() => operatorModuleCache.stationsList || []);
  const [configList, setConfigList] = useState(() => operatorModuleCache.configList || []);
  const [loading, setLoading] = useState(!operatorModuleCache.operators);
  const [error, setError] = useState(null);
  const [authPrompt, setAuthPrompt] = useState(null);
  const [copiedCode, setCopiedCode] = useState(false);

  const [searchTerm, setSearchTerm] = useState("");
  const [stationFilter, setStationFilter] = useState("ALL");
  const [sortType, setSortType] = useState("default");

  // State สำหรับ Detail Modal
  const [detailModal, setDetailModal] = useState(null);
  const [selectedStationView, setSelectedStationView] = useState("ALL_EXAMS");
  const [isStationDropdownOpen, setIsStationDropdownOpen] = useState(false);
  const [stationSearchInModal, setStationSearchInModal] = useState("");
  const stationDropdownRef = useRef(null);

  // State สำหรับ Modal แก้ไขชื่อ/รหัส และ Modal แก้ไขคะแนน
  const [editInfoModal, setEditInfoModal] = useState(null);
  const [infoFormData, setInfoFormData] = useState({ name: "", employeeId: "" });

  const [editScoreModal, setEditScoreModal] = useState(null);
  const [scoreFormData, setScoreFormData] = useState({});

  const [deleteConfirmModal, setDeleteConfirmModal] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);

  // ตรวจสอบสิทธิ์ Admin
  const checkIsAdmin = () => {
    if (isAdminProp === true) return true;
    const propRole = (userRole || role || "").toLowerCase();
    if (propRole === "admin") return true;

    try {
      const directRole = localStorage.getItem("role") || localStorage.getItem("userRole");
      if (directRole && directRole.toLowerCase() === "admin") return true;

      const storedUser = localStorage.getItem("user") || localStorage.getItem("userData") || localStorage.getItem("auth");
      if (storedUser) {
        const parsed = JSON.parse(storedUser);
        if (parsed?.role?.toLowerCase() === "admin" || parsed?.user?.role?.toLowerCase() === "admin" || parsed?.isAdmin) {
          return true;
        }
      }

      const token = localStorage.getItem("token") || localStorage.getItem("sessionToken");
      if (token && token.includes(".")) {
        const payload = JSON.parse(atob(token.split(".")[1]));
        if (payload?.role?.toLowerCase() === "admin" || payload?.isAdmin) {
          return true;
        }
      }
    } catch (e) {
      console.warn("Check admin status error:", e);
    }

    return false;
  };

  const isAdmin = checkIsAdmin();

  const API_URL = `/api`;
  const EXCEL_API_URL = `/publics`;

  const getAuthHeaders = () => {
    const token = localStorage.getItem("token") || localStorage.getItem("sessionToken");
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "x-session-token": token,
    };
  };

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (stationDropdownRef.current && !stationDropdownRef.current.contains(event.target)) {
        setIsStationDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // 1. ดึงการตั้งค่าข้อสอบ และ Stations
  const fetchConfigsAndStations = async (force = false) => {
    if (!force && operatorModuleCache.configList && operatorModuleCache.stationsList) {
      setConfigList(operatorModuleCache.configList);
      setStationsList(operatorModuleCache.stationsList);
      return operatorModuleCache.configList;
    }

    try {
      const headers = getAuthHeaders();
      const [resConfigs, resStations] = await Promise.all([
        fetch(`${API_URL}/excel-configs`, { headers }),
        fetch(`${API_URL}/stations`, { headers }),
      ]);

      let configsData = [];
      if (resConfigs.ok) {
        const cResult = await resConfigs.json();
        configsData = cResult.data || [];
        setConfigList(configsData);
        operatorModuleCache.configList = configsData;
      }

      if (resStations.ok) {
        const sResult = await resStations.json();
        const rawStations = Array.isArray(sResult) ? sResult : sResult.data || [];

        const stationsWithExams = await Promise.all(
          rawStations.map(async (st) => {
            try {
              const resEx = await fetch(`${API_URL}/stations/${encodeURIComponent(st.id)}/exams`, { headers });
              const dataEx = await resEx.json();
              return {
                ...st,
                required_exams: dataEx.success && Array.isArray(dataEx.data) ? dataEx.data : [],
              };
            } catch {
              return { ...st, required_exams: [] };
            }
          })
        );
        setStationsList(stationsWithExams);
        operatorModuleCache.stationsList = stationsWithExams;
      }

      return configsData;
    } catch (err) {
      console.error("Fetch Initial Configs Error:", err);
      return [];
    }
  };

  // 2. ดึงข้อมูลคะแนนสอบของพนักงานทั้งหมด
  const fetchAllScores = async (configs = configList, force = false) => {
    if (!force && operatorModuleCache.operators) {
      setOperators(operatorModuleCache.operators);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    setAuthPrompt(null);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000);

    const pollInterval = setInterval(async () => {
      try {
        const res = await fetch(`${EXCEL_API_URL}/check-auth?t=${new Date().getTime()}`, {
          headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
        });
        const data = await res.json();
        if (data.needsAuth && data.authInfo) {
          setAuthPrompt(data.authInfo);
        } else {
          setAuthPrompt(null);
        }
      } catch (e) {}
    }, 2000);

    try {
      const timestamp = new Date().getTime();
      const allResults = [];

      for (const cfg of configs) {
        try {
          const res = await fetch(
            `${EXCEL_API_URL}/excel-scores?configKey=${encodeURIComponent(cfg.config_key)}&t=${timestamp}`,
            {
              signal: controller.signal,
              headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
            }
          );
          if (res.ok) {
            const resData = await res.json();
            allResults.push({
              configKey: cfg.config_key,
              fileName: cfg.file_name || cfg.config_key,
              data: resData.success ? resData.data : [],
            });
          }
        } catch (e) {
          console.warn(`ข้ามไฟล์ ${cfg.config_key}:`, e);
        }
      }

      const mergedMap = new Map();

      allResults.forEach(({ configKey, data }) => {
        data.forEach((item) => {
          const cleanEmpId = String(item.employeeId || "").trim();
          const cleanName = String(item.name || "").trim();

          if ((!cleanEmpId || cleanEmpId === "-") && (!cleanName || cleanName === "-")) return;

          const primaryKey = `${cleanEmpId || "-"}___${cleanName || "ไม่ระบุชื่อ"}`;

          if (!mergedMap.has(primaryKey)) {
            mergedMap.set(primaryKey, {
              employeeId: cleanEmpId || "-",
              name: cleanName || "ไม่ระบุชื่อ",
              scoresByFile: {},
            });
          }

          const currentRecord = mergedMap.get(primaryKey);
          const newScore = Number(item.score) || 0;
          const existingScore = currentRecord.scoresByFile[configKey];
          currentRecord.scoresByFile[configKey] =
            existingScore !== undefined ? Math.max(existingScore, newScore) : newScore;
        });
      });

      const finalOperators = Array.from(mergedMap.values());
      setOperators(finalOperators);

      operatorModuleCache.operators = finalOperators;
      operatorModuleCache.timestamp = Date.now();
    } catch (err) {
      if (err.name === "AbortError") {
        setError("หมดเวลาในการเชื่อมต่อ (ไม่ได้กดยืนยัน Device Login)");
      } else {
        setError("ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ Backend หรืออ่านข้อมูลได้");
      }
    } finally {
      clearInterval(pollInterval);
      clearTimeout(timeoutId);
      setLoading(false);
      setAuthPrompt(null);
    }
  };

  const loadData = async (force = false) => {
    const cfgs = await fetchConfigsAndStations(force);
    if (cfgs && cfgs.length > 0) {
      await fetchAllScores(cfgs, force);
    } else {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!operatorModuleCache.operators) {
      loadData(false);
    }
  }, []);

  const copyDeviceCode = async () => {
    if (!authPrompt?.code) return;
    const textToCopy = authPrompt.code;

    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(textToCopy);
        setCopiedCode(true);
        setTimeout(() => setCopiedCode(false), 2000);
        return;
      } catch (err) {
        console.warn("Clipboard API failed, trying fallback...", err);
      }
    }

    try {
      const textArea = document.createElement("textarea");
      textArea.value = textToCopy;
      textArea.style.position = "fixed";
      textArea.style.left = "-999999px";
      textArea.style.top = "-999999px";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();

      const successful = document.execCommand("copy");
      document.body.removeChild(textArea);

      if (successful) {
        setCopiedCode(true);
        setTimeout(() => setCopiedCode(false), 2000);
      }
    } catch (err) {
      console.error("Fallback copy failed: ", err);
    }
  };

  const handleOpenEditInfo = (op) => {
    setEditInfoModal(op);
    setInfoFormData({
      employeeId: op.employeeId === "-" ? "" : op.employeeId,
      name: op.name === "ไม่ระบุชื่อ" ? "" : op.name,
    });
  };

  const handleSaveInfo = async (e) => {
    e.preventDefault();
    if (!editInfoModal) return;

    setActionLoading(true);
    try {
      const oldEmpId = editInfoModal.employeeId !== "-" && editInfoModal.employeeId !== "" 
        ? editInfoModal.employeeId 
        : editInfoModal.name;

      const newEmpId = infoFormData.employeeId.trim() || oldEmpId;
      const newName = infoFormData.name.trim() || "ไม่ระบุชื่อ";

      let isForbidden = false;
      const updatePromises = configList.map(async (cfg) => {
        const existingScore = editInfoModal.scoresByFile[cfg.config_key];
        if (existingScore !== undefined && existingScore !== null) {
          try {
            const res = await fetch(`${EXCEL_API_URL}/excel-scores/update/${encodeURIComponent(oldEmpId)}`, {
              method: "PATCH",
              headers: getAuthHeaders(),
              body: JSON.stringify({
                configKey: cfg.config_key,
                newEmployeeId: newEmpId,
                newName: newName,
                newScore: Number(existingScore),
              }),
            });
            if (res.status === 401 || res.status === 403) isForbidden = true;
          } catch (err) {
            console.warn(`อัปเดตชื่อในไฟล์ ${cfg.config_key} ไม่สำเร็จ:`, err);
          }
        }
      });

      await Promise.all(updatePromises);
      if (isForbidden) {
        alert("ไม่มีสิทธิ์แก้ไขข้อมูล (เฉพาะ ADMIN และ ME เท่านั้น)");
        return;
      }

      const updatedList = operators.map((op) => {
        if (op.employeeId === editInfoModal.employeeId && op.name === editInfoModal.name) {
          return {
            ...op,
            employeeId: newEmpId,
            name: newName,
          };
        }
        return op;
      });

      setOperators(updatedList);
      operatorModuleCache.operators = updatedList;

      setEditInfoModal(null);
    } catch (err) {
      console.error("Save info error:", err);
      alert("เกิดข้อผิดพลาดในการแก้ไขข้อมูลพนักงาน");
    } finally {
      setActionLoading(false);
    }
  };

  const handleOpenEditScore = (op) => {
    setEditScoreModal(op);
    const initialScores = {};
    configList.forEach((cfg) => {
      initialScores[cfg.config_key] = op.scoresByFile[cfg.config_key] ?? 0;
    });
    setScoreFormData(initialScores);
  };

  const handleSaveScores = async (e) => {
    e.preventDefault();
    if (!editScoreModal) return;

    setActionLoading(true);
    try {
      const currentId = editScoreModal.employeeId !== "-" && editScoreModal.employeeId !== ""
        ? editScoreModal.employeeId
        : editScoreModal.name;

      let isForbidden = false;
      const updatePromises = configList.map(async (cfg) => {
        const scoreVal = scoreFormData[cfg.config_key] ?? 0;
        try {
          const res = await fetch(`${EXCEL_API_URL}/excel-scores/update/${encodeURIComponent(currentId)}`, {
            method: "PATCH",
            headers: getAuthHeaders(),
            body: JSON.stringify({
              configKey: cfg.config_key,
              newEmployeeId: editScoreModal.employeeId,
              newName: editScoreModal.name,
              newScore: Number(scoreVal),
            }),
          });
          if (res.status === 401 || res.status === 403) isForbidden = true;
        } catch (err) {
          console.warn(`อัปเดตคะแนนไฟล์ ${cfg.config_key} ไม่สำเร็จ:`, err);
        }
      });

      await Promise.all(updatePromises);
      if (isForbidden) {
        alert("ไม่มีสิทธิ์แก้ไขคะแนน (เฉพาะ ADMIN และ ME เท่านั้น)");
        return;
      }

      const updatedList = operators.map((op) => {
        if (op.employeeId === editScoreModal.employeeId && op.name === editScoreModal.name) {
          return {
            ...op,
            scoresByFile: { ...scoreFormData },
          };
        }
        return op;
      });

      setOperators(updatedList);
      operatorModuleCache.operators = updatedList;

      setEditScoreModal(null);
    } catch (err) {
      console.error("Save scores error:", err);
      alert("เกิดข้อผิดพลาดในการบันทึกคะแนน");
    } finally {
      setActionLoading(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteConfirmModal) return;

    setActionLoading(true);
    try {
      const targetEmpId = deleteConfirmModal.employeeId !== "-" ? deleteConfirmModal.employeeId : "";
      const targetName = deleteConfirmModal.name !== "ไม่ระบุชื่อ" ? deleteConfirmModal.name : "";

      let isForbidden = false;
      const deletePromises = configList.map(async (cfg) => {
        const currentScore = deleteConfirmModal.scoresByFile[cfg.config_key];
        if (currentScore !== undefined && currentScore !== null) {
          try {
            const res = await fetch(`${EXCEL_API_URL}/excel-scores`, {
              method: "DELETE",
              headers: getAuthHeaders(),
              body: JSON.stringify({
                configKey: cfg.config_key,
                employeeId: targetEmpId,
                name: targetName,
                score: currentScore,
              }),
            });
            if (res.status === 401 || res.status === 403) isForbidden = true;
          } catch (err) {
            console.warn(`ลบจากไฟล์ ${cfg.config_key} ไม่สำเร็จ:`, err);
          }
        }
      });

      await Promise.all(deletePromises);
      if (isForbidden) {
        alert("ไม่มีสิทธิ์ลบข้อมูล (เฉพาะ ADMIN และ ME เท่านั้น)");
        return;
      }

      const filteredList = operators.filter(
        (op) => !(op.employeeId === deleteConfirmModal.employeeId && op.name === deleteConfirmModal.name)
      );

      setOperators(filteredList);
      operatorModuleCache.operators = filteredList;

      setDeleteConfirmModal(null);
    } catch (err) {
      console.error("Delete operator error:", err);
      alert("เกิดข้อผิดพลาดในการลบข้อมูล");
    } finally {
      setActionLoading(false);
    }
  };

  const checkStationQualification = (opScores, station) => {
    const requiredExams = station.required_exams || [];
    if (requiredExams.length === 0) {
      return { isQualified: true, passedCount: 0, totalCount: 0, examDetails: [] };
    }

    let passedRequiredCount = 0;
    let totalRequiredCount = 0;

    const examDetails = requiredExams.map((req) => {
      const userScore = opScores[req.config_key] !== undefined ? opScores[req.config_key] : null;
      const passed = userScore !== null && Number(userScore) >= Number(req.min_score);
      const isReq = req.is_required !== false;

      if (isReq) {
        totalRequiredCount++;
        if (passed) passedRequiredCount++;
      }

      return {
        ...req,
        userScore,
        passed,
        is_required: isReq,
      };
    });

    return {
      isQualified: totalRequiredCount === 0 || passedRequiredCount === totalRequiredCount,
      passedCount: passedRequiredCount,
      totalCount: totalRequiredCount,
      examDetails,
    };
  };

  const evaluatedOperators = operators.map((op) => {
    const stationQualifications = {};
    let passedStationsCount = 0;

    stationsList.forEach((st) => {
      const qual = checkStationQualification(op.scoresByFile, st);
      stationQualifications[st.id] = qual;
      if (qual.isQualified && qual.totalCount > 0) {
        passedStationsCount++;
      }
    });

    return {
      ...op,
      stationQualifications,
      passedStationsCount,
    };
  });

  const filteredOperators = evaluatedOperators.filter((op) => {
    const term = searchTerm.toLowerCase().trim();
    const nameMatch = op.name ? String(op.name).toLowerCase().includes(term) : false;
    const idMatch = op.employeeId ? String(op.employeeId).toLowerCase().includes(term) : false;
    const matchesSearch = !term || nameMatch || idMatch;

    if (!matchesSearch) return false;

    if (stationFilter !== "ALL") {
      const qual = op.stationQualifications[stationFilter];
      return qual && qual.isQualified;
    }

    return true;
  });

  const sortedOperators = [...filteredOperators].sort((a, b) => {
    if (sortType === "name-asc") return (a.name || "").localeCompare(b.name || "", "th");
    if (sortType === "id-asc") return (a.employeeId || "").localeCompare(b.employeeId || "", "th");
    return 0;
  });

  const filteredModalStations = stationsList.filter((st) => {
    const q = stationSearchInModal.toLowerCase().trim();
    if (!q) return true;
    return (
      (st.id || "").toLowerCase().includes(q) ||
      (st.name || "").toLowerCase().includes(q)
    );
  });

  const activeStationData = stationsList.find((s) => s.id === selectedStationView);
  const activeStationQual = detailModal?.stationQualifications?.[selectedStationView];

  return (
    <div className="space-y-4 relative pb-10 select-none">
      {/* Popup Modal: Microsoft Device Login */}
      {authPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
          <div className={`max-w-md w-full p-6 rounded-2xl shadow-2xl border space-y-5 ${
            isDarkMode ? "bg-[#1E293B] border-slate-700 text-slate-100" : "bg-white border-gray-200 text-gray-800"
          }`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold text-xs">
                  MS
                </div>
                <h3 className={`font-bold text-sm ${isDarkMode ? "text-white" : "text-gray-900"}`}>
                  ยืนยันตัวตน Microsoft Account
                </h3>
              </div>
              <button onClick={() => setAuthPrompt(null)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-sm">✕</button>
            </div>

            <p className={`text-xs leading-relaxed ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>
              กรุณานำรหัสยืนยันตัวตนด้านล่างไปกรอกที่หน้าล็อกอินของ Microsoft เพื่อเชื่อมต่อสิทธิ์เข้าถึงตารางคะแนนบน OneDrive
            </p>

            <div className={`p-4 rounded-xl border text-center space-y-2 ${
              isDarkMode ? "bg-slate-900 border-slate-700" : "bg-gray-50 border-gray-200"
            }`}>
              <span className="text-[10px] uppercase font-bold tracking-wider text-gray-400">
                รหัสยืนยันตัวตน (Code)
              </span>
              <div className="text-2xl font-mono font-black tracking-widest text-blue-600 dark:text-blue-400 select-all">
                {authPrompt.code || "--------"}
              </div>
              <button
                type="button"
                onClick={copyDeviceCode}
                className="text-xs text-gray-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 font-semibold transition-colors"
              >
                {copiedCode ? "คัดลอกรหัสเรียบร้อย" : "กดเพื่อคัดลอกรหัส"}
              </button>
            </div>

            <div className="space-y-2">
              <a
                href={authPrompt.url || "https://microsoft.com/devicelogin"}
                target="_blank"
                rel="noreferrer"
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 transition-all shadow-md shadow-blue-500/20"
              >
                <span>เปิดหน้าเว็บล็อกอิน Microsoft</span>
              </a>
              <button
                type="button"
                onClick={() => loadData(true)}
                className={`w-full py-2.5 text-xs font-semibold rounded-xl border transition-colors ${
                  isDarkMode ? "border-slate-700 hover:bg-slate-800 text-slate-300" : "border-gray-200 hover:bg-gray-50 text-gray-700"
                }`}
              >
                ล็อกอินสำเร็จแล้ว (กดเพื่อโหลดข้อมูลใหม่)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Popup Modal 1: แก้ไขชื่อและรหัสพนักงาน */}
      {editInfoModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className={`max-w-md w-full rounded-3xl shadow-2xl border p-6 space-y-5 ${
            isDarkMode ? "bg-[#1E293B] border-slate-700 text-slate-100" : "bg-white border-gray-200 text-gray-800"
          }`}>
            <div className={`flex items-center justify-between border-b pb-3 ${isDarkMode ? "border-slate-700" : "border-gray-100"}`}>
              <h3 className={`font-bold text-sm ${isDarkMode ? "text-white" : "text-gray-900"}`}>แก้ไขชื่อและรหัสพนักงาน</h3>
              <button onClick={() => setEditInfoModal(null)} className="text-gray-400 hover:text-gray-600 dark:hover:text-white">✕</button>
            </div>

            <form onSubmit={handleSaveInfo} className="space-y-4">
              <div>
                <label className="text-[11px] font-bold text-gray-500 dark:text-gray-400 block mb-1">รหัสพนักงาน (Employee ID)</label>
                <input
                  type="text"
                  value={infoFormData.employeeId}
                  onChange={(e) => setInfoFormData({ ...infoFormData, employeeId: e.target.value })}
                  placeholder="เช่น 10023"
                  className={`w-full p-2.5 rounded-xl border text-xs outline-none font-semibold ${
                    isDarkMode ? "bg-slate-900 border-slate-700 text-white" : "bg-gray-50 border-gray-200 text-gray-800"
                  }`}
                />
              </div>

              <div>
                <label className="text-[11px] font-bold text-gray-500 dark:text-gray-400 block mb-1">ชื่อ-นามสกุล (Name) *</label>
                <input
                  type="text"
                  required
                  value={infoFormData.name}
                  onChange={(e) => setInfoFormData({ ...infoFormData, name: e.target.value })}
                  placeholder="ชื่อ-นามสกุล..."
                  className={`w-full p-2.5 rounded-xl border text-xs outline-none font-semibold ${
                    isDarkMode ? "bg-slate-900 border-slate-700 text-white" : "bg-gray-50 border-gray-200 text-gray-800"
                  }`}
                />
              </div>

              <p className="text-[10px] text-gray-400 italic">
                * การแก้ไขชื่อนี้จะคงค่าคะแนนสอบเดิมของทุกวิชาไว้ทั้งหมด โดยไม่รีเซ็ตเป็น 0
              </p>

              <div className={`flex justify-end gap-2 pt-3 border-t ${isDarkMode ? "border-slate-700" : "border-gray-100"}`}>
                <button
                  type="button"
                  onClick={() => setEditInfoModal(null)}
                  className="px-4 py-2 text-xs font-semibold rounded-xl border border-gray-200 dark:border-slate-700 text-gray-600 dark:text-gray-300"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-5 py-2 text-xs font-bold rounded-xl bg-blue-600 hover:bg-blue-700 text-white shadow-md shadow-blue-500/20"
                >
                  {actionLoading ? "กำลังบันทึก..." : "บันทึกข้อมูล"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Popup Modal 2: แก้ไขคะแนนสอบ */}
      {editScoreModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className={`max-w-lg w-full max-h-[90vh] flex flex-col rounded-3xl shadow-2xl border p-6 space-y-5 ${
            isDarkMode ? "bg-[#1E293B] border-slate-700 text-slate-100" : "bg-white border-gray-200 text-gray-800"
          }`}>
            <div className={`flex items-center justify-between border-b pb-3 ${isDarkMode ? "border-slate-700" : "border-gray-100"}`}>
              <div>
                <h3 className={`font-bold text-sm ${isDarkMode ? "text-white" : "text-gray-900"}`}>
                  แก้ไขคะแนนสอบ: {editScoreModal.name}
                </h3>
                <p className="text-[10px] text-gray-400 font-mono">ID: #{editScoreModal.employeeId}</p>
              </div>
              <button onClick={() => setEditScoreModal(null)} className="text-gray-400 hover:text-gray-600 dark:hover:text-white">✕</button>
            </div>

            <form onSubmit={handleSaveScores} className="space-y-4 overflow-y-auto pr-1 flex-1 custom-scrollbar">
              <div className="space-y-2">
                {configList.map((cfg) => (
                  <div
                    key={cfg.config_key}
                    className={`p-2.5 rounded-xl border flex items-center justify-between gap-3 text-xs ${
                      isDarkMode ? "bg-slate-900/50 border-slate-700/70" : "bg-gray-50 border-gray-200"
                    }`}
                  >
                    <div className="truncate pr-2">
                      <p className={`font-semibold truncate ${isDarkMode ? "text-gray-200" : "text-gray-800"}`}>
                        {cfg.file_name ? cfg.file_name.replace(".xlsx", "") : cfg.config_key}
                      </p>
                      <p className="text-[10px] text-gray-400 font-mono">{cfg.config_key}</p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <input
                        type="number"
                        min="0"
                        max="100"
                        value={scoreFormData[cfg.config_key] ?? 0}
                        onChange={(e) =>
                          setScoreFormData({
                            ...scoreFormData,
                            [cfg.config_key]: Number(e.target.value),
                          })
                        }
                        className={`w-20 p-1.5 text-center font-mono font-bold rounded-lg border outline-none ${
                          isDarkMode ? "bg-slate-800 border-slate-600 text-white" : "bg-white border-gray-300 text-gray-800"
                        }`}
                      />
                      <span className="text-[11px] text-gray-400 font-semibold">pts</span>
                    </div>
                  </div>
                ))}
              </div>

              <div className={`flex justify-end gap-2 pt-3 border-t ${isDarkMode ? "border-slate-700" : "border-gray-100"}`}>
                <button
                  type="button"
                  onClick={() => setEditScoreModal(null)}
                  className="px-4 py-2 text-xs font-semibold rounded-xl border border-gray-200 dark:border-slate-700 text-gray-600 dark:text-gray-300"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-5 py-2 text-xs font-bold rounded-xl bg-purple-600 hover:bg-purple-700 text-white shadow-md shadow-purple-500/20"
                >
                  {actionLoading ? "กำลังบันทึก..." : "บันทึกคะแนน"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: ยืนยันการลบ */}
      {deleteConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className={`max-w-sm w-full p-6 rounded-3xl shadow-2xl border space-y-4 ${
            isDarkMode ? "bg-[#1E293B] border-slate-700 text-slate-100" : "bg-white border-gray-200 text-gray-800"
          }`}>
            <div className="text-center space-y-1">
              <h3 className={`font-bold text-sm ${isDarkMode ? "text-white" : "text-gray-900"}`}>ยืนยันการลบข้อมูล</h3>
              <p className={`text-xs ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>
                คุณแน่ใจหรือไม่ว่าต้องการลบข้อมูลของ <strong>{deleteConfirmModal.name}</strong> (ID: #{deleteConfirmModal.employeeId})
              </p>
            </div>
            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDeleteConfirmModal(null)}
                className="flex-1 py-2.5 text-xs font-semibold rounded-xl border border-gray-200 dark:border-slate-700 text-gray-600 dark:text-gray-300"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                disabled={actionLoading}
                onClick={handleConfirmDelete}
                className="flex-1 py-2.5 text-xs font-bold rounded-xl bg-rose-600 hover:bg-rose-700 text-white shadow-md shadow-rose-500/20"
              >
                {actionLoading ? "กำลังลบ..." : "ยืนยันลบ"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Detail Modal */}
      {detailModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className={`max-w-2xl w-full max-h-[90vh] flex flex-col rounded-3xl shadow-2xl border p-6 space-y-5 ${
            isDarkMode ? "bg-[#1E293B] border-slate-700 text-slate-100" : "bg-white border-gray-200 text-gray-800"
          }`}>
            <div className={`flex items-center justify-between border-b pb-4 shrink-0 ${
              isDarkMode ? "border-slate-700/60" : "border-gray-100"
            }`}>
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-500 border border-white/10 flex items-center justify-center font-black text-base text-white shadow-md">
                  {detailModal.name ? detailModal.name.charAt(0).toUpperCase() : "OP"}
                </div>
                <div>
                  <h3 className={`font-bold text-sm flex items-center gap-2 ${
                    isDarkMode ? "text-white" : "text-gray-900"
                  }`}>
                    <span>{detailModal.name || "ไม่ระบุชื่อ"}</span>
                    <span className="text-[11px] font-mono text-blue-600 dark:text-blue-400 px-2 py-0.5 rounded-lg bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20">
                      ID: #{detailModal.employeeId || "-"}
                    </span>
                  </h3>
                  <p className={`text-[11px] mt-0.5 ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>
                    ผ่านเกณฑ์การทดสอบพร้อมเข้างาน: <strong className="text-emerald-600 dark:text-emerald-400">{detailModal.passedStationsCount} สถานี</strong>
                  </p>
                </div>
              </div>
              <button
                onClick={() => setDetailModal(null)}
                className="w-8 h-8 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-700 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-slate-700/50 transition-colors text-sm"
              >
                ✕
              </button>
            </div>

            <div className="space-y-1.5 shrink-0" ref={stationDropdownRef}>
              <div className="flex items-center justify-between text-[11px] font-bold text-gray-500 dark:text-gray-400 px-1">
                <span>เลือกโหมดการตรวจสอบ</span>
                <span className="text-purple-600 dark:text-purple-400">
                  {selectedStationView === "ALL_EXAMS"
                    ? `ผลสอบทั้งหมด (${configList.length} วิชา)`
                    : `สถานี: ${selectedStationView}`}
                </span>
              </div>

              <div className="relative">
                <button
                  type="button"
                  onClick={() => setIsStationDropdownOpen(!isStationDropdownOpen)}
                  className={`w-full p-3 rounded-2xl border text-xs font-semibold flex items-center justify-between text-left transition-all shadow-sm ${
                    isDarkMode
                      ? "bg-slate-900/90 border-slate-700 hover:border-purple-500/50 text-white"
                      : "bg-gray-50 border-gray-200 hover:border-purple-400 text-gray-800"
                  }`}
                >
                  <div className="flex items-center gap-2.5 truncate">
                    <span className="font-bold truncate">
                      {selectedStationView === "ALL_EXAMS"
                        ? `ดูผลสอบ (All Exams - ${configList.length} ชุด)`
                        : `${activeStationData?.id} - ${activeStationData?.name}`}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {selectedStationView !== "ALL_EXAMS" && activeStationQual && (
                      <span className={`text-[10px] px-2 py-0.5 rounded-lg font-bold border ${
                        activeStationQual.totalCount === 0
                          ? "bg-slate-500/10 text-slate-500 dark:text-slate-400 border-slate-500/20"
                          : activeStationQual.isQualified
                          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
                          : "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30"
                      }`}>
                        {activeStationQual.totalCount === 0 ? "ไม่มีเกณฑ์" : activeStationQual.isQualified ? "ผ่านเกณฑ์" : "ไม่ผ่าน"}
                      </span>
                    )}
                    <span className={`text-gray-400 text-[10px] transition-transform duration-200 ${isStationDropdownOpen ? "rotate-180" : ""}`}>
                      ▼
                    </span>
                  </div>
                </button>

                {isStationDropdownOpen && (
                  <div className={`absolute left-0 right-0 mt-2 rounded-2xl shadow-2xl border p-2 z-50 space-y-1.5 animate-in fade-in zoom-in-95 duration-150 ${
                    isDarkMode ? "bg-[#0F172A] border-slate-700 text-slate-100" : "bg-white border-gray-200 text-gray-800"
                  }`}>
                    <div className="relative p-1">
                      <input
                        type="text"
                        value={stationSearchInModal}
                        onChange={(e) => setStationSearchInModal(e.target.value)}
                        placeholder="ค้นหารหัส หรือ ชื่อสถานี..."
                        autoFocus
                        className={`w-full p-2 pl-3 rounded-xl border text-xs outline-none font-medium ${
                          isDarkMode ? "bg-slate-900 border-slate-700 text-white placeholder-slate-500" : "bg-gray-50 border-gray-200 text-gray-800 placeholder-gray-400"
                        }`}
                      />
                    </div>

                    <div className="max-h-56 overflow-y-auto space-y-1 pr-1 custom-scrollbar">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedStationView("ALL_EXAMS");
                          setIsStationDropdownOpen(false);
                          setStationSearchInModal("");
                        }}
                        className={`w-full text-left p-2.5 rounded-xl text-xs font-semibold flex items-center justify-between transition-colors ${
                          selectedStationView === "ALL_EXAMS"
                            ? "bg-blue-600 text-white font-bold"
                            : isDarkMode
                            ? "hover:bg-slate-800 text-slate-200"
                            : "hover:bg-gray-100 text-gray-700"
                        }`}
                      >
                        <span>ดูผลสอบ (All Exams)</span>
                        {selectedStationView === "ALL_EXAMS" && <span>✓</span>}
                      </button>

                      <div className={`h-px my-1 ${isDarkMode ? "bg-slate-700/60" : "bg-gray-100"}`}></div>

                      {filteredModalStations.map((st) => {
                        const qual = detailModal.stationQualifications[st.id] || { isQualified: true, totalCount: 0 };
                        const isSelected = selectedStationView === st.id;

                        return (
                          <button
                            key={st.id}
                            type="button"
                            onClick={() => {
                              setSelectedStationView(st.id);
                              setIsStationDropdownOpen(false);
                              setStationSearchInModal("");
                            }}
                            className={`w-full text-left p-2.5 rounded-xl text-xs flex items-center justify-between transition-colors border ${
                              isSelected
                                ? isDarkMode
                                  ? "bg-purple-600/20 border-purple-500 text-purple-300 font-bold"
                                  : "bg-purple-50 border-purple-300 text-purple-700 font-bold"
                                : isDarkMode
                                ? "border-transparent hover:bg-slate-800/70 text-slate-200"
                                : "border-transparent hover:bg-gray-50 text-gray-700"
                            }`}
                          >
                            <div className="flex items-center gap-2 truncate pr-2">
                              <span className="font-mono font-bold text-purple-600 dark:text-purple-400 px-1.5 py-0.5 rounded bg-purple-50 dark:bg-purple-500/10 border border-purple-200 dark:border-purple-500/20 shrink-0">
                                {st.id}
                              </span>
                              <span className="truncate text-xs">{st.name}</span>
                            </div>

                            <span className={`text-[10px] px-2 py-0.5 rounded-md font-bold shrink-0 ${
                              qual.totalCount === 0
                                ? "bg-slate-500/10 text-slate-500 dark:text-slate-400"
                                : qual.isQualified
                                ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30"
                                : "bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30"
                            }`}>
                              {qual.totalCount === 0 ? "ไม่มีเกณฑ์" : qual.isQualified ? "ผ่าน" : "ไม่ผ่าน"}
                            </span>
                          </button>
                        );
                      })}

                      {filteredModalStations.length === 0 && (
                        <div className="p-4 text-center text-xs text-gray-400">
                          ไม่พบสถานีที่ตรงกับ "{stationSearchInModal}"
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto pr-1 space-y-3 custom-scrollbar min-h-[240px]">
              {selectedStationView !== "ALL_EXAMS" && (() => {
                if (!activeStationData || !activeStationQual) return null;

                return (
                  <div className="space-y-3">
                    <div className={`p-4 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                      isDarkMode ? "bg-slate-900/50 border-slate-700/60" : "bg-gray-50 border-gray-200"
                    }`}>
                      <div>
                        <h4 className="font-bold text-xs text-purple-600 dark:text-purple-400 flex items-center gap-2">
                          <span>Station: {activeStationData.id}</span>
                          <span className={`font-normal ${isDarkMode ? "text-gray-300" : "text-gray-600"}`}>
                            ({activeStationData.name})
                          </span>
                        </h4>
                        <p className={`text-[11px] mt-0.5 ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>
                          เกณฑ์ข้อสอบบังคับ: <strong>{activeStationQual.totalCount} วิชา</strong> (ผ่านแล้ว {activeStationQual.passedCount}/{activeStationQual.totalCount})
                        </p>
                      </div>

                      <span className={`px-3 py-1.5 rounded-xl text-xs font-bold border shrink-0 text-center ${
                        activeStationQual.isQualified
                          ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
                          : "bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30"
                      }`}>
                        {activeStationQual.totalCount === 0 
                          ? "ไม่มีเงื่อนไขข้อสอบ (พร้อมเข้างาน)" 
                          : activeStationQual.isQualified ? "ผ่านเกณฑ์สถานีนี้แล้ว" : "ยังไม่ผ่านเกณฑ์"}
                      </span>
                    </div>

                    <div className="space-y-2">
                      {activeStationQual.examDetails.map((ex, idx) => (
                        <div
                          key={idx}
                          className={`p-3 rounded-2xl border flex items-center justify-between text-xs transition-all ${
                            ex.passed
                              ? isDarkMode ? "bg-emerald-950/20 border-emerald-500/30" : "bg-emerald-50/60 border-emerald-200"
                              : isDarkMode ? "bg-rose-950/20 border-rose-500/30" : "bg-rose-50/60 border-rose-200"
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                              ex.passed ? "bg-emerald-600 text-white" : "bg-rose-600 text-white"
                            }`}>
                              {ex.passed ? "PASS" : "FAIL"}
                            </span>
                            <div>
                              <p className={`font-bold flex items-center gap-1.5 ${isDarkMode ? "text-slate-200" : "text-gray-800"}`}>
                                <span>{ex.file_name ? ex.file_name.replace(".xlsx", "") : ex.config_key}</span>
                                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${
                                  ex.is_required
                                    ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/30"
                                    : "bg-cyan-500/10 text-cyan-500 border-cyan-500/30"
                                }`}>
                                  {ex.is_required ? "REQ" : "OPT"}
                                </span>
                              </p>
                              <p className="text-[10px] text-gray-400 font-mono">key: {ex.config_key}</p>
                            </div>
                          </div>

                          <div className="flex items-center gap-4">
                            <div className="text-right">
                              <span className="text-[10px] text-gray-400 block">เกณฑ์ขั้นต่ำ</span>
                              <span className={`font-mono font-bold ${isDarkMode ? "text-slate-300" : "text-gray-700"}`}>
                                ≥ {ex.min_score} pts
                              </span>
                            </div>

                            <div className="text-right min-w-[70px]">
                              <span className="text-[10px] text-gray-400 block">คะแนนที่ได้</span>
                              <span className={`font-mono font-black text-sm ${ex.passed ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                                {ex.userScore !== null ? `${ex.userScore} pts` : "ยังไม่สอบ"}
                              </span>
                            </div>
                          </div>
                        </div>
                      ))}

                      {activeStationQual.examDetails.length === 0 && (
                        <div className="p-8 text-center text-xs text-gray-400">
                          สถานีนี้ไม่ได้กำหนดเงื่อนไขข้อสอบไว้ สามารถมอบหมายพนักงานเข้าปฏิบัติงานได้ทันที
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}

              {selectedStationView === "ALL_EXAMS" && (
                <div className="space-y-3">
                  {configList.map((cfg) => {
                    const score = detailModal.scoresByFile[cfg.config_key];
                    const userScoreNum = score !== undefined && score !== null ? Number(score) : null;
                    const hasScore = userScoreNum !== null && userScoreNum > 0;

                    const linkedStations = [];
                    stationsList.forEach((st) => {
                      const matchEx = (st.required_exams || []).find((e) => e.config_key === cfg.config_key);
                      if (matchEx) {
                        const minScore = Number(matchEx.min_score) || 80;
                        const isPassed = userScoreNum !== null && userScoreNum >= minScore;
                        linkedStations.push({
                          stationId: st.id,
                          stationName: st.name,
                          minScore,
                          isRequired: matchEx.is_required !== false,
                          isPassed,
                        });
                      }
                    });

                    return (
                      <div
                        key={cfg.config_key}
                        className={`p-3.5 rounded-2xl border space-y-2.5 transition-all ${
                          isDarkMode ? "bg-slate-900/40 border-slate-700/60" : "bg-gray-50 border-gray-200"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="truncate pr-2">
                            <p className={`font-bold text-xs truncate ${
                              isDarkMode ? "text-slate-200" : "text-gray-800"
                            }`}>
                              {cfg.file_name ? cfg.file_name.replace(".xlsx", "") : cfg.config_key}
                            </p>
                            <p className="text-[10px] text-gray-400 font-mono truncate">{cfg.config_key}</p>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-[10px] text-gray-400">คะแนนที่ได้:</span>
                            <span className={`font-mono font-black text-xs px-2.5 py-1 rounded-xl border ${
                              hasScore
                                ? "bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-500/20"
                                : "bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-200 dark:border-rose-500/30"
                            }`}>
                              {userScoreNum !== null ? `${userScoreNum} pts` : "ยังไม่สอบ"}
                            </span>
                          </div>
                        </div>

                        <div className="pt-2 border-t border-gray-200/60 dark:border-slate-800 space-y-1.5">
                          <div className="flex items-center justify-between text-[10px] text-gray-400 font-semibold">
                            <span>สถานีที่ใช้ข้อสอบชุดนี้ ({linkedStations.length} สถานี):</span>
                          </div>

                          {linkedStations.length > 0 ? (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              {linkedStations.map((stMatch) => (
                                <div
                                  key={stMatch.stationId}
                                  className={`p-2 rounded-xl border flex items-center justify-between gap-2 text-xs ${
                                    stMatch.isPassed
                                      ? isDarkMode
                                        ? "bg-emerald-950/20 border-emerald-500/30 text-emerald-300"
                                        : "bg-emerald-50 border-emerald-200 text-emerald-800"
                                      : isDarkMode
                                      ? "bg-rose-950/20 border-rose-500/30 text-rose-300"
                                      : "bg-rose-50 border-rose-200 text-rose-800"
                                  }`}
                                >
                                  <div className="flex items-center gap-1.5 truncate">
                                    <span className="font-mono font-bold text-[10px] px-1.5 py-0.5 rounded bg-black/10 shrink-0">
                                      {stMatch.stationId}
                                    </span>
                                    <span className="truncate text-[11px]" title={stMatch.stationName}>
                                      {stMatch.stationName || "-"}
                                    </span>
                                  </div>

                                  <div className="flex items-center gap-1.5 shrink-0">
                                    <span className="text-[10px] font-mono opacity-80">
                                      (≥{stMatch.minScore})
                                    </span>
                                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                      stMatch.isPassed
                                        ? "bg-emerald-600 text-white"
                                        : "bg-rose-600 text-white"
                                    }`}>
                                      {stMatch.isPassed ? "ผ่าน" : "ไม่ผ่าน"}
                                    </span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <span className="text-[11px] text-gray-400 italic block py-0.5">
                              (ยังไม่มีสถานีใดผูกข้อสอบชุดนี้)
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className={`flex justify-end pt-2 border-t shrink-0 ${
              isDarkMode ? "border-slate-700/60" : "border-gray-100"
            }`}>
              <button
                type="button"
                onClick={() => setDetailModal(null)}
                className={`px-6 py-2.5 rounded-2xl text-xs font-semibold border transition-all ${
                  isDarkMode ? "border-slate-700 text-slate-300 hover:bg-slate-800" : "border-gray-200 text-gray-700 hover:bg-gray-100"
                }`}
              >
                ปิด
              </button>
            </div>
          </div>
        </div>
      )}

      {/* แถบที่ 1: ส่วนหัวหน้าจอ และตัวกรองสถานี/การเรียงลำดับ */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className={`text-lg font-bold ${isDarkMode ? "text-white" : "text-gray-800"}`}>
              Operator Competency & Exam Overview
            </h2>
            {isAdmin && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-500 border border-amber-500/20">
                ADMIN MODE
              </span>
            )}
          </div>
          <p className="text-xs text-gray-400 mt-0.5"></p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={stationFilter}
            onChange={(e) => setStationFilter(e.target.value)}
            className={`px-3 py-2 rounded-xl text-xs border outline-none font-semibold cursor-pointer transition-all ${
              isDarkMode ? "bg-[#1E293B] border-slate-700 text-slate-200" : "bg-white border-gray-200 text-gray-700 shadow-sm"
            }`}
          >
            <option value="ALL">แสดงพนักงานทั้งหมด</option>
            {stationsList.map((st) => (
              <option key={st.id} value={st.id}>
                ผ่านเกณฑ์: {st.id} ({st.name})
              </option>
            ))}
          </select>

          <select
            value={sortType}
            onChange={(e) => setSortType(e.target.value)}
            className={`px-3 py-2 rounded-xl text-xs border outline-none font-semibold cursor-pointer transition-all ${
              isDarkMode ? "bg-[#1E293B] border-slate-700 text-slate-200" : "bg-white border-gray-200 text-gray-700 shadow-sm"
            }`}
          >
            <option value="default">เรียงปกติ</option>
            <option value="name-asc">ชื่อ: A - Z</option>
            <option value="id-asc">รหัสพนักงาน</option>
          </select>

          <button
            onClick={() => loadData(true)}
            disabled={loading || authPrompt}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all shadow-md shadow-blue-500/20 ${
              loading || authPrompt
                ? "bg-blue-400 cursor-not-allowed text-white opacity-70"
                : "bg-blue-600 hover:bg-blue-700 text-white"
            }`}
          >
            <span>{loading && !authPrompt ? "Syncing..." : "Refresh"}</span>
          </button>
        </div>
      </div>

      {/* แถบที่ 2: Search Bar แยกบรรทัดเดี่ยว เต็มความกว้างเหนือตาราง Operator */}
      <div className="w-full">
        <div className="relative w-full">
          <span className="absolute inset-y-0 left-0 flex items-center pl-3.5 pointer-events-none text-gray-400 text-xs font-semibold">
            ค้นหา:
          </span>
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="ค้นหาชื่อ หรือ รหัสพนักงาน (เช่น 10023, สมชาย)..."
            className={`w-full pl-14 pr-12 py-2.5 rounded-2xl text-xs border outline-none transition-all shadow-sm ${
              isDarkMode
                ? "bg-[#1E293B] border-slate-700 text-slate-100 placeholder-slate-500 focus:border-blue-500"
                : "bg-white border-gray-200 text-gray-800 placeholder-gray-400 focus:border-blue-500"
            }`}
          />
          {searchTerm && (
            <button
              type="button"
              onClick={() => setSearchTerm("")}
              className="absolute inset-y-0 right-0 flex items-center pr-3.5 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
            >
              ล้าง
            </button>
          )}
        </div>
      </div>

      {/* Main Table */}
      {error ? (
        <div className="bg-rose-500/10 text-rose-500 p-4 rounded-xl border border-rose-500/20 text-xs font-semibold">
          {error}
        </div>
      ) : (
        <div className={`rounded-2xl border shadow-sm relative overflow-hidden ${
          isDarkMode ? "bg-[#1E293B] border-slate-700/60 text-slate-300" : "bg-white border-gray-200 text-gray-600"
        }`}>
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full text-left text-xs whitespace-nowrap">
              <thead className={`font-bold uppercase tracking-wider border-b ${
                isDarkMode ? "bg-slate-800/60 text-slate-400 border-slate-700/60" : "bg-gray-50 text-gray-500 border-gray-200"
              }`}>
                <tr>
                  <th className="p-4 pl-6 w-48">OPERATOR ID</th>
                  <th className="p-4">NAME (ชื่อ-นามสกุล)</th>
                  <th className={`p-4 text-center pr-6 ${isAdmin ? "w-64" : "w-36"}`}>ACTION</th>
                </tr>
              </thead>
              <tbody className={`divide-y ${isDarkMode ? "divide-slate-700/50" : "divide-gray-100"}`}>
                {sortedOperators.length === 0 && !loading ? (
                  <tr>
                    <td colSpan={3} className="p-8 text-center text-gray-400">
                      {stationFilter !== "ALL"
                        ? `ไม่พบพนักงานที่ผ่านเกณฑ์ของสถานี ${stationFilter}`
                        : "ไม่พบข้อมูลพนักงาน"}
                    </td>
                  </tr>
                ) : (
                  sortedOperators.map((op, index) => (
                    <tr key={index} className={`transition-colors ${isDarkMode ? "hover:bg-slate-700/30" : "hover:bg-gray-50/70"}`}>
                      <td className="p-4 pl-6 font-bold text-blue-600 dark:text-blue-400 font-mono text-sm">#{op.employeeId}</td>
                      <td className={`p-4 font-bold text-sm flex items-center gap-3 ${isDarkMode ? "text-slate-100" : "text-gray-800"}`}>
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs shrink-0 ${
                          isDarkMode ? "bg-blue-500/20 text-blue-400" : "bg-blue-100 text-blue-600"
                        }`}>
                          {op.name ? op.name.charAt(0).toUpperCase() : "?"}
                        </div>
                        <span>{op.name || "ไม่ระบุชื่อ"}</span>
                      </td>

                      <td className="p-4 text-center pr-6">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setDetailModal(op);
                              setSelectedStationView("ALL_EXAMS");
                              setIsStationDropdownOpen(false);
                              setStationSearchInModal("");
                            }}
                            className="px-3 py-1.5 bg-blue-50 dark:bg-blue-600/10 hover:bg-blue-600 text-blue-600 dark:text-blue-400 hover:text-white border border-blue-200 dark:border-blue-500/30 rounded-xl text-xs font-bold transition-all shadow-sm"
                          >
                            Details
                          </button>

                          {isAdmin && (
                            <>
                              <button
                                type="button"
                                title="แก้ไขชื่อ/รหัสพนักงาน"
                                onClick={() => handleOpenEditInfo(op)}
                                className="px-2.5 py-1.5 bg-blue-50 dark:bg-blue-500/10 hover:bg-blue-500 text-blue-600 dark:text-blue-400 hover:text-white border border-blue-200 dark:border-blue-500/30 rounded-xl text-xs font-bold transition-all shadow-sm"
                              >
                                Edit Info
                              </button>

                              <button
                                type="button"
                                title="แก้ไขคะแนนสอบ"
                                onClick={() => handleOpenEditScore(op)}
                                className="px-2.5 py-1.5 bg-purple-50 dark:bg-purple-500/10 hover:bg-purple-600 text-purple-600 dark:text-purple-400 hover:text-white border border-purple-200 dark:border-purple-500/30 rounded-xl text-xs font-bold transition-all shadow-sm"
                              >
                                Edit Scores
                              </button>

                              <button
                                type="button"
                                title="ลบข้อมูล"
                                onClick={() => setDeleteConfirmModal(op)}
                                className="px-2.5 py-1.5 bg-rose-50 dark:bg-rose-500/10 hover:bg-rose-600 text-rose-600 dark:text-rose-400 hover:text-white border border-rose-200 dark:border-rose-500/30 rounded-xl text-xs font-bold transition-all shadow-sm"
                              >
                                Delete
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}