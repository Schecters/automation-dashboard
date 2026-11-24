// อ่าน Scanner ที่ต่อ COM port (USB-COM / RS232) ด้วย Web Serial ของเบราว์เซอร์ (Chrome / Edge)
// ไม่ต้องใช้ MES Bridge — เบราว์เซอร์ไม่บอกชื่อ COM (เช่น COM3) จึงจำ port จาก USB VID / PID แทน
// เลือก port ครั้งแรกผ่าน popup ของเบราว์เซอร์ (ต้องกดปุ่ม) ครั้งต่อไปเบราว์เซอร์จำสิทธิ์ไว้ให้ (getPorts)

const RETRY_MS = 3000;
const hex4 = (n) => (Number.isInteger(n) ? n.toString(16).padStart(4, "0").toUpperCase() : "????");

export const SERIAL_BAUDS = [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200];

export const serialSupported = () => typeof navigator !== "undefined" && "serial" in navigator && window.isSecureContext;

export const serialUnsupportedReason = () => {
  if (typeof window !== "undefined" && !window.isSecureContext) return "หน้าเว็บนี้ไม่ใช่ https ที่เบราว์เซอร์เชื่อถือ — ใช้ COM port ไม่ได้";
  return "เบราว์เซอร์นี้ไม่รองรับ COM port (Web Serial) — ใช้ Google Chrome หรือ Microsoft Edge";
};

export const serialPortLabel = (cfg) =>
  cfg?.usb_vendor_id != null ? `USB ${hex4(cfg.usb_vendor_id)}:${hex4(cfg.usb_product_id)}` : cfg?.port_label || "COM";

const infoOf = (port) => {
  const info = port.getInfo ? port.getInfo() : {};
  return { usb_vendor_id: info.usbVendorId ?? null, usb_product_id: info.usbProductId ?? null };
};

// popup ให้ผู้ใช้เลือก port (เรียกจาก onClick เท่านั้น)
export const pickSerialPort = async () => {
  if (!serialSupported()) throw new Error(serialUnsupportedReason());
  let port;
  try {
    port = await navigator.serial.requestPort();
  } catch {
    throw new Error("ไม่ได้เลือก COM port");
  }
  const info = infoOf(port);
  return { ...info, port_label: serialPortLabel(info) };
};

// หา port ที่เคยอนุญาตแล้ว ตรง VID / PID ที่บันทึกไว้ (port ไม่มี USB เช่น COM บนเมนบอร์ด = ใช้ตัวแรกที่ไม่มี VID)
export const findGrantedPort = async (cfg) => {
  if (!serialSupported()) return null;
  const ports = await navigator.serial.getPorts();
  return (
    ports.find((p) => {
      const i = infoOf(p);
      return i.usb_vendor_id === (cfg?.usb_vendor_id ?? null) && i.usb_product_id === (cfg?.usb_product_id ?? null);
    }) || null
  );
};

const splitter = (terminator) => {
  if (terminator === "CR") return /\r/g;
  if (terminator === "LF") return /\n/g;
  if (terminator === "CRLF") return /\r\n/g;
  return /\r\n|\r|\n/g; // auto
};

const openErrorText = (err) => {
  const m = String(err?.message || err || "");
  if (/already open|failed to open|access denied|InvalidState|NetworkError/i.test(`${err?.name} ${m}`)) {
    return "เปิด COM port ไม่ได้ — port ถูกใช้อยู่ (แท็บ / โปรแกรมอื่น) หรือสายหลุด";
  }
  return `เปิด COM port ไม่ได้: ${m}`;
};

