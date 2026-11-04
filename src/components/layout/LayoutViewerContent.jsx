import React, { useState, useEffect, useRef, useCallback } from "react";
import { socket } from "../../socket";
import defaultAvatar from "../../assets/unknow.jpg";

export default function LayoutViewerContent({ isDarkMode }) {
  const [lines, setLines] = useState([]);
  const [selectedLine, setSelectedLine] = useState("");
  const [selectedShift, setSelectedShift] = useState("a");
  const [loadingLines, setLoadingLines] = useState(false);
  const [loadingLayout, setLoadingLayout] = useState(false);

  const [elements, setElements] = useState([]);
  const [selectedElement, setSelectedElement] = useState(null);

  const [operatorModal, setOperatorModal] = useState(null);
  const [requiredExams, setRequiredExams] = useState([]);
  const [loadingStationExams, setLoadingStationExams] = useState(false);
  const [operatorsData, setOperatorsData] = useState([]);
  const [loadingOperators, setLoadingOperators] = useState(false);
  const [isSavingAssignment, setIsSavingAssignment] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [onlyPassedFilter, setOnlyPassedFilter] = useState(true);

  const [transferConflictModal, setTransferConflictModal] = useState(null);
  const [authPrompt, setAuthPrompt] = useState(null);
  const [copiedCode, setCopiedCode] = useState(false);

  // Modal แสดงรูปขยายขนาดใหญ่
  const [previewImageModal, setPreviewImageModal] = useState(null);

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [zoomScale, setZoomScale] = useState(1);

  const canvasContainerRef = useRef(null);
  const mainWorkspaceRef = useRef(null);
  const lastClickRef = useRef({ time: 0, id: null });

  const stationCriteriaCacheRef = useRef(new Map());
  const excelScoresCacheRef = useRef(new Map());
  const excelConfigsCacheRef = useRef(null);

  const API_URL = `/api`;
  const EXCEL_API_URL = `/publics`;

  const currentEmpId = Number(localStorage.getItem("employeeId"));
  const userRole = (localStorage.getItem("userRole") || "").toLowerCase().trim();
  const isAdmin = userRole === "admin";

  const getAuthHeaders = () => {
    const token = localStorage.getItem("token") || localStorage.getItem("sessionToken");
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "x-session-token": token,
    };
  };

  const checkCanManageCurrentLine = useCallback(() => {
    if (isAdmin) return true;
    const currentLineObj = lines.find((l) => String(l.id).toUpperCase() === String(selectedLine).toUpperCase());
    if (!currentLineObj || !Array.isArray(currentLineObj.owners)) return false;

    return currentLineObj.owners.some(
      (o) => Number(o.employee_id) === currentEmpId
    );
  }, [isAdmin, lines, selectedLine, currentEmpId]);

  const canManageLine = checkCanManageCurrentLine();

  const openFullImage = (item) => {
    if (item.type === "operator") {
      const empId = item.operator_id;
      setPreviewImageModal({
        title: item.operator_name || item.label || "Operator",
        subTitle: empId ? `Employee ID: #${empId}` : "ยังไม่ได้ผูกรหัสพนักงาน",
        station: item.assigned_station || "-",
        src: empId ? `/api/operator-images/${empId}.png` : defaultAvatar,
      });
    } else if (item.type === "image") {
      setPreviewImageModal({
        title: item.label || "Layout Image",
        subTitle: `ขนาด: ${item.width} x ${item.height} px`,
        station: null,
        src: item.src,
      });
    }
  };

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

  const fitToCanvas = useCallback((elems = elements) => {
    if (!canvasContainerRef.current || !elems || elems.length === 0) return;

    const containerWidth = canvasContainerRef.current.clientWidth;
    const containerHeight = canvasContainerRef.current.clientHeight;
    if (containerWidth === 0 || containerHeight === 0) return;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    elems.forEach((el) => {
      minX = Math.min(minX, el.x);
      minY = Math.min(minY, el.y);
      maxX = Math.max(maxX, el.x + (el.width || 140));
      maxY = Math.max(maxY, el.y + (el.height || 90));
    });

    const contentWidth = maxX - minX;
    const contentHeight = maxY - minY;
    if (contentWidth <= 0 || contentHeight <= 0) return;

    const padding = 50;
    const availableWidth = Math.max(100, containerWidth - padding * 2);
    const availableHeight = Math.max(100, containerHeight - padding * 2);

    const scaleX = availableWidth / contentWidth;
    const scaleY = availableHeight / contentHeight;
    let optimalScale = Math.min(scaleX, scaleY);
    optimalScale = Math.min(1.5, Math.max(0.1, optimalScale));

    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    const targetPanX = containerWidth / 2 - centerX * optimalScale;
    const targetPanY = containerHeight / 2 - centerY * optimalScale;

    setZoomScale(Number(optimalScale.toFixed(2)));
    setPanOffset({
      x: Math.round(targetPanX),
      y: Math.round(targetPanY),
    });
  }, [elements]);

  const fetchLines = async () => {
    setLoadingLines(true);
    try {
      const res = await fetch(`${API_URL}/lines`, {
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      const linesData = Array.isArray(data) ? data : data.data || [];
      if (linesData.length > 0) {
        setLines(linesData);
        setSelectedLine(linesData[0].id);
      }
    } catch (err) {
      console.error("Fetch Lines Error:", err);
    } finally {
      setLoadingLines(false);
    }
  };

  const fetchLayoutAndAssignments = async (lineId, shift = selectedShift, isSilent = false) => {
    if (!lineId) return;
    if (!isSilent) {
      setLoadingLayout(true);
      setSelectedElement(null);
    }

    try {
      const [resLayout, resAssign] = await Promise.all([
        fetch(`${API_URL}/layout/${encodeURIComponent(lineId)}`, { headers: getAuthHeaders() }),
        fetch(`${API_URL}/station-assignments/${encodeURIComponent(lineId)}?shift=${shift}`, { headers: getAuthHeaders() }),
      ]);

      const layoutResult = await resLayout.json();
      const assignResult = await resAssign.json();

      let layoutElems = [];
      if (layoutResult.success && Array.isArray(layoutResult.data)) {
        layoutElems = layoutResult.data;
      }

      const assignments = (assignResult.success && Array.isArray(assignResult.data)) ? assignResult.data : [];
      const assignMap = new Map();
      assignments.forEach((a) => assignMap.set(a.element_id, a));

      const mergedElems = layoutElems.map((item) => {
        if (item.type === "operator") {
          if (assignMap.has(item.id)) {
            const assignData = assignMap.get(item.id);
            return {
              ...item,
              label: assignData.operator_name || assignData.operator_id,
              operator_id: assignData.operator_id,
              operator_name: assignData.operator_name,
            };
          } else {
            return {
              ...item,
              label: "OP",
              operator_id: undefined,
              operator_name: undefined,
            };
          }
        }
        return item;
      });

      setElements(mergedElems);
      if (!isSilent) {
        setTimeout(() => fitToCanvas(mergedElems), 50);
      }
    } catch (err) {
      console.error("Fetch Layout/Assignments Error:", err);
    } finally {
      if (!isSilent) {
        setLoadingLayout(false);
      }
    }
  };

  const processOperatorsMap = (allResults) => {
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
            scores: {},
          });
        }

        const current = mergedMap.get(primaryKey);
        current.scores[configKey] = Number(item.score) || 0;
      });
    });
    return Array.from(mergedMap.values());
  };

  // ดึงเกณฑ์ข้อสอบโดยเจาะจง Line + Station เพื่อใช้ลำดับชั้น (Hierarchy Scope) ที่ถูกต้อง
  const fetchStationCriteriaAndScores = async (stationId, forceRefresh = false) => {
    setLoadingStationExams(true);
    setLoadingOperators(true);
    setAuthPrompt(null);

    // สร้าง Cache Key คู่ Line + Station ป้องกันคะแนนตีกันข้ามไลน์
    const targetStationKey = `${selectedLine}___${stationId || "UNKNOWN"}`;

    let examsCriteria = [];
    if (!forceRefresh && stationCriteriaCacheRef.current.has(targetStationKey)) {
      examsCriteria = stationCriteriaCacheRef.current.get(targetStationKey);
      setRequiredExams(examsCriteria);
      setLoadingStationExams(false);
    } else {
      try {
        if (stationId && stationId !== "UNKNOWN" && selectedLine) {
          // ดึงผ่าน Endpoint Hierarchy ของ Line และ Station
          const resExams = await fetch(
            `${API_URL}/lines/${encodeURIComponent(selectedLine)}/stations/${encodeURIComponent(stationId)}/exams`,
            { headers: getAuthHeaders() }
          );
          const dataExams = await resExams.json();
          if (dataExams.success && Array.isArray(dataExams.data)) {
            examsCriteria = dataExams.data;
          }
        }
        stationCriteriaCacheRef.current.set(targetStationKey, examsCriteria);
        setRequiredExams(examsCriteria);
      } catch (err) {
        console.error("Fetch Line Station Exams Error:", err);
      } finally {
        setLoadingStationExams(false);
      }
    }

    let targetConfigKeys = [];
    if (examsCriteria.length > 0) {
      targetConfigKeys = examsCriteria.map((e) => e.config_key);
    } else {
      if (!forceRefresh && excelConfigsCacheRef.current) {
        targetConfigKeys = excelConfigsCacheRef.current;
      } else {
        try {
          const resCfg = await fetch(`${API_URL}/excel-configs`, { headers: getAuthHeaders() });
          const dataCfg = await resCfg.json();
          if (dataCfg.success && Array.isArray(dataCfg.data)) {
            targetConfigKeys = dataCfg.data.map((c) => c.config_key);
            excelConfigsCacheRef.current = targetConfigKeys;
          }
        } catch (e) {
          console.error("Fetch Excel Configs Error:", e);
        }
      }
    }

    const missingKeys = forceRefresh
      ? targetConfigKeys
      : targetConfigKeys.filter((k) => !excelScoresCacheRef.current.has(k));

    if (missingKeys.length === 0 && targetConfigKeys.length > 0) {
      const allResults = targetConfigKeys.map((k) => ({
        configKey: k,
        data: excelScoresCacheRef.current.get(k) || [],
      }));
      setOperatorsData(processOperatorsMap(allResults));
      setLoadingOperators(false);
      return;
    }

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
      for (const cfgKey of missingKeys) {
        try {
          const res = await fetch(
            `${EXCEL_API_URL}/excel-scores?configKey=${encodeURIComponent(cfgKey)}&t=${timestamp}`
          );
          if (res.ok) {
            const resData = await res.json();
            const scoreList = resData.success ? resData.data : [];
            excelScoresCacheRef.current.set(cfgKey, scoreList);
          }
        } catch (e) {
          console.warn(`ข้ามไฟล์ ${cfgKey}:`, e);
        }
      }

      const allResults = targetConfigKeys.map((k) => ({
        configKey: k,
        data: excelScoresCacheRef.current.get(k) || [],
      }));

      setOperatorsData(processOperatorsMap(allResults));
    } catch (err) {
      console.error("Fetch Station Exam Criteria/Scores Error:", err);
    } finally {
      clearInterval(pollInterval);
      setLoadingOperators(false);
    }
  };

  useEffect(() => {
    fetchLines();
  }, []);

  useEffect(() => {
    if (selectedLine) {
      fetchLayoutAndAssignments(selectedLine, selectedShift);
    }
  }, [selectedLine, selectedShift]);

  useEffect(() => {
    if (!socket) return;

    const handleRealtimeUpdate = (data) => {
      if (
        !data ||
        !data.line_id ||
        (String(data.line_id).toUpperCase() === String(selectedLine).toUpperCase() &&
          (!data.shift || String(data.shift).toLowerCase() === String(selectedShift).toLowerCase()))
      ) {
        fetchLayoutAndAssignments(selectedLine, selectedShift, true);
      }
    };

    socket.on("station_assignment_updated", handleRealtimeUpdate);
    socket.on("assignment_changed", handleRealtimeUpdate);
    socket.on("layout_updated", handleRealtimeUpdate);
    socket.on("operator_assigned", handleRealtimeUpdate);

    const fallbackInterval = setInterval(() => {
      if (selectedLine && !isSavingAssignment) {
        fetchLayoutAndAssignments(selectedLine, selectedShift, true);
      }
    }, 4000);

    return () => {
      socket.off("station_assignment_updated", handleRealtimeUpdate);
      socket.off("assignment_changed", handleRealtimeUpdate);
      socket.off("layout_updated", handleRealtimeUpdate);
      socket.off("operator_assigned", handleRealtimeUpdate);
      clearInterval(fallbackInterval);
    };
  }, [selectedLine, selectedShift, isSavingAssignment]);

  useEffect(() => {
    const handleResize = () => fitToCanvas();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [fitToCanvas]);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      const targetElem = mainWorkspaceRef.current || document.documentElement;
      if (targetElem.requestFullscreen) {
        targetElem.requestFullscreen();
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      }
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      const isFull = Boolean(document.fullscreenElement);
      setIsFullscreen(isFull);
      setTimeout(() => fitToCanvas(), 150);
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, [fitToCanvas]);

  const handleItemClick = (e, item) => {
    e.stopPropagation();
    const now = Date.now();
    const timeDiff = now - lastClickRef.current.time;

    if (timeDiff < 350 && lastClickRef.current.id === item.id) {
      lastClickRef.current = { time: 0, id: null };
      
      if (item.type === "operator") {
        if (canManageLine) {
          setSearchTerm("");
          setOnlyPassedFilter(true);
          setOperatorModal(item);
          fetchStationCriteriaAndScores(item.assigned_station, false);
        } else {
          openFullImage(item);
        }
      } else if (item.type === "image") {
        openFullImage(item);
      }
      return;
    }

    lastClickRef.current = { time: now, id: item.id };
    setSelectedElement(item);
  };

  const handleSelectOperator = async (op, isPassed, forceMove = false) => {
    if (!operatorModal || !selectedLine) return;

    if (!canManageLine) {
      alert("คุณไม่มีสิทธิ์จัดพนักงานใน Line นี้");
      return;
    }

    const hasMandatoryExams = requiredExams.some(e => e.is_required !== false);
    if (!isPassed && hasMandatoryExams && !forceMove) {
      if (!window.confirm(`คำเตือน: พนักงาน (${op.name || op.employeeId}) ยังสอบไม่ผ่านเกณฑบังคับของสถานี ${operatorModal.assigned_station} บน Line ${selectedLine}\n\nต้องการยืนยันมอบหมายงานหรือไม่?`)) {
        return;
      }
    }

    const validEmpId = (op.employeeId && op.employeeId !== "-") 
      ? String(op.employeeId).trim() 
      : (op.name ? String(op.name).trim() : "");

    if (!validEmpId) {
      alert("ข้อมูลพนักงานไม่ถูกต้อง");
      return;
    }

    setIsSavingAssignment(true);
    const newLabel = op.name || validEmpId;

    const targetStation = (operatorModal.assigned_station && operatorModal.assigned_station !== "UNKNOWN" && operatorModal.assigned_station.trim() !== "")
      ? operatorModal.assigned_station.trim()
      : null;

    try {
      const res = await fetch(`${API_URL}/station-assignments/check-or-move`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          line_id: selectedLine,
          station_id: targetStation,
          element_id: operatorModal.id,
          shift: selectedShift,
          operator_id: validEmpId,
          operator_name: op.name || validEmpId,
          force_move: forceMove,
        }),
      });

      const result = await res.json();

      if (!result.success && result.requiresConfirmation) {
        setTransferConflictModal({
          op,
          isPassed,
          currentAssignment: result.currentAssignment,
          targetLine: selectedLine,
          targetStation: targetStation || operatorModal.label,
        });
        return;
      }

      if (res.ok && result.success) {
        setElements((prev) =>
          prev.map((elem) => {
            if (elem.id === operatorModal.id) {
              return {
                ...elem,
                label: newLabel,
                operator_id: validEmpId,
                operator_name: op.name || validEmpId,
              };
            }
            if (elem.operator_id === validEmpId) {
              return {
                ...elem,
                label: "OP",
                operator_id: undefined,
                operator_name: undefined,
              };
            }
            return elem;
          })
        );
        setOperatorModal(null);
        setTransferConflictModal(null);

        if (socket && socket.connected) {
          socket.emit("station_assignment_updated", {
            line_id: selectedLine,
            shift: selectedShift,
          });
        }

        fetchLayoutAndAssignments(selectedLine, selectedShift, true);
      } else {
        alert("บันทึกข้อมูลไม่สำเร็จ: " + (result.error || "Error"));
      }
    } catch (err) {
      alert("เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ");
    } finally {
      setIsSavingAssignment(false);
    }
  };

  const handleClearAssignment = async () => {
    if (!operatorModal || !selectedLine) return;

    if (!canManageLine) {
      alert("คุณไม่มีสิทธิ์ยกเลิกพนักงานใน Line นี้");
      return;
    }

    try {
      const res = await fetch(`${API_URL}/station-assignments/${encodeURIComponent(selectedLine)}/${encodeURIComponent(operatorModal.id)}?shift=${selectedShift}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
      });

      if (res.ok) {
        setElements((prev) =>
          prev.map((elem) =>
            elem.id === operatorModal.id
              ? { ...elem, label: "OP", operator_id: undefined, operator_name: undefined }
              : elem
          )
        );
        setOperatorModal(null);

        if (socket && socket.connected) {
          socket.emit("station_assignment_updated", {
            line_id: selectedLine,
            shift: selectedShift,
          });
        }
      } else {
        const errData = await res.json();
        alert(errData.error || "ยกเลิกการมอบหมายไม่สำเร็จ");
      }
    } catch (err) {
      console.error("Clear Assignment Error:", err);
    }
  };

  const evaluatedOperators = operatorsData.map((op) => {
    let isPassedAllRequired = true;

    const examDetails = requiredExams.map((req) => {
      const userScore = op.scores[req.config_key] !== undefined ? op.scores[req.config_key] : null;
      const passed = userScore !== null && Number(userScore) >= Number(req.min_score);
      const isReq = req.is_required !== false;

      if (isReq && !passed) {
        isPassedAllRequired = false;
      }

      return {
        ...req,
        userScore,
        passed,
        is_required: isReq,
      };
    });

    const hasRequiredExams = requiredExams.some((e) => e.is_required !== false);

    return {
      ...op,
      isPassed: hasRequiredExams ? isPassedAllRequired : true,
      examDetails,
    };
  });

  const filteredOperators = evaluatedOperators.filter((op) => {
    const term = searchTerm.toLowerCase().trim();
    const matchId = String(op.employeeId || "").toLowerCase().includes(term);
    const matchName = String(op.name || "").toLowerCase().includes(term);
    const matchesSearch = !term || matchId || matchName;

    if (!matchesSearch) return false;
    if (onlyPassedFilter && requiredExams.some((e) => e.is_required !== false) && !op.isPassed) {
      return false;
    }

    return true;
  });

  return (
    <div
      ref={mainWorkspaceRef}
      className={`flex flex-col h-full space-y-4 select-none relative ${
        isFullscreen ? (isDarkMode ? "bg-[#0F172A] p-4" : "bg-[#F8FAFC] p-4") : ""
      }`}
    >
      {/* Modal: Preview ภาพขนาดใหญ่ */}
      {previewImageModal && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-in fade-in duration-150"
          onClick={() => setPreviewImageModal(null)}
        >
          <div
            className={`max-w-2xl w-full p-6 rounded-3xl shadow-2xl border space-y-4 relative ${
              isDarkMode ? "bg-[#1E293B] border-slate-700 text-slate-100" : "bg-white border-gray-200 text-gray-900"
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b pb-3 border-slate-700/40">
              <div>
                <h3 className="font-bold text-lg">{previewImageModal.title}</h3>
                <p className="text-xs text-gray-400 font-mono mt-0.5">{previewImageModal.subTitle}</p>
              </div>
              <button
                type="button"
                onClick={() => setPreviewImageModal(null)}
                className="w-9 h-9 rounded-full bg-slate-500/10 hover:bg-slate-500/20 flex items-center justify-center text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <div className="w-full h-96 rounded-2xl overflow-hidden bg-black/40 border border-slate-700/50 flex items-center justify-center p-3 shadow-inner">
              <img
                src={previewImageModal.src}
                alt={previewImageModal.title}
                className="max-w-full max-h-full object-contain rounded-xl"
                onError={(e) => {
                  e.target.onerror = null;
                  e.target.src = defaultAvatar;
                }}
              />
            </div>

            {previewImageModal.station && (
              <div className="flex items-center justify-between px-2 pt-1 text-xs">
                <span className="text-gray-400 font-medium">สถานีประจำการ:</span>
                <span className="font-mono font-bold text-purple-400 bg-purple-500/15 px-3 py-1 rounded-xl border border-purple-500/30">
                  {previewImageModal.station}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal: Microsoft Device Login */}
      {authPrompt && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className={`max-w-md w-full p-6 rounded-2xl shadow-2xl border space-y-5 ${
            isDarkMode ? "bg-[#1E293B] border-slate-700 text-slate-100" : "bg-white border-gray-200 text-gray-900"
          }`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold text-xs">
                  MS
                </div>
                <div>
                  <h3 className={`font-bold text-sm ${isDarkMode ? "text-slate-100" : "text-gray-900"}`}>
                    ยืนยันตัวตน Microsoft Account
                  </h3>
                  <p className="text-[10px] text-gray-500">จำเป็นต้องยืนยันสิทธิ์เพื่ออ่านข้อมูลคะแนน</p>
                </div>
              </div>
              <button onClick={() => setAuthPrompt(null)} className="text-gray-400 hover:text-gray-600 text-base">✕</button>
            </div>

            <p className={`text-xs leading-relaxed ${isDarkMode ? "text-gray-400" : "text-gray-600"}`}>
              นำรหัสยืนยันตัวตนด้านล่างไปกรอกที่หน้าล็อกอินของ Microsoft เพื่อดึงคะแนนสอบจาก OneDrive
            </p>

            <div className={`p-4 rounded-xl border text-center space-y-2 ${
              isDarkMode ? "bg-slate-900 border-slate-700" : "bg-gray-50 border-gray-200"
            }`}>
              <span className="text-[10px] uppercase font-bold tracking-wider text-gray-500 block">
                User Code
              </span>
              <div className="text-3xl font-mono font-black tracking-widest text-blue-600 select-all py-1">
                {authPrompt.code || "--------"}
              </div>
              <button
                type="button"
                onClick={copyDeviceCode}
                className="text-xs text-blue-600 hover:underline font-semibold transition-colors"
              >
                {copiedCode ? "คัดลอกรหัสเรียบร้อย" : "กดเพื่อคัดลอกรหัส"}
              </button>
            </div>

            <div className="space-y-2">
              <a
                href={authPrompt.url || "https://microsoft.com/devicelogin"}
                target="_blank"
                rel="noreferrer"
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-2 transition-all shadow-md"
              >
                <span>เปิดหน้าเว็บล็อกอิน Microsoft</span>
              </a>
              <button
                type="button"
                onClick={() => operatorModal && fetchStationCriteriaAndScores(operatorModal.assigned_station, true)}
                className={`w-full py-2.5 text-xs font-semibold rounded-xl border transition-colors ${
                  isDarkMode ? "border-slate-700 hover:bg-slate-800 text-slate-300" : "border-gray-300 hover:bg-gray-100 text-gray-700"
                }`}
              >
                ล็อกอินสำเร็จแล้ว (ดึงคะแนนใหม่)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: ยืนยันการย้ายพนักงาน */}
      {transferConflictModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className={`max-w-md w-full p-6 rounded-2xl shadow-2xl border space-y-4 ${
            isDarkMode ? "bg-[#1E293B] border-amber-500/40 text-slate-100" : "bg-white border-amber-400 text-gray-900"
          }`}>
            <div className="border-b pb-3 border-slate-700/40">
              <h3 className="font-bold text-sm text-amber-600 dark:text-amber-400">พบการมอบหมายงานซ้ำซ้อน</h3>
              <p className="text-[11px] text-gray-500">พนักงานถูกจัดงานไว้ที่ตำแหน่งอื่นในกะนี้แล้ว</p>
            </div>

            <div className={`p-4 rounded-xl border space-y-2.5 text-xs leading-relaxed ${
              isDarkMode ? "bg-slate-900/60 border-slate-700/60" : "bg-amber-50/70 border-amber-200"
            }`}>
              <div className={`font-semibold ${isDarkMode ? "text-slate-200" : "text-gray-900"}`}>
                พนักงาน: <span className="text-blue-600 dark:text-blue-400 font-bold">{transferConflictModal.op.name || transferConflictModal.op.employeeId}</span> (ID: #{transferConflictModal.op.employeeId})
              </div>

              <div className="space-y-1 text-[11px]">
                <div className="flex items-center justify-between text-rose-600 dark:text-rose-400">
                  <span>ตำแหน่งปัจจุบัน:</span>
                  <span className="font-mono font-bold">Line {transferConflictModal.currentAssignment.line_id} ({transferConflictModal.currentAssignment.station_id || transferConflictModal.currentAssignment.element_id})</span>
                </div>
                <div className="flex items-center justify-between text-emerald-600 dark:text-emerald-400">
                  <span>ตำแหน่งใหม่ที่จะย้ายไป:</span>
                  <span className="font-mono font-bold">Line {transferConflictModal.targetLine} ({transferConflictModal.targetStation})</span>
                </div>
              </div>

              <p className="text-[11px] text-gray-500 pt-1 border-t border-slate-700/40">
                หากกดยืนยัน ระบบจะย้ายพนักงานมายังตำแหน่งใหม่ทันที และลบออกจากตำแหน่งเดิม
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setTransferConflictModal(null)}
                className={`px-4 py-2 rounded-xl text-xs font-semibold border ${
                  isDarkMode ? "border-slate-700 text-slate-300 hover:bg-slate-800" : "border-gray-300 text-gray-700 hover:bg-gray-100"
                }`}
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={() => handleSelectOperator(transferConflictModal.op, transferConflictModal.isPassed, true)}
                className="px-5 py-2 rounded-xl text-xs font-bold text-slate-900 bg-amber-500 hover:bg-amber-400 shadow-md transition-all"
              >
                ยืนยันการย้ายตำแหน่ง
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Operator Selection Modal */}
      {operatorModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className={`max-w-4xl w-full p-6 rounded-2xl shadow-2xl border space-y-4 ${
            isDarkMode ? "bg-[#1E293B] border-slate-700 text-slate-100" : "bg-white border-gray-200 text-gray-900"
          }`}>
            <div className={`flex items-center justify-between border-b pb-3 ${isDarkMode ? "border-slate-700/60" : "border-gray-200"}`}>
              <div>
                <h3 className={`font-bold text-sm ${isDarkMode ? "text-white" : "text-gray-900"}`}>
                  เลือก Operator ประจำตำแหน่ง: {operatorModal.label}
                </h3>
                <div className="flex items-center gap-2 text-[11px] font-medium mt-0.5">
                  <span className={`px-2 py-0.5 rounded font-bold text-[10px] ${
                    selectedShift === 'a' 
                      ? 'bg-amber-500/20 text-amber-500 border border-amber-500/30' 
                      : 'bg-indigo-500/20 text-indigo-500 border border-indigo-500/30'
                  }`}>
                    {selectedShift === 'a' ? 'Shift A (กะ A)' : 'Shift B (กะ B)'}
                  </span>
                  {operatorModal.assigned_station ? (
                    <span className="text-purple-600 dark:text-purple-400 font-mono">
                      Station: <strong>{operatorModal.assigned_station}</strong> (Line {selectedLine})
                    </span>
                  ) : (
                    <span className="text-gray-400 italic">(ไม่ได้ผูกสถานี)</span>
                  )}
                </div>
              </div>
              <button onClick={() => setOperatorModal(null)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-sm">✕</button>
            </div>

            <div className={`p-3 rounded-xl border text-xs space-y-2 ${
              isDarkMode ? "bg-[#0F172A]/70 border-slate-700/60" : "bg-gray-50 border-gray-200"
            }`}>
              <div className="flex items-center justify-between">
                <span className={`font-bold text-[11px] ${isDarkMode ? "text-gray-300" : "text-gray-800"}`}>
                  เกณฑ์คะแนนประจำสถานี {operatorModal.assigned_station || "-"} บน Line {selectedLine}:
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => fetchStationCriteriaAndScores(operatorModal.assigned_station, true)}
                    className="text-[10px] text-blue-500 hover:underline font-semibold flex items-center gap-1"
                    title="ล้างแคชและดึงข้อมูลไฟล์ Excel ใหม่"
                  >
                    รีเฟรชข้อมูล
                  </button>
                  {requiredExams.length > 0 && (
                    <div className="flex items-center gap-3 text-[10px]">
                      <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                        [บังคับ] {requiredExams.filter(e => e.is_required !== false).length}
                      </span>
                      {requiredExams.some(e => e.is_required === false) && (
                        <span className="text-cyan-600 dark:text-cyan-400 font-semibold">
                          [แนะนำ] {requiredExams.filter(e => e.is_required === false).length}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {loadingStationExams ? (
                <p className="text-gray-400 text-[11px] animate-pulse">กำลังโหลดเกณฑ์ข้อสอบ...</p>
              ) : requiredExams.length === 0 ? (
                <p className="text-gray-500 dark:text-gray-400 text-[11px] italic">ไม่มีเงื่อนไขข้อสอบ (สามารถจัดพนักงานลงได้ทุกคน)</p>
              ) : (
                <div className="flex flex-wrap gap-2 pt-0.5">
                  {requiredExams.map((ex, idx) => {
                    const isReq = ex.is_required !== false;
                    return (
                      <div
                        key={idx}
                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold border ${
                          isReq
                            ? isDarkMode ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/40" : "bg-emerald-50 text-emerald-800 border-emerald-300"
                            : isDarkMode ? "bg-cyan-500/10 text-cyan-300 border-cyan-500/40" : "bg-cyan-50 text-cyan-800 border-cyan-300"
                        }`}
                      >
                        <span className={`px-1.5 py-0.2 text-[9px] rounded font-bold uppercase ${
                          isReq 
                            ? isDarkMode ? "bg-emerald-500/20 text-emerald-400" : "bg-emerald-200 text-emerald-900"
                            : isDarkMode ? "bg-cyan-500/20 text-cyan-400" : "bg-cyan-200 text-cyan-900"
                        }`}>
                          {isReq ? "Required" : "Optional"}
                        </span>
                        <span className="truncate max-w-[180px]">
                          {ex.file_name ? ex.file_name.replace(".xlsx", "") : ex.config_key}
                        </span>
                        <span className="font-mono font-bold">
                          ≥ {ex.min_score}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="relative flex-1 w-full">
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="ค้นหารหัส หรือ ชื่อพนักงาน..."
                  className={`w-full p-2.5 pl-4 rounded-xl border text-xs outline-none font-semibold ${
                    isDarkMode 
                      ? "bg-slate-800 border-slate-700 text-white placeholder-slate-500" 
                      : "bg-gray-50 border-gray-300 text-gray-900 placeholder-gray-400 focus:bg-white"
                  }`}
                />
              </div>
            </div>

            <div className={`max-h-72 overflow-y-auto space-y-1.5 p-1.5 rounded-xl border ${
              isDarkMode ? "border-slate-700/60 bg-slate-900/40" : "border-gray-200 bg-gray-50/50"
            }`}>
              {loadingOperators ? (
                <div className="p-8 text-center text-xs text-gray-500">กำลังโหลดคะแนนสอบ...</div>
              ) : isSavingAssignment ? (
                <div className="p-8 text-center text-blue-500 font-bold animate-pulse">กำลังบันทึกข้อมูล...</div>
              ) : filteredOperators.length === 0 ? (
                <div className="p-8 text-center text-xs text-gray-500">
                  {onlyPassedFilter && requiredExams.some(e => e.is_required !== false)
                    ? "ไม่พบพนักงานที่ผ่านเกณฑ์บังคับ"
                    : "ไม่พบรายชื่อพนักงาน"}
                </div>
              ) : (
                filteredOperators.map((op, idx) => (
                  <div
                    key={idx}
                    onClick={() => handleSelectOperator(op, op.isPassed, false)}
                    className={`flex items-center justify-between p-3 rounded-xl border cursor-pointer transition-all gap-4 ${
                      op.isPassed
                        ? isDarkMode
                          ? "bg-slate-800/80 border-slate-700 hover:bg-emerald-950/20 hover:border-emerald-500"
                          : "bg-white border-gray-200 hover:bg-emerald-50 hover:border-emerald-400 shadow-sm"
                        : isDarkMode
                        ? "bg-slate-900/30 border-slate-800/60 opacity-60 hover:opacity-100 hover:border-rose-500/40"
                        : "bg-gray-100/60 border-gray-200 opacity-60 hover:opacity-100 hover:border-rose-300"
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-[240px] max-w-[340px] shrink-0">
                      <div className={`w-8 h-8 rounded-lg border flex items-center justify-center font-bold text-xs shrink-0 ${
                        op.isPassed
                          ? isDarkMode ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" : "bg-emerald-100 border-emerald-300 text-emerald-800"
                          : isDarkMode ? "bg-rose-500/10 border-rose-500/30 text-rose-400" : "bg-rose-100 border-rose-300 text-rose-800"
                      }`}>
                        {op.name ? op.name.charAt(0).toUpperCase() : "OP"}
                      </div>
                      <div className="overflow-hidden">
                        <p className={`font-bold text-xs whitespace-nowrap truncate ${isDarkMode ? "text-slate-100" : "text-gray-900"}`} title={op.name || "ไม่ระบุชื่อ"}>
                          {op.name || "ไม่ระบุชื่อ"}
                        </p>
                        <p className={`text-[10px] font-mono whitespace-nowrap ${isDarkMode ? "text-gray-400" : "text-gray-600 font-medium"}`}>
                          ID: #{op.employeeId || "-"}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 flex-wrap justify-end">
                      {op.examDetails.length > 0 ? (
                        op.examDetails.map((ex, eIdx) => {
                          const isReq = ex.is_required !== false;
                          const examTitle = ex.file_name ? ex.file_name.replace(".xlsx", "") : ex.config_key;
                          const scoreText = ex.userScore !== null ? `${ex.userScore}/${ex.min_score}` : "N/A";

                          return (
                            <span
                              key={eIdx}
                              className={`text-[10px] font-mono px-2 py-0.5 rounded border font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                                isReq
                                  ? ex.passed
                                    ? isDarkMode ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/40" : "bg-emerald-50 text-emerald-800 border-emerald-300"
                                    : isDarkMode ? "bg-rose-500/15 text-rose-400 border-rose-500/40" : "bg-rose-50 text-rose-800 border-rose-300"
                                  : ex.passed
                                  ? isDarkMode ? "bg-cyan-500/15 text-cyan-400 border-cyan-500/40" : "bg-cyan-50 text-cyan-800 border-cyan-300"
                                  : isDarkMode ? "bg-slate-800 text-slate-400 border-slate-700" : "bg-gray-100 text-gray-600 border-gray-300"
                              }`}
                              title={`${isReq ? '[บังคับ]' : '[แนะนำ]'} ${examTitle}: ได้ ${ex.userScore ?? 0} (เกณฑ์ ≥ ${ex.min_score})`}
                            >
                              <span className="text-[9px] font-sans font-bold opacity-80 uppercase">
                                {isReq ? "REQ" : "OPT"}
                              </span>
                              <span className="max-w-[120px] truncate">{examTitle}</span>
                              <span className="font-bold">{scoreText}</span>
                            </span>
                          );
                        })
                      ) : (
                        <span className={`text-[10px] italic whitespace-nowrap ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>
                          พร้อมปฏิบัติงาน
                        </span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className={`flex items-center justify-between pt-2 border-t ${isDarkMode ? "border-slate-700/40" : "border-gray-200"}`}>
              <button
                type="button"
                onClick={handleClearAssignment}
                className="px-3 py-1.5 rounded-xl text-xs font-semibold text-rose-600 hover:bg-rose-500/10 transition-colors"
              >
                ล้างพนักงานออกจากตำแหน่ง
              </button>

              <button
                onClick={() => setOperatorModal(null)}
                className={`px-4 py-2 rounded-xl text-xs font-semibold border ${
                  isDarkMode 
                    ? "border-slate-700 text-slate-300 hover:bg-slate-800" 
                    : "border-gray-300 text-gray-700 hover:bg-gray-100"
                }`}
              >
                ปิด
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Top Controls Bar */}
      <div className={`p-4 rounded-2xl border shadow-sm flex flex-wrap items-center justify-between gap-3 shrink-0 transition-colors ${
        isDarkMode ? "bg-[#1E293B] border-slate-700/60" : "bg-white border-gray-200"
      }`}>
        <div className="flex items-center gap-3 flex-wrap">
          <span className={`font-bold text-sm ${isDarkMode ? "text-white" : "text-gray-900"}`}>
            Production Layout View
          </span>

          <span className={`px-2.5 py-0.5 rounded text-[10px] font-bold uppercase border ${
            canManageLine
              ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
              : "bg-slate-500/10 text-slate-500 dark:text-slate-400 border-slate-500/20"
          }`}>
            {canManageLine ? "Management Access (Editable)" : "Read-only"}
          </span>

          <select
            value={selectedLine}
            onChange={(e) => setSelectedLine(e.target.value)}
            disabled={loadingLines}
            className={`px-3 py-1.5 rounded-xl border text-xs font-semibold focus:outline-none cursor-pointer ${
              isDarkMode 
                ? "bg-slate-800 border-slate-700 text-white" 
                : "bg-gray-50 border-gray-300 text-gray-900 focus:bg-white"
            }`}
          >
            {lines.map((line) => (
              <option key={line.id} value={line.id}>
                Line: {line.id}
              </option>
            ))}
          </select>

          <div className={`flex items-center p-1 rounded-xl border ${
            isDarkMode ? "border-slate-700/50 bg-slate-800/40" : "border-gray-300 bg-gray-100"
          }`}>
            <button
              type="button"
              onClick={() => setSelectedShift("a")}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                selectedShift === "a"
                  ? "bg-amber-500 text-slate-900 shadow-md font-extrabold"
                  : isDarkMode
                  ? "text-slate-400 hover:text-slate-200"
                  : "text-gray-600 hover:text-gray-900"
              }`}
            >
              กะ A
            </button>
            <button
              type="button"
              onClick={() => setSelectedShift("b")}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                selectedShift === "b"
                  ? "bg-indigo-600 text-white shadow-md font-extrabold"
                  : isDarkMode
                  ? "text-slate-400 hover:text-slate-200"
                  : "text-gray-600 hover:text-gray-900"
              }`}
            >
              กะ B
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {selectedElement && (
            <div className="flex items-center gap-2 px-3 py-1 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-600 dark:text-blue-400 text-xs font-medium">
              <span>{selectedElement.type === "station" ? "Station:" : selectedElement.type === "image" ? "Image:" : "Operator:"}</span>
              <strong className={`font-bold ${isDarkMode ? "text-white" : "text-gray-900"}`}>{selectedElement.label}</strong>
              
              {(selectedElement.type === "operator" || selectedElement.type === "image") && (
                <button
                  type="button"
                  onClick={() => openFullImage(selectedElement)}
                  className="px-2 py-0.5 rounded bg-blue-500 text-white text-[11px] font-bold hover:bg-blue-600 transition-colors ml-1"
                >
                  ดูรูปเต็ม
                </button>
              )}

              {selectedElement.assigned_station && (
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-700 dark:text-purple-300 border border-purple-500/30">
                  {selectedElement.assigned_station}
                </span>
              )}
              <button
                onClick={() => setSelectedElement(null)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-white ml-2 text-xs"
              >
                ✕
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={toggleFullscreen}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shadow-sm ${
              isFullscreen
                ? "bg-purple-600 hover:bg-purple-500 text-white"
                : isDarkMode
                ? "bg-slate-800 hover:bg-slate-700 text-white border border-slate-700"
                : "bg-gray-100 hover:bg-gray-200 text-gray-800 border border-gray-300"
            }`}
          >
            <span>{isFullscreen ? "✕" : "Fullscreen"}</span>
          </button>
        </div>
      </div>

      {/* Canvas Viewport */}
      <div className="flex-1 relative overflow-hidden rounded-2xl border min-h-[620px]">
        <div
          ref={canvasContainerRef}
          className={`w-full h-full relative overflow-hidden cursor-default ${
            isDarkMode ? "bg-[#0F172A] border-slate-700/60" : "bg-[#F8FAFC] border-gray-200"
          }`}
        >
          <div
            style={{
              position: "absolute",
              width: "10000px",
              height: "10000px",
              transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoomScale})`,
              transformOrigin: "0 0",
              transition: "transform 0.2s ease-out",
            }}
          >
            {loadingLayout ? (
              <div className="p-20 text-xs text-gray-400 font-semibold">
                กำลังโหลด Layout ของ Line {selectedLine} (กะ: {selectedShift === 'a' ? 'A' : 'B'})...
              </div>
            ) : elements.length === 0 ? (
              <div className="p-20 text-xs text-gray-400 font-semibold">
                ยังไม่มีการจัดวาง Layout สำหรับ Line {selectedLine}
              </div>
            ) : (
              elements.map((item) => {
                const isSelected = selectedElement?.id === item.id;
                const customFontSize = item.fontSize ? `${item.fontSize}px` : (item.type === "station" ? "13px" : "11px");

                const employeeId = item.operator_id;
                const operatorImageSrc = employeeId ? `/api/operator-images/${employeeId}.png` : null;

                // 1. เรนเดอร์ประเภทรูปภาพ (Layout Image)
                if (item.type === "image") {
                  return (
                    <div
                      key={item.id}
                      onClick={(e) => handleItemClick(e, item)}
                      style={{
                        position: "absolute",
                        left: `${item.x}px`,
                        top: `${item.y}px`,
                        width: `${item.width}px`,
                        height: `${item.height}px`,
                        zIndex: 1,
                        pointerEvents: "auto",
                        cursor: "pointer",
                        borderRadius: item.borderRadius !== undefined ? `${item.borderRadius}px` : "8px",
                        borderWidth: item.borderWidth !== undefined ? `${item.borderWidth}px` : "0px",
                        borderColor: item.borderColor || "transparent",
                        borderStyle: "solid",
                        overflow: "hidden",
                      }}
                      title="ดับเบิ้ลคลิกเพื่อดูรูปภาพขยาย"
                      className="select-none hover:opacity-90 transition-opacity group relative"
                    >
                      <img
                        src={item.src}
                        alt={item.label || "Layout Image"}
                        className="w-full h-full"
                        style={{ objectFit: item.objectFit || "contain" }}
                        draggable={false}
                      />
                      {item.label && (
                        <span className="absolute bottom-1 bg-black/60 text-white font-mono text-[9px] px-1 rounded truncate max-w-[90%] left-1/2 -translate-x-1/2">
                          {item.label}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openFullImage(item);
                        }}
                        className="absolute top-1 right-1 w-6 h-6 bg-black/60 hover:bg-black/80 rounded-full text-white text-[11px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        title="ดูรูปภาพเต็ม"
                      >
                        ดูรูป
                      </button>
                    </div>
                  );
                }

                // 2. เรนเดอร์ประเภท Station
                if (item.type === "station") {
                  return (
                    <div
                      key={item.id}
                      onClick={(e) => handleItemClick(e, item)}
                      style={{
                        position: "absolute",
                        left: `${item.x}px`,
                        top: `${item.y}px`,
                        width: `${item.width}px`,
                        height: `${item.height}px`,
                        backgroundColor: item.bgColor || "#ffffff",
                        borderColor: item.borderColor || "#2563eb",
                        color: item.textColor || "#1e293b",
                        fontSize: customFontSize,
                        zIndex: isSelected ? 40 : 20,
                        pointerEvents: "auto",
                      }}
                      className={`flex flex-col items-center justify-center font-bold select-none text-center px-1 border-2 rounded-lg transition-all ${
                        isSelected
                          ? "ring-4 ring-blue-500/40 shadow-2xl scale-105"
                          : "shadow-sm hover:shadow-md hover:scale-[1.02]"
                      }`}
                    >
                      <span className="truncate max-w-full leading-tight px-1">{item.label}</span>
                    </div>
                  );
                }

                // 3. เรนเดอร์ประเภท Operator
                const hasAssigned = Boolean(employeeId);
                const displayName = item.operator_name || item.label || "OP";

                return (
                  <div
                    key={item.id}
                    onClick={(e) => handleItemClick(e, item)}
                    style={{
                      position: "absolute",
                      left: `${item.x}px`,
                      top: `${item.y}px`,
                      width: `${item.width}px`,
                      height: `${item.height}px`,
                      zIndex: isSelected ? 40 : 30,
                      pointerEvents: "auto",
                      cursor: "pointer",
                    }}
                    title={canManageLine ? "ดับเบิ้ลคลิกเพื่อมอบหมายพนักงาน" : "ดับเบิ้ลคลิกเพื่อดูรูปขยาย"}
                    className="relative select-none flex flex-col items-center group"
                  >
                    <div
                      style={{
                        width: `${item.width}px`,
                        height: `${item.height}px`,
                        borderColor: item.borderColor || "#9333ea",
                        backgroundColor: item.bgColor || "#ffffff",
                      }}
                      className={`w-full h-full rounded-full border-2 overflow-hidden flex items-center justify-center shadow-md transition-all relative ${
                        isSelected
                          ? "ring-4 ring-purple-500/50 shadow-2xl scale-105"
                          : "hover:shadow-lg hover:scale-105"
                      }`}
                    >
                      <img
                        src={operatorImageSrc || defaultAvatar}
                        alt="Operator"
                        className="w-full h-full object-cover"
                        loading="lazy"
                        onLoad={(e) => {
                          e.target.style.opacity = "1";
                        }}
                        onError={(e) => {
                          e.target.onerror = null;
                          e.target.src = defaultAvatar;
                        }}
                      />

                      {!hasAssigned && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/20 text-white font-bold text-xs">
                          OP
                        </div>
                      )}

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openFullImage(item);
                        }}
                        className="absolute top-1 right-1 w-6 h-6 bg-black/60 hover:bg-black/80 rounded-full text-white text-[10px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10"
                        title="ดูรูปภาพพนักงาน"
                      >
                        ดูรูป
                      </button>
                    </div>

                    <div className="absolute -bottom-20 left-1/2 -translate-x-1/2 whitespace-nowrap pointer-events-none flex flex-col items-center">
                      <span
                        style={{ fontSize: '35px' }}
                        className={`font-bold px-2 py-0.5 rounded-md shadow-sm border ${
                          isDarkMode
                            ? "bg-slate-900/90 text-slate-100 border-slate-700"
                            : "bg-white/95 text-gray-900 border-gray-300"
                        }`}
                      >
                        {displayName}
                      </span>

                      {item.assigned_station && (
                        <span
                          style={{ fontSize: '25px' }}
                          className="font-mono font-bold px-1.5 py-0.2 rounded-md bg-purple-500/20 text-purple-700 dark:text-purple-300 border border-purple-500/30 whitespace-nowrap shadow-sm mt-0.5"
                        >
                          {item.assigned_station}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}