import { useEffect, useRef, useState } from "react";
import { eng } from "./chromaApi";

// 📈 กราฟ IWT: Sample (แดง) vs เทสครั้งล่าสุด (ขาว) + แถบช่วงตัดสิน begin–end (ขยับตามค่าที่พิมพ์)
//  พื้นมืดเหมือนจอเครื่อง (ทั้งโหมดสว่าง / มืด) — ต้นแบบจาก D:\Chroma DCR\...\steps.html (drawStepWave)
const C = {
  sample: "#f87171", last: "#e2e8f0", grid: "#1e293b", axis: "#64748b", label: "#94a3b8",
  zones: { AREA: "#60a5fa", DAR: "#34d399", FLUT: "#fbbf24", LAPL: "#c084fc" },
};
const ZONE_LABEL = { AREA: "Area", DAR: "Dif-Area", FLUT: "Flutter", LAPL: "Laplac" };

const niceStep = (v) => {
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v) || 10 * p;
};

/**
 * @param {{ sample?: number[]|null, last?: number[]|null, zones: { key: string, begin: number|null, end: number|null }[] }} props
 */
export default function WaveChart({ sample, last, zones }) {
  const canvasRef = useRef(null);
  const [show, setShow] = useState({ sample: true, last: true, zones: true });
  const [hover, setHover] = useState(null); // { i, x, y }
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const geom = () => {
    const el = canvasRef.current;
    const dpr = window.devicePixelRatio || 1;
    const W = el.clientWidth * dpr;
    const H = el.clientHeight * dpr;
    const padL = 52 * dpr, padR = 12 * dpr, padT = 12 * dpr;
    const padB = (22 + 4 * 16) * dpr;
    const all = [...(sample || []), ...(last || [])];
    let max = Math.max(1, ...all.map(Math.abs));
    const step = niceStep(max / 2);
    max = Math.ceil(max / step) * step;
    const n = Math.max(sample?.length || 0, last?.length || 0, 512);
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;
    return {
      dpr, W, H, padL, padR, padT, plotW, plotH, max, step, n,
      x: (i) => padL + (i / (n - 1)) * plotW,
      y: (v) => padT + plotH / 2 - (v / max) * (plotH / 2),
      idx: (px) => Math.round(((px - padL) / plotW) * (n - 1)),
    };
  };

  useEffect(() => {
    const el = canvasRef.current;
    if (!el || !el.clientWidth) return;
    const G = geom();
    el.width = G.W;
    el.height = G.H;
    const g = el.getContext("2d");
    const font = (px) => `${px * G.dpr}px system-ui, sans-serif`;
    g.clearRect(0, 0, G.W, G.H);
    g.font = font(11);
    g.textAlign = "right";
    g.textBaseline = "middle";
    for (let v = -G.max; v <= G.max + 1e-9; v += G.step) {
      const y = G.y(v);
      g.strokeStyle = Math.abs(v) < 1e-9 ? C.axis : C.grid;
      g.lineWidth = G.dpr;
      g.beginPath();
      g.moveTo(G.padL, y);
      g.lineTo(G.W - G.padR, y);
      g.stroke();
      g.fillStyle = C.label;
      g.fillText(`${eng(v)}V`, G.padL - 6 * G.dpr, y);
    }
    const xAxisY = G.padT + G.plotH + 4 * G.dpr;
    g.textAlign = "center";
    g.textBaseline = "top";
    for (let i = 0; i <= 512; i += 64) {
      const x = G.x(Math.max(0, i - 1));
      g.strokeStyle = C.grid;
      g.beginPath();
      g.moveTo(x, G.padT);
      g.lineTo(x, G.padT + G.plotH);
      g.stroke();
      g.fillStyle = C.label;
      g.fillText(String(Math.max(1, i)), x, xAxisY);
    }
    if (show.zones) {
      zones.forEach((z, li) => {
        if (z.begin == null || z.end == null) return;
        const x1 = G.x(Math.min(z.begin, z.end) - 1);
        const x2 = G.x(Math.max(z.begin, z.end) - 1);
        const c = C.zones[z.key] || C.label;
        g.globalAlpha = 0.07;
        g.fillStyle = c;
        g.fillRect(x1, G.padT, x2 - x1, G.plotH);
        g.globalAlpha = 1;
        const lane = 10 * G.dpr;
        const ly = xAxisY + (18 + li * 16) * G.dpr;
        g.fillStyle = c;
        g.fillRect(x1, ly, Math.max(2 * G.dpr, x2 - x1), lane);
        g.textBaseline = "middle";
        g.textAlign = "left";
        g.fillStyle = C.label;
        g.fillText(ZONE_LABEL[z.key] || z.key, 4 * G.dpr, ly + lane / 2);
        const right = x2 + 70 * G.dpr < G.W;
        g.textAlign = right ? "left" : "right";
        g.fillText(`${z.begin}–${z.end}`, right ? x2 + 6 * G.dpr : x1 - 6 * G.dpr, ly + lane / 2);
      });
    }
    const line = (pts, color, w) => {
      g.strokeStyle = color;
      g.lineWidth = w * G.dpr;
      g.lineJoin = "round";
      g.beginPath();
      pts.forEach((v, i) => (i ? g.lineTo(G.x(i), G.y(v)) : g.moveTo(G.x(i), G.y(v))));
      g.stroke();
    };
    if (show.last && last) line(last, C.last, 1.5);
    if (show.sample && sample) line(sample, C.sample, 2);
    if (!sample && !last) {
      g.fillStyle = C.label;
      g.font = font(14);
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText("ยังไม่มี Sample waveform — ใส่ชิ้นงานดีแล้วกด SAMPLE GET", G.W / 2, G.padT + G.plotH / 2);
    }
    if (hover) {
      g.strokeStyle = C.axis;
      g.lineWidth = G.dpr;
      g.setLineDash([4 * G.dpr, 4 * G.dpr]);
      g.beginPath();
      g.moveTo(G.x(hover.i), G.padT);
      g.lineTo(G.x(hover.i), G.padT + G.plotH);
      g.stroke();
      g.setLineDash([]);
      [[sample, C.sample, "sample"], [last, C.last, "last"]].forEach(([pts, c, k]) => {
        if (!pts || !show[k] || pts[hover.i] == null) return;
        g.fillStyle = c;
        g.beginPath();
        g.arc(G.x(hover.i), G.y(pts[hover.i]), 3.5 * G.dpr, 0, Math.PI * 2);
        g.fill();
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sample, last, zones, show, hover, width]);

  const onMove = (e) => {
    const el = canvasRef.current;
    if (!el || (!sample && !last)) return;
    const r = el.getBoundingClientRect();
    const G = geom();
    const i = G.idx((e.clientX - r.left) * G.dpr);
    if (i < 0 || i >= G.n) return setHover(null);
    setHover({ i, x: e.clientX - r.left, y: e.clientY - r.top, w: r.width });
  };

  const v = (pts) => (hover && pts && pts[hover.i] != null ? `${eng(pts[hover.i])}V` : "-");
  const chk = (k, label, color) => (
    <label className="inline-flex items-center gap-1.5 cursor-pointer">
      <input type="checkbox" checked={show[k]} onChange={(e) => setShow({ ...show, [k]: e.target.checked })} />
      {color && <span className="inline-block w-3 h-[3px] rounded" style={{ background: color }} />}
      {label}
    </label>
  );

  return (
    <div>
      <div className="flex flex-wrap gap-4 text-xs mb-2">
        {chk("sample", "Sample (มาตรฐาน)", C.sample)}
        {last && chk("last", "เทสครั้งล่าสุด", C.last)}
        {chk("zones", "ช่วงตัดสิน")}
      </div>
      <div className="relative">
        <canvas
          ref={canvasRef}
          className="w-full block rounded-lg cursor-crosshair"
          style={{ height: 340, background: "#0b1220" }}
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
        />
        {hover && (
          <div
            className="absolute pointer-events-none text-xs font-mono leading-5 rounded-md px-2 py-1 whitespace-nowrap"
            style={{ left: hover.x > hover.w - 170 ? hover.x - 160 : hover.x + 14, top: Math.max(4, hover.y - 20), background: "rgba(15,23,42,.94)", color: "#e2e8f0", border: "1px solid #334155" }}
          >
            <b>จุด {hover.i + 1}</b>
            {sample && <div><span style={{ color: C.sample }}>━</span> Sample {v(sample)}</div>}
            {last && <div><span style={{ color: C.last }}>━</span> ล่าสุด {v(last)}</div>}
            {sample && last && sample[hover.i] != null && last[hover.i] != null && <div>ต่าง {eng(last[hover.i] - sample[hover.i])}V</div>}
          </div>
        )}
      </div>
      <div className="text-[11px] text-gray-400 mt-1">
        แกน X = จุดที่ 1–512 (ระยะห่างตาม Width) / แถบด้านล่าง = ช่วง begin–end ของ Area, Dif-Area, Flutter, Laplac จากช่องด้านล่าง (แก้ค่าแล้วกราฟเปลี่ยนตาม)
      </div>
    </div>
  );
}
