import React, { useState, useEffect } from "react";

const API_BASE_URL = "/api/plc/sequence";

// บันทึก/ลบ Recipe ต้องเป็น Admin -> ต้องส่ง token ไปด้วย
const getAuthHeaders = () => {
  const token = localStorage.getItem("token") || localStorage.getItem("sessionToken");
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
    "x-session-token": token,
  };
};

const DMM_MODES = [
  { value: "RES", label: "Resistance 2-Wire (Ω)", unit: "Ω", scpi: "CONF:RES" },
  { value: "FRES", label: "Resistance 4-Wire (4W Ω)", unit: "4W Ω", scpi: "CONF:FRES" },
  { value: "VOLT:DC", label: "DC Voltage (DCV)", unit: "VDC", scpi: "CONF:VOLT:DC" },
  { value: "VOLT:AC", label: "AC Voltage (ACV)", unit: "VAC", scpi: "CONF:VOLT:AC" },
  { value: "CURR:DC", label: "DC Current (DCI)", unit: "ADC", scpi: "CONF:CURR:DC" },
  { value: "CURR:AC", label: "AC Current (ACI)", unit: "AAC", scpi: "CONF:CURR:AC" },
  { value: "TEMP", label: "Temperature (°C)", unit: "°C", scpi: "CONF:TEMP" },
];

