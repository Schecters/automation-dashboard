import React, { useState, useEffect, useMemo, useRef } from "react";
// 🟢 เชื่อมต่อ Socket.io สำหรับ Real-time Update
import { socket } from "../../socket";

// 🟢 แคช Object URL ของรูปภาพในหน่วยความจำ ไม่ต้องยิงขอซ้ำเมื่อ Sort หรือ Filter
const avatarCache = new Map();

// Sub-component สำหรับแสดงรูปโปรไฟล์จาก Microsoft Graph พร้อม Memory Cache
function UserAvatar({ email, name, isDarkMode }) {
  const cleanEmail = (email || "").trim().toLowerCase();
  const [imgSrc, setImgSrc] = useState(() => avatarCache.get(cleanEmail) || null);
  const [hasError, setHasError] = useState(false);
  const [loading, setLoading] = useState(!avatarCache.has(cleanEmail) && Boolean(cleanEmail));

  useEffect(() => {
    let isMounted = true;
    if (!cleanEmail) {
      setImgSrc(null);
      setLoading(false);
      return;
    }

    if (avatarCache.has(cleanEmail)) {
      setImgSrc(avatarCache.get(cleanEmail));
      setLoading(false);
      return;
    }

    const fetchPhoto = async () => {
      setLoading(true);
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
          const objectUrl = URL.createObjectURL(blob);
          avatarCache.set(cleanEmail, objectUrl);
          setImgSrc(objectUrl);
          setHasError(false);
        }
      } catch {
        if (isMounted) setHasError(true);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchPhoto();

    return () => {
      isMounted = false;
    };
  }, [cleanEmail]);

  if (loading) {
    return (
      <div className="w-8 h-8 rounded-full bg-slate-500/20 animate-pulse border border-slate-500/30 mx-auto" />
    );
  }

  if (imgSrc && !hasError) {
    return (
      <img
        src={imgSrc}
        alt={name || "User Avatar"}
        className="w-8 h-8 rounded-full object-cover border border-blue-500/30 shadow-sm mx-auto"
        onError={() => setHasError(true)}
      />
    );
  }

  const initial = name ? name.trim().charAt(0).toUpperCase() : "?";
  return (
    <div
      className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs border mx-auto ${
        email
          ? isDarkMode
            ? "bg-blue-500/10 text-blue-400 border-blue-500/30"
            : "bg-blue-50 text-blue-600 border-blue-200"
          : isDarkMode
          ? "bg-slate-800 text-slate-500 border-slate-700"
          : "bg-gray-100 text-gray-400 border-gray-200"
      }`}
      title={email ? `Email: ${email}` : "ไม่มีอีเมล"}
    >
      {initial}
    </div>
  );
}

export default function UserManagementContent({ isDarkMode }) {
  const [users, setUsers] = useState([]);
  const [rolesList, setRolesList] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedRole, setSelectedRole] = useState("all");

  const [sortConfig, setSortConfig] = useState({
    key: "employee_id",
    direction: "asc",
  });

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

  const [newUser, setNewUser] = useState({
    employeeId: "",
    name: "",
    email: "",
    password: "",
    role: "me",
    shift: "",
  });

  const [editingUser, setEditingUser] = useState(null);

  const API_URL = `/api`;

  const currentUser = useMemo(() => {
    try {
      const savedUser = JSON.parse(localStorage.getItem("user") || "{}");
      return {
        employee_id: savedUser.employee_id || localStorage.getItem("employeeId"),
        name: savedUser.name || localStorage.getItem("userName"),
        role: (savedUser.role || localStorage.getItem("userRole") || "").toLowerCase().trim(),
      };
    } catch {
      return {
        employee_id: localStorage.getItem("employeeId"),
        name: localStorage.getItem("userName"),
        role: (localStorage.getItem("userRole") || "").toLowerCase().trim(),
      };
    }
  }, []);

  const getAuthHeaders = () => {
    const token = localStorage.getItem("token") || localStorage.getItem("sessionToken");
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "x-session-token": token,
    };
  };

  const handleAuthError = (status) => {
    if (status === 401 || status === 403) {
      alert("Session หมดอายุ หรือคุณไม่มีสิทธิ์ Admin ในการจัดการผู้ใช้");
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      window.location.href = "/";
      return true;
    }
    return false;
  };

  const fetchData = async (isSilent = false) => {
    if (!isSilent) setIsLoading(true);
    try {
      const [resUsers, resRoles] = await Promise.all([
        fetch(`${API_URL}/users`, { headers: getAuthHeaders() }),
        fetch(`${API_URL}/roles`, { headers: getAuthHeaders() })
      ]);

      if (handleAuthError(resUsers.status)) return;

      const usersData = await resUsers.json();
      const rolesData = await resRoles.json();

      if (resUsers.ok) setUsers(Array.isArray(usersData) ? usersData : []);
      if (resRoles.ok && rolesData.success) {
        setRolesList(rolesData.data);
      }
    } catch (err) {
      console.error("Error connecting to server:", err);
    } finally {
      if (!isSilent) setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();

    // 🟢 ดักฟัง Event อัปเดตข้อมูลผู้ใช้แบบ Real-time ผ่าน Socket.io
    if (!socket) return;
    if (!socket.connected) socket.connect();

    const handleRealtimeUserChange = () => {
      fetchData(true);
    };

    socket.on("user_updated", handleRealtimeUserChange);
    socket.on("user_created", handleRealtimeUserChange);
    socket.on("user_deleted", handleRealtimeUserChange);

    return () => {
      socket.off("user_updated", handleRealtimeUserChange);
      socket.off("user_created", handleRealtimeUserChange);
      socket.off("user_deleted", handleRealtimeUserChange);
    };
  }, []);

  const handleAddUser = async (e) => {
    e.preventDefault();
    try {
      const response = await fetch(`${API_URL}/register`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          employeeId: Number(newUser.employeeId),
          name: newUser.name,
          email: newUser.email || null,
          password: newUser.password,
          role: newUser.role,
          shift: newUser.shift || null,
        }),
      });

      if (handleAuthError(response.status)) return;

      const data = await response.json();
      if (response.ok) {
        alert("เพิ่มผู้ใช้งานในระบบเรียบร้อย!");
        setIsAddModalOpen(false);
        setNewUser({ employeeId: "", name: "", email: "", password: "", role: rolesList[0] || "me", shift: "" });

        if (socket && socket.connected) {
          socket.emit("user_created", { employeeId: newUser.employeeId });
        }
        fetchData(true);
      } else {
        alert(`เกิดข้อผิดพลาด: ${data.message}`);
      }
    } catch (err) {
      console.error("Add user error:", err);
      alert("ไม่สามารถเชื่อมต่อกับเซิร์ฟเวอร์ได้");
    }
  };

  const handleOpenEdit = (user) => {
    setEditingUser({
      employeeId: user.employee_id,
      name: user.name,
      email: user.email || "",
      role: user.role,
      shift: user.shift || "",
      password: "",
    });
    setIsEditModalOpen(true);
  };

  const handleUpdateUser = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        name: editingUser.name,
        email: editingUser.email || null,
        role: editingUser.role,
        shift: editingUser.shift || null,
      };

      if (editingUser.password && editingUser.password.trim() !== "") {
        payload.password = editingUser.password;
      }

      const response = await fetch(`${API_URL}/users/${editingUser.employeeId}`, {
        method: "PUT",
        headers: getAuthHeaders(),
        body: JSON.stringify(payload),
      });

      if (handleAuthError(response.status)) return;

      const data = await response.json();
      if (response.ok) {
        alert("อัปเดตข้อมูลผู้ใช้เรียบร้อย!");
        setIsEditModalOpen(false);

        // ถ้ามีการแก้รูป/อีเมล เคลียร์แคชตัวเก่า
        if (editingUser.email) {
          avatarCache.delete(editingUser.email.trim().toLowerCase());
        }

        if (socket && socket.connected) {
          socket.emit("user_updated", { employeeId: editingUser.employeeId });
        }

        setEditingUser(null);
        fetchData(true);
      } else {
        alert(`เกิดข้อผิดพลาด: ${data.message}`);
      }
    } catch (err) {
      console.error("Update error:", err);
      alert("ไม่สามารถเชื่อมต่อกับเซิร์ฟเวอร์ได้");
    }
  };

  const handleDeleteUser = async (employeeId, name, email) => {
    if (String(currentUser.employee_id) === String(employeeId)) {
      alert("คุณไม่สามารถลบบัญชีผู้ดูแลระบบที่กำลังใช้งานอยู่ได้");
      return;
    }

    const isConfirm = window.confirm(`คุณแน่ใจหรือไม่ว่าต้องการลบผู้ใช้งาน "${name}" (ID: #${employeeId})?`);
    if (!isConfirm) return;

    try {
      const response = await fetch(`${API_URL}/users/${employeeId}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
      });

      if (handleAuthError(response.status)) return;

      const data = await response.json();
      if (response.ok) {
        alert("ลบผู้ใช้งานเรียบร้อย!");
        if (email) {
          avatarCache.delete(email.trim().toLowerCase());
        }

        if (socket && socket.connected) {
          socket.emit("user_deleted", { employeeId });
        }
        fetchData(true);
      } else {
        alert(`เกิดข้อผิดพลาด: ${data.message}`);
      }
    } catch (err) {
      console.error("Delete user error:", err);
      alert("ไม่สามารถเชื่อมต่อกับเซิร์ฟเวอร์ได้");
    }
  };

  const getRoleBadge = (role) => {
    switch (role) {
      case "admin":
        return "bg-rose-500/10 text-rose-500 border border-rose-500/20";
      case "me":
        return "bg-blue-500/10 text-blue-500 border border-blue-500/20";
      case "ie":
        return "bg-purple-500/10 text-purple-500 border border-purple-500/20";
      case "pd":
        return "bg-amber-500/10 text-amber-500 border border-amber-500/20";
      case "q":
        return "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20";
      default:
        return "bg-slate-500/10 text-slate-400 border border-slate-500/20";
    }
  };

  const getShiftBadge = (shift) => {
    switch (String(shift).toLowerCase().trim()) {
      case "a":
        return "bg-amber-500/10 text-amber-400 border border-amber-500/20";
      case "b":
        return "bg-indigo-500/10 text-indigo-400 border border-indigo-500/20";
      default:
        return "bg-slate-500/10 text-slate-400 border border-slate-500/20";
    }
  };

  const handleSort = (key) => {
    setSortConfig((prev) => {
      if (prev.key === key) {
        return { key, direction: prev.direction === "asc" ? "desc" : "asc" };
      }
      return { key, direction: "asc" };
    });
  };

  const filteredAndSortedUsers = useMemo(() => {
    let result = users.filter((u) => {
      if (selectedRole === "all") return true;
      return u.role === selectedRole;
    });

    if (sortConfig.key) {
      result = [...result].sort((a, b) => {
        let valA = a[sortConfig.key];
        let valB = b[sortConfig.key];

        if (sortConfig.key === "employee_id") {
          valA = Number(valA);
          valB = Number(valB);
        } else {
          valA = (valA || "").toString().toLowerCase();
          valB = (valB || "").toString().toLowerCase();
        }

        if (valA < valB) return sortConfig.direction === "asc" ? -1 : 1;
        if (valA > valB) return sortConfig.direction === "asc" ? 1 : -1;
        return 0;
      });
    }

    return result;
  }, [users, selectedRole, sortConfig]);

  const renderSortIcon = (columnKey) => {
    const isActive = sortConfig.key === columnKey;
    return (
      <svg
        className={`w-3.5 h-3.5 transition-transform ${
          isActive ? "text-blue-400" : "opacity-30"
        } ${isActive && sortConfig.direction === "desc" ? "rotate-180" : ""}`}
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 15l7-7 7 7" />
      </svg>
    );
  };

  return (
    <div className="space-y-6">
      {/* Top Bar Control */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className={`text-lg font-bold ${isDarkMode ? "text-slate-100" : "text-gray-900"}`}>
              User Management
            </h2>
            <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping"></span>
              LIVE
            </span>
          </div>
          <p className="text-xs text-gray-400 mt-0.5">
            จัดการบัญชีผู้ใช้งาน อีเมล สิทธิ์การเข้าถึง และกะการทำงาน (Admin Only)
          </p>
        </div>
        <button
          onClick={() => setIsAddModalOpen(true)}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-xl text-xs font-semibold shadow-md shadow-blue-500/20 transition-all self-start sm:self-auto"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
          </svg>
          Add New User
        </button>
      </div>

      {/* Role Filters */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          onClick={() => setSelectedRole("all")}
          className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
            selectedRole === "all"
              ? "bg-blue-600 text-white shadow-sm shadow-blue-500/20"
              : isDarkMode
              ? "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200"
              : "bg-gray-100 text-gray-600 hover:bg-gray-200 hover:text-gray-900"
          }`}
        >
          All Roles ({users.length})
        </button>
        {rolesList.map((role) => {
          const isActive = selectedRole === role;
          const count = users.filter((u) => u.role === role).length;
          return (
            <button
              key={role}
              onClick={() => setSelectedRole(role)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold uppercase transition-all ${
                isActive
                  ? "bg-blue-600 text-white shadow-sm shadow-blue-500/20"
                  : isDarkMode
                  ? "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200 hover:text-gray-900"
              }`}
            >
              {role} ({count})
            </button>
          );
        })}
      </div>

      {/* Table */}
      <div className={`rounded-2xl border shadow-sm overflow-hidden ${
        isDarkMode ? "bg-[#1E293B] border-slate-700/60 text-slate-300" : "bg-white border-gray-100 text-gray-600"
      }`}>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className={`font-bold uppercase tracking-wider border-b select-none ${
              isDarkMode ? "bg-slate-800/50 text-slate-400 border-slate-700/60" : "bg-gray-50/50 text-gray-400 border-gray-100"
            }`}>
              <tr>
                <th className="p-4 pl-6 text-center w-16">AVATAR</th>
                <th onClick={() => handleSort("employee_id")} className="p-4 cursor-pointer hover:text-blue-400 transition-colors w-28">
                  <div className="flex items-center gap-1.5">
                    <span>EMP ID</span>
                    {renderSortIcon("employee_id")}
                  </div>
                </th>
                <th onClick={() => handleSort("name")} className="p-4 cursor-pointer hover:text-blue-400 transition-colors">
                  <div className="flex items-center gap-1.5">
                    <span>USER NAME</span>
                    {renderSortIcon("name")}
                  </div>
                </th>
                <th onClick={() => handleSort("email")} className="p-4 cursor-pointer hover:text-blue-400 transition-colors">
                  <div className="flex items-center gap-1.5">
                    <span>EMAIL</span>
                    {renderSortIcon("email")}
                  </div>
                </th>
                <th onClick={() => handleSort("role")} className="p-4 text-center cursor-pointer hover:text-blue-400 transition-colors w-28">
                  <div className="flex items-center justify-center gap-1.5">
                    <span>ROLE</span>
                    {renderSortIcon("role")}
                  </div>
                </th>
                <th onClick={() => handleSort("shift")} className="p-4 text-center cursor-pointer hover:text-blue-400 transition-colors w-28">
                  <div className="flex items-center justify-center gap-1.5">
                    <span>SHIFT</span>
                    {renderSortIcon("shift")}
                  </div>
                </th>
                <th className="p-4 pr-6 text-center w-36">ACTION</th>
              </tr>
            </thead>
            <tbody className={`divide-y ${isDarkMode ? "divide-slate-700/50" : "divide-gray-100"}`}>
              {isLoading ? (
                <tr>
                  <td colSpan="7" className="p-6 text-center opacity-60">กำลังโหลดข้อมูล...</td>
                </tr>
              ) : filteredAndSortedUsers.length === 0 ? (
                <tr>
                  <td colSpan="7" className="p-6 text-center opacity-60">ไม่พบข้อมูลผู้ใช้งานตามเงื่อนไขที่เลือก</td>
                </tr>
              ) : (
                filteredAndSortedUsers.map((u) => (
                  <tr key={u.employee_id} className={`transition-colors ${isDarkMode ? "hover:bg-slate-700/30" : "hover:bg-gray-50/50"}`}>
                    <td className="p-4 pl-6 text-center">
                      <div className="flex items-center justify-center">
                        <UserAvatar email={u.email} name={u.name} isDarkMode={isDarkMode} />
                      </div>
                    </td>
                    <td className="p-4 font-bold text-blue-400 font-mono">#{u.employee_id}</td>
                    <td className={`p-4 font-bold ${isDarkMode ? "text-slate-100" : "text-gray-800"}`}>
                      {u.name}
                    </td>
                    <td className="p-4 font-mono text-[11px] opacity-80">
                      {u.email ? u.email : <span className="opacity-40 italic">-</span>}
                    </td>
                    <td className="p-4 text-center">
                      <span className={`px-2.5 py-1 rounded-md text-[10px] font-bold uppercase ${getRoleBadge(u.role)}`}>
                        {u.role}
                      </span>
                    </td>
                    <td className="p-4 text-center">
                      <span className={`px-2.5 py-1 rounded-md text-[10px] font-bold uppercase ${getShiftBadge(u.shift)}`}>
                        {u.shift ? `กะ ${u.shift.toUpperCase()}` : "-"}
                      </span>
                    </td>
                    <td className="p-4 pr-6 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => handleOpenEdit(u)}
                          className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-blue-500/10 text-blue-400 hover:bg-blue-600 hover:text-white transition-all"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDeleteUser(u.employee_id, u.name, u.email)}
                          className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-rose-500/10 text-rose-500 hover:bg-rose-600 hover:text-white transition-all"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal: Add New User */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className={`rounded-2xl border shadow-xl w-full max-w-md overflow-hidden transition-colors ${
            isDarkMode ? "bg-[#1E293B] border-slate-700 text-slate-100" : "bg-white border-gray-100 text-gray-900"
          }`}>
            <div className={`flex items-center justify-between px-6 py-4 border-b ${
              isDarkMode ? "border-slate-700/60 bg-slate-800/40" : "border-gray-100 bg-gray-50/50"
            }`}>
              <h3 className="text-base font-bold">Add New User</h3>
              <button onClick={() => setIsAddModalOpen(false)} className="opacity-60 hover:opacity-100">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleAddUser} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider mb-1 opacity-80">Employee ID (Number) *</label>
                <input
                  type="number"
                  placeholder="e.g. 101"
                  required
                  value={newUser.employeeId}
                  onChange={(e) => setNewUser({ ...newUser, employeeId: e.target.value })}
                  className={`w-full rounded-xl px-3.5 py-2 text-sm border focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    isDarkMode ? "bg-slate-800 border-slate-700 text-white" : "bg-gray-50 border-gray-200 text-gray-800"
                  }`}
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider mb-1 opacity-80">Full Name *</label>
                <input
                  type="text"
                  placeholder="e.g. Somchai Jaidee"
                  required
                  value={newUser.name}
                  onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
                  className={`w-full rounded-xl px-3.5 py-2 text-sm border focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    isDarkMode ? "bg-slate-800 border-slate-700 text-white" : "bg-gray-50 border-gray-200 text-gray-800"
                  }`}
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider mb-1 opacity-80">Email Address (Optional)</label>
                <input
                  type="email"
                  placeholder="e.g. somchai@company.com"
                  value={newUser.email}
                  onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                  className={`w-full rounded-xl px-3.5 py-2 text-sm border focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    isDarkMode ? "bg-slate-800 border-slate-700 text-white" : "bg-gray-50 border-gray-200 text-gray-800"
                  }`}
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider mb-1 opacity-80">Password *</label>
                <input
                  type="password"
                  placeholder="********"
                  required
                  value={newUser.password}
                  onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                  className={`w-full rounded-xl px-3.5 py-2 text-sm border focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    isDarkMode ? "bg-slate-800 border-slate-700 text-white" : "bg-gray-50 border-gray-200 text-gray-800"
                  }`}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider mb-1 opacity-80">Role</label>
                  <select
                    value={newUser.role}
                    onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
                    className={`w-full rounded-xl px-3.5 py-2 text-sm border focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase ${
                      isDarkMode ? "bg-slate-800 border-slate-700 text-white" : "bg-gray-50 border-gray-200 text-gray-800"
                    }`}
                  >
                    {rolesList.map((role) => (
                      <option key={role} value={role}>
                        {role.toUpperCase()}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider mb-1 opacity-80">Shift (กะ)</label>
                  <select
                    value={newUser.shift}
                    onChange={(e) => setNewUser({ ...newUser, shift: e.target.value })}
                    className={`w-full rounded-xl px-3.5 py-2 text-sm border focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                      isDarkMode ? "bg-slate-800 border-slate-700 text-white" : "bg-gray-50 border-gray-200 text-gray-800"
                    }`}
                  >
                    <option value="">-- ไม่ระบุ --</option>
                    <option value="a">กะ A (Shift A)</option>
                    <option value="b">กะ B (Shift B)</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-gray-200/50">
                <button type="button" onClick={() => setIsAddModalOpen(false)} className="px-4 py-2 rounded-xl text-xs font-semibold opacity-70 hover:opacity-100">
                  Cancel
                </button>
                <button type="submit" className="px-5 py-2 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 shadow-md shadow-blue-500/20">
                  Create User
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Edit User */}
      {isEditModalOpen && editingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className={`rounded-2xl border shadow-xl w-full max-w-md overflow-hidden transition-colors ${
            isDarkMode ? "bg-[#1E293B] border-slate-700 text-slate-100" : "bg-white border-gray-100 text-gray-900"
          }`}>
            <div className={`flex items-center justify-between px-6 py-4 border-b ${
              isDarkMode ? "border-slate-700/60 bg-slate-800/40" : "border-gray-100 bg-gray-50/50"
            }`}>
              <h3 className="text-base font-bold">Edit User (#{editingUser.employeeId})</h3>
              <button onClick={() => setIsEditModalOpen(false)} className="opacity-60 hover:opacity-100">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleUpdateUser} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider mb-1 opacity-80">Full Name *</label>
                <input
                  type="text"
                  required
                  value={editingUser.name}
                  onChange={(e) => setEditingUser({ ...editingUser, name: e.target.value })}
                  className={`w-full rounded-xl px-3.5 py-2 text-sm border focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    isDarkMode ? "bg-slate-800 border-slate-700 text-white" : "bg-gray-50 border-gray-200 text-gray-800"
                  }`}
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider mb-1 opacity-80">Email Address (Optional)</label>
                <input
                  type="email"
                  placeholder="e.g. somchai@company.com"
                  value={editingUser.email}
                  onChange={(e) => setEditingUser({ ...editingUser, email: e.target.value })}
                  className={`w-full rounded-xl px-3.5 py-2 text-sm border focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    isDarkMode ? "bg-slate-800 border-slate-700 text-white" : "bg-gray-50 border-gray-200 text-gray-800"
                  }`}
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider mb-1 opacity-80">
                  New Password <span className="text-[10px] lowercase opacity-60">(leave blank to keep current)</span>
                </label>
                <input
                  type="password"
                  placeholder="Enter new password to reset"
                  value={editingUser.password || ""}
                  onChange={(e) => setEditingUser({ ...editingUser, password: e.target.value })}
                  className={`w-full rounded-xl px-3.5 py-2 text-sm border focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    isDarkMode ? "bg-slate-800 border-slate-700 text-white" : "bg-gray-50 border-gray-200 text-gray-800"
                  }`}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider mb-1 opacity-80">Role</label>
                  <select
                    value={editingUser.role}
                    onChange={(e) => setEditingUser({ ...editingUser, role: e.target.value })}
                    className={`w-full rounded-xl px-3.5 py-2 text-sm border focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase ${
                      isDarkMode ? "bg-slate-800 border-slate-700 text-white" : "bg-gray-50 border-gray-200 text-gray-800"
                    }`}
                  >
                    {rolesList.map((role) => (
                      <option key={role} value={role}>
                        {role.toUpperCase()}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider mb-1 opacity-80">Shift (กะ)</label>
                  <select
                    value={editingUser.shift || ""}
                    onChange={(e) => setEditingUser({ ...editingUser, shift: e.target.value })}
                    className={`w-full rounded-xl px-3.5 py-2 text-sm border focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                      isDarkMode ? "bg-slate-800 border-slate-700 text-white" : "bg-gray-50 border-gray-200 text-gray-800"
                    }`}
                  >
                    <option value="">-- ไม่ระบุ --</option>
                    <option value="a">กะ A (Shift A)</option>
                    <option value="b">กะ B (Shift B)</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-gray-200/50">
                <button type="button" onClick={() => setIsEditModalOpen(false)} className="px-4 py-2 rounded-xl text-xs font-semibold opacity-70 hover:opacity-100">
                  Cancel
                </button>
                <button type="submit" className="px-5 py-2 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 shadow-md shadow-blue-500/20">
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}