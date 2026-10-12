import { io } from "socket.io-client";

// 1. ตรวจสอบหรือสร้างรหัสประจำเครื่องเฉพาะของเบราว์เซอร์นี้
let deviceId = localStorage.getItem("deviceId");
if (!deviceId) {
  deviceId = "dev_" + Math.random().toString(36).substring(2, 8) + "_" + Date.now().toString(36);
  localStorage.setItem("deviceId", deviceId);
}

export { deviceId };

// 2. ฟังก์ชันส่ง Authentication Payload ล่าสุดเสมอ
export const getSocketAuth = () => {
  const token = localStorage.getItem("token") || localStorage.getItem("sessionToken");
  return {
    token: token || null,
    deviceId: deviceId,
  };
};

// 3. กำหนดค่า Socket.IO Client
// 🟢 เปลี่ยน autoConnect เป็น true เพื่อให้ต่อ Socket รอรับ Event / Popup ตั้งแต่หน้าแรก
export const socket = io({
  autoConnect: true,
  transports: ["websocket", "polling"],
  auth: (cb) => {
    cb(getSocketAuth());
  },
  reconnection: true,
  reconnectionAttempts: 15,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  timeout: 20000,
});

// ตรวจสอบสถานะการเชื่อมต่อในโหมด Dev
if (import.meta.env?.DEV) {
  socket.on("connect", () => {
    console.log(`🟢 Socket connected: ${socket.id} (Device ID: ${deviceId})`);
  });

  socket.on("connect_error", (err) => {
    console.warn(`🔴 Socket connection error: ${err.message}`);
  });

  socket.on("disconnect", (reason) => {
    console.log(`🟡 Socket disconnected: ${reason}`);
  });
}

// 4. ฟังก์ชันส่ง Audit Log เมื่อ Operator ใช้งานหน้าจอ
export const logOperatorAudit = (action, target = "Operator Dashboard", metadata = null) => {
  return new Promise((resolve) => {
    if (!socket.connected) {
      console.warn("Audit Log Warning: Socket is disconnected, skipping log emit.");
      return resolve(false);
    }

    socket.emit(
      "operator:audit_log",
      {
        action,
        target,
        metadata,
        timestamp: new Date().toISOString(),
      },
      (res) => {
        resolve(res?.success || false);
      }
    );
  });
};

// 5. ตัวช่วยอัปเดต Auth & Reconnect หลังผู้ใช้ Login หรือ Logout
export const updateSocketAuth = () => {
  socket.auth = getSocketAuth();
  if (!socket.connected) {
    socket.connect();
  }
};