export default function StepCustom({ isDarkMode }) {
  const [internalRecipeId, setInternalRecipeId] = useState("");
  const [recipeName, setRecipeName] = useState("");
  const [existingRecipes, setExistingRecipes] = useState([]);
  const [selectedRecipeId, setSelectedRecipeId] = useState("");
  const [steps, setSteps] = useState([]);
  const [statusMessage, setStatusMessage] = useState({ type: "", text: "" });
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    fetchRecipeList();
  }, []);

  const fetchRecipeList = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/next-id`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.recipes)) {
          setExistingRecipes(data.recipes);
        }
      }
    } catch (err) {
      console.error("Fetch Recipe List Error:", err);
    }
  };

  const handleNewRecipe = () => {
    setInternalRecipeId("");
    setSelectedRecipeId("");
    setRecipeName("");
    setSteps([]);
    setStatusMessage({ type: "info", text: "พร้อมสร้าง Sequence ใหม่ กรุณากรอกชื่อและกำหนดขั้นตอน" });
  };

  const handleSelectRecipe = async (recipeId) => {
    setSelectedRecipeId(recipeId);
    if (!recipeId) {
      handleNewRecipe();
      return;
    }

    setStatusMessage({ type: "info", text: "กำลังดึงข้อมูล Sequence..." });
    try {
      const res = await fetch(`${API_BASE_URL}/get?recipeId=${recipeId}`);
      if (res.ok) {
        const data = await res.json();
        setInternalRecipeId(data.RecipeId);
        setRecipeName(data.RecipeName || "");
        const loadedSteps = (data.Steps || []).map((s) => ({
          stepNo: s.StepNo,
          type: s.Type || "CONTROL",
          description: s.Description || "",
          durationSec: s.DurationMs ? s.DurationMs / 1000 : "",
          actions: (s.Actions || []).map((a) => ({
            address: a.Address || "",
            state: a.State !== undefined ? a.State : true,
          })),
          sensorConfig: s.SensorConfig || {
            source: "DMM",
            registerAddress: "D100",
            mode: "RES",
            minValue: "",
            maxValue: "",
            allowOverload: false,
            unit: "Ω",
          },
        }));
        setSteps(loadedSteps);
        setStatusMessage({ type: "success", text: `กำลังเปิดดู/แก้ไข: "${data.RecipeName}"` });
      } else {
        setStatusMessage({ type: "error", text: "ไม่พบข้อมูล Sequence บน Server" });
      }
    } catch (err) {
      setStatusMessage({ type: "error", text: `เกิดข้อผิดพลาดในการโหลดข้อมูล: ${err.message}` });
    }
  };

  // 🟢 ฟังก์ชันลบ Recipe ปัจจุบันที่เลือกอยู่ ส่งไปยัง DELETE /api/plc/sequence/:recipeId
  const handleDeleteRecipe = async () => {
    const targetId = selectedRecipeId || internalRecipeId;
    if (!targetId) {
      setStatusMessage({ type: "error", text: "กรุณาเลือก Sequence ที่ต้องการลบก่อน" });
      return;
    }

    const currentName = recipeName || targetId;
    const confirmDelete = window.confirm(
      `คุณต้องการลบ Sequence "${currentName}" (ID: ${targetId}) ออกจากฐานข้อมูลใช่หรือไม่? การกระทำนี้ไม่สามารถย้อนกลับได้`
    );
    if (!confirmDelete) return;

    setIsDeleting(true);
    setStatusMessage({ type: "info", text: `กำลังลบ "${currentName}" ออกจากระบบ...` });

    try {
      const res = await fetch(`${API_BASE_URL}/${encodeURIComponent(targetId)}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setStatusMessage({ type: "success", text: data.message || `ลบ Sequence "${currentName}" เรียบร้อยแล้ว` });
        handleNewRecipe();
        await fetchRecipeList();
      } else {
        setStatusMessage({ type: "error", text: data.message || "ไม่สามารถลบ Sequence ได้" });
      }
    } catch (err) {
      console.error("Delete Recipe Error:", err);
      setStatusMessage({ type: "error", text: `เกิดข้อผิดพลาดในการลบข้อมูล: ${err.message}` });
    } finally {
      setIsDeleting(false);
    }
  };

  const createEmptyStep = (stepNo) => ({
    stepNo,
    type: "CONTROL",
    description: "",
    durationSec: "",
    actions: [],
    sensorConfig: {
      source: "DMM",
      registerAddress: "D100",
      mode: "RES",
      minValue: "",
      maxValue: "",
      allowOverload: false,
      unit: "Ω",
    },
  });

  const handleAddStep = () => {
    setSteps([...steps, createEmptyStep(steps.length + 1)]);
  };

  const handleInsertStepAt = (index) => {
    const updated = [...steps];
    updated.splice(index, 0, createEmptyStep(index + 1));
    setSteps(updated.map((item, idx) => ({ ...item, stepNo: idx + 1 })));
  };

  const handleDeleteStep = (index) => {
    const updated = steps.filter((_, idx) => idx !== index);
    setSteps(updated.map((item, idx) => ({ ...item, stepNo: idx + 1 })));
  };

  const handleAddAction = (stepIndex) => {
    const updated = [...steps];
    updated[stepIndex].actions.push({ address: "", state: true });
    setSteps(updated);
  };

  const handleDeleteAction = (stepIndex, actionIndex) => {
    const updated = [...steps];
    updated[stepIndex].actions = updated[stepIndex].actions.filter((_, idx) => idx !== actionIndex);
    setSteps(updated);
  };

  const handleActionChange = (stepIndex, actionIndex, field, value) => {
    const updated = [...steps];
    updated[stepIndex].actions[actionIndex][field] = value;
    setSteps(updated);
  };

  const handleSensorConfigChange = (stepIndex, field, value) => {
    const updated = [...steps];
    const currentCfg = { ...updated[stepIndex].sensorConfig, [field]: value };

    if (field === "mode") {
      const found = DMM_MODES.find((m) => m.value === value);
      if (found) {
        currentCfg.unit = found.unit;
      }
    } else if (field === "source" && value === "PLC_REGISTER") {
      currentCfg.unit = "Word";
    }

    updated[stepIndex].sensorConfig = currentCfg;
    setSteps(updated);
  };

  const handleSaveToServer = async () => {
    if (!recipeName.trim()) {
      setStatusMessage({ type: "error", text: "กรุณาระบุชื่อ Recipe Name ก่อนทำการบันทึก" });
      return;
    }

    setStatusMessage({ type: "info", text: "กำลังส่งข้อมูลบันทึกลงระบบ..." });

    let targetRecipeId = internalRecipeId;
    if (!targetRecipeId) {
      try {
        const nextRes = await fetch(`${API_BASE_URL}/next-id`);
        if (nextRes.ok) {
          const nextData = await nextRes.json();
          targetRecipeId = nextData.nextId?.toString() || Date.now().toString();
        } else {
          targetRecipeId = Date.now().toString();
        }
      } catch {
        targetRecipeId = Date.now().toString();
      }
    }

    const payload = {
      RecipeId: targetRecipeId,
      RecipeName: recipeName.trim(),
      Steps: steps.map((s) => ({
        StepNo: s.stepNo,
        Type: s.type,
        Description: s.description || "",
        DurationMs: Math.round((parseFloat(s.durationSec) || 0) * 1000),
        Actions:
          s.type === "CONTROL"
            ? s.actions
                .filter((a) => a.address.trim() !== "")
                .map((a) => ({
                  Address: a.address.trim().toUpperCase(),
                  State: Boolean(a.state),
                }))
            : [],
        SensorConfig: s.type === "READ_SENSOR" ? s.sensorConfig : null,
      })),
    };

    try {
      const res = await fetch(`${API_BASE_URL}/save`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify(payload),
      });

      if (res.status === 401 || res.status === 403) {
        setStatusMessage({ type: "error", text: "ไม่มีสิทธิ์บันทึก Sequence (เฉพาะ ADMIN เท่านั้น)" });
      } else if (res.ok) {
        setInternalRecipeId(targetRecipeId);
        setSelectedRecipeId(targetRecipeId);
        setStatusMessage({ type: "success", text: `บันทึก "${recipeName.trim()}" เรียบร้อยแล้ว` });
        fetchRecipeList();
      } else {
        setStatusMessage({ type: "error", text: `บันทึกล้มเหลว (HTTP Status: ${res.status})` });
      }
    } catch (err) {
      setStatusMessage({ type: "error", text: `เกิดข้อผิดพลาดในการเชื่อมต่อ: ${err.message}` });
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight">PLC Step & DMM Sensor Sequence Builder</h2>
          <p className={`text-xs mt-1 ${isDarkMode ? "text-slate-400" : "text-gray-500"}`}>
            กำหนดขั้นตอนทั้งสั่งงาน PLC Control และอ่านวัดค่าเซนเซอร์ DMM Picotest พร้อมระบบทดสอบ Open/Short (Overload)
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={handleNewRecipe}
            className={`px-3.5 py-2 text-xs font-semibold rounded-xl border transition-colors ${
              isDarkMode ? "bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700" : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50 shadow-sm"
            }`}
          >
            + สร้างใหม่
          </button>

          {/* 🟢 ปุ่มลบ Sequence ที่เปิดอยู่ */}
          {(selectedRecipeId || internalRecipeId) && (
            <button
              onClick={handleDeleteRecipe}
              disabled={isDeleting}
              className={`px-3.5 py-2 text-xs font-semibold rounded-xl border transition-all flex items-center gap-1.5 ${
                isDarkMode
                  ? "bg-rose-500/10 border-rose-500/30 text-rose-400 hover:bg-rose-500/20"
                  : "bg-rose-50 border-rose-200 text-rose-600 hover:bg-rose-100"
              } disabled:opacity-50`}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              <span>{isDeleting ? "กำลังลบ..." : "ลบ Sequence นี้"}</span>
            </button>
          )}

          <button
            onClick={handleSaveToServer}
            className="px-4 py-2 text-xs font-semibold rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white shadow-md shadow-emerald-600/20 transition-all"
          >
            {internalRecipeId ? "อัปเดตข้อมูล" : "บันทึกข้อมูล"}
          </button>
        </div>
      </div>

      {/* Status Message */}
      {statusMessage.text && (
        <div
          className={`p-3 rounded-xl text-xs font-medium border flex items-center justify-between ${
            statusMessage.type === "success"
              ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-500"
              : statusMessage.type === "error"
              ? "bg-rose-500/10 border-rose-500/30 text-rose-500"
              : "bg-blue-500/10 border-blue-500/30 text-blue-500"
          }`}
        >
          <span>{statusMessage.text}</span>
          <button onClick={() => setStatusMessage({ type: "", text: "" })}>✕</button>
        </div>
      )}

      {/* Recipe Header Info */}
      <div className={`p-5 rounded-2xl border shadow-sm ${isDarkMode ? "bg-[#1E293B] border-slate-700/60" : "bg-white border-gray-200"}`}>
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
          <div className="md:col-span-5">
            <div className="flex items-center justify-between mb-1.5">
              <label className={`text-xs font-semibold ${isDarkMode ? "text-slate-300" : "text-gray-700"}`}>
                เลือกดูหรือแก้ไข Sequence
              </label>
              {(selectedRecipeId || internalRecipeId) && (
                <button
                  type="button"
                  onClick={handleDeleteRecipe}
                  disabled={isDeleting}
                  className="text-[11px] text-rose-500 hover:underline font-semibold"
                >
                  ลบรายการนี้
                </button>
              )}
            </div>
            <select
              value={selectedRecipeId}
              onChange={(e) => handleSelectRecipe(e.target.value)}
              className={`w-full px-3 py-2 rounded-xl text-xs border outline-none ${
                isDarkMode ? "bg-slate-900/60 border-slate-700 text-slate-200" : "bg-white border-gray-300 text-gray-700"
              }`}
            >
              <option value="">-- กำลังสร้างรายการใหม่ --</option>
              {existingRecipes.map((item, idx) => (
                <option key={idx} value={item.RecipeId}>
                  {item.RecipeName}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-7">
            <label className={`block text-xs font-semibold mb-1.5 ${isDarkMode ? "text-slate-300" : "text-gray-700"}`}>
              ชื่อ Sequence (Recipe Name) *
            </label>
            <input
              type="text"
              placeholder="เช่น ทดสอบฮีตเตอร์และวัดค่าความต้านทาน Thermistor..."
              value={recipeName}
              onChange={(e) => setRecipeName(e.target.value)}
              className={`w-full px-3 py-2 rounded-xl text-xs border outline-none ${
                isDarkMode ? "bg-slate-900/60 border-slate-700 text-slate-100" : "bg-white border-gray-300 text-gray-800"
              }`}
            />
          </div>
        </div>
      </div>

      {/* Steps List */}
      <div className="space-y-4">
        {steps.map((step, sIdx) => (
          <React.Fragment key={sIdx}>
            {sIdx > 0 && (
              <div className="flex items-center justify-center my-2 relative group">
                <div className={`w-full h-px border-t border-dashed ${isDarkMode ? "border-slate-700" : "border-gray-300"}`}></div>
                <button
                  onClick={() => handleInsertStepAt(sIdx)}
                  className={`absolute px-3 py-1 text-[11px] font-semibold rounded-full border shadow-sm transition-all opacity-70 group-hover:opacity-100 ${
                    isDarkMode ? "bg-slate-800 border-slate-700 text-blue-400" : "bg-white border-gray-300 text-blue-600"
                  }`}
                >
                  + แทรก Step คั่นตรงนี้
                </button>
              </div>
            )}

            <div className={`p-5 rounded-2xl border shadow-sm ${isDarkMode ? "bg-[#1E293B] border-slate-700/60" : "bg-white border-gray-200"}`}>
              {/* Header Step & Type Selector */}
              <div className="flex items-center justify-between border-b pb-3 mb-4 border-inherit flex-wrap gap-2">
                <div className="flex items-center gap-3">
                  <span className="w-6 h-6 rounded-lg bg-blue-600 text-white flex items-center justify-center text-xs font-bold">
                    {step.stepNo}
                  </span>

                  <div className="flex items-center gap-1 bg-slate-900/20 p-1 rounded-lg border border-inherit">
                    <button
                      type="button"
                      onClick={() => {
                        const updated = [...steps];
                        updated[sIdx].type = "CONTROL";
                        setSteps(updated);
                      }}
                      className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${
                        step.type === "CONTROL"
                          ? "bg-blue-600 text-white shadow-sm"
                          : isDarkMode
                          ? "text-slate-400 hover:text-slate-200"
                          : "text-gray-500 hover:text-gray-800"
                      }`}
                    >
                      ⚡ สั่งควบคุม PLC (ON/OFF)
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const updated = [...steps];
                        updated[sIdx].type = "READ_SENSOR";
                        setSteps(updated);
                      }}
                      className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${
                        step.type === "READ_SENSOR"
                          ? "bg-purple-600 text-white shadow-sm"
                          : isDarkMode
                          ? "text-slate-400 hover:text-slate-200"
                          : "text-gray-500 hover:text-gray-800"
                      }`}
                    >
                      🎯 อ่านค่าเซนเซอร์ / DMM
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleInsertStepAt(sIdx)}
                    className="text-xs px-2.5 py-1 rounded-lg border border-inherit text-blue-400 hover:bg-blue-500/10"
                  >
                    + แทรกก่อนหน้านี้
                  </button>
                  <button onClick={() => handleDeleteStep(sIdx)} className="text-xs text-rose-500 hover:text-rose-400 font-medium px-2 py-1">
                    ลบ Step
                  </button>
                </div>
              </div>

              {/* Description & Duration */}
              <div className="grid grid-cols-1 md:grid-cols-12 gap-4 mb-4">
                <div className="md:col-span-8">
                  <label className={`block text-xs font-medium mb-1 ${isDarkMode ? "text-slate-300" : "text-gray-600"}`}>
                    คำอธิบาย Step
                  </label>
                  <input
                    type="text"
                    placeholder={step.type === "CONTROL" ? "เช่น เปิดวาล์วและฮีตเตอร์..." : "เช่น ตรวจสอบความเป็นฉนวน (ต้องได้ค่า OL ไม่ช็อต)..."}
                    value={step.description}
                    onChange={(e) => {
                      const updated = [...steps];
                      updated[sIdx].description = e.target.value;
                      setSteps(updated);
                    }}
                    className={`w-full px-3 py-2 rounded-xl text-xs border outline-none ${
                      isDarkMode ? "bg-slate-900/60 border-slate-700 text-slate-100" : "bg-gray-50 border-gray-300 text-gray-800"
                    }`}
                  />
                </div>

                <div className="md:col-span-4">
                  <label className={`block text-xs font-medium mb-1 ${isDarkMode ? "text-slate-300" : "text-gray-600"}`}>
                    หน่วงเวลา (วินาที)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    placeholder="เช่น 1 หรือ 2"
                    value={step.durationSec}
                    onChange={(e) => {
                      const updated = [...steps];
                      updated[sIdx].durationSec = e.target.value;
                      setSteps(updated);
                    }}
                    className={`w-full px-3 py-2 rounded-xl text-xs border outline-none font-mono ${
                      isDarkMode ? "bg-slate-900/60 border-slate-700 text-slate-100" : "bg-gray-50 border-gray-300 text-gray-800"
                    }`}
                  />
                </div>
              </div>

              {/* Render เนื้อหาตามประเภท Step */}
              {step.type === "CONTROL" ? (
                <div className={`p-4 rounded-xl border ${isDarkMode ? "bg-slate-900/50 border-slate-800" : "bg-gray-50 border-gray-200"}`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-blue-400">
                      รายการ Address ที่ต้องการสั่งงาน (PLC Actions):
                    </span>
                    <button onClick={() => handleAddAction(sIdx)} className="text-xs text-blue-500 font-semibold">
                      + เพิ่ม Address
                    </button>
                  </div>

                  {step.actions.length === 0 ? (
                    <p className="text-[11px] text-gray-400 italic py-1">(ไม่มี Action — ขั้นตอนนี้จะใช้สำหรับหน่วงเวลาอย่างเดียว)</p>
                  ) : (
                    <div className="space-y-2">
                      {step.actions.map((act, aIdx) => (
                        <div key={aIdx} className="flex items-center gap-3">
                          <input
                            type="text"
                            placeholder="M3000, Y0.0"
                            value={act.address}
                            onChange={(e) => handleActionChange(sIdx, aIdx, "address", e.target.value)}
                            className={`w-36 px-3 py-1.5 rounded-lg text-xs font-mono uppercase border outline-none ${
                              isDarkMode ? "bg-slate-800 border-slate-700 text-slate-100" : "bg-white border-gray-300 text-gray-800"
                            }`}
                          />
                          <select
                            value={act.state ? "1" : "0"}
                            onChange={(e) => handleActionChange(sIdx, aIdx, "state", e.target.value === "1")}
                            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${
                              act.state ? "bg-emerald-500/10 text-emerald-500" : "bg-rose-500/10 text-rose-500"
                            }`}
                          >
                            <option value="1">ON (True)</option>
                            <option value="0">OFF (False)</option>
                          </select>
                          <button onClick={() => handleDeleteAction(sIdx, aIdx)} className="text-slate-400 hover:text-rose-500">
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                /* โหมดอ่านค่าเซนเซอร์ DMM */
                <div className={`p-4 rounded-xl border ${isDarkMode ? "bg-purple-950/20 border-purple-800/40" : "bg-purple-50/60 border-purple-200"}`}>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-purple-400 block mb-3">
                    การตั้งค่าอ่านเซนเซอร์ (Sensor Reading & Criteria):
                  </span>

                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-gray-400 mb-1">อุปกรณ์เซนเซอร์</label>
                      <select
                        value={step.sensorConfig?.source || "DMM"}
                        onChange={(e) => handleSensorConfigChange(sIdx, "source", e.target.value)}
                        className={`w-full px-3 py-1.5 rounded-lg text-xs border outline-none ${
                          isDarkMode ? "bg-slate-800 border-slate-700 text-slate-200" : "bg-white border-gray-300"
                        }`}
                      >
                        <option value="DMM">DMM Picotest (USB)</option>
                        <option value="PLC_REGISTER">PLC Register (Modbus)</option>
                      </select>
                    </div>

                    {step.sensorConfig?.source === "DMM" ? (
                      <div>
                        <label className="block text-[11px] font-semibold text-gray-400 mb-1">ฟังก์ชันวัด DMM</label>
                        <select
                          value={step.sensorConfig?.mode || "RES"}
                          onChange={(e) => handleSensorConfigChange(sIdx, "mode", e.target.value)}
                          className={`w-full px-3 py-1.5 rounded-lg text-xs font-semibold border outline-none ${
                            isDarkMode ? "bg-slate-800 border-slate-700 text-purple-300" : "bg-white border-gray-300 text-purple-700"
                          }`}
                        >
                          {DMM_MODES.map((m) => (
                            <option key={m.value} value={m.value}>
                              {m.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : (
                      <div>
                        <label className="block text-[11px] font-semibold text-gray-400 mb-1">PLC Register Address</label>
                        <input
                          type="text"
                          placeholder="เช่น D100, D200"
                          value={step.sensorConfig?.registerAddress || "D100"}
                          onChange={(e) => handleSensorConfigChange(sIdx, "registerAddress", e.target.value.toUpperCase())}
                          className={`w-full px-3 py-1.5 rounded-lg text-xs uppercase font-mono border outline-none ${
                            isDarkMode ? "bg-slate-800 border-slate-700 text-slate-200" : "bg-white border-gray-300"
                          }`}
                        />
                      </div>
                    )}

                    <div>
                      <label className="block text-[11px] font-semibold text-gray-400 mb-1">
                        Min ({step.sensorConfig?.unit || "Ω"})
                      </label>
                      <input
                        type="number"
                        step="any"
                        placeholder="ไม่จำกัด"
                        value={step.sensorConfig?.minValue || ""}
                        onChange={(e) => handleSensorConfigChange(sIdx, "minValue", e.target.value)}
                        className={`w-full px-3 py-1.5 rounded-lg text-xs font-mono border outline-none ${
                          isDarkMode ? "bg-slate-800 border-slate-700 text-slate-200" : "bg-white border-gray-300"
                        }`}
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-gray-400 mb-1">
                        Max ({step.sensorConfig?.unit || "Ω"})
                      </label>
                      <input
                        type="number"
                        step="any"
                        placeholder="ไม่จำกัด"
                        value={step.sensorConfig?.maxValue || ""}
                        onChange={(e) => handleSensorConfigChange(sIdx, "maxValue", e.target.value)}
                        className={`w-full px-3 py-1.5 rounded-lg text-xs font-mono border outline-none ${
                          isDarkMode ? "bg-slate-800 border-slate-700 text-slate-200" : "bg-white border-gray-300"
                        }`}
                      />
                    </div>
                  </div>

                  <div className="mt-3 pt-3 border-t border-purple-800/30 flex items-center justify-between">
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={Boolean(step.sensorConfig?.allowOverload)}
                        onChange={(e) => handleSensorConfigChange(sIdx, "allowOverload", e.target.checked)}
                        className="w-4 h-4 rounded text-purple-600 focus:ring-purple-500 border-gray-300 cursor-pointer"
                      />
                      <span className={`text-xs font-semibold ${isDarkMode ? "text-purple-200" : "text-purple-900"}`}>
                        ยอมรับค่า Overload เป็น PASS (OL = OK เช่น เช็คไม่ช็อต / วงจรเปิด Open Circuit)
                      </span>
                    </label>

                    {step.sensorConfig?.allowOverload && (
                      <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-bold">
                        OL Accepted
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </React.Fragment>
        ))}

        <button
          onClick={handleAddStep}
          className={`w-full py-3 rounded-2xl border-2 border-dashed font-semibold text-xs transition-all flex items-center justify-center gap-2 ${
            isDarkMode
              ? "border-slate-700 text-slate-300 hover:border-blue-500 bg-slate-800/30"
              : "border-gray-300 text-gray-600 hover:border-blue-600 bg-white"
          }`}
        >
          + เพิ่ม Step ต่อท้ายสุด
        </button>
      </div>
    </div>
  );
}