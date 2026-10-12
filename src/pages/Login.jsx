import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { socket, deviceId, updateSocketAuth } from "../socket";
import "../index.css";

export default function Login() {
  const navigate = useNavigate();

  const [mode, setMode] = useState("user"); // "user" หรือ "register"
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [ssoLoading, setSsoLoading] = useState(false);

  const [employeeId, setEmployeeId] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");

  const API_URL = "/api";

  const CLIENT_ID = import.meta.env.VITE_AZURE_CLIENT_ID || "5445d52f-20c2-4bc0-9832-e9ab00ab3721";
  const TENANT_ID = import.meta.env.VITE_AZURE_TENANT_ID || "19f25823-17ff-421f-ad4e-8fed035aedda";

  // ฟังก์ชันกลางสำหรับบันทึก Session และส่งสัญญาณ Socket อย่างปลอดภัย
  const handleAuthSuccess = (user, sessionToken) => {
    const userRole = (user.role || "").toLowerCase().trim();

    localStorage.setItem("userRole", userRole);
    localStorage.setItem("employeeId", user.employee_id);
    localStorage.setItem("userName", user.name || "");
    localStorage.setItem("userEmail", user.email || "");
    localStorage.setItem("sessionToken", sessionToken);
    localStorage.setItem("token", sessionToken);
    localStorage.setItem("user", JSON.stringify(user));

    // อัปเดต Payload ใน Socket
    updateSocketAuth();

    // ตรวจสอบสถานะการเชื่อมต่อก่อน emit เพื่อเลี่ยง event หลุดหาย
    const registerPayload = { employeeId: user.employee_id, deviceId };
    if (socket.connected) {
      socket.emit("register_user", registerPayload);
    } else {
      socket.once("connect", () => {
        socket.emit("register_user", registerPayload);
      });
    }

    navigate("/home", { replace: true });
  };

  // 🚀 1. เช็ก Session เดิมเมื่อเปิดหน้าเว็บ (ไม่สั่ง connect ซ้ำเพราะ socket.js มี autoConnect อยู่แล้ว)
  useEffect(() => {
    const savedRole = localStorage.getItem("userRole");
    const savedEmpId = localStorage.getItem("employeeId");
    if (savedRole && savedEmpId) {
      if (socket.connected) {
        socket.emit("register_user", { employeeId: savedEmpId, deviceId });
      }
      navigate("/home", { replace: true });
    }
  }, [navigate]);

  // 🌐 2. ดักจับสัญญาณ Logout ข้ามแท็บ
  useEffect(() => {
    const handleStorageChange = (e) => {
      if (e.key === "logout-event") {
        localStorage.removeItem("userRole");
        localStorage.removeItem("employeeId");
        localStorage.removeItem("userName");
        localStorage.removeItem("sessionToken");
        localStorage.removeItem("token");
        localStorage.removeItem("user");
        if (socket.connected) socket.disconnect();
      }
    };

    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, []);

  // 🔷 3. ฟังก์ชันล็อกอินผ่าน Microsoft SSO
  const handleDeltaLogin = async () => {
    setSsoLoading(true);
    const redirectUri = window.location.origin;
    const authUrl = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/authorize?client_id=${CLIENT_ID}&response_type=token&redirect_uri=${encodeURIComponent(
      redirectUri
    )}&scope=User.Read%20openid%20profile%20email&response_mode=fragment`;

    const popup = window.open(authUrl, "DeltaLogin", "width=500,height=600");

    const checkPopup = setInterval(async () => {
      try {
        if (!popup || popup.closed) {
          clearInterval(checkPopup);
          setSsoLoading(false);
          return;
        }

        if (popup.location.href.includes("access_token")) {
          const hash = popup.location.hash.substring(1);
          const params = new URLSearchParams(hash);
          const accessToken = params.get("access_token");

          popup.close();
          clearInterval(checkPopup);

          if (accessToken) {
            const res = await fetch(`${API_URL}/auth/microsoft-sso`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ accessToken, deviceId }),
            });

            const data = await res.json();
            if (!res.ok) {
              throw new Error(data.message || "การเข้าสู่ระบบผ่าน Microsoft ไม่สำเร็จ");
            }

            // หากเคยสมัครแล้ว -> เข้าระบบให้อัตโนมัติทันที
            if (data.isRegistered && data.user) {
              const sessionToken = data.sessionToken || data.token;
              alert(`✅ ยินดีต้อนรับคุณ ${data.user.name} เข้าสู่ระบบ`);
              handleAuthSuccess(data.user, sessionToken);
            } 
            // หากยังไม่เคยสมัคร -> ดึงข้อมูลมากรอกให้อัตโนมัติเพื่อให้ตั้งรหัสผ่าน
            else if (data.profile) {
              setMode("register");
              setEmployeeId(data.profile.employeeId || "");
              setFullName(data.profile.fullName || "");
              setEmail(data.profile.email || "");
              alert("✅ ดึงข้อมูลจากบัญชี Microsoft สำเร็จ! กรุณาตั้งรหัสผ่านเพื่อลงทะเบียนใช้งาน");
            }
          }
          setSsoLoading(false);
        }
      } catch (e) {
        // ข้าม Cross-Origin error ขณะเบราว์เซอร์ยัง Redirect ไม่เสร็จ
      }
    }, 500);
  };

  // 📝 4. Submit แบบฟอร์ม Manual
  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (mode === "register") {
        const response = await fetch(`${API_URL}/register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            employeeId: Number(employeeId),
            name: fullName.trim(),
            email: email && email.trim() !== "" ? email.trim().toLowerCase() : null,
            password: password,
            role: "view",
          }),
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.message || "เกิดข้อผิดพลาดในการสมัครสมาชิก");

        alert(data.message || "✅ สมัครสมาชิกสำเร็จเรียบร้อย! สามารถเข้าสู่ระบบได้ทันที");
        setMode("user");
        setPassword("");
      } else {
        const response = await fetch(`${API_URL}/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            employeeId: Number(employeeId),
            password,
            deviceId,
          }),
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.message || "เข้าสู่ระบบไม่สำเร็จ");

        const sessionToken = data.sessionToken || data.token || `token_${Date.now()}`;
        handleAuthSuccess(data.user, sessionToken);
      }
    } catch (err) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        height: "100vh",
        width: "100vw",
        backgroundColor: "#1d58d8",
        display: "flex",
        overflow: "hidden",
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        position: "relative",
      }}
    >
      {/* ฝั่งซ้าย: Blue Brand Panel */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "40px 60px",
          color: "white",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div
            style={{
              width: "32px",
              height: "32px",
              backgroundColor: "rgba(255, 255, 255, 0.2)",
              borderRadius: "6px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: "bold",
              fontSize: "14px",
            }}
          >
            M
          </div>
          <span style={{ fontWeight: "600", fontSize: "16px", letterSpacing: "0.3px" }}>
            MSH System
          </span>
        </div>

        <div style={{ maxWidth: "480px" }}>
          <h1 style={{ fontSize: "36px", fontWeight: "700", lineHeight: "1.25", marginBottom: "16px" }}>
            Maintenance
          </h1>
          <p style={{ fontSize: "15px", lineHeight: "1.6", color: "rgba(255, 255, 255, 0.8)", margin: 0 }}>
            Track repair tasks across lines, capture root-cause and action-taken, and hand over the shift seamlessly with a complete audit trail.
          </p>
        </div>

        <div style={{ fontSize: "12px", color: "rgba(255, 255, 255, 0.6)" }}>
          © 2026 ME/TE Engineering
        </div>
      </div>

      {/* ฝั่งขวา: White Form Panel */}
      <div
        style={{
          flex: 1,
          backgroundColor: "#f8fafc",
          borderTopLeftRadius: "24px",
          borderBottomLeftRadius: "24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "40px",
          overflowY: "auto",
        }}
      >
        <div style={{ width: "100%", maxWidth: "380px" }}>
          <h2 style={{ fontSize: "24px", fontWeight: "700", color: "#0f172a", marginBottom: "6px", margin: 0 }}>
            {mode === "register" ? "Create an account" : "Sign in"}
          </h2>
          <p style={{ fontSize: "13px", color: "#64748b", marginTop: "6px", marginBottom: "20px" }}>
            {mode === "register"
              ? "กรุณากรอกข้อมูลเพื่อลงทะเบียนเข้าใช้งานระบบ"
              : "Use your Employee ID and password."}
          </p>

          {/* ปุ่ม Microsoft SSO */}
          <button
            type="button"
            onClick={handleDeltaLogin}
            disabled={ssoLoading}
            style={{
              width: "100%",
              padding: "11px",
              marginBottom: "16px",
              backgroundColor: "#ffffff",
              color: "#0f172a",
              border: "1px solid #cbd5e1",
              borderRadius: "8px",
              fontWeight: "600",
              fontSize: "13px",
              cursor: ssoLoading ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "8px",
              boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
            }}
          >
            <svg width="18" height="18" viewBox="0 0 21 21">
              <rect x="1" y="1" width="9" height="9" fill="#f25022" />
              <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
              <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
              <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
            </svg>
            {ssoLoading ? "Connecting Microsoft..." : "Sign in / Register with Microsoft"}
          </button>

          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "16px" }}>
            <div style={{ flex: 1, height: "1px", backgroundColor: "#e2e8f0" }}></div>
            <span style={{ fontSize: "12px", color: "#94a3b8" }}>OR</span>
            <div style={{ flex: 1, height: "1px", backgroundColor: "#e2e8f0" }}></div>
          </div>

          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <div>
              <label style={{ display: "block", fontSize: "12px", fontWeight: "600", color: "#334155", marginBottom: "6px" }}>
                Employee ID *
              </label>
              <input
                type="number"
                placeholder="e.g. 866xxxxx"
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
                required
                style={{
                  width: "100%",
                  padding: "10px 14px",
                  borderRadius: "8px",
                  border: "1px solid #cbd5e1",
                  fontSize: "14px",
                  outline: "none",
                  boxSizing: "border-box",
                  backgroundColor: "white",
                }}
              />
            </div>

            {mode === "register" && (
              <>
                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: "600", color: "#334155", marginBottom: "6px" }}>
                    Full Name *
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Somchai Jaidee"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    required
                    style={{
                      width: "100%",
                      padding: "10px 14px",
                      borderRadius: "8px",
                      border: "1px solid #cbd5e1",
                      fontSize: "14px",
                      outline: "none",
                      boxSizing: "border-box",
                      backgroundColor: "white",
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: "600", color: "#334155", marginBottom: "6px" }}>
                    Email Address (Optional)
                  </label>
                  <input
                    type="email"
                    placeholder="e.g. somchai@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "10px 14px",
                      borderRadius: "8px",
                      border: "1px solid #cbd5e1",
                      fontSize: "14px",
                      outline: "none",
                      boxSizing: "border-box",
                      backgroundColor: "white",
                    }}
                  />
                </div>
              </>
            )}

            <div>
              <label style={{ display: "block", fontSize: "12px", fontWeight: "600", color: "#334155", marginBottom: "6px" }}>
                Password *
              </label>
              <div style={{ position: "relative" }}>
                <input
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  style={{
                    width: "100%",
                    padding: "10px 40px 10px 14px",
                    borderRadius: "8px",
                    border: "1px solid #cbd5e1",
                    fontSize: "14px",
                    outline: "none",
                    boxSizing: "border-box",
                    backgroundColor: "white",
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  style={{
                    position: "absolute",
                    right: "12px",
                    top: "50%",
                    transform: "translateY(-50%)",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "#94a3b8",
                    fontSize: "14px",
                    padding: 0,
                  }}
                >
                  {showPassword ? "👁️‍🗨️" : "👁️"}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              style={{
                width: "100%",
                padding: "11px",
                backgroundColor: loading ? "#93c5fd" : "#2563eb",
                color: "white",
                border: "none",
                borderRadius: "8px",
                fontWeight: "600",
                fontSize: "14px",
                cursor: loading ? "not-allowed" : "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                marginTop: "6px",
              }}
            >
              <span>➔</span> {loading ? "Loading..." : mode === "register" ? "Sign up" : "Sign in"}
            </button>

            <div style={{ textAlign: "center", marginTop: "10px" }}>
              <button
                type="button"
                onClick={() => {
                  setMode(mode === "user" ? "register" : "user");
                  setPassword("");
                }}
                style={{
                  background: "none",
                  border: "none",
                  color: "#2563eb",
                  fontSize: "13px",
                  fontWeight: "600",
                  cursor: "pointer",
                  textDecoration: "underline",
                }}
              >
                {mode === "user"
                  ? "Don't have an account? Sign up"
                  : "Already have an account? Sign in"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}