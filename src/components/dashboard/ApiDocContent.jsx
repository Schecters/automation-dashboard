import React, { useState } from 'react';

export default function ApiDocContent({ isDarkMode }) {
  const [copiedIndex, setCopiedIndex] = useState(null);
  const [activeLang, setActiveLang] = useState('curl'); // 'curl' | 'python' | 'csharp'

  // ล็อค Protocol เป็น HTTP สำหรับ Local LAN
  const serverHost = typeof window !== 'undefined' ? window.location.hostname : '10.204.206.1';
  const currentHost = `http://${serverHost}:5000`;

  const copyToClipboard = (text, idx) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(idx);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  // รายการ API ทั้งหมดในระบบ (HTTP Mode)
  const endpoints = [
    {
      id: 'check-qualification',
      method: 'GET',
      badge: 'bg-emerald-600',
      title: 'Check Operator Qualification (เกณฑ์สอบพนักงานประจำสถานี)',
      path: '/api/operator-data',
      desc: 'ตรวจสอบคุณสมบัติพนักงานประจำคู่ Line + Station ว่าผ่านข้อสอบบังคับทั้งหมดตามเกณฑ์คะแนนใน Excel หรือไม่',
      params: [
        { name: 'employee_id', type: 'string', required: true, desc: 'รหัสพนักงาน (เช่น 86727533)' },
        { name: 'lines', type: 'string', required: true, desc: 'รหัส Production Line (เช่น STF_30)' },
        { name: 'station', type: 'string', required: true, desc: 'รหัส Station (เช่น THM, SW)' }
      ],
      sampleCurl: `curl -X GET "${currentHost}/api/operator-data?employee_id=86727533&lines=STF_30&station=THM"`,
      samplePython: `import requests\n\nurl = "${currentHost}/api/operator-data"\nparams = {\n    "employee_id": "86727533",\n    "lines": "STF_30",\n    "station": "THM"\n}\nres = requests.get(url, params=params)\nprint(res.json())`,
      sampleCsharp: `using var client = new HttpClient();\nvar response = await client.GetStringAsync("${currentHost}/api/operator-data?employee_id=86727533&lines=STF_30&station=THM");\nConsole.WriteLine(response);`,
      sampleResponse: {
        status: "pass",
        employee_id: "86727533",
        operator_name: "พชรพล อินแพง",
        lines: "STF_30",
        station: "THM",
        summary: {
          total_exams: 1,
          passed_exams: 1,
          all_passed: true
        },
        details: [
          {
            exam_key: "L2-QA-0001",
            exam_name: "L2 - NC Control",
            min_score: 18,
            score: 19,
            status: "PASS"
          }
        ]
      }
    },
    // 🟢 1. Endpoint ใหม่: ดึง Next Recipe ID & รายการ Recipe ทั้งหมด
    {
      id: 'plc-next-id',
      method: 'GET',
      badge: 'bg-amber-600',
      title: 'PLC Sequence: Next Recipe ID & Recipe List',
      path: '/api/plc/sequence/next-id',
      desc: 'ดึงเลข Recipe ID ลำดับถัดไป (Auto-Increment) พร้อมรายการ Recipe ทั้งหมดในระบบ สำหรับนำไปใช้สร้าง Recipe ใหม่',
      params: [],
      sampleCurl: `curl -X GET "${currentHost}/api/plc/sequence/next-id"`,
      samplePython: `import requests\n\nres = requests.get("${currentHost}/api/plc/sequence/next-id")\nprint(res.json())`,
      sampleCsharp: `using var client = new HttpClient();\nvar response = await client.GetStringAsync("${currentHost}/api/plc/sequence/next-id");\nConsole.WriteLine(response);`,
      sampleResponse: {
        success: true,
        nextId: "5",
        recipes: [
          {
            RecipeId: "4",
            RecipeName: "Dispensing Cycle"
          },
          {
            RecipeId: "3",
            RecipeName: "Pick and Place Cycle"
          }
        ]
      }
    },
    // 🟢 2. Endpoint ใหม่: ดึงขั้นตอนการทำงานและ Config ของ Recipe ตาม ID
    {
      id: 'plc-get-recipe',
      method: 'GET',
      badge: 'bg-amber-600',
      title: 'PLC Sequence: Get Recipe Details & Steps',
      path: '/api/plc/sequence/get?recipeId=4',
      desc: 'ดึงรายละเอียดข้อมูล Recipe และลำดับขั้นตอนคำสั่งทั้งหมด (Control Action & Sensor Configuration) ตาม Recipe ID',
      params: [
        { name: 'recipeId', type: 'query', required: true, desc: 'รหัส Recipe ที่ต้องการดึงข้อมูล (เช่น 4)' }
      ],
      sampleCurl: `curl -X GET "${currentHost}/api/plc/sequence/get?recipeId=4"`,
      samplePython: `import requests\n\nurl = "${currentHost}/api/plc/sequence/get"\nres = requests.get(url, params={"recipeId": "4"})\nprint(res.json())`,
      sampleCsharp: `using var client = new HttpClient();\nvar response = await client.GetStringAsync("${currentHost}/api/plc/sequence/get?recipeId=4");\nConsole.WriteLine(response);`,
      sampleResponse: {
        RecipeId: "4",
        RecipeName: "Dispensing Cycle",
        Steps: [
          {
            StepNo: 1,
            Type: "CONTROL",
            Description: "Cylinder Down",
            DurationMs: 1500,
            Actions: [
              { target: "Y0", state: 1 }
            ],
            SensorConfig: null
          },
          {
            StepNo: 2,
            Type: "SENSOR",
            Description: "Read Pressure Value",
            DurationMs: 500,
            Actions: [],
            SensorConfig: {
              sensor_id: "D4",
              expected_min: 50,
              expected_max: 100
            }
          }
        ]
      }
    },
    {
      id: 'get-lines',
      method: 'GET',
      badge: 'bg-blue-600',
      title: 'Get All Lines & Management Team',
      path: '/api/lines',
      desc: 'ดึงรายชื่อ Production Lines ทั้งหมด พร้อมรายชื่อผู้ดูแล (Owner, Leader, Supervisor)',
      params: [],
      sampleCurl: `curl -X GET "${currentHost}/api/lines"`,
      samplePython: `import requests\n\nres = requests.get("${currentHost}/api/lines")\nprint(res.json())`,
      sampleCsharp: `using var client = new HttpClient();\nvar response = await client.GetStringAsync("${currentHost}/api/lines");\nConsole.WriteLine(response);`,
      sampleResponse: [
        {
          id: "STF_30",
          owners: [
            { employee_id: 86727533, name: "พชรพล อินแพง", role_type: "owner" }
          ]
        }
      ]
    },
    {
      id: 'get-stations',
      method: 'GET',
      badge: 'bg-blue-600',
      title: 'Get All Stations & Exam Criteria',
      path: '/api/stations',
      desc: 'ดึงรายการ Master Stations ทั้งหมดพร้อมกฎเกณฑ์ข้อสอบที่ผูกไว้',
      params: [],
      sampleCurl: `curl -X GET "${currentHost}/api/stations"`,
      samplePython: `import requests\n\nres = requests.get("${currentHost}/api/stations")\nprint(res.json())`,
      sampleCsharp: `using var client = new HttpClient();\nvar response = await client.GetStringAsync("${currentHost}/api/stations");\nConsole.WriteLine(response);`,
      sampleResponse: {
        success: true,
        data: [
          {
            id: "THM",
            name: "Thermistor Process",
            required_exams: [
              { config_key: "L2-QA-0001", min_score: 18, is_required: true }
            ]
          }
        ]
      }
    },
    {
      id: 'get-assignments',
      method: 'GET',
      badge: 'bg-purple-600',
      title: 'Get Station Current Assignments',
      path: '/api/station-assignments/:lineId?shift=a',
      desc: 'ดึงข้อมูลการจัดคนลงสถานีปัจจุบันในไลน์นั้นๆ แยกตามกะ A หรือ B',
      params: [
        { name: 'lineId', type: 'path', required: true, desc: 'รหัส Line (เช่น STF_30)' },
        { name: 'shift', type: 'query', required: false, desc: 'กะทำงาน: a หรือ b' }
      ],
      sampleCurl: `curl -X GET "${currentHost}/api/station-assignments/STF_30?shift=a"`,
      samplePython: `import requests\n\nres = requests.get("${currentHost}/api/station-assignments/STF_30", params={"shift": "a"})\nprint(res.json())`,
      sampleCsharp: `using var client = new HttpClient();\nvar response = await client.GetStringAsync("${currentHost}/api/station-assignments/STF_30?shift=a");\nConsole.WriteLine(response);`,
      sampleResponse: {
        success: true,
        data: [
          {
            line_id: "STF_30",
            station_id: "THM",
            element_id: "st_1",
            shift: "a",
            operator_id: "86727533",
            operator_name: "พชรพล อินแพง"
          }
        ]
      }
    }
  ];

  return (
    <div className="space-y-8 pb-16 max-w-6xl mx-auto">
      {/* Header */}
      <div className="border-b pb-5 border-gray-200 dark:border-slate-700/60">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className={`text-2xl font-black tracking-tight ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
              System API Reference & Gateway
            </h2>
            <p className="text-xs text-gray-400 mt-1">
              เอกสารและจุดเชื่อมต่อ API สำหรับระบบภายนอก (C#, Python, Data Analysis, PLC & Automation Gateway) ในโหมด HTTP
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              HTTP // {serverHost}:5000
            </span>
          </div>
        </div>
      </div>

      {/* 📚 Endpoints Documentation List */}
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h3 className={`text-base font-bold flex items-center gap-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
            <span>รายการ Endpoint ทั้งหมดในระบบ</span>
          </h3>
        </div>

        {endpoints.map((ep, idx) => (
          <div
            key={ep.id}
            className={`rounded-3xl border overflow-hidden shadow-sm transition-all ${
              isDarkMode ? 'bg-[#1E293B] border-slate-700/70' : 'bg-white border-gray-200'
            }`}
          >
            {/* Header Item */}
            <div className={`p-5 border-b flex flex-col md:flex-row md:items-center justify-between gap-3 ${
              isDarkMode ? 'bg-slate-800/40 border-slate-700/70' : 'bg-gray-50/70 border-gray-200'
            }`}>
              <div className="flex items-center gap-3">
                <span className={`px-2.5 py-1 rounded-lg text-white font-mono text-xs font-bold ${ep.badge}`}>
                  {ep.method}
                </span>
                <span className="font-mono text-sm font-bold text-blue-500">
                  {ep.path}
                </span>
              </div>
              <p className={`text-xs font-medium ${isDarkMode ? 'text-slate-300' : 'text-gray-700'}`}>
                {ep.title}
              </p>
            </div>

            <div className="p-6 space-y-5 text-xs">
              <p className={`leading-relaxed ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                {ep.desc}
              </p>

              {/* Parameters Table */}
              {ep.params.length > 0 && (
                <div className="space-y-2">
                  <span className="text-[11px] font-bold text-gray-400 block uppercase tracking-wider">
                    Query / Path Parameters:
                  </span>
                  <div className={`overflow-x-auto rounded-xl border ${isDarkMode ? 'border-slate-700 bg-slate-900/40' : 'border-gray-200 bg-gray-50'}`}>
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className={`border-b text-[10px] uppercase font-bold text-gray-400 ${isDarkMode ? 'border-slate-700/60' : 'border-gray-200'}`}>
                          <th className="p-2.5 pl-3.5">Parameter</th>
                          <th className="p-2.5">Type</th>
                          <th className="p-2.5">Required</th>
                          <th className="p-2.5">Description</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-700/30">
                        {ep.params.map(p => (
                          <tr key={p.name}>
                            <td className="p-2.5 pl-3.5 font-mono font-bold text-blue-400">{p.name}</td>
                            <td className="p-2.5 font-mono text-gray-400">{p.type}</td>
                            <td className="p-2.5">
                              {p.required ? (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-400 font-bold border border-rose-500/20">required</span>
                              ) : (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-500/10 text-gray-400 font-medium">optional</span>
                              )}
                            </td>
                            <td className="p-2.5 text-gray-400">{p.desc}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Code Snippets & Examples (HTTP 100%) */}
              <div className="space-y-2 pt-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    {['curl', 'python', 'csharp'].map((lang) => (
                      <button
                        key={lang}
                        type="button"
                        onClick={() => setActiveLang(lang)}
                        className={`px-3 py-1 rounded-lg text-[10px] font-bold uppercase transition-all ${
                          activeLang === lang
                            ? 'bg-blue-600 text-white shadow-sm'
                            : isDarkMode ? 'bg-slate-800 text-gray-400 hover:text-white' : 'bg-gray-100 text-gray-600 hover:text-gray-900'
                        }`}
                      >
                        {lang === 'csharp' ? 'C# (.NET)' : lang}
                      </button>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      const text = activeLang === 'curl' ? ep.sampleCurl : activeLang === 'python' ? ep.samplePython : ep.sampleCsharp;
                      copyToClipboard(text, idx);
                    }}
                    className="text-[11px] text-blue-400 hover:underline font-mono"
                  >
                    {copiedIndex === idx ? '✓ Copied Code' : 'Copy Code'}
                  </button>
                </div>

                <pre className={`p-4 rounded-2xl text-xs font-mono overflow-x-auto custom-scrollbar border leading-relaxed ${
                  isDarkMode ? 'bg-[#0F172A] border-slate-700 text-slate-300' : 'bg-slate-900 border-gray-300 text-slate-200'
                }`}>
                  {activeLang === 'curl' && ep.sampleCurl}
                  {activeLang === 'python' && ep.samplePython}
                  {activeLang === 'csharp' && ep.sampleCsharp}
                </pre>
              </div>

              {/* Sample Response */}
              <div className="space-y-2 pt-1">
                <span className="text-[11px] font-bold text-gray-400 block uppercase tracking-wider">
                  Sample JSON Output (200 OK):
                </span>
                <pre className={`p-4 rounded-2xl text-xs font-mono overflow-x-auto custom-scrollbar border leading-relaxed ${
                  isDarkMode ? 'bg-[#0F172A] border-slate-700 text-emerald-400' : 'bg-slate-900 border-gray-300 text-emerald-400'
                }`}>
                  {JSON.stringify(ep.sampleResponse, null, 2)}
                </pre>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}