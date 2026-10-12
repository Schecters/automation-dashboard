import React, { useState, useEffect, useMemo } from 'react';

// 🟢 Component แสดงรูปจาก Graph API ผ่าน ?email=...
function UserAvatar({ email, name, className = "w-7 h-7 text-xs" }) {
  const [imgSrc, setImgSrc] = useState(null);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    let isMounted = true;
    const cleanEmail = String(email || '').trim();

    if (!cleanEmail) {
      setImgSrc(null);
      return;
    }

    const fetchPhoto = async () => {
      try {
        const res = await fetch(`/api/users/photo-by-email?email=${encodeURIComponent(cleanEmail)}`);
        if (!res.ok) {
          if (isMounted) setHasError(true);
          return;
        }

        const blob = await res.blob();
        if (blob.size === 0) {
          if (isMounted) setHasError(true);
          return;
        }

        if (isMounted) {
          setImgSrc(URL.createObjectURL(blob));
          setHasError(false);
        }
      } catch {
        if (isMounted) setHasError(true);
      }
    };

    fetchPhoto();

    return () => {
      isMounted = false;
      if (imgSrc) URL.revokeObjectURL(imgSrc);
    };
  }, [email]);

  if (imgSrc && !hasError) {
    return (
      <img
        src={imgSrc}
        alt={name || "User Avatar"}
        className={`${className} rounded-full object-cover border border-blue-400/40 shadow-sm shrink-0`}
        onError={() => setHasError(true)}
      />
    );
  }

  const initial = name ? name.trim().charAt(0).toUpperCase() : "?";
  return (
    <div className={`${className} rounded-full bg-blue-600 text-white font-bold flex items-center justify-center shrink-0 shadow-sm border border-blue-400/30`}>
      {initial}
    </div>
  );
}

// 🟢 Component ขยายรูป Owner ขนาดใหญ่ใน Modal
function LargeUserAvatar({ email, name }) {
  const [imgSrc, setImgSrc] = useState(null);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    let isMounted = true;
    const cleanEmail = String(email || '').trim();

    if (!cleanEmail) {
      setImgSrc(null);
      return;
    }

    const fetchPhoto = async () => {
      try {
        const res = await fetch(`/api/users/photo-by-email?email=${encodeURIComponent(cleanEmail)}`);
        if (!res.ok) {
          if (isMounted) setHasError(true);
          return;
        }
        const blob = await res.blob();
        if (blob.size === 0) {
          if (isMounted) setHasError(true);
          return;
        }
        if (isMounted) {
          setImgSrc(URL.createObjectURL(blob));
          setHasError(false);
        }
      } catch {
        if (isMounted) setHasError(true);
      }
    };

    fetchPhoto();

    return () => {
      isMounted = false;
      if (imgSrc) URL.revokeObjectURL(imgSrc);
    };
  }, [email]);

  if (imgSrc && !hasError) {
    return (
      <img
        src={imgSrc}
        alt={name || "User Avatar"}
        className="w-48 h-48 rounded-3xl object-cover border-2 border-blue-500/40 shadow-2xl"
        onError={() => setHasError(true)}
      />
    );
  }

  const initial = name ? name.trim().charAt(0).toUpperCase() : "?";
  return (
    <div className="w-48 h-48 rounded-3xl bg-blue-600/20 text-blue-400 text-6xl font-black flex items-center justify-center border-2 border-blue-500/30 shadow-2xl">
      {initial}
    </div>
  );
}

