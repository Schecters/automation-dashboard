import { useState } from "react";
import { operatorLogin } from "../components/mes/mesApi";

// 🏭 หน้า Login ของ MES Update (https://<server>:5173/MES) หน้าตาแบบเดียวกับ Login.jsx
// operator ใช้รหัสพนักงานอย่างเดียว ต้องเคยทำข้อสอบ (มีรหัสในไฟล์ Excel คะแนนสอบ)
const inputStyle = {
  width: "100%",
  padding: "12px 14px",
  borderRadius: "8px",
  border: "1px solid #cbd5e1",
  fontSize: "16px",
  letterSpacing: "1px",
  outline: "none",
  boxSizing: "border-box",
  backgroundColor: "white",
};

export default function MesLogin({ onLoggedIn, onOpenSettings, message, terminal }) {
  const [employeeId, setEmployeeId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    const id = employeeId.trim();
    if (!id || loading) return;
    setLoading(true);
    setError("");
    const { auth, error: err } = await operatorLogin(id);
    setLoading(false);
    if (err) {
      setError(err);
      setEmployeeId("");
      return;
    }
    onLoggedIn(auth);
  };

  const shownError = error || message;

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
      {/* ฝั่งซ้าย: Blue Brand Panel (ซ่อนบนจอเล็ก) */}
      <div
        className="hidden md:flex"
        style={{
          flex: 1,
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
          <span style={{ fontWeight: "600", fontSize: "16px", letterSpacing: "0.3px" }}>MSH System</span>
        </div>

        <div style={{ maxWidth: "480px" }}>
          <h1 style={{ fontSize: "36px", fontWeight: "700", lineHeight: "1.25", marginBottom: "16px" }}>MES Update</h1>
          <p style={{ fontSize: "15px", lineHeight: "1.6", color: "rgba(255, 255, 255, 0.8)", margin: 0 }}>
            สแกน QR จากเครื่อง Keyence แล้ว update route ใน MES ตาม station ที่เลือกให้อัตโนมัติ
            ทีละหลาย station จากบนลงล่าง
          </p>
        </div>

        <div style={{ fontSize: "12px", color: "rgba(255, 255, 255, 0.6)" }}>© 2026 ME/TE Engineering</div>
      </div>

      {/* ฝั่งขวา: White Form Panel */}
      <div
        className="md:rounded-l-3xl"
        style={{
          flex: 1,
          backgroundColor: "#f8fafc",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "40px",
          overflowY: "auto",
        }}
      >
        <div style={{ width: "100%", maxWidth: "380px" }}>
          <h2 style={{ fontSize: "24px", fontWeight: "700", color: "#0f172a", margin: 0 }}>Operator sign in</h2>
          <p style={{ fontSize: "13px", color: "#64748b", marginTop: "6px", marginBottom: "20px" }}>
            กรอกหรือสแกนรหัสพนักงาน (ต้องเคยทำข้อสอบในระบบ)
          </p>
          <div
            style={{
              fontSize: "12px",
              marginTop: "-8px",
              marginBottom: "16px",
              color: terminal ? "#334155" : "#dc2626",
              fontWeight: 600,
            }}
          >
            เครื่องนี้: {terminal || "ยังไม่ได้ตั้งชื่อ (ให้ ME / Admin ตั้งค่า)"}
          </div>

          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <div>
              <label style={{ display: "block", fontSize: "12px", fontWeight: "600", color: "#334155", marginBottom: "6px" }}>
                Employee ID *
              </label>
              <input
                type="text"
                inputMode="numeric"
                placeholder="e.g. 866xxxxx"
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
                autoFocus
                required
                style={inputStyle}
              />
            </div>

            {shownError && (
              <div
                style={{
                  padding: "10px 12px",
                  borderRadius: "8px",
                  backgroundColor: "#fef2f2",
                  border: "1px solid #fecaca",
                  color: "#dc2626",
                  fontSize: "13px",
                  fontWeight: "600",
                }}
              >
                {shownError}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !employeeId.trim()}
              style={{
                width: "100%",
                padding: "12px",
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
                opacity: !employeeId.trim() && !loading ? 0.6 : 1,
              }}
            >
              <span>➔</span> {loading ? "กำลังตรวจสอบประวัติข้อสอบ..." : "Sign in"}
            </button>

            <p style={{ fontSize: "12px", color: "#94a3b8", textAlign: "center", margin: 0 }}>
              ระบบจะออกจากระบบอัตโนมัติเวลา 07:40 และ 19:40
            </p>

            {onOpenSettings && (
              <div style={{ textAlign: "center", marginTop: "4px" }}>
                <button
                  type="button"
                  onClick={onOpenSettings}
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
                  ⚙ ตั้งค่า station (ME / Admin)
                </button>
              </div>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
