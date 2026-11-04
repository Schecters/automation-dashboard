import React, { useState, useEffect, useRef, useCallback } from "react";

// 🟢 เพิ่มรับ prop isActive จากหน้า Home เพื่อเช็กว่าตอนนี้อยู่หน้านี้จริงหรือไม่
export default function PhotoOperator({ isDarkMode, isActive = true }) {
  const [employeeId, setEmployeeId] = useState("");
  const [mode, setMode] = useState("camera"); // "camera" หรือ "upload"
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [capturedImage, setCapturedImage] = useState(null);
  const [uploadedFile, setUploadedFile] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState({ type: "", text: "" });

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);

  const API_URL = `/api`;

  const getHeaders = () => {
    const token = localStorage.getItem("token") || localStorage.getItem("sessionToken");
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "x-session-token": token,
    };
  };

// 🟢 ฟังก์ชันปิดกล้องแบบบังคับเคลียร์ทุก Track บนเบราว์เซอร์
  const stopCamera = useCallback(() => {
    // 1. ปิดผ่าน Ref ปกติ
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    
    // 2. บังคับเคลียร์ทุก MediaStream ที่กำลังรันอยู่บนหน้าจอทั้งหมด (เผื่อกรณีค้าง)
    navigator.mediaDevices?.enumerateDevices?.().then(() => {
      if (videoRef.current && videoRef.current.srcObject) {
        const stream = videoRef.current.srcObject;
        stream.getTracks().forEach((track) => track.stop());
        videoRef.current.srcObject = null;
      }
    }).catch(() => {});

    setIsCameraActive(false);
  }, []);

  // 🟢 ใช้ useEffect เฝ้าดูสภาวะ active หรือตอนที่ component กำลังจะถูกทำลาย
  useEffect(() => {
    let currentStream = null;

    if (isActive && mode === "camera") {
      setMessage({ type: "", text: "" });
      
      navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 640 }, facingMode: "environment" },
        audio: false,
      }).then((stream) => {
        currentStream = stream;
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
        setIsCameraActive(true);
        setCapturedImage(null);
      }).catch((err) => {
        console.error("Camera Access Error:", err);
        setMessage({ type: "error", text: "ไม่สามารถเปิดกล้องได้ กรุณาตรวจสอบสิทธิ์" });
      });
    } else {
      stopCamera();
    }

    // เมื่อย้ายหน้า (isActive เปลี่ยนเป็น false หรือ Component Unmount) กล้องจะดับทันที
    return () => {
      if (currentStream) {
        currentStream.getTracks().forEach((track) => track.stop());
      }
      stopCamera();
    };
  }, [isActive, mode, stopCamera]);

  // 🟢 ควบคุมการเปิด/ปิดกล้องตาม mode และ prop isActive
  useEffect(() => {
    // ถ้าไม่ได้เปิดใช้งานหน้านี้ หรือไม่ได้เลือกโหมดกล้อง ให้ปิดกล้องทันที
    if (!isActive || mode !== "camera") {
      stopCamera();
      return;
    }

    let activeStream = null;
    setMessage({ type: "", text: "" });

    const initCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 640 },
            height: { ideal: 640 },
            facingMode: { exact: "environment" },
          },
          audio: false,
        });

        activeStream = stream;
        streamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setIsCameraActive(true);
        setCapturedImage(null);
      } catch (err) {
        console.warn("Exact environment camera not found, trying ideal...", err);
        try {
          const fallbackStream = await navigator.mediaDevices.getUserMedia({
            video: {
              width: { ideal: 640 },
              height: { ideal: 640 },
              facingMode: "environment",
            },
            audio: false,
          });

          activeStream = fallbackStream;
          streamRef.current = fallbackStream;

          if (videoRef.current) {
            videoRef.current.srcObject = fallbackStream;
            await videoRef.current.play();
          }
          setIsCameraActive(true);
          setCapturedImage(null);
        } catch (fallbackErr) {
          console.error("Camera Access Error:", fallbackErr);
          setMessage({
            type: "error",
            text: "ไม่สามารถเปิดกล้องหลังได้ กรุณาตรวจสอบสิทธิ์การเข้าถึงกล้อง หรือเลือกใช้โหมดอัปโหลดไฟล์แทน",
          });
        }
      }
    };

    initCamera();

    // Cleanup function: ปิดกล้องทันทีที่เปลี่ยนแท็บ, เปลี่ยนโหมด หรือ Unmount
    return () => {
      if (activeStream) {
        activeStream.getTracks().forEach((track) => track.stop());
      }
      stopCamera();
    };
  }, [isActive, mode, stopCamera]);

  // ถ่ายภาพจาก Video Stream ลง Canvas แล้วแปลงเป็น Base64
  const handleCapture = () => {
    if (!videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const size = Math.min(video.videoWidth, video.videoHeight);

    canvas.width = size;
    canvas.height = size;

    const ctx = canvas.getContext("2d");
    const startX = (video.videoWidth - size) / 2;
    const startY = (video.videoHeight - size) / 2;

    ctx.drawImage(video, startX, startY, size, size, 0, 0, size, size);

    const dataUrl = canvas.toDataURL("image/png");
    setCapturedImage(dataUrl);
    stopCamera();
  };

  // ถ่ายใหม่
  const handleRetake = () => {
    setCapturedImage(null);
    setMode("upload");
    setTimeout(() => setMode("camera"), 50);
  };

  // เลือกไฟล์รูปจากเครื่อง
  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/") && !/\.(jpe?g|png|webp|bmp|gif)$/i.test(file.name)) {
      alert("กรุณาเลือกไฟล์ที่เป็นรูปภาพเท่านั้น");
      return;
    }

    setUploadedFile(file);
    const previewUrl = URL.createObjectURL(file);
    setCapturedImage(previewUrl);
    setMessage({ type: "", text: "" });
  };

  // แปลงไฟล์เป็น Base64 ก่อนส่ง Server
  const convertFileToBase64 = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = (error) => reject(error);
      reader.readAsDataURL(file);
    });
  };

  // บันทึกภาพส่งไปที่ Backend
  const handleSavePhoto = async (e) => {
    e.preventDefault();
    const cleanId = employeeId.trim().replace(/\D/g, "");

    if (!cleanId) {
      setMessage({ type: "error", text: "กรุณาระบุรหัสพนักงานให้ถูกต้อง (เฉพาะตัวเลข)" });
      return;
    }

    if (!capturedImage) {
      setMessage({ type: "error", text: "กรุณาถ่ายภาพหรือเลือกไฟล์รูปภาพก่อนทำการบันทึก" });
      return;
    }

    setIsSaving(true);
    setMessage({ type: "", text: "" });

    try {
      let base64Image = capturedImage;

      if (mode === "upload" && uploadedFile) {
        base64Image = await convertFileToBase64(uploadedFile);
      }

      const res = await fetch(`${API_URL}/operator-photo`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({
          employee_id: cleanId,
          image_base64: base64Image,
        }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setMessage({
          type: "success",
          text: `บันทึกรูปภาพ ${data.fileName} ลงโฟลเดอร์เรียบร้อยแล้ว!`,
        });
        setEmployeeId("");
        setCapturedImage(null);
        setUploadedFile(null);
        if (mode === "camera") {
          setMode("upload");
          setTimeout(() => setMode("camera"), 50);
        }
      } else {
        setMessage({
          type: "error",
          text: data.message || "เกิดข้อผิดพลาดในการบันทึกรูปภาพ",
        });
      }
    } catch (err) {
      console.error("Save Photo Error:", err);
      setMessage({ type: "error", text: "ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ Backend ได้" });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="max-w-xl mx-auto space-y-6 select-none pb-12">
      {/* Title */}
      <div className="pb-4 border-b border-gray-200 dark:border-slate-700/60 flex items-center justify-between">
        <div>
          <h2 className={`text-xl font-bold ${isDarkMode ? "text-white" : "text-gray-900"}`}>
            Operator Photo Capture
          </h2>
          <p className={`text-xs mt-1 ${isDarkMode ? "text-slate-400" : "text-gray-600"}`}>
            ถ่ายภาพหรือเลือกไฟล์รูปภาพพนักงาน บันทึกเป็นไฟล์รหัสพนักงาน (.png)
          </p>
        </div>
        <span
          className={`px-2 py-0.5 rounded font-mono font-bold text-[10px] uppercase border ${
            isDarkMode
              ? "bg-purple-500/15 text-purple-400 border-purple-500/30"
              : "bg-purple-50 text-purple-700 border-purple-200"
          }`}
        >
          Target: /assets
        </span>
      </div>

      {/* แจ้งเตือน */}
      {message.text && (
        <div
          className={`p-3.5 rounded-xl border text-xs font-semibold flex items-center justify-between shadow-sm transition-all ${
            message.type === "success"
              ? isDarkMode
                ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                : "bg-emerald-50 text-emerald-800 border-emerald-300"
              : isDarkMode
              ? "bg-rose-500/15 text-rose-400 border-rose-500/30"
              : "bg-rose-50 text-rose-800 border-rose-300"
          }`}
        >
          <span>{message.text}</span>
          <button
            type="button"
            onClick={() => setMessage({ type: "", text: "" })}
            className="font-bold ml-2 text-sm"
          >
            ✕
          </button>
        </div>
      )}

      {/* ฟอร์มหลัก */}
      <form
        onSubmit={handleSavePhoto}
        className={`p-6 rounded-2xl border shadow-sm space-y-5 transition-colors ${
          isDarkMode ? "bg-[#1E293B] border-slate-700/60" : "bg-white border-gray-200"
        }`}
      >
        {/* รหัสพนักงาน */}
        <div>
          <label
            className={`block font-semibold text-xs mb-1.5 ${
              isDarkMode ? "text-gray-300" : "text-gray-800"
            }`}
          >
            รหัสพนักงาน (Employee ID) *
          </label>
          <input
            type="text"
            required
            pattern="[0-9]*"
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value.replace(/\D/g, ""))}
            placeholder="เช่น 86649767"
            className={`w-full px-4 py-2.5 rounded-xl border text-sm font-mono font-bold outline-none transition-colors ${
              isDarkMode
                ? "bg-slate-900 border-slate-700 text-white placeholder-slate-500 focus:border-blue-500"
                : "bg-gray-50 border-gray-300 text-gray-900 placeholder-gray-400 focus:bg-white focus:border-blue-500"
            }`}
          />
          {employeeId && (
            <p className="text-[11px] text-gray-500 font-mono mt-1">
              ชื่อไฟล์ที่จะบันทึก: <strong className="text-blue-500">{employeeId}.png</strong>
            </p>
          )}
        </div>

        {/* ปุ่มสลับโหมด: ถ่ายจากกล้อง / เลือกไฟล์จากเครื่อง */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className={`block font-semibold text-xs ${isDarkMode ? "text-gray-300" : "text-gray-800"}`}>
              แหล่งที่มาของรูปภาพ
            </label>
            <div className={`flex items-center p-1 rounded-xl border text-xs font-semibold ${
              isDarkMode ? "bg-slate-900 border-slate-700" : "bg-gray-100 border-gray-200"
            }`}>
              <button
                type="button"
                onClick={() => {
                  setMode("camera");
                  setCapturedImage(null);
                  setUploadedFile(null);
                }}
                className={`px-3 py-1 rounded-lg transition-all ${
                  mode === "camera"
                    ? "bg-blue-600 text-white shadow-sm font-bold"
                    : isDarkMode ? "text-slate-400 hover:text-slate-200" : "text-gray-600 hover:text-gray-900"
                }`}
              >
                ถ่ายจากกล้อง
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode("upload");
                  stopCamera();
                  setCapturedImage(null);
                  setUploadedFile(null);
                }}
                className={`px-3 py-1 rounded-lg transition-all ${
                  mode === "upload"
                    ? "bg-blue-600 text-white shadow-sm font-bold"
                    : isDarkMode ? "text-slate-400 hover:text-slate-200" : "text-gray-600 hover:text-gray-900"
                }`}
              >
                เลือกไฟล์ / ถ่ายจากเครื่อง
              </button>
            </div>
          </div>

          {/* แสดงผลตามโหมดที่เลือก */}
          {mode === "camera" ? (
            <div className="space-y-3">
              <div
                className={`w-72 h-72 mx-auto rounded-full overflow-hidden border-4 relative flex items-center justify-center shadow-lg transition-all ${
                  isDarkMode ? "bg-slate-900 border-slate-700" : "bg-gray-100 border-gray-300"
                }`}
              >
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className={`w-full h-full object-cover  ${
                    capturedImage ? "hidden" : "block"
                  }`}
                />
                {capturedImage && (
                  <img src={capturedImage} alt="Captured Operator" className="w-full h-full object-cover" />
                )}
                <canvas ref={canvasRef} className="hidden" />
              </div>

              <div className="flex items-center justify-center gap-2 pt-2">
                {!capturedImage ? (
                  <button
                    type="button"
                    onClick={handleCapture}
                    disabled={!isCameraActive}
                    className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl shadow-md transition-all disabled:opacity-50"
                  >
                    ถ่ายภาพ (Capture)
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleRetake}
                    className={`px-5 py-2.5 rounded-xl text-xs font-semibold border transition-all ${
                      isDarkMode ? "border-slate-700 hover:bg-slate-800 text-slate-300" : "border-gray-300 hover:bg-gray-100 text-gray-700"
                    }`}
                  >
                    ถ่ายใหม่ (Retake)
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <label className="cursor-pointer block">
                <div
                  className={`flex flex-col items-center justify-center border-2 border-dashed rounded-2xl p-6 shadow-sm transition-all ${
                    isDarkMode
                      ? "border-slate-700 hover:border-blue-500 bg-slate-900/60 hover:bg-slate-900"
                      : "border-gray-300 hover:border-blue-500 bg-gray-50 hover:bg-blue-50/30"
                  }`}
                >
                  <svg className="w-8 h-8 text-gray-400 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <span className="text-xs font-semibold text-blue-500">
                    แตะเพื่อเลือกไฟล์รูปภาพ หรือถ่ายภาพจากมือถือ
                  </span>
                  <span className="text-[11px] text-gray-400 mt-1">
                    รองรับไฟล์ PNG, JPG, WEBP
                  </span>
                </div>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleFileChange}
                />
              </label>

              {capturedImage && (
                <div className="flex flex-col items-center gap-2 pt-2">
                  <div className="w-36 h-36 rounded-full overflow-hidden border-2 border-blue-500 shadow-md">
                    <img src={capturedImage} alt="Uploaded Preview" className="w-full h-full object-cover" />
                  </div>
                  <span className="text-xs text-emerald-400 font-semibold">✓ เลือกรูปภาพเรียบร้อยแล้ว</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ปุ่มบันทึกไฟล์ */}
        <div className={`pt-4 border-t ${isDarkMode ? "border-slate-700/60" : "border-gray-200"}`}>
          <button
            type="submit"
            disabled={!capturedImage || !employeeId || isSaving}
            className={`w-full py-3 rounded-xl text-xs font-bold text-white transition-all shadow-md ${
              !capturedImage || !employeeId || isSaving
                ? "bg-gray-400 dark:bg-slate-700 opacity-50 cursor-not-allowed"
                : "bg-emerald-600 hover:bg-emerald-700 shadow-emerald-500/20"
            }`}
          >
            {isSaving ? "กำลังบันทึกภาพลงเครื่อง..." : `บันทึกภาพ (${employeeId ? `${employeeId}.png` : "ระบุรหัส"})`}
          </button>
        </div>
      </form>
    </div>
  );
}