// เปิดอ่าน Scanner ค้างไว้ คืนฟังก์ชัน close()
// onSn(sn) = ได้ SN 1 ชิ้น / onStatus({ ok, text }) = สถานะการเชื่อมต่อ
export const openSerialScanner = (cfg, { onSn, onStatus }) => {
  let closed = false;
  let port = null;
  let reader = null;
  let retryTimer = null;
  let buffer = "";
  const re0 = splitter(cfg?.terminator);

  const status = (ok, text) => {
    if (!closed) onStatus?.({ ok, text });
  };

  const scheduleRetry = () => {
    if (closed || retryTimer) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      start();
    }, RETRY_MS);
  };

  const closePort = async () => {
    try {
      if (reader) await reader.cancel();
    } catch {
      // อ่านค้าง / port หลุดไปแล้ว
    }
    try {
      reader?.releaseLock();
    } catch {
      // ปล่อยไม่ได้ = ไม่เป็นไร
    }
    reader = null;
    try {
      if (port) await port.close();
    } catch {
      // ปิดไปแล้ว
    }
    port = null;
  };

  const handleText = (text) => {
    buffer += text;
    const re = new RegExp(re0.source, "g");
    let start = 0;
    let m;
    while ((m = re.exec(buffer))) {
      const line = buffer.slice(start, m.index).replace(/[^\x20-\x7e]/g, "").trim();
      start = re.lastIndex;
      if (!line) continue;
      if (/^ERROR$/i.test(line)) {
        status(false, "Scanner อ่าน QR ไม่ได้ (ERROR)");
        continue;
      }
      status(true, "เชื่อมต่อแล้ว");
      onSn?.(line);
    }
    buffer = buffer.slice(start);
    // CRLF: เหลือ \r ค้างท้าย รอ \n ของรอบถัดไป / กันข้อมูลขยะยาวผิดปกติ
    if (buffer.length > 4096) buffer = "";
  };

  const start = async () => {
    if (closed) return;
    try {
      port = await findGrantedPort(cfg);
      if (!port) {
        status(false, `ไม่พบ COM port ${serialPortLabel(cfg)} — เสียบสาย หรือกดเลือก port ใหม่ในหน้าตั้งค่า`);
        return scheduleRetry();
      }
      await port.open({
        baudRate: Number(cfg.baud_rate) || 9600,
        dataBits: Number(cfg.data_bits) || 8,
        parity: cfg.parity || "none",
        stopBits: Number(cfg.stop_bits) || 1,
      });
    } catch (err) {
      port = null;
      status(false, openErrorText(err));
      return scheduleRetry();
    }
    if (closed) return closePort();
    status(true, "เชื่อมต่อแล้ว");
    const decoder = new TextDecoder("latin1");
    try {
      while (!closed && port?.readable) {
        reader = port.readable.getReader();
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            if (value) handleText(decoder.decode(value, { stream: true }));
          }
        } finally {
          try {
            reader.releaseLock();
          } catch {
            // ปล่อยแล้ว
          }
          reader = null;
        }
      }
    } catch (err) {
      if (!closed) status(false, `COM port หลุด: ${err?.message || err}`);
    }
    // หลุดกลางบรรทัด: ทิ้งข้อมูลที่ค้าง ไม่ให้ไปต่อหน้า SN แรกของการเชื่อมต่อใหม่
    buffer = "";
    if (!closed) {
      await closePort();
      status(false, "COM port หลุด — กำลังเชื่อมต่อใหม่...");
      scheduleRetry();
    }
  };

  // เสียบสาย USB กลับ -> ลองใหม่ทันที
  const onConnect = () => {
    if (closed || port) return;
    clearTimeout(retryTimer);
    retryTimer = null;
    start();
  };
  if (serialSupported()) navigator.serial.addEventListener("connect", onConnect);

  if (!serialSupported()) status(false, serialUnsupportedReason());
  else start();

  return async () => {
    closed = true;
    clearTimeout(retryTimer);
    if (serialSupported()) navigator.serial.removeEventListener("connect", onConnect);
    buffer = "";
    await closePort();
  };
};

// ทดสอบจากหน้าตั้งค่า: เปิด port รอสแกน waitMs (0 = แค่เช็คว่าเปิดได้) แล้วปิด
export const testSerialScanner = (cfg, waitMs = 10000) =>
  new Promise((resolve, reject) => {
    let done = false;
    let close = null;
    let timer = null;
    const finish = (fn, v) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      Promise.resolve(close?.()).finally(() => fn(v));
    };
    close = openSerialScanner(cfg, {
      onSn: (sn) => finish(resolve, { sn }),
      onStatus: ({ ok, text }) => {
        if (!ok) return finish(reject, new Error(text));
        if (waitMs === 0) finish(resolve, { sn: null });
      },
    });
    if (waitMs > 0) timer = setTimeout(() => finish(resolve, { sn: null }), waitMs);
  });
