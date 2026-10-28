// 🛡️ ดักทุก fetch ทั้งแอป: ถ้า API ตอบ 401 (token หมดอายุ / login ซ้อนจากอุปกรณ์อื่น / ถูก logout)
// ให้แจ้ง AppRoutes ผ่าน event "auth:session-expired" เพื่อออกจากระบบอัตโนมัติ
// (ไม่ต้องไปแก้ทุกหน้าที่เรียก fetch)

export const SESSION_EXPIRED_EVENT = "auth:session-expired";

// API ที่ตอบ 401 ได้ตามปกติ (เช่น กรอกรหัสผ่านผิด) ไม่ใช่ session หลุด
// /api/mes/ ใช้ token operator แยกต่างหาก หน้า MES Update จัดการ 401 เอง
const IGNORED_PATHS = ["/api/login", "/api/register", "/api/auth/", "/api/mes/"];

const getRequestUrl = (input) => {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input?.url || "";
};

export const installAuthInterceptor = () => {
  if (window.__authInterceptorInstalled) return;
  window.__authInterceptorInstalled = true;

  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input, init) => {
    const response = await originalFetch(input, init);

    if (response.status === 401) {
      const url = getRequestUrl(input);
      const isIgnored = IGNORED_PATHS.some((p) => url.includes(p));
      const isLoggedIn = Boolean(localStorage.getItem("token") || localStorage.getItem("sessionToken"));

      if (!isIgnored && isLoggedIn) {
        let message = "";
        try {
          const data = await response.clone().json();
          message = data?.message || "";
        } catch {
          // body ไม่ใช่ JSON ก็ใช้ข้อความ default
        }
        window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT, { detail: { message } }));

        // หน้าเว็บกำลังจะถูกพากลับไปหน้า Login -> ไม่คืน response ให้โค้ดหน้านั้นทำงานต่อ
        // (กัน alert ซ้ำจาก handler 401 ของแต่ละหน้า)
        return new Promise(() => {});
      }
    }

    return response;
  };
};
