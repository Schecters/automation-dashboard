import React, { useState, useEffect } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { socket, getSocketAuth, deviceId } from '../socket';
import { SESSION_EXPIRED_EVENT } from '../authInterceptor';

// กัน alert เด้งซ้ำหลายรอบ เมื่อหลาย request ได้ 401 พร้อมกัน
let isLoggingOut = false;

import Login from '../pages/Login';
import Home from '../pages/Home';

export default function AppRoutes() {
  const navigate = useNavigate();

  const [isDarkMode, setIsDarkMode] = useState(() => {
    const savedMode = localStorage.getItem("isDarkMode");
    return savedMode ? JSON.parse(savedMode) : false;
  });

  useEffect(() => {
    localStorage.setItem("isDarkMode", JSON.stringify(isDarkMode));
  }, [isDarkMode]);

  useEffect(() => {
    // 🔌 ฟังก์ชันช่วยเชื่อมต่อ Socket แบบยืนยัน Auth
    const connectSocketIfAuthenticated = () => {
      const token = localStorage.getItem("token") || localStorage.getItem("sessionToken");
      const employeeId = localStorage.getItem("employeeId");

      if (token && employeeId) {
        if (!socket.connected) {
          socket.auth = getSocketAuth();
          socket.connect();
        }
        socket.emit("register_user", { employeeId, deviceId });
      }
    };

    connectSocketIfAuthenticated();

    // ⚡ ฟังก์ชันเคลียร์ค่าและเด้งกลับหน้าแรก
    const performLogout = (msg) => {
      if (isLoggingOut) return;
      isLoggingOut = true;

      if (msg) alert(msg);

      localStorage.removeItem("token");
      localStorage.removeItem("sessionToken");
      localStorage.removeItem("user");
      localStorage.removeItem("userRole");
      localStorage.removeItem("employeeId");
      localStorage.removeItem("userName");

      if (socket.connected) {
        socket.disconnect();
      }

      // 🔄 ใช้ replace เพื่อล้าง History Stack ป้องกันการกดย้อนกลับ
      window.location.replace("/");
    };

    // 🌐 ตรวจจับ Event จากแท็บอื่นๆ ในเบราว์เซอร์เดียวกัน
    const handleStorageChange = (e) => {
      if (e.key === "logout-event" || (e.key === "userRole" && e.newValue === null)) {
        performLogout(); 
      }
    };

    // 🚨 ตรวจจับเมื่อถูกเตะจากเครื่องอื่น (Login ซ้อน)
    const handleForceLogout = (data) => {
      // อยู่หน้า Login อยู่แล้ว (ไม่มี token) ไม่ต้องทำอะไร
      if (!localStorage.getItem("token") && !localStorage.getItem("sessionToken")) return;
      performLogout(data?.message || "มีการเข้าสู่ระบบซ้อนจากอุปกรณ์อื่น บัญชีของคุณถูกออกจากระบบ");
    };

    // 🚨 API ตอบ 401 (token ไม่ตรงกับ session ล่าสุด / หมดอายุ) -> ออกจากระบบอัตโนมัติ
    const handleSessionExpired = (e) => {
      performLogout(e.detail?.message || "Session ของคุณหมดอายุ หรือมีการเข้าสู่ระบบจากอุปกรณ์อื่น กรุณาเข้าสู่ระบบใหม่");
    };

    // 🛡️ ป้องกัน WebSocket ค้างจาก Back-Forward Cache (bfcache)
    const handlePageShow = (e) => {
      if (e.persisted) {
        connectSocketIfAuthenticated();
      }
    };

    const handlePageHide = () => {
      if (socket.connected) {
        socket.disconnect();
      }
    };

    window.addEventListener("storage", handleStorageChange);
    window.addEventListener("pageshow", handlePageShow);
    window.addEventListener("pagehide", handlePageHide);
    socket.on("force_logout", handleForceLogout);
    window.addEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);

    return () => {
      window.removeEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);
      window.removeEventListener("storage", handleStorageChange);
      window.removeEventListener("pageshow", handlePageShow);
      window.removeEventListener("pagehide", handlePageHide);
      socket.off("force_logout", handleForceLogout);
    };
  }, [navigate]);

  return (
    <Routes>
      <Route path="/" element={<Login isDarkMode={isDarkMode} />} />
      <Route path="/login" element={<Navigate to="/" replace />} />

      {/* 🏠 Unified Home Dashboard (ตรวจสอบสิทธิ์ภายในคอมโพเนนต์) */}
      <Route 
        path="/home" 
        element={<Home isDarkMode={isDarkMode} setIsDarkMode={setIsDarkMode} />} 
      />

      {/* Redirect หน้าเก่าทั้งหมดไปยัง /home */}
      <Route path="/admin" element={<Navigate to="/home" replace />} />
      <Route path="/engineer" element={<Navigate to="/home" replace />} />
      <Route path="/production" element={<Navigate to="/home" replace />} />
      <Route path="/operator" element={<Navigate to="/home" replace />} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}