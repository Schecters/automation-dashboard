import { deviceId } from "../../socket";

// เรียก API ของหน้า MES Update ที่ใช้ร่วมกันหลายไฟล์
const API_URL = "/api";

// คืน { auth } เมื่อสำเร็จ หรือ { error }
export const operatorLogin = async (employeeId) => {
  try {
    const res = await fetch(`${API_URL}/mes/operator-login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employee_id: employeeId, device_id: deviceId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!data.success) return { error: data.message || `เข้าสู่ระบบไม่สำเร็จ (HTTP ${res.status})` };
    return { auth: { token: data.token, expires_at: data.expires_at, operator: data.operator } };
  } catch (err) {
    return { error: `เข้าสู่ระบบไม่สำเร็จ: ${err.message}` };
  }
};