export default function LinesAndStation({ isDarkMode }) {
  const [lines, setLines] = useState([]);
  const [stations, setStations] = useState([]);
  const [users, setUsers] = useState([]);
  const [excelConfigs, setExcelConfigs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState('all');

  const userRole = (localStorage.getItem("userRole") || "").toLowerCase().trim();
  const isAdmin = userRole === "admin";

  const [viewLineModalOpen, setViewLineModalOpen] = useState(false);
  const [viewingLine, setViewingLine] = useState(null);
  const [viewingOwnerSearchTerm, setViewingOwnerSearchTerm] = useState('');

  // 🟢 State สำหรับ Modal แสดงรายละเอียดและรูปภาพขนาดใหญ่ของ Owner
  const [ownerDetailModal, setOwnerDetailModal] = useState(null);

  const [lineModalOpen, setLineModalOpen] = useState(false);
  const [editingLine, setEditingLine] = useState(null);
  const [lineIdInput, setLineIdInput] = useState('');
  const [selectedOwners, setSelectedOwners] = useState([]);
  const [userSearchTerm, setUserSearchTerm] = useState('');
  const [userRoleFilter, setUserRoleFilter] = useState('all');
  const [selectedStations, setSelectedStations] = useState([]);
  const [stationSearchTerm, setStationSearchTerm] = useState('');

  // Modal State: Stations
  const [stationModalOpen, setStationModalOpen] = useState(false);
  const [editingStation, setEditingStation] = useState(null);
  const [stationIdInput, setStationIdInput] = useState('');
  const [stationNameInput, setStationNameInput] = useState('');
  
  const [examRules, setExamRules] = useState([]);
  const [examPickerModalOpen, setExamPickerModalOpen] = useState(false);
  const [examPickerSearch, setExamPickerSearch] = useState('');

  const [actionLoading, setActionLoading] = useState(false);

  const API_URL = `/api`;

  const getHeaders = () => {
    const token = localStorage.getItem('token') || localStorage.getItem('sessionToken');
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    };
  };

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const headers = getHeaders();
      const [resLines, resStations, resUsers, resConfigs] = await Promise.all([
        fetch(`${API_URL}/lines`, { headers }),
        fetch(`${API_URL}/stations`, { headers }),
        isAdmin ? fetch(`${API_URL}/users`, { headers }) : Promise.resolve(null),
        isAdmin ? fetch(`${API_URL}/excel-configs`, { headers }) : Promise.resolve(null)
      ]);

      if (!resLines.ok || !resStations.ok) throw new Error('เกิดข้อผิดพลาดในการดึงข้อมูล');

      const linesData = await resLines.json();
      const rawLines = Array.isArray(linesData) ? linesData : linesData.data || [];

      const linesWithStations = await Promise.all(
        rawLines.map(async (l) => {
          try {
            const resSt = await fetch(`${API_URL}/lines/${encodeURIComponent(l.id)}/stations`, { headers });
            const dataSt = await resSt.json();
            return {
              ...l,
              stations: dataSt.success && Array.isArray(dataSt.data) ? dataSt.data : []
            };
          } catch {
            return { ...l, stations: [] };
          }
        })
      );
      setLines(linesWithStations);

      const stationsData = await resStations.json();
      const rawStations = Array.isArray(stationsData) ? stationsData : stationsData.data || [];
      const stationsWithExams = await Promise.all(
        rawStations.map(async (st) => {
          try {
            const resEx = await fetch(`${API_URL}/stations/${encodeURIComponent(st.id)}/exams`, { headers });
            const dataEx = await resEx.json();
            return {
              ...st,
              required_exams: dataEx.success && Array.isArray(dataEx.data) ? dataEx.data : []
            };
          } catch {
            return { ...st, required_exams: [] };
          }
        })
      );
      setStations(stationsWithExams);

      if (resUsers && resUsers.ok) {
        const usersData = await resUsers.json();
        setUsers(Array.isArray(usersData) ? usersData : usersData.data || []);
      }

      if (resConfigs && resConfigs.ok) {
        const configsData = await resConfigs.json();
        const confArray = Array.isArray(configsData) ? configsData : configsData.data || [];
        setExcelConfigs(confArray);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const availableRoles = useMemo(() => {
    const rolesSet = new Set(users.map(u => (u.role || '').toLowerCase().trim()).filter(Boolean));
    return Array.from(rolesSet);
  }, [users]);

  const resolveOwnerEmail = (empId, fallbackEmail = '') => {
    if (fallbackEmail && String(fallbackEmail).includes('@')) return fallbackEmail;
    const found = users.find(u => Number(u.employee_id) === Number(empId));
    return found?.email || '';
  };

  const handleOpenViewLine = (line) => {
    setViewingLine(line);
    setViewingOwnerSearchTerm('');
    setViewLineModalOpen(true);
  };

  const handleOpenAddLine = () => {
    if (!isAdmin) return;
    setEditingLine(null);
    setLineIdInput('');
    setSelectedOwners([]);
    setSelectedStations([]);
    setUserSearchTerm('');
    setUserRoleFilter('all');
    setStationSearchTerm('');
    setLineModalOpen(true);
  };

  const handleOpenEditLine = (line) => {
    if (!isAdmin) return;
    setEditingLine(line);
    setLineIdInput(line.id);
    
    const formattedOwners = (line.owners || []).map(o => ({
      employee_id: o.employee_id,
      role_type: o.role_type || 'owner',
      email: o.email || resolveOwnerEmail(o.employee_id)
    }));
    setSelectedOwners(formattedOwners);
    setSelectedStations(line.stations ? line.stations.map(s => s.id) : []);
    setUserSearchTerm('');
    setUserRoleFilter('all');
    setStationSearchTerm('');
    setLineModalOpen(true);
  };

  const handleSaveLine = async (e) => {
    e.preventDefault();
    if (!isAdmin) return alert('เฉพาะ Admin เท่านั้นที่สามารถแก้ไขข้อมูลได้');
    if (!lineIdInput.trim()) return alert('กรุณากรอก Line ID');

    setActionLoading(true);
    try {
      const headers = getHeaders();
      const targetLineId = lineIdInput.trim().toUpperCase();

      let res;
      if (editingLine) {
        res = await fetch(`${API_URL}/lines/${editingLine.id}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({ new_id: targetLineId, owner_ids: selectedOwners })
        });
      } else {
        res = await fetch(`${API_URL}/lines`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ id: targetLineId, owner_ids: selectedOwners })
        });
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'บันทึกข้อมูลไม่สำเร็จ');

      const resStationMapping = await fetch(`${API_URL}/lines/${encodeURIComponent(targetLineId)}/stations`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ station_ids: selectedStations })
      });
      const dataMapping = await resStationMapping.json();
      if (!resStationMapping.ok) throw new Error(dataMapping.message || 'ผูก Station กับ Line ไม่สำเร็จ');

      setLineModalOpen(false);
      fetchData();
    } catch (err) {
      alert(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteLine = async (lineId) => {
    if (!isAdmin) return alert('เฉพาะ Admin เท่านั้นที่สามารถลบข้อมูลได้');
    if (!window.confirm(`ยืนยันการลบ Line "${lineId}" หรือไม่?`)) return;
    try {
      const res = await fetch(`${API_URL}/lines/${lineId}`, {
        method: 'DELETE',
        headers: getHeaders()
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'ลบไม่สำเร็จ');
      fetchData();
    } catch (err) {
      alert(err.message);
    }
  };

  const toggleOwnerSelection = (empId) => {
    setSelectedOwners(prev => {
      const exists = prev.find(o => o.employee_id === empId);
      if (exists) {
        return prev.filter(o => o.employee_id !== empId);
      } else {
        const targetUser = users.find(u => u.employee_id === empId);
        return [...prev, { employee_id: empId, role_type: 'owner', email: targetUser?.email || '' }];
      }
    });
  };

  const handleUpdateOwnerRoleType = (empId, newRoleType) => {
    setSelectedOwners(prev =>
      prev.map(o => o.employee_id === empId ? { ...o, role_type: newRoleType } : o)
    );
  };

  const toggleStationSelection = (stId) => {
    setSelectedStations(prev =>
      prev.includes(stId) ? prev.filter(id => id !== stId) : [...prev, stId]
    );
  };

  const filteredModalStations = (stations || []).filter((st) => {
    const q = stationSearchTerm.toLowerCase().trim();
    if (!q) return true;
    return (st.id || '').toLowerCase().includes(q) || (st.name || '').toLowerCase().includes(q);
  });

  const isAllVisibleStationsSelected =
    filteredModalStations.length > 0 &&
    filteredModalStations.every((st) => selectedStations.includes(st.id));

  const handleSelectAllStations = () => {
    const visibleIds = filteredModalStations.map((st) => st.id);
    setSelectedStations((prev) => Array.from(new Set([...prev, ...visibleIds])));
  };

  const handleClearAllStations = () => {
    const visibleIds = filteredModalStations.map((st) => st.id);
    setSelectedStations((prev) => prev.filter((id) => !visibleIds.includes(id)));
  };

  // Station Handlers
  const handleOpenAddStation = () => {
    if (!isAdmin) return;
    setEditingStation(null);
    setStationIdInput('');
    setStationNameInput('');
    setExamRules([]);
    setStationModalOpen(true);
  };

  const handleOpenEditStation = (station) => {
    if (!isAdmin) return;
    setEditingStation(station);
    setStationIdInput(station.id);
    setStationNameInput(station.name);
    
    const rules = (station.required_exams || []).map((ex, index) => ({
      rule_id: ex.id || `rule_${Date.now()}_${index}`,
      config_key: ex.config_key,
      file_name: ex.file_name || ex.config_key,
      min_score: ex.min_score !== undefined ? Number(ex.min_score) : 80,
      is_required: ex.is_required !== false,
      line_scope_type: ex.line_scope_type || 'COMMON',
      line_ids: Array.isArray(ex.line_ids) ? ex.line_ids : []
    }));
    setExamRules(rules);
    setStationModalOpen(true);
  };

  const handleSelectConfigFromPicker = (cfg) => {
    const newRule = {
      rule_id: `rule_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      config_key: cfg.config_key,
      file_name: cfg.file_name || cfg.config_key,
      min_score: 80,
      is_required: true,
      line_scope_type: 'COMMON',
      line_ids: []
    };
    setExamRules(prev => [...prev, newRule]);
    setExamPickerModalOpen(false);
  };

  const handleRemoveRule = (rule_id) => {
    setExamRules(prev => prev.filter(r => r.rule_id !== rule_id));
  };

  const updateRuleField = (rule_id, field, value) => {
    setExamRules(prev => prev.map(r => {
      if (r.rule_id !== rule_id) return r;
      if (field === 'line_scope_type' && value === 'COMMON') {
        return { ...r, [field]: value, line_ids: [] };
      }
      return { ...r, [field]: value };
    }));
  };

  const toggleRuleTargetLine = (rule_id, lineId) => {
    setExamRules(prev => prev.map(r => {
      if (r.rule_id !== rule_id) return r;
      const currentLines = r.line_ids || [];
      const nextLines = currentLines.includes(lineId)
        ? currentLines.filter(id => id !== lineId)
        : [...currentLines, lineId];
      return { ...r, line_ids: nextLines };
    }));
  };

  const handleSaveStation = async (e) => {
    e.preventDefault();
    if (!isAdmin) return alert('เฉพาะ Admin เท่านั้นที่สามารถแก้ไขข้อมูลได้');
    if (!stationIdInput.trim() || !stationNameInput.trim()) {
      return alert('กรุณากรอกรหัสและชื่อ Station ให้ครบถ้วน');
    }

    setActionLoading(true);
    try {
      const headers = getHeaders();
      const targetStationId = stationIdInput.trim();

      let res;
      if (editingStation) {
        res = await fetch(`${API_URL}/stations/${editingStation.id}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({ new_id: targetStationId, name: stationNameInput.trim() })
        });
      } else {
        res = await fetch(`${API_URL}/stations`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ id: targetStationId, name: stationNameInput.trim() })
        });
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'บันทึกข้อมูล Station ไม่สำเร็จ');

      const resExams = await fetch(`${API_URL}/stations/${encodeURIComponent(targetStationId)}/exams`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          exams: examRules.map(r => ({
            config_key: r.config_key,
            min_score: Number(r.min_score) || 80,
            is_required: Boolean(r.is_required),
            line_scope_type: r.line_scope_type || 'COMMON',
            line_ids: r.line_ids || []
          }))
        })
      });
      const dataExams = await resExams.json();
      if (!resExams.ok) throw new Error(dataExams.message || 'บันทึกเกณฑ์ข้อสอบไม่สำเร็จ');

      setStationModalOpen(false);
      fetchData();
    } catch (err) {
      alert(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteStation = async (stationId) => {
    if (!isAdmin) return alert('เฉพาะ Admin เท่านั้นที่สามารถลบข้อมูลได้');
    if (!window.confirm(`ยืนยันการลบ Station "${stationId}" หรือไม่?`)) return;
    try {
      const res = await fetch(`${API_URL}/stations/${stationId}`, {
        method: 'DELETE',
        headers: getHeaders()
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'ลบไม่สำเร็จ');
      fetchData();
    } catch (err) {
      alert(err.message);
    }
  };

  const filteredStations = (stations || []).filter((st) =>
    (st.id || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (st.name || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredUsers = (users || []).filter((u) => {
    const q = userSearchTerm.toLowerCase().trim();
    const matchId = String(u.employee_id).toLowerCase().includes(q);
    const matchName = (u.name || '').toLowerCase().includes(q);
    const userRoleLower = (u.role || '').toLowerCase().trim();
    return (!q || matchId || matchName || userRoleLower.includes(q)) && (userRoleFilter === 'all' || userRoleLower === userRoleFilter);
  });

  const filteredPickerConfigs = useMemo(() => {
    const q = examPickerSearch.toLowerCase().trim();
    if (!q) return excelConfigs;
    return excelConfigs.filter(c => 
      (c.config_key || '').toLowerCase().includes(q) ||
      (c.file_name || '').toLowerCase().includes(q)
    );
  }, [excelConfigs, examPickerSearch]);

  const getLineRoleBadge = (roleType) => {
    switch ((roleType || '').toLowerCase().trim()) {
      case 'supervisor':
        return { label: 'Supervisor', style: 'bg-purple-500/15 text-purple-400 border-purple-500/30' };
      case 'leader':
        return { label: 'Leader', style: 'bg-amber-500/15 text-amber-400 border-amber-500/30' };
      default:
        return { label: 'Owner', style: 'bg-blue-500/15 text-blue-400 border-blue-500/30' };
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
        <p className={`text-xs ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>
          กำลังโหลดข้อมูลจากฐานข้อมูล automation_lines...
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 🟢 Modal: ดูรายละเอียดและรูปขยายขนาดใหญ่ของ Owner */}
      {ownerDetailModal && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-150"
          onClick={() => setOwnerDetailModal(null)}
        >
          <div
            className={`max-w-md w-full p-6 rounded-3xl shadow-2xl border space-y-5 relative text-center ${
              isDarkMode ? "bg-[#1E293B] border-slate-700 text-slate-100" : "bg-white border-gray-200 text-gray-900"
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b pb-3 border-slate-700/40">
              <span className={`text-[10px] font-bold uppercase px-2.5 py-0.5 rounded-lg border ${getLineRoleBadge(ownerDetailModal.role_type).style}`}>
                {getLineRoleBadge(ownerDetailModal.role_type).label} Detail
              </span>
              <button
                type="button"
                onClick={() => setOwnerDetailModal(null)}
                className="w-8 h-8 rounded-full bg-slate-500/10 hover:bg-slate-500/20 flex items-center justify-center text-sm font-bold"
              >
                ✕
              </button>
            </div>

            {/* รูปขยายใหญ่ */}
            <div className="flex justify-center py-2">
              <LargeUserAvatar email={ownerDetailModal.email} name={ownerDetailModal.name} />
            </div>

            <div className="space-y-1">
              <h3 className="font-bold text-lg leading-tight">{ownerDetailModal.name || 'ไม่ระบุชื่อ'}</h3>
              <p className="font-mono text-xs text-blue-400 font-semibold">Employee ID: #{ownerDetailModal.employee_id}</p>
              {ownerDetailModal.email && (
                <p className="text-xs text-gray-400">{ownerDetailModal.email}</p>
              )}
            </div>

            <div className="pt-2 border-t border-slate-700/40 flex items-center justify-between text-xs px-2">
              <span className="text-gray-400 font-medium">Line:</span>
              <span className="font-mono font-bold text-purple-400 bg-purple-500/15 px-3 py-1 rounded-xl border border-purple-500/30">
                {ownerDetailModal.line_id || '-'}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-gray-200 dark:border-slate-700/60">
        <div>
          <div className="flex items-center gap-2">
            <h2 className={`text-xl font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
              Lines & Station Management
            </h2>
            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
              isAdmin ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' : 'bg-slate-500/10 text-slate-400 border border-slate-500/20'
            }`}>
              {isAdmin ? 'Admin Mode (Editable)' : 'Viewer Mode (Read-only)'}
            </span>
            <button onClick={fetchData} title="Refresh Data" className="p-1 text-gray-400 hover:text-blue-500 transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          </div>
        </div>

        {/* Tab Controls */}
        <div className={`flex gap-1 p-1 rounded-xl border ${isDarkMode ? 'bg-[#1E293B] border-slate-700/80' : 'bg-gray-100 border-gray-200'}`}>
          {[
            { id: 'all', label: 'Overview' },
            { id: 'lines', label: `Lines (${lines.length})` },
            { id: 'stations', label: `Stations (${stations.length})` }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                activeTab === tab.id
                  ? 'bg-blue-600 text-white shadow-sm font-semibold'
                  : isDarkMode ? 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/40' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200/60'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Section 1: Lines */}
      {(activeTab === 'all' || activeTab === 'lines') && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className={`text-sm font-semibold flex items-center gap-2 ${isDarkMode ? 'text-slate-200' : 'text-gray-700'}`}>
              Production Lines ({lines.length})
            </h3>
            {isAdmin && (
              <button
                onClick={handleOpenAddLine}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-xl shadow-sm transition-all"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
                </svg>
                <span>Add Line</span>
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {lines.map((line) => (
              <div 
                key={line.id} 
                className={`rounded-2xl border transition-all flex flex-col justify-between overflow-hidden shadow-sm ${
                  isDarkMode ? 'bg-[#1E293B] border-slate-700/60' : 'bg-white border-gray-200'
                }`}
              >
                <div>
                  <div className={`px-5 py-3 border-b flex items-center justify-between ${
                    isDarkMode ? 'bg-slate-800/80 border-slate-700/60' : 'bg-blue-50/70 border-blue-100'
                  }`}>
                    <span className="font-mono font-bold text-base text-blue-600 dark:text-blue-400">{line.id}</span>
                  </div>

                  <div className="p-5 space-y-4 text-xs">
                    <div>
                      <span className={`block text-[11px] mb-2 font-semibold ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>
                        Line Management Team ({line.owners?.length || 0})
                      </span>
                      <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1 custom-scrollbar">
                        {line.owners && line.owners.length > 0 ? (
                          line.owners.map((owner, idx) => {
                            const badge = getLineRoleBadge(owner.role_type);
                            const ownerEmail = resolveOwnerEmail(owner.employee_id, owner.email);
                            return (
                              <div
                                key={idx}
                                onClick={() => setOwnerDetailModal({ ...owner, email: ownerEmail, line_id: line.id })}
                                className={`flex items-center justify-between px-3 py-2 rounded-xl border cursor-pointer transition-all ${
                                  isDarkMode
                                    ? 'bg-[#0F172A] border-slate-700/40 text-slate-200 hover:bg-slate-800 hover:border-blue-500/50'
                                    : 'bg-gray-50 border-gray-200/80 text-gray-700 hover:bg-blue-50/60 hover:border-blue-300'
                                }`}
                                title="คลิกเพื่อดูรูปภาพและรายละเอียด"
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <UserAvatar email={ownerEmail} name={owner.name} className="w-6 h-6 text-[10px]" />
                                  <div className="truncate">
                                    <span className="font-mono text-blue-500 font-semibold text-[11px] mr-1">#{owner.employee_id}</span>
                                    <span className="font-medium truncate max-w-[120px]">{owner.name}</span>
                                  </div>
                                </div>
                                <span className={`text-[9px] font-bold uppercase px-2 py-0.5 rounded border shrink-0 ${badge.style}`}>
                                  {badge.label}
                                </span>
                              </div>
                            );
                          })
                        ) : (
                          <div className="text-gray-400 text-[11px] py-1 italic">ยังไม่มีผู้ดูแลที่ระบุ</div>
                        )}
                      </div>
                    </div>

                    <div className="pt-2 border-t border-slate-700/30">
                      <span className={`block text-[11px] mb-2 font-semibold ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>
                        Stations ประจำ Line ({line.stations?.length || 0})
                      </span>
                      {line.stations && line.stations.length > 0 ? (
                        <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1 custom-scrollbar">
                          {line.stations.map((st) => {
                            const fullStation = stations.find(s => s.id === st.id);
                            return (
                              <div key={st.id} className={`flex items-center gap-2 p-2 rounded-xl border text-[11px] ${
                                isDarkMode ? 'bg-[#0F172A]/80 border-slate-700/50 text-slate-200' : 'bg-gray-50 border-gray-200 text-gray-800'
                              }`}>
                                <span className="px-2 py-0.5 rounded-lg font-mono font-bold text-[10px] bg-purple-500/10 text-purple-400 border border-purple-500/20 shrink-0">
                                  {st.id}
                                </span>
                                <span className="truncate font-medium">{st.name || fullStation?.name || '-'}</span>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="text-gray-400 text-[11px] py-1 italic">ยังไม่ได้ผูก Station กับ Line นี้</div>
                      )}
                    </div>
                  </div>
                </div>

                <div className={`px-5 py-3 border-t flex items-center justify-end gap-1.5 ${
                  isDarkMode ? 'border-slate-700/60 bg-slate-900/40' : 'border-gray-100 bg-gray-50/50'
                }`}>
                  <button
                    onClick={() => handleOpenViewLine(line)}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-blue-500 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 rounded-xl transition-colors shadow-sm"
                  >
                    <span>Details</span>
                  </button>

                  {isAdmin && (
                    <>
                      <button
                        onClick={() => handleOpenEditLine(line)}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-amber-500 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 rounded-xl transition-colors shadow-sm"
                      >
                        <span>Edit</span>
                      </button>
                      <button
                        onClick={() => handleDeleteLine(line.id)}
                        className="p-1.5 text-rose-500 hover:bg-rose-500/10 border border-rose-500/20 rounded-xl transition-colors shadow-sm"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Section 2: Stations */}
      {(activeTab === 'all' || activeTab === 'stations') && (
        <div className="space-y-3 pt-2">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <h3 className={`text-sm font-semibold flex items-center gap-2 ${isDarkMode ? 'text-slate-200' : 'text-gray-700'}`}>
              Station List ({filteredStations.length})
            </h3>

            <div className="flex items-center gap-2 flex-wrap">
              <input
                type="text"
                placeholder="Search Station..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className={`w-full sm:w-60 px-3 py-1.5 rounded-xl text-xs border outline-none transition-all ${
                  isDarkMode ? 'bg-[#1E293B] border-slate-700 text-white' : 'bg-white border-gray-300 text-gray-900'
                }`}
              />
              {isAdmin && (
                <button
                  onClick={handleOpenAddStation}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-xl shadow-sm transition-all"
                >
                  <span>Add Station</span>
                </button>
              )}
            </div>
          </div>

          <div className={`overflow-x-auto rounded-2xl border ${isDarkMode ? 'bg-[#1E293B] border-slate-700/60' : 'bg-white border-gray-200 shadow-sm'}`}>
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className={`border-b ${isDarkMode ? 'bg-[#0F172A]/60 border-slate-700/60 text-slate-400' : 'bg-gray-50 border-gray-200 text-gray-500'}`}>
                  <th className="py-3 px-4 font-semibold uppercase tracking-wider w-32">Station ID</th>
                  <th className="py-3 px-4 font-semibold uppercase tracking-wider">Process Name / Description</th>
                  <th className="py-3 px-4 font-semibold uppercase tracking-wider">Exam Rules (กฎเกณฑ์ข้อสอบ)</th>
                  {isAdmin && <th className="py-3 px-4 font-semibold uppercase tracking-wider text-right w-24">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-700/30">
                {filteredStations.length === 0 ? (
                  <tr>
                    <td colSpan={isAdmin ? 4 : 3} className="py-8 text-center text-gray-400">ไม่พบข้อมูล Station</td>
                  </tr>
                ) : (
                  filteredStations.map((st) => (
                    <tr key={st.id} className={isDarkMode ? 'hover:bg-slate-700/20 text-slate-200' : 'hover:bg-gray-50/80 text-gray-700'}>
                      <td className="py-3 px-4">
                        <span className="font-mono font-bold text-blue-500 px-2 py-0.5 bg-blue-500/10 rounded-md border border-blue-500/20">
                          {st.id}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-medium">{st.name}</td>
                      <td className="py-3 px-4">
                        <div className="flex flex-wrap gap-1.5">
                          {st.required_exams && st.required_exams.length > 0 ? (
                            st.required_exams.map((ex, idx) => {
                              const isReq = ex.is_required !== false;
                              const scope = ex.line_scope_type || 'COMMON';
                              return (
                                <span
                                  key={idx}
                                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-semibold border ${
                                    isReq ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' : 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30'
                                  }`}
                                >
                                  <span>{ex.file_name ? ex.file_name.replace(".xlsx", "") : ex.config_key}</span>
                                  <span className={`px-1 rounded text-[9px] font-bold ${isReq ? 'bg-emerald-500/20 text-emerald-300' : 'bg-cyan-500/20 text-cyan-300'}`}>
                                    {isReq ? 'REQ' : 'OPT'}
                                  </span>
                                  <strong className="font-mono">≥{ex.min_score}</strong>
                                  {scope !== 'COMMON' && (
                                    <span className="text-[9px] px-1 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                                      {scope === 'INCLUDE' ? `Line: ${ex.line_ids?.join(',')}` : `Excl: ${ex.line_ids?.join(',')}`}
                                    </span>
                                  )}
                                </span>
                              );
                            })
                          ) : (
                            <span className="text-[11px] text-gray-400 italic">ไม่มีเงื่อนไขข้อสอบ</span>
                          )}
                        </div>
                      </td>
                      {isAdmin && (
                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button onClick={() => handleOpenEditStation(st)} className="p-1.5 text-gray-400 hover:text-blue-500 rounded-lg">
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                              </svg>
                            </button>
                            <button onClick={() => handleDeleteStation(st.id)} className="p-1.5 text-gray-400 hover:text-rose-500 rounded-lg">
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal 1: Add / Edit Line */}
      {isAdmin && lineModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className={`w-full max-w-4xl max-h-[90vh] flex flex-col rounded-2xl p-6 border shadow-2xl ${
            isDarkMode ? 'bg-[#1E293B] border-slate-700 text-white' : 'bg-white border-gray-200 text-gray-900'
          }`}>
            <div className="flex items-center justify-between pb-3 border-b border-gray-200 dark:border-slate-700/60 mb-4">
              <h3 className="text-base font-bold">{editingLine ? `Edit Line: ${editingLine.id}` : 'Add New Production Line'}</h3>
              <button onClick={() => setLineModalOpen(false)} className="text-gray-400 hover:text-gray-200">✕</button>
            </div>

            <form onSubmit={handleSaveLine} className="flex-1 overflow-hidden flex flex-col justify-between">
              <div className="grid grid-cols-1 md:grid-cols-12 gap-6 overflow-y-auto pr-1 pb-2">
                <div className="md:col-span-5 space-y-4">
                  <div>
                    <label className="block text-xs font-semibold mb-1 text-gray-400">Line ID / Code *</label>
                    <input
                      type="text"
                      required
                      value={lineIdInput}
                      onChange={(e) => setLineIdInput(e.target.value.toUpperCase())}
                      className={`w-full px-3 py-2 text-xs rounded-xl border font-mono ${
                        isDarkMode ? 'bg-[#0F172A] border-slate-700 text-white' : 'bg-gray-50 border-gray-300 text-gray-900'
                      }`}
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-xs font-semibold text-gray-400">Management Team ({selectedOwners.length})</label>
                    </div>

                    <div className="flex items-center gap-1.5 mb-2">
                      <div className="relative flex-1">
                        <input
                          type="text"
                          placeholder="Search User ID / Name..."
                          value={userSearchTerm}
                          onChange={(e) => setUserSearchTerm(e.target.value)}
                          className={`w-full pl-7 pr-6 py-1.5 text-xs rounded-xl border outline-none ${
                            isDarkMode ? 'bg-[#0F172A] border-slate-700 text-white placeholder-slate-500' : 'bg-gray-50 border-gray-300 text-gray-900 placeholder-gray-400'
                          }`}
                        />
                        {userSearchTerm && (
                          <button
                            type="button"
                            onClick={() => setUserSearchTerm('')}
                            className="absolute right-2 top-1.5 text-xs text-gray-400 hover:text-gray-200"
                          >
                            ✕
                          </button>
                        )}
                      </div>

                      <select
                        value={userRoleFilter}
                        onChange={(e) => setUserRoleFilter(e.target.value)}
                        className={`px-2 py-1.5 text-xs rounded-xl border outline-none ${
                          isDarkMode ? 'bg-[#0F172A] border-slate-700 text-slate-300' : 'bg-gray-50 border-gray-300 text-gray-700'
                        }`}
                      >
                        <option value="all">All Roles</option>
                        {availableRoles.map(r => (
                          <option key={r} value={r}>{r.toUpperCase()}</option>
                        ))}
                      </select>
                    </div>

                    <div className={`max-h-72 overflow-y-auto p-1.5 rounded-xl border space-y-1.5 custom-scrollbar ${
                      isDarkMode ? 'bg-[#0F172A] border-slate-700' : 'bg-gray-50 border-gray-300'
                    }`}>
                      {filteredUsers.length === 0 ? (
                        <div className="text-center py-6 text-xs text-gray-400">ไม่พบพนักงานที่ตรงกับการค้นหา</div>
                      ) : (
                        filteredUsers.map((u) => {
                          const matchedOwner = selectedOwners.find(o => o.employee_id === u.employee_id);
                          const isSelected = Boolean(matchedOwner);
                          const userEmail = resolveOwnerEmail(u.employee_id, u.email);
                          return (
                            <div key={u.employee_id} className={`flex flex-col p-2.5 rounded-xl border text-xs gap-2 ${
                              isSelected ? 'bg-blue-950/30 border-blue-500/50 text-white' : isDarkMode ? 'bg-slate-800/40 border-slate-700/60' : 'bg-white border-gray-200'
                            }`}>
                              <div className="flex items-center justify-between cursor-pointer" onClick={() => toggleOwnerSelection(u.employee_id)}>
                                <div className="flex items-center gap-2 min-w-0">
                                  <input type="checkbox" checked={isSelected} readOnly className="pointer-events-none" />
                                  <UserAvatar email={userEmail} name={u.name} className="w-6 h-6 text-[10px]" />
                                  <span className="font-mono font-bold text-blue-400">#{u.employee_id}</span>
                                  <span className="font-medium truncate max-w-[130px]">{u.name}</span>
                                </div>
                                <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-slate-500/20 shrink-0">{u.role}</span>
                              </div>
                              {isSelected && (
                                <div className="flex items-center gap-2 border-t border-blue-500/20 pt-2 pl-6">
                                  <span className="text-[10px] text-gray-400">ตำแหน่ง:</span>
                                  <select
                                    value={matchedOwner.role_type || 'owner'}
                                    onChange={(e) => handleUpdateOwnerRoleType(u.employee_id, e.target.value)}
                                    className={`px-2 py-1 text-[11px] rounded border outline-none ${
                                      isDarkMode ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-gray-300 text-gray-900'
                                    }`}
                                  >
                                    <option value="owner">Line Owner</option>
                                    <option value="leader">Line Leader</option>
                                    <option value="supervisor">Line Supervisor</option>
                                  </select>
                                </div>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>

                <div className="md:col-span-7 flex flex-col">
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-semibold text-gray-400">ผูก Stations ({selectedStations.length})</label>
                    <button
                      type="button"
                      onClick={isAllVisibleStationsSelected ? handleClearAllStations : handleSelectAllStations}
                      className="text-[11px] font-semibold text-purple-400 hover:underline"
                    >
                      {isAllVisibleStationsSelected ? 'ยกเลิกทั้งหมด' : 'เลือกทั้งหมด'}
                    </button>
                  </div>

                  <div className="relative mb-2">
                    <input
                      type="text"
                      placeholder="Search Station ID / Name..."
                      value={stationSearchTerm}
                      onChange={(e) => setStationSearchTerm(e.target.value)}
                      className={`w-full pl-7 pr-6 py-1.5 text-xs rounded-xl border outline-none ${
                        isDarkMode ? 'bg-[#0F172A] border-slate-700 text-white placeholder-slate-500' : 'bg-gray-50 border-gray-300 text-gray-900 placeholder-gray-400'
                      }`}
                    />
                    {stationSearchTerm && (
                      <button
                        type="button"
                        onClick={() => setStationSearchTerm('')}
                        className="absolute right-2 top-1.5 text-xs text-gray-400 hover:text-gray-200"
                      >
                        ✕
                      </button>
                    )}
                  </div>

                  <div className={`flex-1 min-h-[290px] max-h-[320px] overflow-y-auto p-2 rounded-xl border space-y-1.5 custom-scrollbar ${
                    isDarkMode ? 'bg-[#0F172A] border-slate-700' : 'bg-gray-50 border-gray-300'
                  }`}>
                    {filteredModalStations.length === 0 ? (
                      <div className="text-center py-6 text-xs text-gray-400">ไม่พบ Station ที่ตรงกับการค้นหา</div>
                    ) : (
                      filteredModalStations.map((st) => {
                        const isSelected = selectedStations.includes(st.id);
                        return (
                          <div
                            key={st.id}
                            onClick={() => toggleStationSelection(st.id)}
                            className={`flex items-center justify-between p-2.5 rounded-xl cursor-pointer text-xs border ${
                              isSelected ? 'bg-purple-600 border-purple-500 text-white' : isDarkMode ? 'bg-slate-800/40 border-slate-700/60' : 'bg-white border-gray-200'
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              <input type="checkbox" checked={isSelected} readOnly className="pointer-events-none" />
                              <span className="font-mono font-bold">{st.id}</span>
                              <span>{st.name}</span>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-4 mt-2 border-t border-gray-200 dark:border-slate-700/60">
                <button type="button" onClick={() => setLineModalOpen(false)} className="px-4 py-2 text-xs text-gray-400">ยกเลิก</button>
                <button type="submit" disabled={actionLoading} className="px-5 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-xl">
                  {actionLoading ? 'กำลังบันทึก...' : 'บันทึก'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 2: Add / Edit Station */}
      {isAdmin && stationModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className={`w-full max-w-5xl max-h-[96vh] flex flex-col rounded-2xl p-6 border shadow-2xl ${
            isDarkMode ? 'bg-[#1E293B] border-slate-700 text-white' : 'bg-white border-gray-200 text-gray-900'
          }`}>
            <div className="flex items-center justify-between pb-3 border-b border-gray-200 dark:border-slate-700/60 mb-4">
              <h3 className="text-base font-bold">
                {editingStation ? `Edit Station: ${editingStation.id}` : 'Add New Master Station'}
              </h3>
              <button onClick={() => setStationModalOpen(false)} className="text-gray-400 hover:text-gray-200">✕</button>
            </div>

            <form onSubmit={handleSaveStation} className="flex-1 overflow-hidden flex flex-col justify-between space-y-4">
              <div className="space-y-4 overflow-y-auto pr-1 pb-1 custom-scrollbar">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-semibold mb-1 text-gray-400">Station ID *</label>
                    <input
                      type="text"
                      required
                      value={stationIdInput}
                      onChange={(e) => setStationIdInput(e.target.value)}
                      className={`w-full px-3 py-2 text-xs rounded-xl border font-mono ${
                        isDarkMode ? 'bg-[#0F172A] border-slate-700 text-white' : 'bg-gray-50 border-gray-300 text-gray-900'
                      }`}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold mb-1 text-gray-400">Process Name / Description *</label>
                    <input
                      type="text"
                      required
                      value={stationNameInput}
                      onChange={(e) => setStationNameInput(e.target.value)}
                      className={`w-full px-3 py-2 text-xs rounded-xl border ${
                        isDarkMode ? 'bg-[#0F172A] border-slate-700 text-white' : 'bg-gray-50 border-gray-300 text-gray-900'
                      }`}
                    />
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-700/40 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <h4 className={`text-xs font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                        กฎเกณฑ์ข้อสอบประจำ Station ({examRules.length} กฎ)
                      </h4>
                      <p className="text-[11px] text-gray-400">สามารถเพิ่มข้อสอบชุดเดิมซ้ำได้ เพื่อกำหนดคะแนนต่างกันตามแต่ละ Line</p>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setExamPickerSearch('');
                        setExamPickerModalOpen(true);
                      }}
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-sm transition-all flex items-center gap-1.5"
                    >
                      <span>+ เพิ่มกฎข้อสอบ</span>
                    </button>
                  </div>

                  <div className={`max-h-80 overflow-y-auto p-2 rounded-xl border space-y-2.5 custom-scrollbar ${
                    isDarkMode ? 'bg-[#0F172A] border-slate-700' : 'bg-gray-50 border-gray-300'
                  }`}>
                    {examRules.map((rule, rIdx) => {
                      const isReq = rule.is_required !== false;
                      const scopeType = rule.line_scope_type || 'COMMON';

                      return (
                        <div
                          key={rule.rule_id}
                          className={`p-3 rounded-xl border transition-all space-y-2.5 ${
                            isDarkMode ? 'bg-slate-800/60 border-slate-700' : 'bg-white border-gray-200 shadow-sm'
                          }`}
                        >
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-blue-500/20 text-blue-400 font-bold">
                                กฎ #{rIdx + 1}
                              </span>
                              <div>
                                <p className={`font-bold text-xs ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                                  {rule.file_name}
                                </p>
                                <p className="text-[10px] text-gray-400 font-mono">{rule.config_key}</p>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              <button
                                type="button"
                                onClick={() => updateRuleField(rule.rule_id, 'is_required', !isReq)}
                                className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border transition-all ${
                                  isReq ? 'bg-emerald-600 text-white border-emerald-500' : 'bg-cyan-600 text-white border-cyan-500'
                                }`}
                              >
                                {isReq ? 'REQ (บังคับ)' : 'OPT (แนะนำ)'}
                              </button>

                              <span className={`text-[11px] font-semibold ${isDarkMode ? 'text-white' : 'text-gray-700'}`}>เกณฑ์ (≥):</span>
                              <input
                                type="number"
                                min="0"
                                max="100"
                                value={rule.min_score}
                                onChange={(e) => updateRuleField(rule.rule_id, 'min_score', Number(e.target.value) || 0)}
                                className={`w-14 p-1 text-center rounded-lg border text-xs font-bold font-mono ${
                                  isDarkMode ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-gray-300 text-gray-900'
                                }`}
                              />
                              <span className={`text-[11px] ${isDarkMode ? 'text-gray-300' : 'text-gray-500'}`}>pts</span>

                              <button
                                type="button"
                                onClick={() => handleRemoveRule(rule.rule_id)}
                                className="p-1 text-rose-500 hover:bg-rose-500/10 rounded-lg ml-2 font-bold text-xs"
                                title="ลบกฎนี้"
                              >
                                ✕
                              </button>
                            </div>
                          </div>

                          <div className="pt-2 border-t border-slate-700/40 space-y-2">
                            <div className="flex flex-wrap items-center gap-3 text-xs">
                              <span className={`text-[11px] font-bold ${isDarkMode ? 'text-white' : 'text-gray-700'}`}>ขอบเขตไลน์:</span>

                              <label className="flex items-center gap-1 cursor-pointer">
                                <input
                                  type="radio"
                                  name={`scope-${rule.rule_id}`}
                                  checked={scopeType === 'COMMON'}
                                  onChange={() => updateRuleField(rule.rule_id, 'line_scope_type', 'COMMON')}
                                  className="text-blue-600"
                                />
                                <span className={`text-[11px] ${isDarkMode ? 'text-white' : 'text-gray-800'}`}>ทุก Line (Common)</span>
                              </label>

                              <label className="flex items-center gap-1 cursor-pointer">
                                <input
                                  type="radio"
                                  name={`scope-${rule.rule_id}`}
                                  checked={scopeType === 'INCLUDE'}
                                  onChange={() => updateRuleField(rule.rule_id, 'line_scope_type', 'INCLUDE')}
                                  className="text-amber-600"
                                />
                                <span className="text-[11px] text-amber-400 font-medium">เฉพาะ Line ที่เลือก</span>
                              </label>

                              <label className="flex items-center gap-1 cursor-pointer">
                                <input
                                  type="radio"
                                  name={`scope-${rule.rule_id}`}
                                  checked={scopeType === 'EXCLUDE'}
                                  onChange={() => updateRuleField(rule.rule_id, 'line_scope_type', 'EXCLUDE')}
                                  className="text-rose-600"
                                />
                                <span className="text-[11px] text-rose-400 font-medium">ทุก Line ยกเว้น</span>
                              </label>
                            </div>

                            {scopeType !== 'COMMON' && (
                              <div className="p-2 rounded-xl border border-slate-700/70 bg-black/20 space-y-1.5">
                                <span className="text-[10px] text-gray-400 font-semibold block">
                                  {scopeType === 'INCLUDE' ? 'เลือก Line ที่ต้องการใช้เกณฑ์นี้:' : 'เลือก Line ที่ต้องการยกเว้นเกณฑ์นี้:'}
                                </span>
                                <div className="flex flex-wrap gap-1.5">
                                  {lines.map((l) => {
                                    const isLineChecked = (rule.line_ids || []).includes(l.id);
                                    return (
                                      <button
                                        key={l.id}
                                        type="button"
                                        onClick={() => toggleRuleTargetLine(rule.rule_id, l.id)}
                                        className={`px-2 py-0.5 rounded-lg text-[10px] font-mono font-bold border transition-all ${
                                          isLineChecked
                                            ? scopeType === 'INCLUDE' ? 'bg-amber-500 text-slate-900 border-amber-400' : 'bg-rose-500 text-white border-rose-400'
                                            : isDarkMode ? 'bg-slate-800 text-white border-slate-700 hover:bg-slate-700' : 'bg-gray-100 text-gray-700 border-gray-300 hover:bg-gray-200'
                                        }`}
                                      >
                                        {isLineChecked ? `✓ ${l.id}` : `+ ${l.id}`}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}

                    {examRules.length === 0 && (
                      <div className="text-center py-8 text-xs text-gray-400">
                        ยังไม่มีการกำหนดกฎเกณฑ์ข้อสอบสำหรับ Station นี้ (กดปุ่ม "+ เพิ่มกฎข้อสอบ" ด้านบน)
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-gray-200 dark:border-slate-700/60">
                <button type="button" onClick={() => setStationModalOpen(false)} className="px-4 py-2 text-xs text-gray-400">ยกเลิก</button>
                <button type="submit" disabled={actionLoading} className="px-5 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-xl">
                  {actionLoading ? 'กำลังบันทึก...' : 'บันทึก'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 3: Exam Picker */}
      {examPickerModalOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-150">
          <div className={`w-full max-w-xl max-h-[85vh] flex flex-col rounded-3xl p-6 border shadow-2xl space-y-4 ${
            isDarkMode ? 'bg-[#0F172A] border-slate-700 text-white' : 'bg-white border-gray-200 text-gray-900'
          }`}>
            <div className="flex items-center justify-between border-b pb-3 border-slate-700/60">
              <div>
                <h3 className={`text-sm font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                  เลือกวิชาข้อสอบเพื่อสร้างกฎ
                </h3>
                <p className="text-[11px] text-gray-400">พิมพ์ค้นหาหรือคลิกเลือกวิชาที่ต้องการ</p>
              </div>
              <button
                type="button"
                onClick={() => setExamPickerModalOpen(false)}
                className="w-8 h-8 rounded-full flex items-center justify-center text-gray-400 hover:text-white hover:bg-slate-800"
              >
                ✕
              </button>
            </div>

            <div className="relative">
              <input
                type="text"
                value={examPickerSearch}
                onChange={(e) => setExamPickerSearch(e.target.value)}
                placeholder="พิมพ์ค้นหาชื่อไฟล์ หรือ รหัสข้อสอบ..."
                autoFocus
                className={`w-full px-4 py-2.5 text-xs rounded-xl border outline-none font-medium ${
                  isDarkMode 
                    ? 'bg-slate-900 border-slate-700 text-white placeholder-slate-500 focus:border-blue-500' 
                    : 'bg-gray-50 border-gray-300 text-gray-900 placeholder-gray-400 focus:border-blue-500'
                }`}
              />
              {examPickerSearch && (
                <button
                  type="button"
                  onClick={() => setExamPickerSearch('')}
                  className="absolute right-3 top-2.5 text-xs text-gray-400 hover:text-white"
                >
                  ✕
                </button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto space-y-2 pr-1 custom-scrollbar max-h-96">
              {filteredPickerConfigs.map(c => (
                <button
                  key={c.config_key}
                  type="button"
                  onClick={() => handleSelectConfigFromPicker(c)}
                  className={`w-full text-left p-3 rounded-2xl border flex items-center justify-between transition-all ${
                    isDarkMode 
                      ? 'bg-slate-900/70 border-slate-800 hover:bg-blue-600 hover:border-blue-500 text-white' 
                      : 'bg-gray-50 border-gray-200 hover:bg-blue-50 hover:border-blue-300 text-gray-900'
                  }`}
                >
                  <div className="truncate pr-3">
                    <p className="font-bold text-xs leading-relaxed truncate">
                      {c.file_name ? c.file_name.replace(".xlsx", "") : c.config_key}
                    </p>
                    <p className="text-[10px] font-mono text-gray-400">
                      รหัส: {c.config_key}
                    </p>
                  </div>
                  <span className="text-xs font-bold text-blue-400 shrink-0">
                    + เลือก
                  </span>
                </button>
              ))}

              {filteredPickerConfigs.length === 0 && (
                <div className="p-8 text-center text-xs text-gray-400">
                  ไม่พบข้อสอบที่ตรงกับ "{examPickerSearch}"
                </div>
              )}
            </div>

            <div className="flex justify-end pt-2 border-t border-slate-700/60">
              <button
                type="button"
                onClick={() => setExamPickerModalOpen(false)}
                className="px-4 py-2 text-xs font-semibold rounded-xl border border-slate-700 text-gray-300 hover:bg-slate-800"
              >
                ปิด
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal 4: View Line Details */}
      {viewLineModalOpen && viewingLine && (() => {
        const activeStationsInLine = (viewingLine.stations || [])
          .map((st) => {
            const fullStation = stations.find((s) => s.id === st.id);
            return {
              id: st.id,
              name: st.name || fullStation?.name || '-',
              allExams: fullStation?.required_exams || []
            };
          })
          .filter((st) => st.id);

        const filteredViewingOwners = (viewingLine.owners || []).filter((owner) => {
          const q = viewingOwnerSearchTerm.toLowerCase().trim();
          if (!q) return true;
          return (
            String(owner.employee_id).toLowerCase().includes(q) ||
            (owner.name || '').toLowerCase().includes(q) ||
            (owner.role_type || '').toLowerCase().includes(q)
          );
        });

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div className={`w-full max-w-3xl max-h-[90vh] flex flex-col rounded-2xl p-6 border shadow-2xl ${
              isDarkMode ? 'bg-[#1E293B] border-slate-700 text-white' : 'bg-white border-gray-200 text-gray-900'
            }`}>
              <div className="flex items-center justify-between pb-3 border-b border-gray-200 dark:border-slate-700/60 mb-4">
                <div>
                  <h3 className="text-base font-bold flex items-center gap-2">
                    <span>Line Details:</span>
                    <span className="font-mono text-blue-500 bg-blue-500/10 px-2 py-0.5 rounded-lg border border-blue-500/20">{viewingLine.id}</span>
                  </h3>
                  <p className={`text-xs mt-0.5 ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>
                    รายการ Stations และ Line Management Team ประจำ Line {viewingLine.id}
                  </p>
                </div>
                <button onClick={() => setViewLineModalOpen(false)} className="text-gray-400 hover:text-gray-200">✕</button>
              </div>

              <div className="flex-1 overflow-y-auto space-y-5 pr-1 pb-2 custom-scrollbar">
                <div>
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2.5">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-gray-400">
                      Line Management Team ({filteredViewingOwners.length}/{viewingLine.owners?.length || 0})
                    </h4>

                    <div className="relative w-full sm:w-56">
                      <input
                        type="text"
                        placeholder="Search ID, Name, Role..."
                        value={viewingOwnerSearchTerm}
                        onChange={(e) => setViewingOwnerSearchTerm(e.target.value)}
                        className={`w-full pl-7 pr-6 py-1 text-xs rounded-xl border outline-none ${
                          isDarkMode ? 'bg-[#0F172A] border-slate-700 text-white placeholder-slate-500' : 'bg-gray-50 border-gray-300 text-gray-900 placeholder-gray-400'
                        }`}
                      />
                      {viewingOwnerSearchTerm && (
                        <button
                          type="button"
                          onClick={() => setViewingOwnerSearchTerm('')}
                          className="absolute right-2 top-1 text-xs text-gray-400 hover:text-gray-200"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {filteredViewingOwners.length > 0 ? (
                      filteredViewingOwners.map((owner, idx) => {
                        const ownerEmail = resolveOwnerEmail(owner.employee_id, owner.email);
                        return (
                          <div 
                            key={idx} 
                            onClick={() => setOwnerDetailModal({ ...owner, email: ownerEmail, line_id: viewingLine.id })}
                            className={`flex items-center justify-between px-3.5 py-2.5 rounded-xl border cursor-pointer transition-all ${
                              isDarkMode 
                                ? 'bg-[#0F172A] border-slate-700/60 text-slate-200 hover:bg-slate-800 hover:border-blue-500/50' 
                                : 'bg-gray-50 border-gray-200 text-gray-700 hover:bg-blue-50/60 hover:border-blue-300'
                            }`}
                            title="คลิกเพื่อดูรูปภาพและรายละเอียด"
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <UserAvatar email={ownerEmail} name={owner.name} className="w-7 h-7 text-xs" />
                              <div className="truncate">
                                <span className="font-mono text-blue-400 font-bold text-xs bg-blue-500/10 px-2 py-0.5 rounded border border-blue-500/20 mr-1.5">
                                  #{owner.employee_id}
                                </span>
                                <span className="font-medium text-xs truncate">{owner.name}</span>
                              </div>
                            </div>
                            <span className={`text-[9px] font-bold uppercase px-2 py-0.5 rounded border shrink-0 ${getLineRoleBadge(owner.role_type).style}`}>
                              {getLineRoleBadge(owner.role_type).label}
                            </span>
                          </div>
                        );
                      })
                    ) : (
                      <div className="text-gray-400 text-xs py-2 italic col-span-2">
                        {viewingLine.owners?.length > 0 ? 'ไม่พบรายชื่อที่ตรงกับการค้นหา' : 'ยังไม่มีการระบุทีมผู้ดูแล'}
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider mb-2.5 text-gray-400">
                    Stations ประจำ Line ({activeStationsInLine.length})
                  </h4>
                  {activeStationsInLine.length > 0 ? (
                    <div className={`overflow-hidden rounded-xl border ${isDarkMode ? 'border-slate-700/60 bg-[#0F172A]' : 'border-gray-200 bg-gray-50'}`}>
                      <table className="w-full text-left text-xs border-collapse">
                        <thead>
                          <tr className={`border-b ${isDarkMode ? 'bg-[#0F172A]/80 border-slate-700/60 text-slate-400' : 'bg-gray-100 border-gray-200 text-gray-600'}`}>
                            <th className="py-2.5 px-3.5 font-semibold w-16 text-center">ลำดับ</th>
                            <th className="py-2.5 px-3.5 font-semibold w-28">Station ID</th>
                            <th className="py-2.5 px-3.5 font-semibold">ชื่อขั้นตอน</th>
                            <th className="py-2.5 px-3.5 font-semibold">เกณฑ์ข้อสอบที่มีผลกับ Line นี้</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200 dark:divide-slate-800">
                          {activeStationsInLine.map((st, idx) => {
                            const lineExams = st.allExams.filter((ex) => {
                              const scope = ex.line_scope_type || 'COMMON';
                              const lineIds = ex.line_ids || [];
                              if (scope === 'INCLUDE') return lineIds.includes(viewingLine.id);
                              if (scope === 'EXCLUDE') return !lineIds.includes(viewingLine.id);
                              return true;
                            });

                            return (
                              <tr key={st.id} className={isDarkMode ? 'hover:bg-slate-800/40 text-slate-300' : 'hover:bg-white text-gray-700'}>
                                <td className="py-3 px-3.5 text-center font-mono text-gray-400">{idx + 1}</td>
                                <td className="py-3 px-3.5">
                                  <span className="px-2 py-0.5 rounded font-mono font-bold text-purple-400 bg-purple-500/10 border border-purple-500/20">{st.id}</span>
                                </td>
                                <td className="py-3 px-3.5 font-medium">{st.name}</td>
                                <td className="py-3 px-3.5">
                                  <div className="flex flex-wrap gap-1">
                                    {lineExams.length > 0 ? (
                                      lineExams.map((ex, exIdx) => (
                                        <span key={exIdx} className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-medium border ${
                                          ex.is_required !== false ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20'
                                        }`}>
                                          <span>{ex.file_name ? ex.file_name.replace(".xlsx", "") : ex.config_key}</span>
                                          <strong className="font-mono">≥{ex.min_score}</strong>
                                        </span>
                                      ))
                                    ) : (
                                      <span className="text-gray-400 text-[11px] italic">ไม่มีเงื่อนไข</span>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="p-6 text-center text-xs text-gray-400">Line นี้ยังไม่ได้ทำการผูก Station ใดๆ</div>
                  )}
                </div>
              </div>

              <div className="flex justify-end pt-3 border-t border-gray-200 dark:border-slate-700/60">
                <button type="button" onClick={() => setViewLineModalOpen(false)} className="px-5 py-2 text-xs font-semibold bg-slate-700 hover:bg-slate-600 text-white rounded-xl">
                  ปิดหน้าต่าง
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}