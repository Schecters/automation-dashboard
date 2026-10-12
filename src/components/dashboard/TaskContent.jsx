import React, { useState, useEffect, useMemo, useCallback } from "react";
import { socket } from "../../socket";

export default function TaskContent({ isDarkMode }) {
  const [tasks, setTasks] = useState([]);
  const [engineers, setEngineers] = useState([]);
  const [linesData, setLinesData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [typeFilter, setTypeFilter] = useState("all");
  const [actionLoadingId, setActionLoadingId] = useState(null);

  // 🟢 สลับมุมมอง: "card" (การ์ดเลื่อนข้าง) หรือ "table" (แถบตาราง)
  const [viewMode, setViewMode] = useState("card");

  // Date Range Filter States
  const [timeRange, setTimeRange] = useState("all");
  const [customStartDate, setCustomStartDate] = useState("");
  const [customEndDate, setCustomEndDate] = useState("");

  // Modal กรอก Solution ตอนกด Complete
  const [completeModalOpen, setCompleteModalOpen] = useState(false);
  const [taskToComplete, setTaskToComplete] = useState(null);
  const [solutionInput, setSolutionInput] = useState("");
  const [selectedSolutionImages, setSelectedSolutionImages] = useState([]);
  const [solutionImagePreviews, setSolutionImagePreviews] = useState([]);
  const [submittingSolution, setSubmittingSolution] = useState(false);

  // Modal ดูรายละเอียด Solution & Task
  const [viewDetailModalOpen, setViewDetailModalOpen] = useState(false);
  const [taskDetail, setTaskDetail] = useState(null);

  // Admin Modal State
  const [adminModalOpen, setAdminModalOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState(null);
  const [adminStatusInput, setAdminStatusInput] = useState("pending");
  const [adminAssigneeInput, setAdminAssigneeInput] = useState("");
  const [adminSolutionInput, setAdminSolutionInput] = useState("");
  const [adminProblemInput, setAdminProblemInput] = useState("");
  const [adminLineInput, setAdminLineInput] = useState("");
  const [adminStationInput, setAdminStationInput] = useState("");
  const [adminTaskTypeInput, setAdminTaskTypeInput] = useState("general");
  const [adminShiftInput, setAdminShiftInput] = useState("a");

  // Lightbox Modal ดูรูปขนาดเต็ม
  const [lightboxImages, setLightboxImages] = useState([]);
  const [lightboxIndex, setLightboxIndex] = useState(0);

  const currentEmpId = Number(localStorage.getItem("employeeId"));
  const userRole = (localStorage.getItem("userRole") || "").toLowerCase().trim();
  const isAdmin = userRole === "admin";

  const API_URL = `/api`;

  const getSafeImageUrl = (url) => {
    if (!url) return "";
    let clean = String(url).trim().replace(/^["']|["']$/g, "");
    if (!clean) return "";
    if (clean.startsWith("http://") || clean.startsWith("https://")) {
      try {
        const parsed = new URL(clean);
        return parsed.pathname;
      } catch {
        return clean;
      }
    }
    return clean.startsWith("/") ? clean : `/${clean}`;
  };

  const parsePostgresArray = (data) => {
    if (!data) return [];
    if (Array.isArray(data)) {
      return data
        .flat(Infinity)
        .map((item) => String(item).trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
    }
    if (typeof data === "string") {
      let str = data.trim();
      if (str === "{}" || str === "[]" || str === "" || str === '""') return [];

      if (str.startsWith("{") && str.endsWith("}")) {
        str = str.slice(1, -1);
        return str
          .split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/)
          .map((s) => s.replace(/\\"/g, '"').replace(/^["']|["']$/g, "").trim())
          .filter(Boolean);
      }
      try {
        const parsed = JSON.parse(str);
        if (Array.isArray(parsed)) {
          return parsed.map((s) => String(s).replace(/^["']|["']$/g, "").trim()).filter(Boolean);
        }
        return [String(parsed).replace(/^["']|["']$/g, "").trim()];
      } catch {
        return [str.replace(/^["']|["']$/g, "").trim()];
      }
    }
    return [];
  };

  const extractTaskImages = (task) => {
    if (!task) return [];
    let list = parsePostgresArray(task.images);
    if (list.length === 0 && task.image_url) {
      list = [task.image_url];
    }
    return list.map((img) => getSafeImageUrl(img)).filter(Boolean);
  };

  const extractSolutionImages = (task) => {
    if (!task) return [];
    const rawData = task.solution_images || task.solutionImages || [];
    let list = parsePostgresArray(rawData);
    if (list.length === 0 && task.solution_image_url) {
      list = [task.solution_image_url];
    }
    return list.map((img) => getSafeImageUrl(img)).filter(Boolean);
  };

  const openLightbox = (imageList, initialIndex = 0) => {
    if (!imageList || imageList.length === 0) return;
    setLightboxImages(imageList);
    setLightboxIndex(initialIndex);
  };

  const closeLightbox = () => {
    setLightboxImages([]);
    setLightboxIndex(0);
  };

  const nextLightboxImage = (e) => {
    e?.stopPropagation();
    setLightboxIndex((prev) => (prev + 1) % lightboxImages.length);
  };

  const prevLightboxImage = (e) => {
    e?.stopPropagation();
    setLightboxIndex((prev) => (prev - 1 + lightboxImages.length) % lightboxImages.length);
  };

  const getHeaders = (isMultipart = false) => {
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

  const fetchData = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    setError(null);
    const token = localStorage.getItem("token") || localStorage.getItem("sessionToken");

    if (!token || token === "null" || token === "undefined") {
      window.location.href = "/";
      return;
    }

    try {
      const headers = getHeaders();
      const [resTasks, resLines] = await Promise.all([
        fetch(`${API_URL}/tasks`, { headers }),
        fetch(`${API_URL}/lines`, { headers }),
      ]);

      if (resTasks.status === 401 || resTasks.status === 403) {
        localStorage.clear();
        alert("Session หมดอายุ กรุณาเข้าสู่ระบบใหม่อีกครั้ง");
        window.location.href = "/";
        return;
      }

      if (!resTasks.ok) throw new Error("ไม่สามารถดึงข้อมูลรายการ Task ได้");
      const tasksData = await resTasks.json();
      setTasks(Array.isArray(tasksData) ? tasksData : []);

      if (resLines.ok) {
        const linesJson = await resLines.json();
        setLinesData(Array.isArray(linesJson) ? linesJson : []);
      }

      if (isAdmin) {
        const resUsers = await fetch(`${API_URL}/users`, { headers });
        if (resUsers.ok) {
          const usersData = await resUsers.json();
          if (Array.isArray(usersData)) {
            setEngineers(usersData.filter((u) => ["admin", "me", "ie", "pd", "q"].includes(u.role?.toLowerCase())));
          }
        }
      }
    } catch (err) {
      console.error("Fetch Data Error:", err);
      setError(err.message);
    } finally {
      if (!isSilent) setLoading(false);
    }
  }, [API_URL, isAdmin]);

  useEffect(() => {
    fetchData();

    if (!socket) return;
    if (!socket.connected) socket.connect();

    const handleRealtimeTaskUpdate = () => {
      fetchData(true);
    };

    socket.on("new_task", handleRealtimeTaskUpdate);
    socket.on("task_created", handleRealtimeTaskUpdate);
    socket.on("task_updated", handleRealtimeTaskUpdate);
    socket.on("task_status_changed", handleRealtimeTaskUpdate);
    socket.on("task_status_updated", handleRealtimeTaskUpdate);
    socket.on("task_deleted", handleRealtimeTaskUpdate);

    return () => {
      socket.off("new_task", handleRealtimeTaskUpdate);
      socket.off("task_created", handleRealtimeTaskUpdate);
      socket.off("task_updated", handleRealtimeTaskUpdate);
      socket.off("task_status_changed", handleRealtimeTaskUpdate);
      socket.off("task_status_updated", handleRealtimeTaskUpdate);
      socket.off("task_deleted", handleRealtimeTaskUpdate);
    };
  }, [fetchData]);

  const canUserAcceptTask = (task) => {
    if (isAdmin) return true;
    if (userRole === "pd") return false;
    return true;
  };

  const handleAcceptTask = async (taskId) => {
    setActionLoadingId(taskId);
    try {
      const res = await fetch(`${API_URL}/tasks/${taskId}/status`, {
        method: "PATCH",
        headers: getHeaders(),
        body: JSON.stringify({ status: "in_progress" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "รับงานไม่สำเร็จ");

      if (socket && socket.connected) {
        socket.emit("task_updated", { task_id: taskId, status: "in_progress" });
      }
      fetchData(true);
    } catch (err) {
      alert(`คำเตือน: ${err.message}`);
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleCancelAcceptTask = async (taskId) => {
    if (!window.confirm("คุณต้องการยกเลิกการรับงานนี้ เพื่อคืนกลับไปเป็นสถานะรอดำเนินการ (Pending) ใช่หรือไม่?")) {
      return;
    }

    setActionLoadingId(taskId);
    try {
      let res;
      if (isAdmin) {
        res = await fetch(`${API_URL}/tasks/${taskId}/admin-override`, {
          method: "PUT",
          headers: getHeaders(),
          body: JSON.stringify({ status: "pending", accepted_by: null }),
        });
      } else {
        res = await fetch(`${API_URL}/tasks/${taskId}/status`, {
          method: "PATCH",
          headers: getHeaders(),
          body: JSON.stringify({ status: "pending" }),
        });
      }

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "ยกเลิกรับงานไม่สำเร็จ");

      if (socket && socket.connected) {
        socket.emit("task_updated", { task_id: taskId, status: "pending" });
      }
      fetchData(true);
    } catch (err) {
      alert(`คำเตือน: ${err.message}`);
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleOpenCompleteModal = (task) => {
    setTaskToComplete(task);
    setSolutionInput("");
    setSelectedSolutionImages([]);
    setSolutionImagePreviews([]);
    setCompleteModalOpen(true);
  };

  const handleSolutionImagesChange = (e) => {
    const rawFiles = e.target.files;
    if (!rawFiles || rawFiles.length === 0) return;

    const fileArray = Array.from(rawFiles);
    const imageFiles = fileArray.filter((f) =>
      f.type.startsWith("image/") || /\.(jpe?g|png|webp|bmp|gif)$/i.test(f.name)
    );

    if (imageFiles.length === 0) {
      alert("กรุณาเลือกไฟล์ที่เป็นรูปภาพเท่านั้น");
      return;
    }

    const combined = [...selectedSolutionImages, ...imageFiles].slice(0, 5);
    setSelectedSolutionImages(combined);
    setSolutionImagePreviews(combined.map((file) => URL.createObjectURL(file)));
  };

  const handleRemoveSpecificSolutionImage = (indexToRemove) => {
    const updatedImages = selectedSolutionImages.filter((_, idx) => idx !== indexToRemove);
    const updatedPreviews = solutionImagePreviews.filter((_, idx) => idx !== indexToRemove);
    setSelectedSolutionImages(updatedImages);
    setSolutionImagePreviews(updatedPreviews);
  };

  const handleConfirmComplete = async (e) => {
    e.preventDefault();
    if (!solutionInput.trim()) {
      alert("กรุณาระบุรายละเอียดการแก้ไขปัญหา");
      return;
    }

    setSubmittingSolution(true);
    try {
      const payload = new FormData();
      payload.append("status", "complete");
      payload.append("solution", solutionInput.trim());

      selectedSolutionImages.forEach((file) => {
        payload.append("solution_images", file);
      });

      const res = await fetch(`${API_URL}/tasks/${taskToComplete.task_id}/status`, {
        method: "PATCH",
        headers: getHeaders(true),
        body: payload,
      });

      if (res.status === 413) {
        throw new Error("ขนาดไฟล์รูปภาพรวมใหญ่เกินไป กรุณาลดจำนวนรูปภาพ");
      }

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "ปิดงานไม่สำเร็จ");

      if (socket && socket.connected) {
        socket.emit("task_updated", { task_id: taskToComplete.task_id, status: "complete" });
      }

      setCompleteModalOpen(false);
      await fetchData(true);
    } catch (err) {
      alert(`คำเตือน: ${err.message}`);
    } finally {
      setSubmittingSolution(false);
    }
  };

  const handleOpenViewDetails = (task) => {
    const currentTask = tasks.find((t) => String(t.task_id) === String(task.task_id)) || task;
    setTaskDetail(currentTask);
    setViewDetailModalOpen(true);
  };

  const handleAdminQuickStatusChange = async (task, newStatus) => {
    if (newStatus === "complete") {
      handleOpenCompleteModal(task);
      return;
    }

    setActionLoadingId(task.task_id);
    try {
      let targetAssignee = task.accepted_by;
      if (newStatus === "pending") targetAssignee = null;
      if (newStatus === "in_progress" && !targetAssignee) targetAssignee = currentEmpId;

      const res = await fetch(`${API_URL}/tasks/${task.task_id}/admin-override`, {
        method: "PUT",
        headers: getHeaders(),
        body: JSON.stringify({ status: newStatus, accepted_by: targetAssignee }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Admin Override ไม่สำเร็จ");

      if (socket && socket.connected) {
        socket.emit("task_updated", { task_id: task.task_id, status: newStatus });
      }
      fetchData(true);
    } catch (err) {
      alert(`คำเตือน: ${err.message}`);
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleOpenAdminModal = (task) => {
    setSelectedTask(task);
    setAdminStatusInput(task.status || "pending");
    setAdminAssigneeInput(task.accepted_by ? String(task.accepted_by) : "");
    setAdminSolutionInput(task.solution || "");
    setAdminProblemInput(task.problem || "");
    setAdminLineInput(task.lines || "");
    setAdminStationInput(task.station_id || task.station || "");
    setAdminTaskTypeInput(task.task_type || "general");
    setAdminShiftInput(task.shift || "a");
    setAdminModalOpen(true);
  };

  const handleAdminModalSubmit = async (e) => {
    e.preventDefault();
    if (!selectedTask) return;

    if (!adminProblemInput.trim()) {
      alert("กรุณาระบุรายละเอียดปัญหา");
      return;
    }

    setActionLoadingId(selectedTask.task_id);
    try {
      const resUpdateDetails = await fetch(`${API_URL}/tasks/${selectedTask.task_id}`, {
        method: "PUT",
        headers: getHeaders(),
        body: JSON.stringify({
          lines: adminLineInput.trim(),
          station: adminStationInput.trim(),
          problem: adminProblemInput.trim(),
          task_type: adminTaskTypeInput,
          shift: adminShiftInput,
        }),
      });

      if (!resUpdateDetails.ok) {
        const errData = await resUpdateDetails.json();
        throw new Error(errData.message || "อัปเดตรายละเอียดงานไม่สำเร็จ");
      }

      const resOverride = await fetch(`${API_URL}/tasks/${selectedTask.task_id}/admin-override`, {
        method: "PUT",
        headers: getHeaders(),
        body: JSON.stringify({
          status: adminStatusInput,
          accepted_by: adminStatusInput === "pending" ? null : adminAssigneeInput || null,
          solution: adminStatusInput === "complete" ? adminSolutionInput : null,
        }),
      });

      const dataOverride = await resOverride.json();
      if (!resOverride.ok) throw new Error(dataOverride.message || "อัปเดตสถานะงานไม่สำเร็จ");

      if (socket && socket.connected) {
        socket.emit("task_updated", { task_id: selectedTask.task_id, status: adminStatusInput });
      }

      setAdminModalOpen(false);
      fetchData(true);
    } catch (err) {
      alert(`คำเตือน: ${err.message}`);
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleDeleteTask = async (taskId) => {
    if (!isAdmin) return alert("เฉพาะ Admin เท่านั้นที่สามารถลบ Task ได้");
    if (!window.confirm(`คุณแน่ใจหรือไม่ว่าต้องการลบ Task "${taskId}" อย่างถาวร?`)) return;

    setActionLoadingId(taskId);
    try {
      const res = await fetch(`${API_URL}/tasks/${taskId}`, {
        method: "DELETE",
        headers: getHeaders(),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "ลบ Task ไม่สำเร็จ");

      if (socket && socket.connected) {
        socket.emit("task_deleted", { task_id: taskId });
      }

      setTasks((prev) => prev.filter((t) => t.task_id !== taskId));
    } catch (err) {
      alert(`คำเตือน: ${err.message}`);
    } finally {
      setActionLoadingId(null);
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return "-";
    const d = new Date(dateStr);
    return d.toLocaleString("th-TH", {
      timeZone: "Asia/Bangkok",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getTaskTypeBadge = (type) => {
    switch (type) {
      case "pd_call_me":
        return {
          label: "PD Call ME",
          style: "bg-red-500/15 text-red-400 border-red-500/30 animate-pulse font-extrabold",
        };
      case "shift_handover":
        return {
          label: "ส่งต่อกะ",
          style: "bg-indigo-500/10 text-indigo-400 border-indigo-500/30 font-bold",
        };
      case "improvement":
        return {
          label: "Improvement",
          style: "bg-amber-500/10 text-amber-400 border-amber-500/30 font-bold",
        };
      case "product_issue":
        return {
          label: "Product Issue",
          style: "bg-rose-500/10 text-rose-400 border-rose-500/30 font-bold",
        };
      default:
        return {
          label: "แจ้งซ่อม",
          style: "bg-blue-500/10 text-blue-400 border-blue-500/30 font-bold",
        };
    }
  };

  // Date Range Filter
  const dateFilteredTasks = useMemo(() => {
    if (!tasks || tasks.length === 0) return [];
    if (timeRange === "all") return tasks;

    const now = new Date();

    return tasks.filter((t) => {
      if (!t.created_at) return false;
      const taskDate = new Date(t.created_at);

      if (timeRange === "today") {
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        return taskDate >= startOfToday;
      }
      if (timeRange === "7days") {
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(now.getDate() - 7);
        return taskDate >= sevenDaysAgo;
      }
      if (timeRange === "30days") {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(now.getDate() - 30);
        return taskDate >= thirtyDaysAgo;
      }
      if (timeRange === "custom") {
        if (!customStartDate && !customEndDate) return true;
        const start = customStartDate ? new Date(customStartDate) : new Date(0);
        const end = customEndDate ? new Date(customEndDate) : new Date();
        end.setHours(23, 59, 59, 999);
        return taskDate >= start && taskDate <= end;
      }
      return true;
    });
  }, [tasks, timeRange, customStartDate, customEndDate]);

  // Category Filter
  const filteredByType = useMemo(() => {
    return dateFilteredTasks.filter((t) => {
      if (typeFilter === "all") return true;
      return (t.task_type || "general") === typeFilter;
    });
  }, [dateFilteredTasks, typeFilter]);

  // 🟢 นิยามหัวข้อสถานะ 3 หมวด (Pending / In Progress / Complete)
  const statusSections = [
    {
      key: "pending",
      label: "Pending (รอดำเนินการ)",
      badgeClass: "bg-slate-500/15 text-slate-400 border-slate-500/30",
      icon: "⏳",
    },
    {
      key: "in_progress",
      label: "In Progress (กำลังดำเนินการ)",
      badgeClass: "bg-amber-500/15 text-amber-400 border-amber-500/30",
      icon: "⚙️",
    },
    {
      key: "complete",
      label: "Completed (เสร็จสิ้น)",
      badgeClass: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
      icon: "✅",
    },
  ];

  // 🟢 จัดกลุ่มงานตามสถานะ
  const groupedTasksByStatus = useMemo(() => {
    const map = new Map();
    statusSections.forEach((sec) => map.set(sec.key, []));

    filteredByType.forEach((t) => {
      const statusKey = t.status || "pending";
      if (map.has(statusKey)) {
        map.get(statusKey).push(t);
      }
    });

    return map;
  }, [filteredByType]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
        <p className={`text-xs ${isDarkMode ? "text-slate-400" : "text-gray-500"}`}>
          กำลังโหลดรายการงานซ่อม...
        </p>
      </div>
    );
  }

  // 🟢 Render การ์ดงานแต่ละใบ
  const renderCardItem = (t) => {
    const isAcceptor = Number(t.accepted_by) === currentEmpId;
    const canComplete = isAcceptor || isAdmin;
    const isProcessing = actionLoadingId === t.task_id;
    const typeInfo = getTaskTypeBadge(t.task_type);
    const taskImages = extractTaskImages(t);
    const isAcceptable = canUserAcceptTask(t);

    return (
      <div
        key={t.task_id}
        className={`w-72 sm:w-80 shrink-0 rounded-2xl border p-4 flex flex-col justify-between gap-2.5 shadow-sm hover:shadow-md transition-all relative overflow-hidden ${
          isDarkMode
            ? "bg-[#1E293B] border-slate-700/70 text-slate-200"
            : "bg-white border-gray-200 text-gray-800"
        }`}
      >
        <div
          className={`absolute top-0 left-0 right-0 h-1.5 ${
            t.status === "complete"
              ? "bg-emerald-500"
              : t.status === "in_progress"
              ? "bg-amber-500"
              : "bg-slate-400"
          }`}
        />

        <div className="space-y-1.5 pt-1">
          <div className="flex items-center justify-between">
            <span className="font-mono font-bold text-sm text-blue-500">
              {t.task_id}
            </span>
            <span className={`px-2 py-0.5 rounded-lg text-[10px] border ${typeInfo.style}`}>
              {typeInfo.label}
            </span>
          </div>

          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-blue-400">{t.lines}</span>
              <span
                className={`px-1.5 py-0.2 rounded text-[9px] font-bold border ${
                  t.shift === "b"
                    ? "bg-indigo-500/15 text-indigo-300 border-indigo-500/30"
                    : "bg-amber-500/15 text-amber-300 border-amber-500/30"
                }`}
              >
                กะ {String(t.shift || "a").toUpperCase()}
              </span>
            </div>
            <span
              className="text-[11px] text-gray-400 truncate max-w-[130px]"
              title={t.station_name || t.station_id}
            >
              {t.station_id} {t.station_name ? `(${t.station_name})` : ""}
            </span>
          </div>
        </div>

        <div className="my-1 flex items-start gap-2.5">
          {taskImages.length > 0 && (
            <button
              type="button"
              onClick={() => openLightbox(taskImages, 0)}
              className="relative shrink-0 w-14 h-14 rounded-xl overflow-hidden border border-slate-700/50 hover:border-blue-500 transition-all shadow-sm"
              title="คลิกดูภาพใหญ่"
            >
              <img
                src={taskImages[0]}
                alt="Problem Thumbnail"
                className="w-full h-full object-cover"
              />
              {taskImages.length > 1 && (
                <span className="absolute bottom-0 right-0 bg-blue-600/90 text-white font-mono text-[9px] font-bold px-1 rounded-tl">
                  +{taskImages.length - 1}
                </span>
              )}
            </button>
          )}
          <p
            className={`text-xs leading-relaxed line-clamp-3 font-medium ${
              isDarkMode ? "text-slate-300" : "text-gray-700"
            }`}
            title={t.problem}
          >
            {t.problem}
          </p>
        </div>

        <div className="pt-2 border-t border-gray-100 dark:border-slate-700/60 text-[11px] space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-gray-400">ผู้รับผิดชอบ:</span>
            {t.accepted_by ? (
              <span className={`font-semibold ${isAcceptor ? "text-emerald-400" : "text-blue-400"}`}>
                {t.accepted_by_name || `#${t.accepted_by}`} {isAcceptor && "(You)"}
              </span>
            ) : (
              <span className="text-gray-400 italic">Unassigned</span>
            )}
          </div>
          <div className="text-gray-400 text-[10px] space-y-0.5">
            <div className="flex items-center justify-between">
              <span>สร้าง:</span>
              <span>{formatDate(t.created_at)}</span>
            </div>
            {t.accepted_at && (
              <div className="flex items-center justify-between text-blue-400">
                <span>รับงาน:</span>
                <span>{formatDate(t.accepted_at)}</span>
              </div>
            )}
            {t.end_at && (
              <div className="flex items-center justify-between text-emerald-400 font-semibold">
                <span>เสร็จ:</span>
                <span>{formatDate(t.end_at)}</span>
              </div>
            )}
          </div>
        </div>

        <div className="pt-2 border-t border-gray-100 dark:border-slate-700/60 flex items-center justify-between gap-1.5">
          {isAdmin ? (
            <div className="flex items-center justify-between w-full gap-1.5">
              <select
                value={t.status}
                disabled={isProcessing}
                onChange={(e) => handleAdminQuickStatusChange(t, e.target.value)}
                className={`flex-1 px-2 py-1.5 rounded-xl font-bold text-[11px] border outline-none cursor-pointer transition-all ${
                  t.status === "pending"
                    ? "bg-slate-500/10 text-slate-400 border-slate-500/20"
                    : t.status === "in_progress"
                    ? "bg-amber-500/10 text-amber-500 border-amber-500/20"
                    : "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
                }`}
              >
                <option value="pending" className="bg-[#1E293B] text-slate-300">Pending</option>
                <option value="in_progress" className="bg-[#1E293B] text-amber-400">In Progress</option>
                <option value="complete" className="bg-[#1E293B] text-emerald-400">Completed</option>
              </select>

              <button
                onClick={() => handleOpenViewDetails(t)}
                title="ดูรายละเอียดงานและรูปภาพทั้งหมด"
                className="p-1.5 rounded-xl text-emerald-400 hover:bg-emerald-500/10 transition-colors border border-emerald-500/20"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
              </button>

              <button
                onClick={() => handleOpenAdminModal(t)}
                title="แก้ไขรายละเอียดและสถานะงาน"
                className="p-1.5 rounded-xl text-purple-400 hover:bg-purple-500/10 transition-colors border border-purple-500/20"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </button>

              <button
                onClick={() => handleDeleteTask(t.task_id)}
                disabled={isProcessing}
                title="Delete Task"
                className="p-1.5 rounded-xl text-rose-400 hover:bg-rose-500/10 transition-colors border border-rose-500/20"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          ) : userRole === "pd" ? (
            <div className="flex items-center justify-between w-full">
              <span className={`px-2.5 py-1 rounded-lg font-bold text-[10px] ${
                t.status === "complete"
                  ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                  : t.status === "in_progress"
                  ? "bg-amber-500/10 text-amber-500 border border-amber-500/20"
                  : "bg-slate-500/10 text-slate-400 border border-slate-500/20"
              }`}>
                {t.status === "complete" ? "Completed" : t.status === "in_progress" ? "In Progress" : "Pending"}
              </span>
              <button
                onClick={() => handleOpenViewDetails(t)}
                className="px-3 py-1 text-xs font-bold text-blue-400 hover:bg-blue-500/10 border border-blue-500/30 rounded-xl transition-all"
              >
                Details
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between w-full gap-2">
              {t.status === "pending" && (
                isAcceptable ? (
                  <button
                    onClick={() => handleAcceptTask(t.task_id)}
                    disabled={isProcessing}
                    className="flex-1 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-xs shadow-sm transition-all disabled:opacity-50"
                  >
                    {isProcessing ? "Processing..." : "Accept"}
                  </button>
                ) : (
                  <span className="px-2.5 py-1 rounded-lg font-bold text-[10px] bg-slate-500/10 text-slate-400 border border-slate-500/20">
                    Pending
                  </span>
                )
              )}

              {t.status === "in_progress" && (
                <div className="flex items-center gap-1.5 flex-1">
                  {canComplete && (
                    <button
                      onClick={() => handleOpenCompleteModal(t)}
                      disabled={isProcessing}
                      className="flex-1 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-xs shadow-sm transition-all disabled:opacity-50"
                    >
                      Complete
                    </button>
                  )}

                  {(isAcceptor || isAdmin) && (
                    <button
                      type="button"
                      onClick={() => handleCancelAcceptTask(t.task_id)}
                      disabled={isProcessing}
                      title="ยกเลิกการรับงานนี้เพื่อคืนกลับไปเป็น Pending"
                      className="px-2.5 py-1.5 rounded-xl font-bold text-xs bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 transition-all"
                    >
                      ยกเลิก
                    </button>
                  )}
                </div>
              )}

              {t.status === "complete" && (
                <span className="px-2.5 py-1 rounded-lg font-bold text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  Completed
                </span>
              )}

              <button
                onClick={() => handleOpenViewDetails(t)}
                className="px-3 py-1 text-xs font-bold text-emerald-400 hover:bg-emerald-500/10 border border-emerald-500/30 rounded-xl transition-all"
              >
                Details
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6 select-none">
      {/* Header Controls & Filters */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-gray-200 dark:border-slate-700/60">
        <div>
          <div className="flex items-center gap-2">
            <h2 className={`text-xl font-bold ${isDarkMode ? "text-white" : "text-gray-900"}`}>
              Task Management
            </h2>
            <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping"></span>
              LIVE
            </span>
            <span
              className={`px-2.5 py-0.5 rounded-lg text-[10px] font-bold uppercase border ${
                isAdmin
                  ? "bg-purple-500/10 text-purple-400 border-purple-500/20"
                  : "bg-blue-500/10 text-blue-400 border-blue-500/20"
              }`}
            >
              {isAdmin ? "Admin Controller" : `${userRole.toUpperCase()} View (#${currentEmpId})`}
            </span>
          </div>
        </div>

        {/* View Mode Switcher, Date Range & Type Filter */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* ปุ่มสลับมุมมอง แถบตาราง vs การ์ด */}
          <div
            className={`flex items-center p-1 rounded-xl border ${
              isDarkMode ? "bg-[#1E293B] border-slate-700/80" : "bg-gray-100 border-gray-200"
            }`}
          >
            <button
              type="button"
              onClick={() => setViewMode("card")}
              title="แสดงมุมมองการ์ดแนวนอนเลื่อนข้าง (Horizontal Card Row View)"
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                viewMode === "card"
                  ? "bg-blue-600 text-white shadow-sm font-bold"
                  : isDarkMode
                  ? "text-slate-400 hover:text-slate-200 hover:bg-slate-700/40"
                  : "text-gray-600 hover:text-gray-900 hover:bg-gray-200/60"
              }`}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
              </svg>
              <span>การ์ด (Card)</span>
            </button>

            <button
              type="button"
              onClick={() => setViewMode("table")}
              title="แสดงมุมมองแถบตาราง (Table Row View)"
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                viewMode === "table"
                  ? "bg-blue-600 text-white shadow-sm font-bold"
                  : isDarkMode
                  ? "text-slate-400 hover:text-slate-200 hover:bg-slate-700/40"
                  : "text-gray-600 hover:text-gray-900 hover:bg-gray-200/60"
              }`}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 10h16M4 14h16M4 18h16" />
              </svg>
              <span>แถบตาราง</span>
            </button>
          </div>

          {/* ตัวเลือกช่วงเวลา */}
          <div className={`flex items-center p-1 rounded-xl border ${
            isDarkMode ? "bg-[#1E293B] border-slate-700/80" : "bg-gray-100 border-gray-200"
          }`}>
            {[
              { id: "all", label: "ทั้งหมด" },
              { id: "today", label: "Today" },
              { id: "7days", label: "Last 7 Days" },
              { id: "30days", label: "Last 30 Days" },
              { id: "custom", label: "Custom" },
            ].map((btn) => {
              const isActive = timeRange === btn.id;
              return (
                <button
                  key={btn.id}
                  type="button"
                  onClick={() => setTimeRange(btn.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    isActive
                      ? "bg-blue-600 text-white shadow-sm font-bold"
                      : isDarkMode
                      ? "text-slate-400 hover:text-slate-200 hover:bg-slate-700/40"
                      : "text-gray-600 hover:text-gray-900 hover:bg-gray-200/60"
                  }`}
                >
                  {btn.label}
                </button>
              );
            })}
          </div>

          {timeRange === "custom" && (
            <div className="flex items-center gap-1.5 animate-in fade-in duration-150">
              <input
                type="date"
                value={customStartDate}
                onChange={(e) => setCustomStartDate(e.target.value)}
                className={`px-2.5 py-1.5 rounded-xl border text-xs outline-none font-semibold ${
                  isDarkMode ? "bg-[#1E293B] border-slate-700 text-white" : "bg-white border-gray-300 text-gray-900 focus:border-blue-500"
                }`}
              />
              <span className={`text-xs font-bold ${isDarkMode ? "text-slate-400" : "text-gray-500"}`}>-</span>
              <input
                type="date"
                value={customEndDate}
                onChange={(e) => setCustomEndDate(e.target.value)}
                className={`px-2.5 py-1.5 rounded-xl border text-xs outline-none font-semibold ${
                  isDarkMode ? "bg-[#1E293B] border-slate-700 text-white" : "bg-white border-gray-300 text-gray-900 focus:border-blue-500"
                }`}
              />
            </div>
          )}

          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className={`px-3 py-2 rounded-xl text-xs font-semibold border outline-none cursor-pointer transition-all ${
              isDarkMode
                ? "bg-[#1E293B] border-slate-700 text-slate-200"
                : "bg-white border-gray-200 text-gray-700 shadow-sm"
            }`}
          >
            <option value="all">ทุกประเภทงาน</option>
            <option value="pd_call_me">PD Call ME</option>
            <option value="general">งานแจ้งซ่อมทั่วไป</option>
            <option value="shift_handover">งานส่งต่อกะ</option>
            <option value="improvement">งาน Improvement</option>
            <option value="product_issue">ปัญหา Product Issue</option>
          </select>

          <button
            onClick={() => fetchData(false)}
            title="Refresh Tasks"
            className={`p-2 rounded-xl border transition-colors shadow-sm ${
              isDarkMode
                ? "bg-[#1E293B] border-slate-700 text-slate-400 hover:text-white"
                : "bg-white border-gray-200 text-gray-500 hover:text-gray-800"
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>
      </div>

      {/* 🟢 ส่วนแสดงผลแบบแยกแถวตามสถานะ (Pending / In Progress / Complete) และเลื่อนข้างได้ */}
      <div className="space-y-8">
        {statusSections.map((sec) => {
          const statusTasks = groupedTasksByStatus.get(sec.key) || [];

          return (
            <div key={sec.key} className="space-y-3">
              {/* แถบหัวข้อสถานะประจำแถว */}
              <div className="flex items-center justify-between pb-1 border-b border-gray-200/60 dark:border-slate-800">
                <div className="flex items-center gap-2">
                  <span className="text-base">{sec.icon}</span>
                  <h3 className={`font-bold text-sm tracking-wide ${
                    isDarkMode ? "text-slate-100" : "text-gray-900"
                  }`}>
                    {sec.label}
                  </h3>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold border ${sec.badgeClass}`}>
                    {statusTasks.length} งาน
                  </span>
                </div>
                <span className="text-[11px] text-gray-400 italic hidden sm:inline">
                  ← เลื่อนซ้าย-ขวาเพื่อดูงานเพิ่มเติม →
                </span>
              </div>

              {/* กรณีไม่มีงานในสถานะนี้ */}
              {statusTasks.length === 0 ? (
                <div className="p-6 text-center text-xs text-gray-400 border border-dashed rounded-2xl">
                  ไม่มีรายการงานในสถานะนี้
                </div>
              ) : viewMode === "table" ? (
                /* 1. แสดงผลแบบแถบตาราง (Table View) แยกสถานะ เลื่อนซ้าย-ขวา */
                <div
                  className={`rounded-2xl border shadow-sm overflow-hidden ${
                    isDarkMode ? "bg-[#1E293B] border-slate-700/60 text-slate-300" : "bg-white border-gray-100 text-gray-600"
                  }`}
                >
                  <div className="overflow-x-auto custom-scrollbar">
                    <table className="w-full text-left text-xs">
                      <thead
                        className={`font-bold uppercase tracking-wider border-b ${
                          isDarkMode
                            ? "bg-slate-800/50 text-slate-400 border-slate-700/60"
                            : "bg-gray-50/50 text-gray-400 border-gray-100"
                        }`}
                      >
                        <tr>
                          <th className="p-4 pl-6 w-32">TASK ID</th>
                          <th className="p-4 w-44">LINE / STATION</th>
                          <th className="p-4 w-36">CATEGORY</th>
                          <th className="p-4 min-w-[200px]">PROBLEM / DETAILS</th>
                          <th className="p-4 text-center w-24">PHOTOS</th>
                          <th className="p-4 w-36">ASSIGNED TO</th>
                          <th className="p-4 text-center w-60">STATUS & ACTION</th>
                          <th className="p-4 pr-6 w-40">TIMESTAMPS</th>
                        </tr>
                      </thead>
                      <tbody className={`divide-y ${isDarkMode ? "divide-slate-700/50" : "divide-gray-100"}`}>
                        {statusTasks.map((t) => {
                          const isAcceptor = Number(t.accepted_by) === currentEmpId;
                          const canComplete = isAcceptor || isAdmin;
                          const isProcessing = actionLoadingId === t.task_id;
                          const typeInfo = getTaskTypeBadge(t.task_type);
                          const taskImages = extractTaskImages(t);
                          const isAcceptable = canUserAcceptTask(t);

                          return (
                            <tr
                              key={t.task_id}
                              className={`transition-colors ${isDarkMode ? "hover:bg-slate-700/30" : "hover:bg-gray-50/50"}`}
                            >
                              <td className="p-4 pl-6 font-mono font-bold text-blue-500">
                                {t.task_id}
                              </td>

                              <td className="p-4">
                                <div className="flex flex-col gap-1">
                                  <div className="flex items-center gap-1.5">
                                    <span className="font-bold text-blue-400">{t.lines}</span>
                                    <span
                                      className={`px-1.5 py-0.2 rounded text-[9px] font-bold border ${
                                        t.shift === "b"
                                          ? "bg-indigo-500/15 text-indigo-300 border-indigo-500/30"
                                          : "bg-amber-500/15 text-amber-300 border-amber-500/30"
                                      }`}
                                    >
                                      กะ {String(t.shift || "a").toUpperCase()}
                                    </span>
                                  </div>
                                  <span
                                    className={`text-[11px] truncate max-w-[150px] ${
                                      isDarkMode ? "text-slate-400" : "text-gray-500"
                                    }`}
                                    title={t.station_name || t.station_id}
                                  >
                                    {t.station_id} {t.station_name ? `(${t.station_name})` : ""}
                                  </span>
                                </div>
                              </td>

                              <td className="p-4">
                                <span className={`px-2.5 py-0.5 rounded-lg text-[10px] border inline-block whitespace-nowrap ${typeInfo.style}`}>
                                  {typeInfo.label}
                                </span>
                              </td>

                              <td className="p-4">
                                <div className="font-medium leading-relaxed max-w-xs truncate" title={t.problem}>
                                  {t.problem}
                                </div>
                              </td>

                              <td className="p-4 text-center">
                                {taskImages.length > 0 ? (
                                  <button
                                    type="button"
                                    onClick={() => openLightbox(taskImages, 0)}
                                    className="relative group inline-block rounded-lg overflow-hidden border border-slate-700/50 hover:border-blue-500 transition-all shadow-sm"
                                    title={`ดูรูปภาพปัญหา (${taskImages.length} รูป)`}
                                  >
                                    <img
                                      src={taskImages[0]}
                                      alt="Problem Thumbnail"
                                      className="w-10 h-10 object-cover group-hover:scale-110 transition-transform duration-200"
                                    />
                                    {taskImages.length > 1 && (
                                      <span className="absolute bottom-0 right-0 bg-blue-600/90 text-white font-mono text-[9px] font-bold px-1 rounded-tl">
                                        +{taskImages.length - 1}
                                      </span>
                                    )}
                                  </button>
                                ) : (
                                  <span className="text-gray-400 opacity-40">-</span>
                                )}
                              </td>

                              <td className="p-4">
                                {t.accepted_by ? (
                                  <div className="flex flex-col">
                                    <span
                                      className={`font-semibold text-[11px] ${
                                        isAcceptor ? "text-emerald-400" : isDarkMode ? "text-slate-200" : "text-gray-700"
                                      }`}
                                    >
                                      {t.accepted_by_name || `#${t.accepted_by}`}
                                    </span>
                                    <span className="text-[10px] text-gray-400 font-mono">
                                      ID: #{t.accepted_by} {isAcceptor && "(You)"}
                                    </span>
                                  </div>
                                ) : (
                                  <span className="text-gray-400 italic text-[11px]">Unassigned</span>
                                )}
                              </td>

                              <td className="p-4 text-center">
                                {isAdmin ? (
                                  <div className="flex items-center justify-center gap-1.5">
                                    <select
                                      value={t.status}
                                      disabled={isProcessing}
                                      onChange={(e) => handleAdminQuickStatusChange(t, e.target.value)}
                                      className={`px-2.5 py-1 rounded-lg font-bold text-[11px] border outline-none cursor-pointer transition-all ${
                                        t.status === "pending"
                                          ? "bg-slate-500/10 text-slate-400 border-slate-500/20"
                                          : t.status === "in_progress"
                                          ? "bg-amber-500/10 text-amber-500 border-amber-500/20"
                                          : "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
                                      }`}
                                    >
                                      <option value="pending" className="bg-[#1E293B] text-slate-300">Pending</option>
                                      <option value="in_progress" className="bg-[#1E293B] text-amber-400">In Progress</option>
                                      <option value="complete" className="bg-[#1E293B] text-emerald-400">Completed</option>
                                    </select>

                                    <button
                                      onClick={() => handleOpenViewDetails(t)}
                                      title="ดูรายละเอียดงานและรูปภาพทั้งหมด"
                                      className="p-1.5 rounded-lg text-emerald-400 hover:bg-emerald-500/10 transition-colors border border-emerald-500/20"
                                    >
                                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                      </svg>
                                    </button>

                                    <button
                                      onClick={() => handleOpenAdminModal(t)}
                                      title="แก้ไขรายละเอียดและสถานะงาน"
                                      className="p-1.5 rounded-lg text-purple-400 hover:bg-purple-500/10 transition-colors border border-purple-500/20"
                                    >
                                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                      </svg>
                                    </button>

                                    <button
                                      onClick={() => handleDeleteTask(t.task_id)}
                                      disabled={isProcessing}
                                      title="Delete Task"
                                      className="p-1.5 rounded-lg text-rose-400 hover:bg-rose-500/10 transition-colors border border-rose-500/20"
                                    >
                                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                      </svg>
                                    </button>
                                  </div>
                                ) : userRole === "pd" ? (
                                  <div className="flex items-center justify-center gap-1.5">
                                    {t.status === "pending" && (
                                      <span className="px-2.5 py-1 rounded-lg font-bold text-[10px] bg-slate-500/10 text-slate-400 border border-slate-500/20">
                                        Pending
                                      </span>
                                    )}
                                    {t.status === "in_progress" && (
                                      <span className="px-2.5 py-1 rounded-lg font-bold text-[10px] bg-amber-500/10 text-amber-500 border border-amber-500/20">
                                        In Progress (#{t.accepted_by})
                                      </span>
                                    )}
                                    {t.status === "complete" && (
                                      <span className="px-2.5 py-1 rounded-lg font-bold text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                        Completed
                                      </span>
                                    )}
                                    <button
                                      onClick={() => handleOpenViewDetails(t)}
                                      className="px-2.5 py-1 text-[10px] font-bold text-blue-400 hover:bg-blue-500/10 border border-blue-500/30 rounded-lg flex items-center gap-1 transition-all"
                                      title="View Details"
                                    >
                                      Details
                                    </button>
                                  </div>
                                ) : (
                                  <div className="flex items-center justify-center gap-1.5 flex-wrap">
                                    {t.status === "pending" && (
                                      isAcceptable ? (
                                        <button
                                          onClick={() => handleAcceptTask(t.task_id)}
                                          disabled={isProcessing}
                                          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold text-[11px] shadow-sm transition-all disabled:opacity-50"
                                        >
                                          {isProcessing ? "Processing..." : "Accept"}
                                        </button>
                                      ) : (
                                        <span className="px-2.5 py-1 rounded-lg font-bold text-[10px] bg-slate-500/10 text-slate-400 border border-slate-500/20">
                                          {t.task_type === "shift_handover" ? "รอ Owner อีกกะรับงาน" : "Pending"}
                                        </span>
                                      )
                                    )}

                                    {t.status === "in_progress" && (
                                      <>
                                        {canComplete ? (
                                          <button
                                            onClick={() => handleOpenCompleteModal(t)}
                                            disabled={isProcessing}
                                            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold text-[11px] shadow-sm transition-all disabled:opacity-50"
                                          >
                                            Complete
                                          </button>
                                        ) : (
                                          <span className="px-2 py-1 rounded-lg font-bold text-[10px] bg-amber-500/10 text-amber-500 border border-amber-500/20 text-center">
                                            In Progress (#{t.accepted_by})
                                          </span>
                                        )}

                                        {(isAcceptor || isAdmin) && (
                                          <button
                                            type="button"
                                            onClick={() => handleCancelAcceptTask(t.task_id)}
                                            disabled={isProcessing}
                                            title="ยกเลิกการรับงานนี้เพื่อคืนกลับไปเป็น Pending"
                                            className="px-2 py-1.5 rounded-lg font-bold text-[10px] bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 transition-all"
                                          >
                                            ยกเลิก
                                          </button>
                                        )}
                                      </>
                                    )}

                                    {t.status === "complete" && (
                                      <span className="px-2.5 py-1 rounded-lg font-bold text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                        Completed
                                      </span>
                                    )}

                                    <button
                                      onClick={() => handleOpenViewDetails(t)}
                                      className="px-2.5 py-1 text-[10px] font-bold text-emerald-400 hover:bg-emerald-500/10 border border-emerald-500/30 rounded-lg flex items-center gap-1 transition-all"
                                      title="ดูรายละเอียดงานและรูปภาพทั้งหมด"
                                    >
                                      Details
                                    </button>
                                  </div>
                                )}
                              </td>

                              <td className="p-4 pr-6 text-[11px] opacity-80 whitespace-nowrap">
                                <div>สร้าง: {formatDate(t.created_at)}</div>
                                {t.accepted_at && (
                                  <div className="text-blue-400 font-medium mt-0.5">
                                    รับงาน: {formatDate(t.accepted_at)}
                                  </div>
                                )}
                                {t.end_at && (
                                  <div className="text-emerald-400 font-medium mt-0.5">
                                    เสร็จ: {formatDate(t.end_at)}
                                  </div>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                /* 2. แสดงผลแบบการ์ดแถวแนวนอนเลื่อนข้าง (Horizontal Card Row View) แยกสถานะ */
                <div className="flex gap-4 overflow-x-auto pb-3 pt-1 px-1 custom-scrollbar scroll-smooth">
                  {statusTasks.map((t) => renderCardItem(t))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* MODAL: ดูรายละเอียด Solution & Task Details */}
      {viewDetailModalOpen && taskDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn">
          <div
            className={`w-full max-w-3xl rounded-2xl p-6 border shadow-2xl transition-all max-h-[90vh] overflow-y-auto ${
              isDarkMode ? "bg-[#1E293B] border-slate-700 text-white" : "bg-white border-gray-200 text-gray-900"
            }`}
          >
            <div className="flex items-center justify-between mb-4 border-b pb-3 border-gray-200 dark:border-slate-700">
              <div className="flex items-center gap-2.5">
                <div>
                  <h3 className="text-base font-bold flex items-center gap-2">
                    <span>Task Details:</span>
                    <span className="text-xs font-mono text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded border border-blue-500/20 font-bold">
                      {taskDetail.task_id}
                    </span>
                  </h3>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className={`px-1.5 py-0.2 rounded text-[9px] font-bold border ${getTaskTypeBadge(taskDetail.task_type).style}`}>
                      {getTaskTypeBadge(taskDetail.task_type).label}
                    </span>
                    <span className="text-xs text-gray-400">
                      Line: <strong className="text-blue-400">{taskDetail.lines}</strong> | Station: <strong className="text-purple-400">{taskDetail.station_id}</strong> (กะ {String(taskDetail.shift || 'a').toUpperCase()})
                    </span>
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setViewDetailModalOpen(false)}
                className="p-1.5 rounded-lg opacity-60 hover:opacity-100 transition-opacity"
              >
                ✕
              </button>
            </div>

            <div className="space-y-5 text-xs">
              <div className="space-y-2">
                <span className="font-bold text-rose-400 uppercase tracking-wider block text-xs">
                  Problem Details / ข้อมูลปัญหาแจ้งซ่อม
                </span>
                <div
                  className={`p-3.5 rounded-xl border leading-relaxed break-words whitespace-pre-wrap ${
                    isDarkMode ? "bg-[#0F172A] border-slate-700/70 text-slate-200" : "bg-gray-50 border-gray-200 text-gray-800"
                  }`}
                >
                  {taskDetail.problem}
                </div>

                <div>
                  <span className="text-[11px] font-semibold text-gray-400 mb-1.5 block">
                    รูปภาพตอนแจ้งปัญหา (Before Repair) : {extractTaskImages(taskDetail).length > 0 ? `${extractTaskImages(taskDetail).length} รูป` : "ไม่มีรูปภาพแนบ"}
                  </span>
                  {extractTaskImages(taskDetail).length > 0 ? (
                    <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 gap-2.5 border rounded-xl p-3 bg-black/20">
                      {extractTaskImages(taskDetail).map((imgUrl, idx) => (
                        <div
                          key={idx}
                          onClick={() => openLightbox(extractTaskImages(taskDetail), idx)}
                          className="relative group aspect-video rounded-lg overflow-hidden border border-slate-700/60 bg-black/30 cursor-pointer shadow-sm"
                        >
                          <img
                            src={imgUrl}
                            alt={`Before Repair ${idx + 1}`}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                          />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="p-3 rounded-xl border border-dashed border-slate-700/60 text-center text-gray-500 italic text-[11px]">
                      ไม่มีการแนบรูปภาพปัญหา
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-2 pt-3 border-t border-slate-700/50">
                <span className="font-bold text-emerald-400 uppercase tracking-wider block text-xs">
                  Solution / วิธีการแก้ไขและผลการดำเนินงาน
                </span>
                <div
                  className={`p-3.5 rounded-xl border leading-relaxed font-medium break-words whitespace-pre-wrap ${
                    isDarkMode
                      ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-200"
                      : "bg-emerald-50 border-emerald-200 text-emerald-900"
                  }`}
                >
                  {taskDetail.solution || "ยังไม่มีการบันทึกรายละเอียดการดำเนินการ"}
                </div>

                <div>
                  <span className="text-[11px] font-semibold text-emerald-400 mb-1.5 block">
                    รูปภาพผลการแก้ไขปัญหา (After Repair) : {extractSolutionImages(taskDetail).length > 0 ? `${extractSolutionImages(taskDetail).length} รูป` : "ไม่มีรูปภาพแนบ"}
                  </span>
                  {extractSolutionImages(taskDetail).length > 0 ? (
                    <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 gap-2.5 border border-emerald-500/30 rounded-xl p-3 bg-emerald-950/20">
                      {extractSolutionImages(taskDetail).map((imgUrl, idx) => (
                        <div
                          key={idx}
                          onClick={() => openLightbox(extractSolutionImages(taskDetail), idx)}
                          className="relative group aspect-video rounded-lg overflow-hidden border border-emerald-500/50 bg-black/30 cursor-pointer shadow-sm"
                        >
                          <img
                            src={imgUrl}
                            alt={`After Repair ${idx + 1}`}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                          />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="p-3 rounded-xl border border-dashed border-emerald-500/20 text-center text-gray-500 italic text-[11px]">
                      ไม่มีการแนบรูปภาพผลการซ่อม
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-4 mt-4 border-t border-gray-200 dark:border-slate-700/60">
              <button
                type="button"
                onClick={() => setViewDetailModalOpen(false)}
                className="px-5 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-sm transition-all"
              >
                ปิดหน้าต่าง
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: กรอก Solution ตอนกด Complete */}
      {completeModalOpen && taskToComplete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn">
          <div
            className={`w-full max-w-xl rounded-2xl p-6 border shadow-2xl transition-all max-h-[90vh] overflow-y-auto ${
              isDarkMode ? "bg-[#1E293B] border-slate-700 text-white" : "bg-white border-gray-200 text-gray-900"
            }`}
          >
            <div className="flex items-center justify-between mb-4 border-b pb-3 border-gray-200 dark:border-slate-700">
              <div>
                <h3 className="text-base font-bold">Complete Task</h3>
                <p className="text-xs text-blue-400 font-mono mt-0.5">Task ID: {taskToComplete.task_id}</p>
              </div>
              <button
                type="button"
                onClick={() => setCompleteModalOpen(false)}
                className="opacity-60 hover:opacity-100 text-sm"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleConfirmComplete} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold mb-1 text-gray-400">รายละเอียดงาน</label>
                <div
                  className={`p-3 rounded-xl border leading-relaxed break-words whitespace-pre-wrap ${
                    isDarkMode ? "bg-[#0F172A] border-slate-700 text-slate-300" : "bg-gray-50 border-gray-200 text-gray-700"
                  }`}
                >
                  {taskToComplete.problem}
                </div>
              </div>

              <div>
                <label className="block font-semibold mb-1 text-gray-400">
                  วิธีการแก้ไขปัญหา / ผลการดำเนินการ (Solution / Action Taken) *
                </label>
                <textarea
                  rows={4}
                  required
                  placeholder="อธิบายขั้นตอนการตรวจเช็คและการแก้ไข..."
                  value={solutionInput}
                  onChange={(e) => setSolutionInput(e.target.value)}
                  className={`w-full p-3 rounded-xl border outline-none leading-relaxed resize-none focus:border-emerald-500 transition-colors ${
                    isDarkMode ? "bg-[#0F172A] border-slate-700 text-white placeholder-slate-500" : "bg-gray-50 border-gray-300 text-gray-900 placeholder-gray-400"
                  }`}
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block font-semibold text-gray-400">
                    Attach Repair Photos / แนบรูปภาพผลการแก้ไข <span className="normal-case font-normal text-slate-500">(สูงสุด 5 รูป)</span>
                  </label>
                  {selectedSolutionImages.length > 0 && (
                    <span className="text-[11px] text-emerald-400 font-bold">
                      เลือกแล้ว {selectedSolutionImages.length} / 5 รูป
                    </span>
                  )}
                </div>

                <div className="mb-3">
                  <label className="cursor-pointer block">
                    <div
                      className={`flex flex-col items-center justify-center border-2 border-dashed rounded-xl p-4 shadow-sm transition-all ${
                        selectedSolutionImages.length >= 5
                          ? "opacity-40 pointer-events-none"
                          : isDarkMode
                          ? "border-slate-700 hover:border-emerald-500 bg-[#0F172A]/40 hover:bg-[#0F172A]"
                          : "border-gray-300 hover:border-emerald-500 bg-gray-50 hover:bg-emerald-50/30"
                      }`}
                    >
                      <span className="text-xs font-semibold text-emerald-400">
                        แนบรูปภาพผลการซ่อม/แก้ไข (ถ่ายสดหรือเลือกจากเครื่อง)
                      </span>
                    </div>
                    <input
                      key={`file-${selectedSolutionImages.length}`}
                      type="file"
                      multiple
                      className="hidden"
                      onChange={handleSolutionImagesChange}
                      disabled={selectedSolutionImages.length >= 5}
                    />
                  </label>
                </div>

                {solutionImagePreviews.length > 0 && (
                  <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                    {solutionImagePreviews.map((previewUrl, idx) => (
                      <div key={idx} className="relative group border border-emerald-500/40 rounded-xl overflow-hidden shadow-sm aspect-video bg-black/20">
                        <img src={previewUrl} alt={`Solution Preview ${idx + 1}`} className="w-full h-full object-cover" />
                        <button
                          type="button"
                          onClick={() => handleRemoveSpecificSolutionImage(idx)}
                          className="absolute top-1 right-1 bg-rose-600 hover:bg-rose-700 text-white rounded-full p-1 shadow-md transition-colors"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-gray-200 dark:border-slate-700/60">
                <button
                  type="button"
                  onClick={() => setCompleteModalOpen(false)}
                  className="px-4 py-2 font-medium rounded-xl hover:bg-gray-500/10 text-gray-400 transition-colors"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={submittingSolution}
                  className="px-5 py-2 font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl shadow-md transition-all disabled:opacity-50"
                >
                  {submittingSolution ? "กำลังบันทึก..." : "ยืนยันปิดงาน"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ADMIN EDIT & CONTROLLER MODAL */}
      {adminModalOpen && selectedTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn">
          <div
            className={`w-full max-w-xl rounded-2xl p-6 border shadow-2xl transition-all max-h-[90vh] overflow-y-auto ${
              isDarkMode ? "bg-[#1E293B] border-slate-700 text-white" : "bg-white border-gray-200 text-gray-900"
            }`}
          >
            <div className="flex items-center justify-between mb-4 border-b pb-3 border-gray-200 dark:border-slate-700">
              <div>
                <h3 className="text-base font-bold">แก้ไขข้อมูลงานซ่อม (Task Editor)</h3>
                <p className="text-xs text-blue-400 font-mono mt-0.5">Task ID: {selectedTask.task_id}</p>
              </div>
              <button
                type="button"
                onClick={() => setAdminModalOpen(false)}
                className="opacity-60 hover:opacity-100 text-sm"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleAdminModalSubmit} className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold mb-1 text-gray-400">Line *</label>
                  <input
                    type="text"
                    required
                    value={adminLineInput}
                    onChange={(e) => setAdminLineInput(e.target.value.toUpperCase())}
                    className={`w-full px-3 py-2 rounded-xl border outline-none font-bold ${
                      isDarkMode ? "bg-[#0F172A] border-slate-700 text-white" : "bg-gray-50 border-gray-300 text-gray-900"
                    }`}
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1 text-gray-400">Station *</label>
                  <input
                    type="text"
                    required
                    value={adminStationInput}
                    onChange={(e) => setAdminStationInput(e.target.value)}
                    className={`w-full px-3 py-2 rounded-xl border outline-none font-bold ${
                      isDarkMode ? "bg-[#0F172A] border-slate-700 text-white" : "bg-gray-50 border-gray-300 text-gray-900"
                    }`}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold mb-1 text-gray-400">ประเภทงาน (Category) *</label>
                  <select
                    value={adminTaskTypeInput}
                    onChange={(e) => setAdminTaskTypeInput(e.target.value)}
                    className={`w-full px-3 py-2 rounded-xl border outline-none font-semibold ${
                      isDarkMode ? "bg-[#0F172A] border-slate-700 text-white" : "bg-gray-50 border-gray-300 text-gray-900"
                    }`}
                  >
                    <option value="general">แจ้งซ่อมทั่วไป (General)</option>
                    <option value="pd_call_me">PD Call ME</option>
                    <option value="shift_handover">ส่งต่องานระหว่างกะ</option>
                    <option value="improvement">งาน Improvement</option>
                    <option value="product_issue">ปัญหา Product Issue</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold mb-1 text-gray-400">กะการทำงาน (Shift) *</label>
                  <select
                    value={adminShiftInput}
                    onChange={(e) => setAdminShiftInput(e.target.value)}
                    className={`w-full px-3 py-2 rounded-xl border outline-none font-semibold ${
                      isDarkMode ? "bg-[#0F172A] border-slate-700 text-white" : "bg-gray-50 border-gray-300 text-gray-900"
                    }`}
                  >
                    <option value="a">กะ A</option>
                    <option value="b">กะ B</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-semibold mb-1 text-gray-400">รายละเอียดปัญหา (Problem Details) *</label>
                <textarea
                  rows={3}
                  required
                  value={adminProblemInput}
                  onChange={(e) => setAdminProblemInput(e.target.value)}
                  className={`w-full p-3 rounded-xl border outline-none leading-relaxed resize-none ${
                    isDarkMode ? "bg-[#0F172A] border-slate-700 text-white" : "bg-gray-50 border-gray-300 text-gray-900"
                  }`}
                />
              </div>

              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-700/40">
                <div>
                  <label className="block font-semibold mb-1 text-gray-400">สถานะงาน (Status) *</label>
                  <select
                    value={adminStatusInput}
                    onChange={(e) => setAdminStatusInput(e.target.value)}
                    className={`w-full px-3 py-2 rounded-xl border outline-none font-semibold ${
                      isDarkMode ? "bg-[#0F172A] border-slate-700 text-white" : "bg-gray-50 border-gray-300 text-gray-900"
                    }`}
                  >
                    <option value="pending">Pending (รอดำเนินการ)</option>
                    <option value="in_progress">In Progress (กำลังซ่อม)</option>
                    <option value="complete">Completed (เสร็จสิ้น)</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold mb-1 text-gray-400">ผู้รับผิดชอบงาน</label>
                  <select
                    value={adminAssigneeInput}
                    onChange={(e) => setAdminAssigneeInput(e.target.value)}
                    disabled={adminStatusInput === "pending"}
                    className={`w-full px-3 py-2 rounded-xl border outline-none ${
                      adminStatusInput === "pending"
                        ? "opacity-50 cursor-not-allowed"
                        : isDarkMode ? "bg-[#0F172A] border-slate-700 text-white" : "bg-gray-50 border-gray-300 text-gray-900"
                    }`}
                  >
                    <option value="">-- ไม่ระบุผู้รับผิดชอบ --</option>
                    {engineers.map((eng) => (
                      <option key={eng.employee_id} value={eng.employee_id}>
                        #{eng.employee_id} - {eng.name} ({eng.role})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {adminStatusInput === "complete" && (
                <div>
                  <label className="block font-semibold mb-1 text-gray-400">วิธีแก้ไขปัญหา (Solution)</label>
                  <textarea
                    rows={3}
                    placeholder="ระบุวิธีแก้ไขปัญหา..."
                    value={adminSolutionInput}
                    onChange={(e) => setAdminSolutionInput(e.target.value)}
                    className={`w-full p-2.5 rounded-xl border outline-none leading-relaxed resize-none ${
                      isDarkMode ? "bg-[#0F172A] border-slate-700 text-white" : "bg-gray-50 border-gray-300 text-gray-900"
                    }`}
                  />
                </div>
              )}

              <div className="flex justify-end gap-2 pt-3 border-t border-gray-200 dark:border-slate-700/60">
                <button
                  type="button"
                  onClick={() => setAdminModalOpen(false)}
                  className="px-4 py-2 font-medium rounded-xl hover:bg-gray-500/10 text-gray-400 transition-colors"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={actionLoadingId === selectedTask.task_id}
                  className="px-5 py-2 font-semibold bg-purple-600 hover:bg-purple-700 text-white rounded-xl shadow-md transition-colors disabled:opacity-50"
                >
                  {actionLoadingId === selectedTask.task_id ? "กำลังบันทึก..." : "บันทึกการแก้ไข"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* LIGHTBOX MODAL */}
      {lightboxImages.length > 0 && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fadeIn select-none"
          onClick={closeLightbox}
        >
          <div className="relative max-w-4xl max-h-[90vh] flex flex-col items-center" onClick={(e) => e.stopPropagation()}>
            <img
              src={lightboxImages[lightboxIndex]}
              alt={`Fullscreen ${lightboxIndex + 1}`}
              className="max-w-full max-h-[80vh] rounded-2xl object-contain shadow-2xl border border-white/20"
            />

            {lightboxImages.length > 1 && (
              <div className="mt-3 px-3 py-1 bg-black/60 text-white text-xs font-mono font-bold rounded-full border border-white/20">
                {lightboxIndex + 1} / {lightboxImages.length}
              </div>
            )}

            {lightboxImages.length > 1 && (
              <button
                type="button"
                onClick={prevLightboxImage}
                className="absolute left-2 sm:-left-12 top-1/2 -translate-y-1/2 bg-white/20 hover:bg-white/40 text-white rounded-full p-2.5 shadow-lg transition-all"
                title="รูปก่อนหน้า"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            )}

            {lightboxImages.length > 1 && (
              <button
                type="button"
                onClick={nextLightboxImage}
                className="absolute right-2 sm:-right-12 top-1/2 -translate-y-1/2 bg-white/20 hover:bg-white/40 text-white rounded-full p-2.5 shadow-lg transition-all"
                title="รูปถัดไป"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5l7 7-7 7" />
                </svg>
              </button>
            )}

            <button
              type="button"
              onClick={closeLightbox}
              className="absolute -top-3 -right-3 bg-rose-600 hover:bg-rose-700 text-white rounded-full p-2 shadow-lg transition-colors"
              title="ปิด"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  );
}