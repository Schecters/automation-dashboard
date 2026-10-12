import React, { useState, useEffect, useRef, useCallback } from "react";

export default function LayoutEditorContent({ isDarkMode }) {
  const [lines, setLines] = useState([]);
  const [selectedLine, setSelectedLine] = useState("");
  const [loadingLines, setLoadingLines] = useState(false);
  const [loadingLayout, setLoadingLayout] = useState(false);

  const [stationsList, setStationsList] = useState([]);
  const [loadingStations, setLoadingStations] = useState(false);

  const [elements, setElements] = useState([]);

  // Undo / Redo State
  const [history, setHistory] = useState([[]]);
  const [historyIndex, setHistoryIndex] = useState(0);

  // Clipboard State
  const [hasClipboard, setHasClipboard] = useState(false);
  const clipboardRef = useRef([]);

  // Selected State
  const [selectedIds, setSelectedIds] = useState([]);
  const [editModal, setEditModal] = useState(null);

  const [copyLineModalOpen, setCopyLineModalOpen] = useState(false);
  const [targetLine, setTargetLine] = useState("");
  const [isCopying, setIsCopying] = useState(false);

  const [isFullscreen, setIsFullscreen] = useState(false);

  // Pan & Zoom
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [zoomScale, setZoomScale] = useState(1);
  const [isPanning, setIsPanning] = useState(false);

  // 🟢 Ref สำหรับรองรับ Pinch-to-Zoom บนโทรศัพท์มือถือ
  const lastTouchDistanceRef = useRef(null);

  const GRID_SIZE = 20;

  const canvasContainerRef = useRef(null);
  const mainWorkspaceRef = useRef(null);
  const isSpacePressedRef = useRef(false);
  const imageUploadInputRef = useRef(null);

  const API_URL = `/api`;

  const clampPan = (x, y) => ({
    x: Math.min(0, Math.round(x)),
    y: Math.min(0, Math.round(y)),
  });

  const actionRef = useRef({
    mode: null,
    resizeHandle: null,
    startX: 0,
    startY: 0,
    initialPanX: 0,
    initialPanY: 0,
    initialElementsMap: new Map(),
    initialGroupBounds: null,
    hasChanged: false,
  });

  const colorPresets = [
    { label: "Default Blue", bg: "#ffffff", border: "#2563eb", text: "#1e293b" },
    { label: "Emerald Green", bg: "#f0fdf4", border: "#16a34a", text: "#14532d" },
    { label: "Purple OP", bg: "#faf5ff", border: "#9333ea", text: "#581c87" },
    { label: "Amber Warning", bg: "#fffbeb", border: "#d97706", text: "#78350f" },
    { label: "Rose Hazard", bg: "#fff1f2", border: "#e11d48", text: "#881337" },
    { label: "Dark Slate", bg: "#1e293b", border: "#475569", text: "#f8fafc" },
  ];

  const getAuthHeaders = (isMultipart = false) => {
    const token = localStorage.getItem("token") || localStorage.getItem("sessionToken");
    const headers = {
      Authorization: `Bearer ${token}`,
      "x-session-token": token,
    };
    if (!isMultipart) {
      headers["Content-Type"] = "application/json";
    }
    return headers;
  };

  const pushStateToHistory = (newElements) => {
    setHistory((prevHistory) => {
      const updatedHistory = prevHistory.slice(0, historyIndex + 1);
      return [...updatedHistory, newElements];
    });
    setHistoryIndex((prevIndex) => prevIndex + 1);
  };

  const handleUndo = useCallback(() => {
    if (historyIndex > 0) {
      const prevIndex = historyIndex - 1;
      const prevElements = history[prevIndex];
      setHistoryIndex(prevIndex);
      setElements(prevElements);
      setSelectedIds([]);
    }
  }, [history, historyIndex]);

  const handleRedo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      const nextIndex = historyIndex + 1;
      const nextElements = history[nextIndex];
      setHistoryIndex(nextIndex);
      setElements(nextElements);
      setSelectedIds([]);
    }
  }, [history, historyIndex]);

  const handleCopy = useCallback(() => {
    if (selectedIds.length === 0) return;
    const selectedElems = elements.filter((el) => selectedIds.includes(el.id));
    clipboardRef.current = selectedElems;
    setHasClipboard(selectedElems.length > 0);
  }, [elements, selectedIds]);

  const handlePaste = useCallback(() => {
    if (!clipboardRef.current || clipboardRef.current.length === 0) return;

    const offset = 40;
    const newSelectedIds = [];
    const newPastedElements = clipboardRef.current.map((item, index) => {
      const newId = `elem_${Date.now()}_${index}`;
      newSelectedIds.push(newId);
      return {
        ...item,
        id: newId,
        x: item.x + offset,
        y: item.y + offset,
      };
    });

    setElements((prev) => {
      const updated = [...prev, ...newPastedElements];
      pushStateToHistory(updated);
      return updated;
    });

    setSelectedIds(newSelectedIds);
    clipboardRef.current = newPastedElements;
  }, [historyIndex]);

  // 🟢 ฟังก์ชันส่งวัตถุที่เลือกไปไว้หลังสุด (Send to Back)
  const handleSendToBack = useCallback(() => {
    if (selectedIds.length === 0) return;
    const selected = elements.filter((el) => selectedIds.includes(el.id));
    const unselected = elements.filter((el) => !selectedIds.includes(el.id));
    const reordered = [...selected, ...unselected];
    setElements(reordered);
    pushStateToHistory(reordered);
  }, [elements, selectedIds]);

  // 🟢 ฟังก์ชันดึงวัตถุที่เลือกขึ้นมาหน้าสุด (Bring to Front)
  const handleBringToFront = useCallback(() => {
    if (selectedIds.length === 0) return;
    const selected = elements.filter((el) => selectedIds.includes(el.id));
    const unselected = elements.filter((el) => !selectedIds.includes(el.id));
    const reordered = [...unselected, ...selected];
    setElements(reordered);
    pushStateToHistory(reordered);
  }, [elements, selectedIds]);

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

  const fetchStationsByLine = async (lineId) => {
    if (!lineId) {
      setStationsList([]);
      return;
    }
    setLoadingStations(true);
    try {
      const res = await fetch(`${API_URL}/lines/${encodeURIComponent(lineId)}/stations`, {
        headers: getAuthHeaders(),
      });
      const result = await res.json();
      const list = (result.success && Array.isArray(result.data)) ? result.data : [];
      setStationsList(list);
    } catch (err) {
      console.error("Fetch Line Stations Error:", err);
      setStationsList([]);
    } finally {
      setLoadingStations(false);
    }
  };

  const fitAllElements = useCallback((elems = elements) => {
    if (!canvasContainerRef.current || !elems || elems.length === 0) {
      setPanOffset({ x: 0, y: 0 });
      setZoomScale(1);
      return;
    }

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

    const currentScale = Number(optimalScale.toFixed(2));
    const targetPanX = -minX * currentScale + 20;
    const targetPanY = -minY * currentScale + 20;

    setZoomScale(currentScale);
    setPanOffset(clampPan(targetPanX, targetPanY));
  }, [elements]);

  const fetchLayoutByLine = async (lineId) => {
    if (!lineId) return;
    setLoadingLayout(true);
    try {
      const res = await fetch(`${API_URL}/layout/${encodeURIComponent(lineId)}`, {
        headers: getAuthHeaders(),
      });
      const result = await res.json();
      if (res.ok && result.success && Array.isArray(result.data) && result.data.length > 0) {
        setElements(result.data);
        setHistory([result.data]);
        setHistoryIndex(0);
        setTimeout(() => fitAllElements(result.data), 80);
      } else {
        setElements([]);
        setHistory([[]]);
        setHistoryIndex(0);
        setPanOffset({ x: 0, y: 0 });
        setZoomScale(1);
      }
    } catch (err) {
      console.error("Fetch Layout Error:", err);
    } finally {
      setLoadingLayout(false);
    }
  };

  useEffect(() => {
    fetchLines();
  }, []);

  useEffect(() => {
    if (selectedLine) {
      setSelectedIds([]);
      fetchLayoutByLine(selectedLine);
      fetchStationsByLine(selectedLine);
    }
  }, [selectedLine]);

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
      setTimeout(() => fitAllElements(), 150);
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, [fitAllElements]);

  const saveLayout = async () => {
    if (!selectedLine) return;
    try {
      const token = localStorage.getItem("token") || localStorage.getItem("sessionToken");
      const res = await fetch(`${API_URL}/layout/${encodeURIComponent(selectedLine)}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "x-session-token": token,
        },
        body: JSON.stringify({ elements }),
      });
      const result = await res.json();
      if (res.ok && result.success) {
        alert(`บันทึก Layout ของ [${selectedLine}] สำเร็จ!`);
      } else {
        alert("ไม่สามารถบันทึกได้: " + (result.error || "เกิดข้อผิดพลาด"));
      }
    } catch (err) {
      alert("เชื่อมต่อ Server เพื่อบันทึกข้อมูลไม่ได้");
    }
  };

  const handleCopyLayoutToLine = async () => {
    if (!targetLine || targetLine === selectedLine) {
      alert("กรุณาเลือก Line ปลายทางที่ต่างจาก Line ปัจจุบัน");
      return;
    }

    if (!window.confirm(`ยืนยันการคัดลอก Layout จาก [${selectedLine}] ไปยัง [${targetLine}] ใช่หรือไม่?`)) {
      return;
    }

    setIsCopying(true);
    try {
      const token = localStorage.getItem("token") || localStorage.getItem("sessionToken");
      const res = await fetch(`${API_URL}/layout/${encodeURIComponent(targetLine)}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "x-session-token": token,
        },
        body: JSON.stringify({ elements }),
      });
      const result = await res.json();
      if (res.ok && result.success) {
        alert(`คัดลอกผังจาก [${selectedLine}] ไปยัง [${targetLine}] เรียบร้อย!`);
        setCopyLineModalOpen(false);
        setSelectedLine(targetLine);
      } else {
        alert("ไม่สามารถคัดลอกได้: " + (result.error || "เกิดข้อผิดพลาด"));
      }
    } catch (err) {
      alert("เชื่อมต่อ Server ไม่สำเร็จ");
    } finally {
      setIsCopying(false);
    }
  };

  const resetPanAndZoom = () => {
    setPanOffset({ x: 0, y: 0 });
    setZoomScale(1);
  };

  const getSelectedGroupBounds = useCallback(() => {
    const selectedElems = elements.filter((el) => selectedIds.includes(el.id));
    if (selectedElems.length === 0) return null;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    selectedElems.forEach((el) => {
      minX = Math.min(minX, el.x);
      minY = Math.min(minY, el.y);
      maxX = Math.max(maxX, el.x + el.width);
      maxY = Math.max(maxY, el.y + el.height);
    });

    return {
      minX,
      minY,
      maxX,
      maxY,
      width: maxX - minX,
      height: maxY - minY,
    };
  }, [elements, selectedIds]);

  // 🟢 รองรับ Pointer / Touch บน Canvas พื้นหลัง
  const handleCanvasPointerDown = (e) => {
    if (e.target === canvasContainerRef.current || e.button === 1 || isSpacePressedRef.current || e.pointerType === "touch") {
      if (!e.shiftKey && !e.ctrlKey && e.pointerType !== "touch") {
        setSelectedIds([]);
      }
      setIsPanning(true);
      actionRef.current = {
        mode: "pan",
        startX: e.clientX,
        startY: e.clientY,
        initialPanX: panOffset.x,
        initialPanY: panOffset.y,
        hasChanged: false,
      };
    }
  };

  // 🟢 รองรับ Pointer / Touch เมื่อกดที่ Element
  const handleElementPointerDown = (e, item) => {
    if (isSpacePressedRef.current || e.button === 1) return;
    e.stopPropagation();

    let newSelectedIds = [...selectedIds];

    if (e.shiftKey || e.ctrlKey) {
      if (newSelectedIds.includes(item.id)) {
        newSelectedIds = newSelectedIds.filter((id) => id !== item.id);
      } else {
        newSelectedIds.push(item.id);
      }
    } else {
      if (!newSelectedIds.includes(item.id)) {
        newSelectedIds = [item.id];
      }
    }

    setSelectedIds(newSelectedIds);

    const elemMap = new Map();
    elements.forEach((el) => {
      if (newSelectedIds.includes(el.id)) {
        elemMap.set(el.id, { x: el.x, y: el.y, width: el.width, height: el.height });
      }
    });

    actionRef.current = {
      mode: "drag",
      activeId: item.id,
      startX: e.clientX,
      startY: e.clientY,
      initialElementsMap: elemMap,
      hasChanged: false,
    };
  };

  const handleResizeStart = (e, handleDirection) => {
    e.stopPropagation();
    if (selectedIds.length === 0) return;

    const elemMap = new Map();
    elements.forEach((el) => {
      if (selectedIds.includes(el.id)) {
        elemMap.set(el.id, { x: el.x, y: el.y, width: el.width, height: el.height });
      }
    });

    actionRef.current = {
      mode: "resize",
      resizeHandle: handleDirection,
      startX: e.clientX,
      startY: e.clientY,
      initialElementsMap: elemMap,
      initialGroupBounds: getSelectedGroupBounds(),
      hasChanged: false,
    };
  };

  // 🟢 ตรวจจับการใช้ 2 นิ้วขยาย/ย่อ (Pinch-to-Zoom)
  const handleTouchStart = (e) => {
    if (e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      lastTouchDistanceRef.current = dist;
      actionRef.current.mode = "pinch";
    }
  };

  const handleTouchMove = (e) => {
    if (actionRef.current.mode === "pinch" && e.touches.length === 2) {
      e.preventDefault();
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      if (lastTouchDistanceRef.current) {
        const delta = dist - lastTouchDistanceRef.current;
        const zoomDelta = delta * 0.005;
        setZoomScale((prev) => Math.min(2.5, Math.max(0.1, Number((prev + zoomDelta).toFixed(2)))));
      }
      lastTouchDistanceRef.current = dist;
    }
  };

  const handleTouchEnd = () => {
    lastTouchDistanceRef.current = null;
    if (actionRef.current.mode === "pinch") {
      actionRef.current.mode = null;
    }
  };

  useEffect(() => {
    const canvasContainer = canvasContainerRef.current;
    if (!canvasContainer) return;

    const onWheelPrevent = (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.ctrlKey || e.metaKey) {
        const zoomDelta = e.deltaY > 0 ? -0.08 : 0.08;
        setZoomScale((prev) => Math.min(2.5, Math.max(0.1, Number((prev + zoomDelta).toFixed(2)))));
      } else {
        setPanOffset((prev) => clampPan(prev.x - e.deltaX, prev.y - e.deltaY));
      }
    };

    canvasContainer.addEventListener("wheel", onWheelPrevent, { passive: false });
    return () => canvasContainer.removeEventListener("wheel", onWheelPrevent);
  }, []);

  useEffect(() => {
    const handleMove = (e) => {
      if (!actionRef.current.mode || actionRef.current.mode === "pinch") return;

      const clientX = e.clientX ?? (e.touches && e.touches[0]?.clientX);
      const clientY = e.clientY ?? (e.touches && e.touches[0]?.clientY);
      if (clientX === undefined || clientY === undefined) return;

      const { mode, startX, startY, initialPanX, initialPanY, initialElementsMap, resizeHandle, initialGroupBounds } = actionRef.current;

      if (mode === "pan") {
        setPanOffset(clampPan(initialPanX + (clientX - startX), initialPanY + (clientY - startY)));
      } else if (mode === "drag") {
        const deltaX = (clientX - startX) / zoomScale;
        const deltaY = (clientY - startY) / zoomScale;

        const snappedDeltaX = Math.round(deltaX / GRID_SIZE) * GRID_SIZE;
        const snappedDeltaY = Math.round(deltaY / GRID_SIZE) * GRID_SIZE;

        if (snappedDeltaX !== 0 || snappedDeltaY !== 0) {
          actionRef.current.hasChanged = true;
        }

        setElements((prev) =>
          prev.map((elem) => {
            if (initialElementsMap.has(elem.id)) {
              const init = initialElementsMap.get(elem.id);
              return {
                ...elem,
                x: Math.max(0, init.x + snappedDeltaX),
                y: Math.max(0, init.y + snappedDeltaY),
              };
            }
            return elem;
          })
        );
      } else if (mode === "resize" && initialGroupBounds) {
        const deltaX = (clientX - startX) / zoomScale;
        const deltaY = (clientY - startY) / zoomScale;

        let newGroupMinX = initialGroupBounds.minX;
        let newGroupMinY = initialGroupBounds.minY;
        let newGroupWidth = initialGroupBounds.width;
        let newGroupHeight = initialGroupBounds.height;

        if (resizeHandle.includes("e")) {
          newGroupWidth = Math.max(40, initialGroupBounds.width + deltaX);
        }
        if (resizeHandle.includes("s")) {
          newGroupHeight = Math.max(40, initialGroupBounds.height + deltaY);
        }
        if (resizeHandle.includes("w")) {
          const maxDeltaW = initialGroupBounds.width - 40;
          const appliedDeltaX = Math.min(deltaX, maxDeltaW);
          newGroupMinX = initialGroupBounds.minX + appliedDeltaX;
          newGroupWidth = initialGroupBounds.width - appliedDeltaX;
        }
        if (resizeHandle.includes("n")) {
          const maxDeltaH = initialGroupBounds.height - 40;
          const appliedDeltaY = Math.min(deltaY, maxDeltaH);
          newGroupMinY = initialGroupBounds.minY + appliedDeltaY;
          newGroupHeight = initialGroupBounds.height - appliedDeltaY;
        }

        const scaleXRatio = newGroupWidth / (initialGroupBounds.width || 1);
        const scaleYRatio = newGroupHeight / (initialGroupBounds.height || 1);

        actionRef.current.hasChanged = true;

        setElements((prev) =>
          prev.map((elem) => {
            if (initialElementsMap.has(elem.id)) {
              const init = initialElementsMap.get(elem.id);

              if (initialElementsMap.size === 1) {
                return {
                  ...elem,
                  x: Math.max(0, Math.round(newGroupMinX / GRID_SIZE) * GRID_SIZE),
                  y: Math.max(0, Math.round(newGroupMinY / GRID_SIZE) * GRID_SIZE),
                  width: Math.max(40, Math.round(newGroupWidth / GRID_SIZE) * GRID_SIZE),
                  height: Math.max(40, Math.round(newGroupHeight / GRID_SIZE) * GRID_SIZE),
                };
              } else {
                const relativeX = (init.x - initialGroupBounds.minX) * scaleXRatio;
                const relativeY = (init.y - initialGroupBounds.minY) * scaleYRatio;
                const newW = Math.max(30, init.width * scaleXRatio);
                const newH = Math.max(30, init.height * scaleYRatio);

                return {
                  ...elem,
                  x: Math.max(0, Math.round((newGroupMinX + relativeX) / GRID_SIZE) * GRID_SIZE),
                  y: Math.max(0, Math.round((newGroupMinY + relativeY) / GRID_SIZE) * GRID_SIZE),
                  width: Math.round(newW / GRID_SIZE) * GRID_SIZE,
                  height: Math.round(newH / GRID_SIZE) * GRID_SIZE,
                };
              }
            }
            return elem;
          })
        );
      }
    };

    const handleUp = () => {
      if (actionRef.current.hasChanged) {
        pushStateToHistory(elements);
      }

      actionRef.current.mode = null;
      actionRef.current.resizeHandle = null;
      actionRef.current.initialElementsMap.clear();
      actionRef.current.initialGroupBounds = null;
      actionRef.current.hasChanged = false;
      setIsPanning(false);
    };

    const handleKeyDown = (e) => {
      if (editModal || copyLineModalOpen) return;

      const isCtrlOrCmd = e.ctrlKey || e.metaKey;

      if (isCtrlOrCmd && (e.code === "KeyC" || e.key.toLowerCase() === "c")) {
        e.preventDefault();
        handleCopy();
        return;
      }

      if (isCtrlOrCmd && (e.code === "KeyV" || e.key.toLowerCase() === "v")) {
        e.preventDefault();
        handlePaste();
        return;
      }

      if (isCtrlOrCmd && (e.code === "KeyZ" || e.key.toLowerCase() === "z")) {
        e.preventDefault();
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
        return;
      }

      if (isCtrlOrCmd && (e.code === "KeyY" || e.key.toLowerCase() === "y")) {
        e.preventDefault();
        handleRedo();
        return;
      }

      if (e.key === "[") {
        e.preventDefault();
        handleSendToBack();
        return;
      }

      if (e.key === "]") {
        e.preventDefault();
        handleBringToFront();
        return;
      }

      if (e.key === "Escape") {
        e.preventDefault();
        setSelectedIds([]);
      }

      if (e.code === "Space") {
        isSpacePressedRef.current = true;
      }

      if ((e.key === "Delete" || e.key === "Backspace") && selectedIds.length > 0) {
        const updated = elements.filter((item) => !selectedIds.includes(item.id));
        setElements(updated);
        pushStateToHistory(updated);
        setSelectedIds([]);
      }
    };

    const handleKeyUp = (e) => {
      if (e.code === "Space") {
        isSpacePressedRef.current = false;
      }
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    window.addEventListener("touchmove", handleMove, { passive: false });
    window.addEventListener("touchend", handleUp);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
      window.removeEventListener("touchmove", handleMove);
      window.removeEventListener("touchend", handleUp);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [selectedIds, editModal, copyLineModalOpen, zoomScale, panOffset, elements, handleUndo, handleRedo, handleCopy, handlePaste, handleSendToBack, handleBringToFront, historyIndex]);

  const addShape = (type) => {
    const newId = `elem_${Date.now()}`;
    const spawnX = Math.max(40, Math.round((-panOffset.x + 80) / GRID_SIZE) * GRID_SIZE);
    const spawnY = Math.max(40, Math.round((-panOffset.y + 80) / GRID_SIZE) * GRID_SIZE);

    const defaultLabel = type === "station" ? (stationsList[0]?.id || "Station") : "OP";

    const newElem = {
      id: newId,
      type,
      x: spawnX,
      y: spawnY,
      width: type === "station" ? 140 : 64,
      height: type === "station" ? 90 : 64,
      fontSize: type === "station" ? 13 : 11,
      stationFontSize: 8,
      label: defaultLabel,
      assigned_station: type === "operator" ? (stationsList[0]?.id || "") : undefined,
      borderColor: type === "station" ? "#2563eb" : "#9333ea",
      bgColor: "#ffffff",
      textColor: "#1e293b",
    };
    const updated = [...elements, newElem];
    setElements(updated);
    pushStateToHistory(updated);
    setSelectedIds([newId]);
  };

  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      alert("กรุณาเลือกไฟล์ที่เป็นรูปภาพเท่านั้น");
      return;
    }

    if (file.size > 25 * 1024 * 1024) {
      alert("ไฟล์รูปภาพมีขนาดเกิน 25MB กรุณาเลือกไฟล์ที่เล็กลง");
      return;
    }

    try {
      const formData = new FormData();
      formData.append("image", file);

      const res = await fetch(`${API_URL}/layout/upload-image`, {
        method: "POST",
        headers: getAuthHeaders(true),
        body: formData,
      });

      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        const textError = await res.text();
        console.error("Server HTML Response:", textError);
        throw new Error("เซิร์ฟเวอร์ตอบกลับไม่ถูกต้อง (Proxy Error หรือ Server ขัดข้อง)");
      }

      const uploadResult = await res.json();
      if (!res.ok || !uploadResult.success) {
        throw new Error(uploadResult.message || "อัปโหลดไม่สำเร็จ");
      }

      const serverImageUrl = uploadResult.url;

      const img = new Image();
      img.onload = () => {
        let initW = img.naturalWidth || 180;
        let initH = img.naturalHeight || 120;

        const maxInitialDim = 400;
        if (initW > maxInitialDim || initH > maxInitialDim) {
          const ratio = Math.min(maxInitialDim / initW, maxInitialDim / initH);
          initW = Math.round(initW * ratio);
          initH = Math.round(initH * ratio);
        }

        const newId = `img_${Date.now()}`;
        const spawnX = Math.max(40, Math.round((-panOffset.x + 80) / GRID_SIZE) * GRID_SIZE);
        const spawnY = Math.max(40, Math.round((-panOffset.y + 80) / GRID_SIZE) * GRID_SIZE);

        const newImageElem = {
          id: newId,
          type: "image",
          x: spawnX,
          y: spawnY,
          width: Math.max(60, Math.round(initW / GRID_SIZE) * GRID_SIZE),
          height: Math.max(60, Math.round(initH / GRID_SIZE) * GRID_SIZE),
          label: file.name.replace(/\.[^/.]+$/, ""),
          src: serverImageUrl,
          fileName: uploadResult.fileName,
          borderColor: "transparent",
          borderWidth: 0,
          borderRadius: 8,
          objectFit: "contain",
          bgColor: "transparent",
        };

        const updated = [newImageElem, ...elements];
        setElements(updated);
        pushStateToHistory(updated);
        setSelectedIds([newId]);
      };
      img.src = serverImageUrl;
    } catch (err) {
      console.error("Upload Image Error:", err);
      alert(`การอัปโหลดขัดข้อง: ${err.message}`);
    } finally {
      e.target.value = "";
    }
  };

  const handleOpenEditModal = (item) => {
    setEditModal({
      id: item.id,
      type: item.type,
      label: item.label || (item.type === "station" ? (stationsList[0]?.id || "Station") : (item.type === "image" ? "Image" : "OP")),
      assigned_station: item.assigned_station || (stationsList[0]?.id || ""),
      width: Number(item.width) || (item.type === "station" ? 140 : (item.type === "image" ? 180 : 64)),
      height: Number(item.height) || (item.type === "station" ? 90 : (item.type === "image" ? 120 : 64)),
      fontSize: Number(item.fontSize) || (item.type === "station" ? 13 : 11),
      stationFontSize: Number(item.stationFontSize) || 8,
      borderColor: item.borderColor || (item.type === "station" ? "#2563eb" : (item.type === "image" ? "transparent" : "#9333ea")),
      borderWidth: Number(item.borderWidth) || (item.type === "image" ? 0 : 2),
      borderRadius: Number(item.borderRadius) || (item.type === "image" ? 8 : (item.type === "station" ? 8 : 9999)),
      bgColor: item.bgColor || (item.type === "image" ? "transparent" : "#ffffff"),
      textColor: item.textColor || "#1e293b",
      src: item.src || "",
      objectFit: item.objectFit || "contain",
    });
  };

  const handleSaveModal = () => {
    if (!editModal) return;
    const finalW = Math.max(20, Math.round(Number(editModal.width) || 40));
    const finalH = Math.max(20, Math.round(Number(editModal.height) || 40));
    const finalFontSize = Math.max(8, Math.min(72, Math.round(Number(editModal.fontSize) || 12)));
    const finalStationFontSize = Math.max(6, Math.min(36, Math.round(Number(editModal.stationFontSize) || 8)));
    const finalBorderWidth = Math.max(0, Math.min(20, Number(editModal.borderWidth) || 0));
    const finalBorderRadius = Math.max(0, Math.min(200, Number(editModal.borderRadius) || 0));

    const updated = elements.map((item) =>
      item.id === editModal.id
        ? {
            ...item,
            ...editModal,
            width: finalW,
            height: finalH,
            fontSize: finalFontSize,
            stationFontSize: finalStationFontSize,
            borderWidth: finalBorderWidth,
            borderRadius: finalBorderRadius,
          }
        : item
    );
    setElements(updated);
    pushStateToHistory(updated);
    setEditModal(null);
  };

  const groupBounds = getSelectedGroupBounds();

  return (
    <div
      ref={mainWorkspaceRef}
      className={`flex flex-col h-full space-y-4 select-none ${
        isFullscreen ? (isDarkMode ? "bg-[#0F172A] p-2 sm:p-4" : "bg-[#F8FAFC] p-2 sm:p-4") : ""
      }`}
    >
      <input
        type="file"
        ref={imageUploadInputRef}
        onChange={handleImageUpload}
        accept="image/*"
        className="hidden"
      />

      {/* Modal คัดลอก Layout */}
      {copyLineModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className={`max-w-md w-full p-6 rounded-2xl shadow-2xl border space-y-4 ${
            isDarkMode ? "bg-[#1E293B] border-slate-700 text-slate-100" : "bg-white border-gray-200 text-gray-800"
          }`}>
            <div className="flex items-center justify-between border-b pb-3 border-slate-700/40">
              <h3 className="font-bold text-sm flex items-center gap-2">
                <span>คัดลอกผัง Layout ไปยัง Line อื่น</span>
              </h3>
              <button onClick={() => setCopyLineModalOpen(false)} className="text-gray-400 hover:text-gray-200 text-sm">✕</button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400">
                ผังต้นทาง: <strong className="text-white font-mono">{selectedLine}</strong> ({elements.length} ชิ้นส่วน)
              </div>

              <div>
                <label className="font-bold block mb-1 text-gray-400">เลือก Line ปลายทางที่ต้องการวางผัง</label>
                <select
                  value={targetLine}
                  onChange={(e) => setTargetLine(e.target.value)}
                  className={`w-full p-2.5 rounded-xl border outline-none font-semibold cursor-pointer ${
                    isDarkMode ? "bg-slate-800 border-slate-700 text-white" : "bg-gray-50 border-gray-200"
                  }`}
                >
                  <option value="">-- เลือก Line ปลายทาง --</option>
                  {lines
                    .filter((l) => l.id !== selectedLine)
                    .map((l) => (
                      <option key={l.id} value={l.id}>{l.id}</option>
                    ))}
                </select>
              </div>

              <p className="text-[11px] text-rose-400 leading-relaxed">
                คำเตือน: การคัดลอกนี้จะบันทึกทับผังเดิมของ Line ปลายทางทันที
              </p>
            </div>

            <div className="flex gap-2 pt-3 border-t border-slate-700/40">
              <button
                onClick={() => setCopyLineModalOpen(false)}
                className={`flex-1 py-2 rounded-xl text-xs font-semibold border ${
                  isDarkMode ? "border-slate-700 text-slate-300" : "border-gray-200 text-gray-700"
                }`}
              >
                ยกเลิก
              </button>
              <button
                onClick={handleCopyLayoutToLine}
                disabled={!targetLine || isCopying}
                className={`flex-1 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-md transition-all ${
                  !targetLine || isCopying ? "opacity-50 cursor-not-allowed" : ""
                }`}
              >
                {isCopying ? "กำลังคัดลอก..." : "ยืนยันการคัดลอก"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Popup Modal ปรับแต่ง */}
      {editModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-150" onClick={() => setEditModal(null)}>
          <div className={`max-w-md w-full p-6 rounded-2xl shadow-2xl border space-y-4 max-h-[90vh] overflow-y-auto ${
            isDarkMode ? "bg-[#1E293B] border-slate-700 text-slate-100" : "bg-white border-gray-200 text-gray-800"
          }`} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b pb-3 border-slate-700/40">
              <h3 className="font-bold text-sm flex items-center gap-2">
                <span>ปรับแต่ง {editModal.type === "station" ? "Station Box" : editModal.type === "image" ? "Image (รูปภาพ)" : "Circle OP (Operator)"}</span>
              </h3>
              <button onClick={() => setEditModal(null)} className="text-gray-400 hover:text-gray-200 text-sm">✕</button>
            </div>

            <div className="space-y-3 text-xs">
              {editModal.type === "station" ? (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="font-bold text-gray-400">
                      เลือก Station ประจำ Line [{selectedLine}]
                    </label>
                    {loadingStations && (
                      <span className="text-[10px] text-blue-400 animate-pulse">กำลังโหลด...</span>
                    )}
                  </div>
                  <select
                    value={editModal.label}
                    onChange={(e) => setEditModal({ ...editModal, label: e.target.value })}
                    className={`w-full p-2.5 rounded-xl border outline-none font-semibold cursor-pointer ${
                      isDarkMode ? "bg-slate-800 border-slate-700 text-white" : "bg-gray-50 border-gray-200 text-gray-800"
                    }`}
                  >
                    {stationsList.length === 0 ? (
                      <option value={editModal.label}>
                        {loadingStations ? "กำลังโหลด..." : `ไม่พบ Station ที่ผูกกับ Line ${selectedLine}`}
                      </option>
                    ) : (
                      stationsList.map((st) => (
                        <option key={st.id} value={st.id}>
                          {st.id} - {st.name}
                        </option>
                      ))
                    )}
                  </select>
                </div>
              ) : editModal.type === "image" ? (
                <div className="space-y-3">
                  <div>
                    <label className="font-bold block mb-1 text-gray-400">ชื่อรูปภาพ / Label</label>
                    <input
                      type="text"
                      value={editModal.label}
                      onChange={(e) => setEditModal({ ...editModal, label: e.target.value })}
                      className={`w-full p-2.5 rounded-xl border outline-none font-semibold ${
                        isDarkMode ? "bg-slate-800 border-slate-700 text-white" : "bg-gray-50 border-gray-200"
                      }`}
                      placeholder="เช่น Layout แผนก, เครื่องจักร A"
                    />
                  </div>

                  <div className="p-3 rounded-xl border border-dashed border-slate-600/60 bg-slate-900/30 flex flex-col items-center gap-2">
                    <div className="w-full h-28 rounded-lg overflow-hidden flex items-center justify-center bg-black/20">
                      <img src={editModal.src} alt="Preview" className="max-w-full max-h-full object-contain" />
                    </div>
                    <label className="cursor-pointer text-[11px] font-bold text-blue-400 hover:underline">
                      คลิกเพื่อเปลี่ยนไฟล์รูปภาพใหม่
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;

                          try {
                            const formData = new FormData();
                            formData.append("image", file);

                            const res = await fetch(`${API_URL}/layout/upload-image`, {
                              method: "POST",
                              headers: getAuthHeaders(true),
                              body: formData,
                            });

                            const uploadResult = await res.json();
                            if (res.ok && uploadResult.success) {
                              setEditModal({
                                ...editModal,
                                src: uploadResult.url,
                                fileName: uploadResult.fileName,
                              });
                            } else {
                              alert("เปลี่ยนรูปภาพไม่สำเร็จ: " + (uploadResult.message || "Error"));
                            }
                          } catch (err) {
                            alert("เกิดข้อผิดพลาดในการส่งรูปภาพไปเซิร์ฟเวอร์");
                          }
                        }}
                      />
                    </label>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="font-bold block mb-1 text-gray-400 text-[10px]">การจัดวางภาพ (Fit)</label>
                      <select
                        value={editModal.objectFit || "contain"}
                        onChange={(e) => setEditModal({ ...editModal, objectFit: e.target.value })}
                        className={`w-full p-2 rounded-xl border outline-none text-xs font-semibold ${
                          isDarkMode ? "bg-slate-800 border-slate-700 text-white" : "bg-gray-50 border-gray-200"
                        }`}
                      >
                        <option value="contain">Contain (พอดีสัดส่วน)</option>
                        <option value="cover">Cover (เต็มพื้นที่)</option>
                        <option value="fill">Fill (ยืดเต็ม)</option>
                      </select>
                    </div>

                    <div>
                      <label className="font-bold block mb-1 text-gray-400 text-[10px]">ความโค้งมุม (Radius)</label>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        value={editModal.borderRadius || 0}
                        onChange={(e) => setEditModal({ ...editModal, borderRadius: e.target.value })}
                        className={`w-full p-2 rounded-xl border outline-none text-xs font-mono font-bold ${
                          isDarkMode ? "bg-slate-800 border-slate-700 text-white" : "bg-white border-gray-300"
                        }`}
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <label className="font-bold block mb-1 text-gray-400">ชื่อ Operator (Label)</label>
                    <input
                      type="text"
                      value={editModal.label}
                      onChange={(e) => setEditModal({ ...editModal, label: e.target.value })}
                      className={`w-full p-2.5 rounded-xl border outline-none font-semibold ${
                        isDarkMode ? "bg-slate-800 border-slate-700 text-white" : "bg-gray-50 border-gray-200"
                      }`}
                      placeholder="เช่น OP, OP-HS-F, สมชาย"
                    />
                  </div>

                  <div>
                    <label className="font-bold block mb-1 text-gray-400">
                      งาน Station ที่ประจำอยู่ (Line: {selectedLine})
                    </label>
                    <select
                      value={editModal.assigned_station || ""}
                      onChange={(e) => setEditModal({ ...editModal, assigned_station: e.target.value })}
                      className={`w-full p-2.5 rounded-xl border outline-none font-semibold cursor-pointer ${
                        isDarkMode ? "bg-slate-800 border-slate-700 text-white" : "bg-gray-50 border-gray-200 text-gray-800"
                      }`}
                    >
                      <option value="">-- ไม่ระบุ Station --</option>
                      {stationsList.map((st) => (
                        <option key={st.id} value={st.id}>
                          {st.id} - {st.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              {/* ขนาดกว้าง / สูง */}
              <div className={`grid ${editModal.type === "operator" ? "grid-cols-4" : editModal.type === "image" ? "grid-cols-2" : "grid-cols-3"} gap-2 p-3 rounded-xl border bg-slate-900/30 border-slate-700/50`}>
                <div>
                  <label className="font-bold block mb-1 text-gray-400 text-[10px]">กว้าง (W)</label>
                  <div className="relative flex items-center">
                    <input
                      type="number"
                      min="20"
                      max="2000"
                      value={editModal.width}
                      onChange={(e) => setEditModal({ ...editModal, width: e.target.value })}
                      className={`w-full p-1.5 pr-5 rounded-lg border outline-none font-mono font-bold text-[11px] ${
                        isDarkMode ? "bg-slate-800 border-slate-700 text-white" : "bg-white border-gray-300"
                      }`}
                    />
                    <span className="absolute right-1 text-[9px] text-gray-400 font-mono">px</span>
                  </div>
                </div>

                <div>
                  <label className="font-bold block mb-1 text-gray-400 text-[10px]">สูง (H)</label>
                  <div className="relative flex items-center">
                    <input
                      type="number"
                      min="20"
                      max="2000"
                      value={editModal.height}
                      onChange={(e) => setEditModal({ ...editModal, height: e.target.value })}
                      className={`w-full p-1.5 pr-5 rounded-lg border outline-none font-mono font-bold text-[11px] ${
                        isDarkMode ? "bg-slate-800 border-slate-700 text-white" : "bg-white border-gray-300"
                      }`}
                    />
                    <span className="absolute right-1 text-[9px] text-gray-400 font-mono">px</span>
                  </div>
                </div>

                {editModal.type !== "image" && (
                  <div>
                    <label className="font-bold block mb-1 text-gray-400 text-[10px]">ฟอนต์ชื่อ</label>
                    <div className="relative flex items-center">
                      <input
                        type="number"
                        min="8"
                        max="72"
                        value={editModal.fontSize}
                        onChange={(e) => setEditModal({ ...editModal, fontSize: e.target.value })}
                        className={`w-full p-1.5 pr-5 rounded-lg border outline-none font-mono font-bold text-[11px] ${
                          isDarkMode ? "bg-slate-800 border-slate-700 text-white" : "bg-white border-gray-300"
                        }`}
                      />
                      <span className="absolute right-1 text-[9px] text-gray-400 font-mono">px</span>
                    </div>
                  </div>
                )}

                {editModal.type === "operator" && (
                  <div>
                    <label className="font-bold block mb-1 text-purple-400 text-[10px]">ฟอนต์ Station</label>
                    <div className="relative flex items-center">
                      <input
                        type="number"
                        min="6"
                        max="36"
                        value={editModal.stationFontSize}
                        onChange={(e) => setEditModal({ ...editModal, stationFontSize: e.target.value })}
                        className={`w-full p-1.5 pr-5 rounded-lg border outline-none font-mono font-bold text-[11px] border-purple-500/40 ${
                          isDarkMode ? "bg-slate-800 text-purple-300" : "bg-white text-purple-700"
                        }`}
                      />
                      <span className="absolute right-1 text-[9px] text-gray-400 font-mono">px</span>
                    </div>
                  </div>
                )}
              </div>

              {editModal.type !== "image" && (
                <div>
                  <label className="font-bold block mb-1 text-gray-400">ชุดสีสำเร็จรูป (Color Preset)</label>
                  <div className="grid grid-cols-3 gap-2">
                    {colorPresets.map((p, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setEditModal({ ...editModal, borderColor: p.border, bgColor: p.bg, textColor: p.text })}
                        className="p-2 rounded-xl border flex items-center gap-2 text-[10px] font-bold hover:scale-105 transition-all"
                        style={{ backgroundColor: p.bg, borderColor: p.border, color: p.text }}
                      >
                        <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: p.border }}></span>
                        <span className="truncate">{p.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-3 gap-2 pt-1">
                <div>
                  <label className="font-bold block mb-1 text-gray-400 text-[11px]">สีกรอบ</label>
                  <input
                    type="color"
                    value={editModal.borderColor === "transparent" ? "#ffffff" : editModal.borderColor}
                    onChange={(e) => setEditModal({ ...editModal, borderColor: e.target.value })}
                    className="w-full h-8 rounded-lg cursor-pointer bg-transparent border-0"
                  />
                </div>
                <div>
                  <label className="font-bold block mb-1 text-gray-400 text-[11px]">สีพื้นหลัง</label>
                  <input
                    type="color"
                    value={editModal.bgColor === "transparent" ? "#ffffff" : editModal.bgColor}
                    onChange={(e) => setEditModal({ ...editModal, bgColor: e.target.value })}
                    className="w-full h-8 rounded-lg cursor-pointer bg-transparent border-0"
                  />
                </div>
                {editModal.type !== "image" ? (
                  <div>
                    <label className="font-bold block mb-1 text-gray-400 text-[11px]">สีตัวอักษร</label>
                    <input
                      type="color"
                      value={editModal.textColor}
                      onChange={(e) => setEditModal({ ...editModal, textColor: e.target.value })}
                      className="w-full h-8 rounded-lg cursor-pointer bg-transparent border-0"
                    />
                  </div>
                ) : (
                  <div>
                    <label className="font-bold block mb-1 text-gray-400 text-[11px]">ความหนากรอบ (px)</label>
                    <input
                      type="number"
                      min="0"
                      max="20"
                      value={editModal.borderWidth || 0}
                      onChange={(e) => setEditModal({ ...editModal, borderWidth: e.target.value })}
                      className={`w-full h-8 px-2 rounded-lg border text-xs font-mono font-bold ${
                        isDarkMode ? "bg-slate-800 border-slate-700 text-white" : "bg-white border-gray-300"
                      }`}
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="flex gap-2 pt-3 border-t border-slate-700/40">
              <button
                onClick={() => setEditModal(null)}
                className={`flex-1 py-2 rounded-xl text-xs font-semibold border ${
                  isDarkMode ? "border-slate-700 text-slate-300" : "border-gray-200 text-gray-700"
                }`}
              >
                ยกเลิก
              </button>
              <button
                onClick={handleSaveModal}
                className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl shadow-md shadow-blue-500/20"
              >
                บันทึกการแก้ไข
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Top Bar (ปรับปรุงให้รองรับ Flex-wrap บนหน้าจอโทรศัพท์) */}
      <div className={`p-3 sm:p-4 rounded-2xl border shadow-sm flex flex-wrap items-center justify-between gap-3 shrink-0 transition-colors ${
        isDarkMode ? "bg-[#1E293B] border-slate-700/60" : "bg-white border-gray-100"
      }`}>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <span className="font-bold text-xs sm:text-sm">Layout Editor</span>

          <select
            value={selectedLine}
            onChange={(e) => setSelectedLine(e.target.value)}
            disabled={loadingLines}
            className={`px-2.5 sm:px-3 py-1.5 rounded-xl border text-xs font-semibold focus:outline-none cursor-pointer ${
              isDarkMode ? "bg-slate-800 border-slate-700 text-white" : "bg-gray-50 border-gray-200 text-gray-800"
            }`}
          >
            {lines.map((line) => (
              <option key={line.id} value={line.id}>{line.id}</option>
            ))}
          </select>

          {/* ปุ่ม Undo & Redo */}
          <div className="flex items-center gap-1 border-l border-slate-700/40 pl-2 sm:pl-3">
            <button
              type="button"
              onClick={handleUndo}
              disabled={historyIndex <= 0}
              title="ย้อนกลับ (Undo: Ctrl+Z)"
              className={`p-1.5 px-2 rounded-xl text-xs font-bold flex items-center gap-1 transition-all ${
                historyIndex > 0
                  ? isDarkMode
                    ? "bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700"
                    : "bg-gray-100 hover:bg-gray-200 text-gray-700 border border-gray-200"
                  : "opacity-30 cursor-not-allowed text-gray-500"
              }`}
            >
              <span>Undo</span>
            </button>

            <button
              type="button"
              onClick={handleRedo}
              disabled={historyIndex >= history.length - 1}
              title="ทำซ้ำ (Redo: Ctrl+Y)"
              className={`p-1.5 px-2 rounded-xl text-xs font-bold flex items-center gap-1 transition-all ${
                historyIndex < history.length - 1
                  ? isDarkMode
                    ? "bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700"
                    : "bg-gray-100 hover:bg-gray-200 text-gray-700 border border-gray-200"
                  : "opacity-30 cursor-not-allowed text-gray-500"
              }`}
            >
              <span>Redo</span>
            </button>
          </div>

          {/* ปุ่ม Copy & Paste */}
          <div className="flex items-center gap-1 border-l border-slate-700/40 pl-2 sm:pl-3">
            <button
              type="button"
              onClick={handleCopy}
              disabled={selectedIds.length === 0}
              title="คัดลอกวัตถุที่เลือก (Ctrl+C)"
              className={`p-1.5 px-2 rounded-xl text-xs font-bold flex items-center gap-1 transition-all ${
                selectedIds.length > 0
                  ? isDarkMode
                    ? "bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700"
                    : "bg-gray-100 hover:bg-gray-200 text-gray-700 border border-gray-200"
                  : "opacity-30 cursor-not-allowed text-gray-500"
              }`}
            >
              <span>Copy</span>
            </button>

            <button
              type="button"
              onClick={handlePaste}
              disabled={!hasClipboard}
              title="วางวัตถุที่คัดลอก (Ctrl+V)"
              className={`p-1.5 px-2 rounded-xl text-xs font-bold flex items-center gap-1 transition-all ${
                hasClipboard
                  ? isDarkMode
                    ? "bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700"
                    : "bg-gray-100 hover:bg-gray-200 text-gray-700 border border-gray-200"
                  : "opacity-30 cursor-not-allowed text-gray-500"
              }`}
            >
              <span>Paste</span>
            </button>
          </div>

          {/* 🟢 ปุ่มจัดการเลเยอร์: Send to Back / Bring to Front */}
          {selectedIds.length > 0 && (
            <div className="flex items-center gap-1 border-l border-slate-700/40 pl-2 sm:pl-3">
              <button
                type="button"
                onClick={handleSendToBack}
                title="ย้ายไปไว้ข้างหลังสุด (Send to Back: [ )"
                className={`p-1.5 px-2 rounded-xl text-xs font-bold flex items-center gap-1 transition-all shadow-sm ${
                  isDarkMode
                    ? "bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30"
                    : "bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200"
                }`}
              >
                <span>⏬</span>
                <span className="hidden sm:inline">Send to Back</span>
              </button>

              <button
                type="button"
                onClick={handleBringToFront}
                title="ดึงขึ้นมาไว้ข้างหน้าสุด (Bring to Front: ] )"
                className={`p-1.5 px-2 rounded-xl text-xs font-bold flex items-center gap-1 transition-all shadow-sm ${
                  isDarkMode
                    ? "bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border border-purple-500/30"
                    : "bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200"
                }`}
              >
                <span>⏫</span>
                <span className="hidden sm:inline">Bring to Front</span>
              </button>
            </div>
          )}

          {selectedIds.length > 0 && (
            <span className="text-xs font-bold px-2 py-0.5 rounded-xl bg-blue-500/20 text-blue-400 border border-blue-500/30">
              เลือก {selectedIds.length} ชิ้น
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setTargetLine("");
              setCopyLineModalOpen(true);
            }}
            title="คัดลอกผังของ Line นี้ไปยัง Line อื่น"
            className="px-2.5 sm:px-3.5 py-1.5 bg-emerald-600/10 text-emerald-500 hover:bg-emerald-600/20 border border-emerald-500/30 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all"
          >
            <span>Copy Layout To...</span>
          </button>

          <button
            onClick={() => {
              if (selectedIds.length > 0) {
                const updated = elements.filter((i) => !selectedIds.includes(i.id));
                setElements(updated);
                pushStateToHistory(updated);
                setSelectedIds([]);
              }
            }}
            disabled={selectedIds.length === 0}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
              selectedIds.length > 0
                ? "bg-rose-500/10 text-rose-500 hover:bg-rose-500/20"
                : "opacity-40 cursor-not-allowed bg-gray-100 text-gray-400"
            }`}
          >
            Delete ({selectedIds.length})
          </button>

          <button
            onClick={saveLayout}
            className="bg-blue-600 hover:bg-blue-700 text-white px-3.5 sm:px-4 py-1.5 rounded-xl text-xs font-bold shadow-md shadow-blue-500/20 transition-all"
          >
            Save Layout
          </button>
        </div>
      </div>

      {/* Main Workspace (รองรับแนวนอนบนหน้าจอมือถือและแท็บเล็ต) */}
      <div className="flex flex-col md:flex-row gap-3 sm:gap-4 flex-1 relative overflow-hidden min-h-[500px]">
        {/* Toolbar ด้านซ้าย / ด้านบนสำหรับจอเล็ก */}
        <div className={`p-3 sm:p-4 rounded-2xl border shadow-sm flex md:flex-col gap-2 sm:gap-3 h-fit shrink-0 overflow-x-auto ${
          isDarkMode ? "bg-[#1E293B] border-slate-700/60" : "bg-white border-gray-100"
        }`}>
          <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1 hidden md:block">SHAPES & MEDIA</p>

          <button
            onClick={() => addShape("station")}
            className={`p-2 sm:p-3 rounded-xl border flex md:flex-col items-center gap-2 transition-all min-w-[100px] md:min-w-0 md:w-full ${
              isDarkMode ? "border-slate-700 hover:bg-slate-800" : "border-gray-200 hover:bg-blue-50/50"
            }`}
          >
            <div className="w-10 sm:w-14 h-6 sm:h-8 border-2 border-blue-600 rounded bg-white"></div>
            <span className="text-[11px] font-semibold">Station Box</span>
          </button>

          <button
            onClick={() => addShape("operator")}
            className={`p-2 sm:p-3 rounded-xl border flex md:flex-col items-center gap-2 transition-all min-w-[100px] md:min-w-0 md:w-full ${
              isDarkMode ? "border-slate-700 hover:bg-slate-800" : "border-gray-200 hover:bg-blue-50/50"
            }`}
          >
            <div className="w-6 sm:w-8 h-6 sm:h-8 border-2 border-purple-600 rounded-full bg-white"></div>
            <span className="text-[11px] font-semibold">Circle OP</span>
          </button>

          {/* ปุ่มเพิ่มรูปภาพ */}
          <button
            type="button"
            onClick={() => imageUploadInputRef.current?.click()}
            className={`p-2 sm:p-3 rounded-xl border flex md:flex-col items-center gap-2 transition-all min-w-[100px] md:min-w-0 md:w-full ${
              isDarkMode ? "border-slate-700 hover:bg-slate-800" : "border-gray-200 hover:bg-blue-50/50"
            }`}
          >
            <div className="w-10 sm:w-12 h-6 sm:h-8 border-2 border-emerald-500 rounded flex items-center justify-center bg-emerald-500/10 text-emerald-500 text-[10px] font-bold">
              IMG
            </div>
            <span className="text-[11px] font-semibold text-emerald-500">Image</span>
          </button>

          <div className="mt-2 pt-3 border-t border-gray-200/50 text-[10px] text-gray-400 space-y-1 hidden md:block">
            <p><strong>คีย์ลัดการใช้งาน:</strong></p>
            <p>• <strong>[ / ]</strong>: ย้ายหลังสุด / หน้าสุด</p>
            <p>• <strong>Ctrl + C / V</strong>: Copy / Paste</p>
            <p>• <strong>Ctrl + Z / Y</strong>: Undo / Redo</p>
            <p>• <strong>ดับเบิ้ลคลิก</strong>: กำหนดค่า / เปลี่ยนรูป</p>
            <p>• <strong>Shift + Click</strong>: เลือกหลายตัว</p>
          </div>
        </div>

        {/* Canvas Container (ผูก Touch Events และ Pointer Events ครบถ้วน) */}
        <div
          ref={canvasContainerRef}
          onPointerDown={handleCanvasPointerDown}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          style={{ touchAction: "none" }}
          className={`flex-1 rounded-2xl border shadow-sm relative overflow-hidden h-full select-none ${
            isPanning ? "cursor-grab active:cursor-grabbing" : "cursor-default"
          } ${isDarkMode ? "bg-[#0F172A] border-slate-700/60" : "bg-[#F8FAFC] border-gray-200"}`}
        >
          {/* Floating Controls Bar */}
          <div className="absolute top-3 right-3 sm:top-4 sm:right-4 z-40 flex items-center gap-1 sm:gap-1.5 p-1 sm:p-1.5 rounded-xl shadow-xl border bg-black/60 backdrop-blur-md border-white/10 text-white text-xs">
            <button
              type="button"
              onClick={toggleFullscreen}
              title={isFullscreen ? "ออกจากโหมดเต็มจอ (Esc)" : "แสดงแบบเต็มหน้าจอ (Full Screen)"}
              className={`px-2 sm:px-2.5 h-7 rounded-lg flex items-center gap-1 font-bold text-xs shadow-sm transition-all ${
                isFullscreen
                  ? "bg-purple-600 hover:bg-purple-500 text-white"
                  : "bg-white/10 hover:bg-white/20 text-white"
              }`}
            >
              <span>{isFullscreen ? "✕" : "⛶"}</span>
              <span className="text-[10px] hidden sm:inline">{isFullscreen ? "Exit Full" : "Fullscreen"}</span>
            </button>

            <button
              type="button"
              onClick={() => fitAllElements()}
              title="ปรับมุมมองและอัตราขยายให้เห็นผังทั้งหมด (Fit All Elements)"
              className="px-2 sm:px-2.5 h-7 rounded-lg bg-emerald-600 hover:bg-emerald-500 flex items-center gap-1 font-bold text-xs shadow-sm transition-all"
            >
              <span>⛶</span>
              <span className="text-[10px] hidden sm:inline">Fit</span>
            </button>

            <button
              type="button"
              onClick={resetPanAndZoom}
              title="รีเซ็ตมุมมองที่จุดเริ่มต้น (0,0)"
              className="w-7 h-7 rounded-lg bg-blue-600 hover:bg-blue-500 flex items-center justify-center font-bold text-xs shadow-sm transition-all"
            >
              ⌂
            </button>

            <div className="h-4 w-px bg-white/20 mx-0.5"></div>

            <button
              type="button"
              onClick={() => setZoomScale((prev) => Math.max(0.1, Number((prev - 0.05).toFixed(2))))}
              title="ซูมออก (-)"
              className="w-7 h-7 rounded-lg bg-white/10 hover:bg-white/20 font-bold flex items-center justify-center transition-colors"
            >
              -
            </button>

            <span className="text-[10px] sm:text-[11px] font-mono px-1 font-semibold min-w-[34px] sm:min-w-[38px] text-center">
              {Math.round(zoomScale * 100)}%
            </span>

            <button
              type="button"
              onClick={() => setZoomScale((prev) => Math.min(2.5, Number((prev + 0.05).toFixed(2))))}
              title="ซูมเข้า (+)"
              className="w-7 h-7 rounded-lg bg-white/10 hover:bg-white/20 font-bold flex items-center justify-center transition-colors"
            >
              +
            </button>
          </div>

          {/* Transformable Layer */}
          <div
            style={{
              position: "absolute",
              width: "10000px",
              height: "10000px",
              transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoomScale})`,
              transformOrigin: "0 0",
              transition: isPanning ? "none" : "transform 0.15s ease-out",
              backgroundImage: isDarkMode
                ? "radial-gradient(#334155 1.5px, transparent 1.5px)"
                : "radial-gradient(#cbd5e1 1.5px, transparent 1.5px)",
              backgroundSize: `${GRID_SIZE}px ${GRID_SIZE}px`,
              pointerEvents: "auto",
            }}
          >
            {loadingLayout ? (
              <div className="p-20 text-xs text-gray-400 font-semibold">
                กำลังโหลดผังของ Line {selectedLine}...
              </div>
            ) : elements.length === 0 ? (
              <div className="p-20 text-xs text-gray-400 font-semibold">
                ยังไม่มีการจัดวาง Layout สำหรับ Line {selectedLine}
              </div>
            ) : (
              elements.map((item, index) => {
                const isSelected = selectedIds.includes(item.id);
                const customFontSize = item.fontSize ? `${item.fontSize}px` : (item.type === "station" ? "13px" : "11px");
                const customStationFontSize = item.stationFontSize ? `${item.stationFontSize}px` : "9px";

                const defaultZIndex = item.type === "image" ? index + 1 : (item.type === "operator" ? 30 : 20);

                return (
                  <div
                    key={item.id}
                    onPointerDown={(e) => handleElementPointerDown(e, item)}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      handleOpenEditModal(item);
                    }}
                    style={{
                      position: "absolute",
                      left: `${item.x}px`,
                      top: `${item.y}px`,
                      width: `${item.width}px`,
                      height: `${item.height}px`,
                      backgroundColor: item.bgColor || "transparent",
                      borderColor: item.borderColor || (item.type === "station" ? "#2563eb" : item.type === "image" ? "transparent" : "#9333ea"),
                      borderWidth: item.borderWidth !== undefined ? `${item.borderWidth}px` : (item.type === "image" ? "0px" : "2px"),
                      borderRadius: item.borderRadius !== undefined ? `${item.borderRadius}px` : (item.type === "station" ? "8px" : item.type === "image" ? "8px" : "9999px"),
                      borderStyle: "solid",
                      color: item.textColor || "#1e293b",
                      fontSize: customFontSize,
                      cursor: "move",
                      overflow: "hidden",
                      zIndex: isSelected ? 40 : defaultZIndex,
                    }}
                    className={`flex flex-col items-center justify-center font-bold select-none text-center transition-shadow relative ${
                      isSelected
                        ? "shadow-2xl ring-2 ring-blue-500/50"
                        : "shadow-sm hover:shadow-md"
                    }`}
                  >
                    {/* Render Image Component */}
                    {item.type === "image" ? (
                      <div className="w-full h-full relative flex items-center justify-center overflow-hidden pointer-events-none">
                        <img
                          src={item.src}
                          alt={item.label || "Layout item"}
                          className="w-full h-full"
                          style={{ objectFit: item.objectFit || "contain" }}
                          draggable={false}
                        />
                        {item.label && (
                          <span className="absolute bottom-1 bg-black/60 text-white font-mono text-[9px] px-1 rounded truncate max-w-[90%]">
                            {item.label}
                          </span>
                        )}
                      </div>
                    ) : (
                      <>
                        <span className="truncate max-w-full leading-tight px-1">{item.label}</span>

                        {item.type === "operator" && item.assigned_station && (
                          <span
                            style={{ fontSize: customStationFontSize }}
                            className="absolute -bottom-5 left-1/2 -translate-x-1/2 font-mono font-bold px-1.5 py-0.2 rounded-md bg-purple-500/15 text-purple-600 dark:text-purple-300 border border-purple-500/30 whitespace-nowrap shadow-sm z-20 pointer-events-none"
                          >
                            {item.assigned_station}
                          </span>
                        )}
                      </>
                    )}
                  </div>
                );
              })
            )}

            {/* Canva-Style Transform Handles (8 จุด รองรับ Pointer & Touch) */}
            {groupBounds && selectedIds.length > 0 && (
              <div
                style={{
                  position: "absolute",
                  left: `${groupBounds.minX}px`,
                  top: `${groupBounds.minY}px`,
                  width: `${groupBounds.width}px`,
                  height: `${groupBounds.height}px`,
                  pointerEvents: "none",
                  zIndex: 50,
                }}
                className="border-2 border-blue-500"
              >
                <div onPointerDown={(e) => handleResizeStart(e, "nw")} style={{ pointerEvents: "auto" }} className="absolute -left-2.5 -top-2.5 w-4 h-4 bg-white border-2 border-blue-500 rounded-full cursor-nwse-resize shadow-md hover:scale-125 transition-transform" />
                <div onPointerDown={(e) => handleResizeStart(e, "ne")} style={{ pointerEvents: "auto" }} className="absolute -right-2.5 -top-2.5 w-4 h-4 bg-white border-2 border-blue-500 rounded-full cursor-nesw-resize shadow-md hover:scale-125 transition-transform" />
                <div onPointerDown={(e) => handleResizeStart(e, "se")} style={{ pointerEvents: "auto" }} className="absolute -right-2.5 -bottom-2.5 w-4 h-4 bg-white border-2 border-blue-500 rounded-full cursor-nwse-resize shadow-md hover:scale-125 transition-transform" />
                <div onPointerDown={(e) => handleResizeStart(e, "sw")} style={{ pointerEvents: "auto" }} className="absolute -left-2.5 -bottom-2.5 w-4 h-4 bg-white border-2 border-blue-500 rounded-full cursor-nesw-resize shadow-md hover:scale-125 transition-transform" />
                <div onPointerDown={(e) => handleResizeStart(e, "n")} style={{ pointerEvents: "auto" }} className="absolute left-1/2 -top-1.5 -translate-x-1/2 w-5 h-2.5 bg-white border-2 border-blue-500 rounded-full cursor-ns-resize shadow-sm hover:scale-125 transition-transform" />
                <div onPointerDown={(e) => handleResizeStart(e, "s")} style={{ pointerEvents: "auto" }} className="absolute left-1/2 -bottom-1.5 -translate-x-1/2 w-5 h-2.5 bg-white border-2 border-blue-500 rounded-full cursor-ns-resize shadow-sm hover:scale-125 transition-transform" />
                <div onPointerDown={(e) => handleResizeStart(e, "w")} style={{ pointerEvents: "auto" }} className="absolute -left-1.5 top-1/2 -translate-y-1/2 w-2.5 h-5 bg-white border-2 border-blue-500 rounded-full cursor-ew-resize shadow-sm hover:scale-125 transition-transform" />
                <div onPointerDown={(e) => handleResizeStart(e, "e")} style={{ pointerEvents: "auto" }} className="absolute -right-1.5 top-1/2 -translate-y-1/2 w-2.5 h-5 bg-white border-2 border-blue-500 rounded-full cursor-ew-resize shadow-sm hover:scale-125 transition-transform" />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}