
import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Popup,
} from "react-leaflet";

import "leaflet/dist/leaflet.css";
import "./admin.css";

const API =
  import.meta.env.VITE_API_URL || "http://localhost:5001/api";

const STATUSES = ["Pending", "In Progress", "Resolved"];

const DEPARTMENTS = [
  "Municipal Corporation",
  "Public Works Department (PWD)",
  "Traffic Police Department",
  "Water Supply Department",
  "Electricity Department",
  "Sanitation and Waste Management",
  "Drainage and Sewerage Department",
  "Street Lighting Department",
  "Parks and Garden Department",
  "Pollution Control Board",
  "Urban Development Authority",
  "Fire and Emergency Services",
];

// Format dates safely.
function formatDate(value) {
  if (!value) return "N/A";

  return new Date(value).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

// Convert date into YYYY-MM using local time.
function getMonth(value) {
  if (!value) return "";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "";

  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
  ].join("-");
}

function formatMonth(value) {
  if (!value) return "";

  const [year, month] = value.split("-");

  return new Date(Number(year), Number(month) - 1)
    .toLocaleDateString("en-IN", {
      month: "short",
      year: "numeric",
    });
}

// Calculate number of complaints for a particular field.
function countBy(items, field) {
  const result = {};

  items.forEach((item) => {
    const key = item[field] || "Not specified";
    result[key] = (result[key] || 0) + 1;
  });

  return Object.entries(result).sort((a, b) => b[1] - a[1]);
}

// Main Admin Dashboard Component.
export default function AdminDashboard({
  token: initialToken,
  admin: initialAdmin,
  onLogout,
}) {
  const [token, setToken] = useState(() => initialToken || localStorage.getItem("cw_admin_token") || "");
  const [admin, setAdmin] = useState(() => {
    if (initialAdmin) return initialAdmin;
    try {
      return JSON.parse(localStorage.getItem("cw_admin_user"));
    } catch {
      return null;
    }
  });

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState("");

  async function handleLogin(e) {
    e.preventDefault();
    if (!loginEmail || !loginPassword) return;
    setLoginBusy(true);
    setLoginError("");
    try {
      const res = await axios.post(`${API}/admin/login`, {
        email: loginEmail.trim().toLowerCase(),
        password: loginPassword,
      });
      localStorage.setItem("cw_admin_token", res.data.token);
      localStorage.setItem("cw_admin_user", JSON.stringify(res.data.admin));
      setToken(res.data.token);
      setAdmin(res.data.admin);
    } catch (err) {
      setLoginError(err.response?.data?.error || "Login failed. Check admin credentials.");
    } finally {
      setLoginBusy(false);
    }
  }

  function handleLogout() {
    localStorage.removeItem("cw_admin_token");
    localStorage.removeItem("cw_admin_user");
    setToken("");
    setAdmin(null);
    if (onLogout) onLogout();
  }

  const [activePage, setActivePage] = useState("Overview");

  const [issues, setIssues] = useState([]);
  const [users, setUsers] = useState([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [search, setSearch] = useState("");

  // All analytics filters.
  const [filters, setFilters] = useState({
    city: "",
    category: "",
    month: "",
    status: "",
    department: "",
    from: "",
    to: "",
  });

  // Temporary changes made in complaint table.
  const [draftUpdates, setDraftUpdates] = useState({});

  // Selected complaint for detail modal.
  const [selectedIssue, setSelectedIssue] = useState(null);

  // Load data from protected admin APIs.
  async function loadData() {
    if (!token) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");

    try {
      const headers = {
        Authorization: `Bearer ${token}`,
      };

      const [issueResponse, userResponse] = await Promise.all([
        axios.get(`${API}/admin/issues`, { headers }),
        axios.get(`${API}/admin/users`, { headers }),
      ]);

      setIssues(issueResponse.data);
      setUsers(userResponse.data);

    } catch (err) {
      setError(
        err.response?.data?.error ||
        "Could not load admin dashboard data."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, [token]);

  // Update one filter without affecting other filters.
  function updateFilter(name, value) {
    setFilters((previous) => ({
      ...previous,
      [name]: value,
    }));
  }

  // Apply all filters together.
  const filteredIssues = useMemo(() => {
    return issues.filter((issue) => {
      const issueMonth = getMonth(issue.created_at);
      const issueDate = issue.created_at
        ? new Date(issue.created_at)
        : null;

      if (
        filters.city &&
        (issue.city || "").toLowerCase() !==
          filters.city.toLowerCase()
      ) return false;

      if (
        filters.category &&
        issue.category !== filters.category
      ) return false;

      if (
        filters.month &&
        issueMonth !== filters.month
      ) return false;

      if (
        filters.status &&
        issue.status !== filters.status
      ) return false;

      if (
        filters.department &&
        issue.department !== filters.department
      ) return false;

      if (
        filters.from &&
        (!issueDate ||
          issueDate < new Date(`${filters.from}T00:00:00`))
      ) return false;

      if (
        filters.to &&
        (!issueDate ||
          issueDate >= new Date(
            new Date(`${filters.to}T00:00:00`).getTime() +
            24 * 60 * 60 * 1000
          ))
      ) return false;

      return true;
    });
  }, [issues, filters]);

  // Dashboard statistics based on currently filtered complaints.
  const stats = useMemo(() => ({
    total: filteredIssues.length,

    pending: filteredIssues.filter(
      (i) => i.status === "Pending"
    ).length,

    inProgress: filteredIssues.filter(
      (i) => i.status === "In Progress"
    ).length,

    resolved: filteredIssues.filter(
      (i) => i.status === "Resolved"
    ).length,
  }), [filteredIssues]);

  // City-wise statistics.
  const cityStats = useMemo(
    () => countBy(filteredIssues, "city").slice(0, 7),
    [filteredIssues]
  );

  // Issue-wise statistics.
  const categoryStats = useMemo(
    () => countBy(filteredIssues, "category").slice(0, 7),
    [filteredIssues]
  );

  // Department-wise statistics.
  const departmentStats = useMemo(
    () => countBy(filteredIssues, "department"),
    [filteredIssues]
  );

  // Last six months complaint trends.
  const monthlyStats = useMemo(() => {
    const result = [];
    const now = new Date();

    for (let i = 5; i >= 0; i--) {
      const date = new Date(
        now.getFullYear(),
        now.getMonth() - i,
        1
      );

      const month = getMonth(date);

      const monthlyIssues = filteredIssues.filter(
        (issue) => getMonth(issue.created_at) === month
      );

      result.push({
        month,
        total: monthlyIssues.length,
        resolved: monthlyIssues.filter(
          (issue) => issue.status === "Resolved"
        ).length,
      });
    }

    return result;
  }, [filteredIssues]);

  const maxMonthly = Math.max(
    1,
    ...monthlyStats.map((item) => item.total)
  );

  // Unique filter options from actual database records.
  const cities = useMemo(
    () => [...new Set(
      issues.map((i) => i.city).filter(Boolean)
    )].sort(),
    [issues]
  );

  const categories = useMemo(
    () => [...new Set(
      issues.map((i) => i.category).filter(Boolean)
    )].sort(),
    [issues]
  );

  const departments = useMemo(
    () => [...new Set([
      ...DEPARTMENTS,
      ...issues.map((i) => i.department).filter(Boolean),
    ])].sort(),
    [issues]
  );

  // Search complaints.
  const searchedIssues = useMemo(() => {
    const term = search.trim().toLowerCase();

    if (!term) return filteredIssues;

    return filteredIssues.filter((issue) =>
      [
        issue.tracking_id,
        issue.title,
        issue.category,
        issue.city,
        issue.department,
        issue.status,
      ].some((value) =>
        String(value || "").toLowerCase().includes(term)
      )
    );
  }, [filteredIssues, search]);

  // Save complaint status or department.
  async function saveComplaint(issue, overrideChanges) {
    const changes = overrideChanges || draftUpdates[issue.id];

    if (!changes) return;

    try {
      setError("");
      setSuccess("");

      await axios.patch(
        `${API}/admin/issues/${issue.id}`,
        changes,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      setDraftUpdates((previous) => {
        const updated = { ...previous };
        delete updated[issue.id];
        return updated;
      });

      setSuccess(`Complaint ${issue.tracking_id} updated.`);

      await loadData();

    } catch (err) {
      setError(
        err.response?.data?.error ||
        "Could not update complaint."
      );
    }
  }

  // Export currently filtered complaints as CSV.
  function exportCSV() {
    const columns = [
      "tracking_id",
      "title",
      "category",
      "city",
      "department",
      "status",
      "created_at",
    ];

    const rows = searchedIssues.map((issue) =>
      columns.map((key) => {
        const value = String(issue[key] ?? "")
          .replace(/"/g, '""');

        return `"${value}"`;
      }).join(",")
    );

    const csv = [
      columns.join(","),
      ...rows,
    ].join("\n");

    const blob = new Blob([csv], {
      type: "text/csv;charset=utf-8;",
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = "civicwatch-complaints.csv";
    link.click();

    URL.revokeObjectURL(url);
  }

  function clearFilters() {
    setFilters({
      city: "",
      category: "",
      month: "",
      status: "",
      department: "",
      from: "",
      to: "",
    });
  }

  const hasFilters = Object.values(filters).some(Boolean);

  // Validate coordinates before showing map markers.
  const mapIssues = filteredIssues.filter((issue) => {
    const lat = Number(issue.latitude);
    const lng = Number(issue.longitude);

    return (
      issue.latitude !== null &&
      issue.longitude !== null &&
      issue.latitude !== "" &&
      issue.longitude !== "" &&
      Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      lat >= -90 && lat <= 90 &&
      lng >= -180 && lng <= 180
    );
  });

  const mapCenter = mapIssues.length
    ? [
        Number(mapIssues[0].latitude),
        Number(mapIssues[0].longitude),
      ]
    : [20.5937, 78.9629];

  if (!token) {
    return (
      <div className="cw-admin" style={{ justifyContent: "center", alignItems: "center", background: "#0b3d2e", minHeight: "100vh", padding: "20px" }}>
        <div style={{ background: "#ffffff", padding: "32px", borderRadius: "10px", width: "100%", maxWidth: "420px", boxShadow: "0 10px 25px rgba(0,0,0,0.2)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "20px" }}>
            <div className="cw-brand-icon">CW</div>
            <div>
              <strong style={{ fontSize: "18px" }}>CivicWatch</strong>
              <span style={{ fontSize: "11px", color: "#64748b", display: "block" }}>ADMIN PORTAL LOGIN</span>
            </div>
          </div>
          {loginError && (
            <div className="cw-alert cw-error">{loginError}</div>
          )}
          <form onSubmit={handleLogin} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <label style={{ fontSize: "12px", fontWeight: "600" }}>Admin Email</label>
              <input
                type="email"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                placeholder="admin@civicwatch.gov.in"
                required
                style={{ padding: "10px", borderRadius: "6px", border: "1px solid #d8e0db" }}
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <label style={{ fontSize: "12px", fontWeight: "600" }}>Password</label>
              <input
                type="password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                placeholder="••••••••••••"
                required
                style={{ padding: "10px", borderRadius: "6px", border: "1px solid #d8e0db" }}
              />
            </div>
            <button
              type="submit"
              disabled={loginBusy}
              style={{ padding: "11px", background: "#0b3d2e", color: "white", border: "none", borderRadius: "6px", fontWeight: "600", cursor: "pointer", marginTop: "6px" }}
            >
              {loginBusy ? "Logging in..." : "Login to Admin Portal"}
            </button>
            <div style={{ marginTop: "6px" }}>
              <span style={{ fontSize: "11px", fontWeight: "700", color: "#64748b", textTransform: "uppercase", display: "block", marginBottom: "6px" }}>
                Test Hierarchy Accounts:
              </span>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
                <button
                  type="button"
                  onClick={() => {
                    setLoginEmail("national@civicwatch.gov.in");
                    setLoginPassword("Admin@12345678");
                  }}
                  style={{ padding: "6px 8px", background: "#f8fafc", border: "1px dashed #cbd5e1", borderRadius: "5px", fontSize: "11px", cursor: "pointer", color: "#0f172a", textAlign: "left" }}
                >
                  🇮🇳 National (All-India)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setLoginEmail("state.mh@civicwatch.gov.in");
                    setLoginPassword("Admin@12345678");
                  }}
                  style={{ padding: "6px 8px", background: "#f8fafc", border: "1px dashed #cbd5e1", borderRadius: "5px", fontSize: "11px", cursor: "pointer", color: "#0f172a", textAlign: "left" }}
                >
                  🚩 State (Maharashtra)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setLoginEmail("admin.mumbai@civicwatch.gov.in");
                    setLoginPassword("Admin@12345678");
                  }}
                  style={{ padding: "6px 8px", background: "#f8fafc", border: "1px dashed #cbd5e1", borderRadius: "5px", fontSize: "11px", cursor: "pointer", color: "#0f172a", textAlign: "left" }}
                >
                  🏙️ City (Mumbai)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setLoginEmail("ward.powai@civicwatch.gov.in");
                    setLoginPassword("Admin@12345678");
                  }}
                  style={{ padding: "6px 8px", background: "#f8fafc", border: "1px dashed #cbd5e1", borderRadius: "5px", fontSize: "11px", cursor: "pointer", color: "#0f172a", textAlign: "left" }}
                >
                  📍 Block (Powai Ward)
                </button>
              </div>
            </div>
            <button
              type="button"
              onClick={onLogout}
              style={{ background: "transparent", border: "none", color: "#0b3d2e", fontSize: "13px", cursor: "pointer", marginTop: "10px", textDecoration: "underline" }}
            >
              ← Back to Citizen Portal
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="cw-admin">

      {/* SIDEBAR */}
      <aside className="cw-sidebar">

        <div className="cw-brand">
          <div className="cw-brand-icon">CW</div>
          <div>
            <strong>CivicWatch</strong>
            <span>ADMIN PORTAL</span>
          </div>
        </div>

        <nav className="cw-navigation">
          {[
            ["Overview", "▦"],
            ["Complaints", "▤"],
            ["Live Issue Map", "⌖"],
            ["Departments", "▥"],
            ["Users", "♙"],
            ["Analytics", "▧"],
          ].map(([name, icon]) => (
            <button
              key={name}
              className={
                activePage === name ? "active" : ""
              }
              onClick={() => setActivePage(name)}
            >
              <span>{icon}</span>
              {name}
            </button>
          ))}
        </nav>

        <div className="cw-sidebar-bottom">
          <div className="cw-admin-profile">
            <div className="cw-avatar">
              {(admin?.name || "A").charAt(0).toUpperCase()}
            </div>
            <div>
              <strong>{admin?.name || "Administrator"}</strong>
              <span>Administrator</span>
            </div>
          </div>

          <button
            className="cw-logout"
            onClick={handleLogout}
          >
            ↪ Logout
          </button>

          <button
            className="cw-logout"
            onClick={onLogout}
            style={{ marginTop: "6px", background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.2)" }}
          >
            ← Citizen Portal
          </button>
        </div>
      </aside>

      {/* MAIN CONTENT */}
      <main className="cw-main">

        <header className="cw-header">
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
              <h1>{activePage}</h1>
              <span
                style={{
                  fontSize: "11px",
                  fontWeight: "700",
                  padding: "4px 10px",
                  borderRadius: "12px",
                  background: "#dcfce7",
                  color: "#166534",
                  letterSpacing: "0.5px",
                  border: "1px solid #bbf7d0",
                }}
              >
                {admin?.admin_level === "NATIONAL"
                  ? "🇮🇳 NATIONAL (PAN-INDIA)"
                  : admin?.admin_level === "STATE"
                    ? `🚩 STATE: ${admin.state}`
                    : admin?.admin_level === "BLOCK"
                      ? `📍 BLOCK: ${admin.block} (${admin.city})`
                      : `🏙️ CITY: ${admin?.city || "MUMBAI"}`}
              </span>
            </div>
            <p>
              Monitor and manage civic issues across departments
            </p>
          </div>

          <div className="cw-header-actions">
            <button
              className="cw-refresh"
              onClick={loadData}
              disabled={loading}
            >
              ↻ Refresh
            </button>

            <span className="cw-header-user">
              {admin?.name || "Administrator"}
            </span>

            <button
              type="button"
              className="cw-header-logout"
              onClick={handleLogout}
              title="Logout from Admin Portal"
            >
              ↪ Logout
            </button>
          </div>
        </header>

        {error && (
          <div className="cw-alert cw-error">
            {error}
          </div>
        )}

        {success && (
          <div className="cw-alert cw-success">
            {success}
          </div>
        )}

        {loading ? (
          <div className="cw-loading">
            Loading dashboard data...
          </div>
        ) : (
          <>

            {/* OVERVIEW */}
            {activePage === "Overview" && (
              <>

                <div className="cw-stat-grid">
                  <StatCard
                    label="Total Complaints"
                    value={stats.total}
                    color="green"
                  />

                  <StatCard
                    label="Pending"
                    value={stats.pending}
                    color="orange"
                  />

                  <StatCard
                    label="In Progress"
                    value={stats.inProgress}
                    color="blue"
                  />

                  <StatCard
                    label="Resolved"
                    value={stats.resolved}
                    color="green"
                  />
                </div>

                <div className="cw-overview-grid">

                  <section className="cw-panel cw-wide">
                    <div className="cw-panel-heading">
                      <h2>Complaint Trends</h2>
                      <span>Last 6 months</span>
                    </div>

                    <MonthlyChart
                      data={monthlyStats}
                      max={maxMonthly}
                    />
                  </section>

                  <section className="cw-panel">
                    <div className="cw-panel-heading">
                      <h2>Complaint Status</h2>
                    </div>

                    <StatusChart stats={stats} />
                  </section>

                </div>

                <section className="cw-panel">
                  <div className="cw-panel-heading">
                    <h2>Recent Complaints</h2>
                    <button
                      onClick={() => setActivePage("Complaints")}
                    >
                      View all →
                    </button>
                  </div>

                  <ComplaintTable
                    issues={searchedIssues.slice(0, 5)}
                    draftUpdates={draftUpdates}
                    setDraftUpdates={setDraftUpdates}
                    saveComplaint={saveComplaint}
                    departments={departments}
                    onSelectIssue={setSelectedIssue}
                  />
                </section>

              </>
            )}

            {/* COMPLAINTS */}
            {activePage === "Complaints" && (
              <section className="cw-panel">

                <div className="cw-panel-heading">
                  <h2>All Complaints ({searchedIssues.length})</h2>

                  <button onClick={exportCSV}>
                    Export CSV
                  </button>
                </div>

                <div style={{ display: "flex", gap: "8px", marginBottom: "14px", flexWrap: "wrap" }}>
                  {[
                    ["All", ""],
                    ["🟠 Pending", "Pending"],
                    ["🔵 In Progress", "In Progress"],
                    ["🟢 Resolved", "Resolved"],
                  ].map(([label, val]) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => updateFilter("status", val)}
                      style={{
                        padding: "6px 14px",
                        borderRadius: "20px",
                        border: "1px solid",
                        borderColor: filters.status === val ? "#0b3d2e" : "#d8e0db",
                        background: filters.status === val ? "#0b3d2e" : "#ffffff",
                        color: filters.status === val ? "#ffffff" : "#334155",
                        fontWeight: "600",
                        fontSize: "12px",
                        cursor: "pointer",
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <input
                  className="cw-search"
                  placeholder="Search issue ID, title, city..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />

                <ComplaintTable
                  issues={searchedIssues}
                  draftUpdates={draftUpdates}
                  setDraftUpdates={setDraftUpdates}
                  saveComplaint={saveComplaint}
                  departments={departments}
                  onSelectIssue={setSelectedIssue}
                />

              </section>
            )}

            {/* LIVE MAP */}
            {activePage === "Live Issue Map" && (
              <section className="cw-panel">

                <div className="cw-panel-heading">
                  <h2>Reported Issue Locations</h2>
                  <span>
                    {mapIssues.length} mapped complaints
                  </span>
                </div>

                <div className="cw-map">
                  <MapContainer
                    center={mapCenter}
                    zoom={mapIssues.length ? 11 : 5}
                    scrollWheelZoom
                    key={`${mapCenter[0]}-${mapCenter[1]}`}
                  >
                    <TileLayer
                      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    />

                    {mapIssues.map((issue) => (
                      <CircleMarker
                        key={issue.id}
                        center={[
                          Number(issue.latitude),
                          Number(issue.longitude),
                        ]}
                        radius={8}
                        pathOptions={{
                          color:
                            issue.status === "Resolved"
                              ? "#15803d"
                              : issue.status === "In Progress"
                                ? "#2563eb"
                                : "#ea580c",
                          fillOpacity: 0.75,
                        }}
                      >
                        <Popup>
                          <strong>{issue.title}</strong>
                          <br />
                          {issue.tracking_id}
                          <br />
                          {issue.city || "City not specified"}
                          <br />
                          Status: {issue.status}
                        </Popup>
                      </CircleMarker>
                    ))}
                  </MapContainer>
                </div>

                <p className="cw-muted">
                  Only complaints with valid coordinates appear on the map.
                </p>

              </section>
            )}

            {/* DEPARTMENTS */}
            {activePage === "Departments" && (
              <section className="cw-panel">

                <div className="cw-panel-heading">
                  <h2>Department Performance</h2>
                </div>

                <div className="cw-data-list">
                  {departmentStats.map(([name, count]) => {
                    const departmentIssues = filteredIssues.filter(
                      (issue) => issue.department === name
                    );

                    const resolved = departmentIssues.filter(
                      (issue) => issue.status === "Resolved"
                    ).length;

                    const percentage = count
                      ? Math.round((resolved / count) * 100)
                      : 0;

                    return (
                      <div className="cw-department-row" key={name}>
                        <div>
                          <strong>{name}</strong>
                          <span>
                            {count} complaints · {resolved} resolved
                          </span>
                        </div>

                        <div className="cw-progress">
                          <div
                            style={{ width: `${percentage}%` }}
                          />
                        </div>

                        <strong>{percentage}%</strong>
                      </div>
                    );
                  })}
                </div>

              </section>
            )}

            {/* USERS */}
            {activePage === "Users" && (
              <section className="cw-panel">

                <div className="cw-panel-heading">
                  <h2>Registered Users ({users.length})</h2>
                </div>

                <div className="cw-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>Name</th>
                        <th>Email</th>
                        <th>Mobile</th>
                        <th>Complaints</th>
                        <th>Joined</th>
                      </tr>
                    </thead>

                    <tbody>
                      {users.map((user) => (
                        <tr key={user.id}>
                          <td>{user.id}</td>
                          <td>{user.name}</td>
                          <td>{user.email}</td>
                          <td>{user.mobile || "N/A"}</td>
                          <td>{user.total_complaints ?? 0}</td>
                          <td>{formatDate(user.created_at)}</td>
                        </tr>
                      ))}

                      {users.length === 0 && (
                        <tr>
                          <td colSpan="6">No users found.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

              </section>
            )}

            {/* ANALYTICS */}
            {activePage === "Analytics" && (
              <>

                <section className="cw-panel">

                  <div className="cw-panel-heading">
                    <div>
                      <h2>Complaint Analytics</h2>
                      <p className="cw-muted">
                        Apply multiple filters to analyse complaints.
                      </p>
                    </div>

                    <button
                      className="cw-clear"
                      onClick={clearFilters}
                    >
                      Clear Filters
                    </button>
                  </div>

                  <div className="cw-filter-grid">

                    <FilterSelect
                      label="City"
                      value={filters.city}
                      onChange={(v) => updateFilter("city", v)}
                      options={cities}
                    />

                    <FilterSelect
                      label="Issue Type"
                      value={filters.category}
                      onChange={(v) => updateFilter("category", v)}
                      options={categories}
                    />

                    <FilterSelect
                      label="Status"
                      value={filters.status}
                      onChange={(v) => updateFilter("status", v)}
                      options={STATUSES}
                    />

                    <FilterSelect
                      label="Department"
                      value={filters.department}
                      onChange={(v) => updateFilter("department", v)}
                      options={departments}
                    />

                    <div className="cw-filter-field">
                      <label>Month</label>
                      <input
                        type="month"
                        value={filters.month}
                        onChange={(e) =>
                          updateFilter("month", e.target.value)
                        }
                      />
                    </div>

                    <div className="cw-filter-field">
                      <label>From Date</label>
                      <input
                        type="date"
                        value={filters.from}
                        max={filters.to || undefined}
                        onChange={(e) =>
                          updateFilter("from", e.target.value)
                        }
                      />
                    </div>

                    <div className="cw-filter-field">
                      <label>To Date</label>
                      <input
                        type="date"
                        value={filters.to}
                        min={filters.from || undefined}
                        onChange={(e) =>
                          updateFilter("to", e.target.value)
                        }
                      />
                    </div>

                  </div>

                  <div className="cw-filter-footer">
                    <span>
                      {hasFilters
                        ? "Filters applied"
                        : "Showing all complaints"}
                    </span>

                    <strong>
                      {filteredIssues.length} results
                    </strong>
                  </div>

                </section>

                <div className="cw-stat-grid">
                  <StatCard
                    label="Total Complaints"
                    value={stats.total}
                    color="green"
                  />

                  <StatCard
                    label="Pending"
                    value={stats.pending}
                    color="orange"
                  />

                  <StatCard
                    label="In Progress"
                    value={stats.inProgress}
                    color="blue"
                  />

                  <StatCard
                    label="Resolved"
                    value={stats.resolved}
                    color="green"
                  />
                </div>

                <div className="cw-overview-grid">

                  <section className="cw-panel">
                    <h2>City-wise Complaints</h2>

                    <HorizontalChart
                      data={cityStats}
                    />
                  </section>

                  <section className="cw-panel">
                    <h2>Issue-wise Complaints</h2>

                    <HorizontalChart
                      data={categoryStats}
                    />
                  </section>

                </div>

                <section className="cw-panel">
                  <div className="cw-panel-heading">
                    <h2>Month-wise Complaints</h2>
                    <span>Last 6 months</span>
                  </div>

                  <MonthlyChart
                    data={monthlyStats}
                    max={maxMonthly}
                  />
                </section>

                <section className="cw-panel">
                  <div className="cw-panel-heading">
                    <h2>Filtered Complaint Records</h2>

                    <button onClick={exportCSV}>
                      Export CSV
                    </button>
                  </div>

                  <input
                    className="cw-search"
                    placeholder="Search filtered complaints..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />

                  <ComplaintTable
                    issues={searchedIssues}
                    draftUpdates={draftUpdates}
                    setDraftUpdates={setDraftUpdates}
                    saveComplaint={saveComplaint}
                    departments={departments}
                    onSelectIssue={setSelectedIssue}
                  />
                </section>

              </>
            )}

          </>
        )}

        {selectedIssue && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(15, 23, 42, 0.6)",
              backdropFilter: "blur(2px)",
              display: "grid",
              placeItems: "center",
              zIndex: 9999,
              padding: "20px",
            }}
            onClick={() => setSelectedIssue(null)}
          >
            <div
              style={{
                background: "#ffffff",
                borderRadius: "10px",
                maxWidth: "600px",
                width: "100%",
                maxHeight: "90vh",
                overflowY: "auto",
                padding: "24px",
                boxShadow: "0 20px 25px -5px rgba(0,0,0,0.2)",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: "1px solid #e2e8f0", paddingBottom: "12px", marginBottom: "16px" }}>
                <div>
                  <span style={{ fontSize: "11px", fontWeight: "700", color: "#0b3d2e", letterSpacing: "0.5px" }}>{selectedIssue.tracking_id}</span>
                  <h2 style={{ margin: "4px 0 0", fontSize: "18px" }}>{selectedIssue.title}</h2>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedIssue(null)}
                  style={{ background: "transparent", border: "none", fontSize: "22px", cursor: "pointer", color: "#64748b" }}
                >
                  ×
                </button>
              </div>

              {selectedIssue.photo_url ? (
                <div style={{ width: "100%", maxHeight: "280px", borderRadius: "8px", overflow: "hidden", marginBottom: "16px", background: "#0f172a", textAlign: "center" }}>
                  <img
                    src={selectedIssue.photo_url.startsWith("http") ? selectedIssue.photo_url : `http://localhost:5001${selectedIssue.photo_url.startsWith("/") ? "" : "/"}${selectedIssue.photo_url}`}
                    alt="Proof"
                    style={{ maxHeight: "280px", maxWidth: "100%", objectFit: "contain" }}
                  />
                </div>
              ) : (
                <div style={{ padding: "20px", background: "#f8fafc", borderRadius: "8px", border: "1px dashed #cbd5e1", textAlign: "center", color: "#64748b", marginBottom: "16px", fontSize: "13px" }}>
                  📷 No photo uploaded for this report.
                </div>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", fontSize: "13px", marginBottom: "16px" }}>
                <div><strong>Status:</strong> <span className={`cw-status-select ${selectedIssue.status.toLowerCase().replace(/\s+/g, "")}`} style={{ padding: "3px 8px", borderRadius: "10px" }}>{selectedIssue.status}</span></div>
                <div><strong>Department:</strong> {selectedIssue.department}</div>
                <div><strong>Location:</strong> {selectedIssue.city || "City not specified"}</div>
                <div><strong>Reported By:</strong> {selectedIssue.reported_by || "Anonymous Citizen"}</div>
                <div><strong>Reported Date:</strong> {formatDate(selectedIssue.created_at)}</div>
                <div><strong>Resolved Date:</strong> {formatDate(selectedIssue.resolved_at)}</div>
              </div>

              <div style={{ background: "#f8fafc", padding: "12px", borderRadius: "6px", marginBottom: "16px" }}>
                <strong style={{ display: "block", fontSize: "12px", color: "#475569", marginBottom: "4px" }}>Description:</strong>
                <p style={{ margin: 0, fontSize: "13px", color: "#1e293b", whiteSpace: "pre-wrap" }}>{selectedIssue.description || "No description provided."}</p>
              </div>

              {selectedIssue.latitude && selectedIssue.longitude && (
                <div style={{ marginBottom: "16px", fontSize: "12px" }}>
                  <strong>GPS Coordinates:</strong> {selectedIssue.latitude}, {selectedIssue.longitude}{" "}
                  <a
                    href={`https://www.google.com/maps?q=${selectedIssue.latitude},${selectedIssue.longitude}`}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: "#2563eb", marginLeft: "6px" }}
                  >
                    View on Google Maps ↗
                  </a>
                </div>
              )}

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid #e2e8f0", paddingTop: "14px" }}>
                <div style={{ display: "flex", gap: "8px" }}>
                  {selectedIssue.status !== "In Progress" && (
                    <button
                      type="button"
                      onClick={async () => {
                        await saveComplaint({ ...selectedIssue }, { status: "In Progress" });
                        setSelectedIssue((prev) => ({ ...prev, status: "In Progress" }));
                      }}
                      style={{ padding: "7px 12px", background: "#eff6ff", color: "#1d4ed8", border: "1px solid #bfdbfe", borderRadius: "5px", cursor: "pointer", fontWeight: "600", fontSize: "12px" }}
                    >
                      Mark In Progress
                    </button>
                  )}
                  {selectedIssue.status !== "Resolved" && (
                    <button
                      type="button"
                      onClick={async () => {
                        await saveComplaint({ ...selectedIssue }, { status: "Resolved" });
                        setSelectedIssue((prev) => ({ ...prev, status: "Resolved", resolved_at: new Date().toISOString() }));
                      }}
                      style={{ padding: "7px 12px", background: "#f0fdf4", color: "#166534", border: "1px solid #bbf7d0", borderRadius: "5px", cursor: "pointer", fontWeight: "600", fontSize: "12px" }}
                    >
                      ✓ Mark Resolved
                    </button>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => setSelectedIssue(null)}
                  style={{ padding: "7px 14px", background: "#f1f5f9", border: "1px solid #cbd5e1", borderRadius: "5px", cursor: "pointer", fontSize: "12px" }}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        <footer className="cw-footer">
          CivicWatch Admin Portal
        </footer>

      </main>
    </div>
  );
}

// ==========================================
// SMALL COMPONENTS
// ==========================================

function StatCard({ label, value, color }) {
  return (
    <div className={`cw-stat cw-${color}`}>
      <span>{label}</span>
      <strong>{value.toLocaleString("en-IN")}</strong>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}) {
  return (
    <div className="cw-filter-field">
      <label>{label}</label>

      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">All {label}</option>

        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </div>
  );
}

function StatusChart({ stats }) {
  const total = stats.total || 1;

  const pending = (stats.pending / total) * 100;
  const progress = (stats.inProgress / total) * 100;

  const resolved = (stats.resolved / total) * 100;

  return (
    <div className="cw-status-chart">

      <div
        className="cw-donut"
        style={{
          background: `conic-gradient(
            #15803d 0% ${resolved}%,
            #2563eb ${resolved}% ${resolved + progress}%,
            #f59e0b ${resolved + progress}% 100%
          )`,
        }}
      >
        <div>
          <strong>{stats.total}</strong>
          <span>Total</span>
        </div>
      </div>

      <div className="cw-status-legend">
        <span>🟢 Resolved: {stats.resolved}</span>
        <span>🔵 In Progress: {stats.inProgress}</span>
        <span>🟠 Pending: {stats.pending}</span>
      </div>

    </div>
  );
}

function MonthlyChart({ data, max }) {
  return (
    <div className="cw-month-chart">

      {data.map((item) => (
        <div className="cw-month-column" key={item.month}>

          <div className="cw-bars">

            <div
              className="cw-bar cw-total-bar"
              style={{
                height: `${(item.total / max) * 100}%`,
              }}
              title={`Total: ${item.total}`}
            />

            <div
              className="cw-bar cw-resolved-bar"
              style={{
                height: `${(item.resolved / max) * 100}%`,
              }}
              title={`Resolved: ${item.resolved}`}
            />

          </div>

          <strong>{item.total}</strong>

          <span>{formatMonth(item.month)}</span>

        </div>
      ))}

    </div>
  );
}

function HorizontalChart({ data }) {
  const max = Math.max(1, ...data.map((item) => item[1]));

  if (!data.length) {
    return <p className="cw-muted">No data available.</p>;
  }

  return (
    <div className="cw-horizontal-chart">

      {data.map(([name, count]) => (
        <div className="cw-horizontal-row" key={name}>

          <span>{name}</span>

          <div className="cw-horizontal-track">
            <div
              style={{
                width: `${(count / max) * 100}%`,
              }}
            />
          </div>

          <strong>{count}</strong>

        </div>
      ))}

    </div>
  );
}

function ComplaintTable({
  issues,
  draftUpdates,
  setDraftUpdates,
  saveComplaint,
  departments,
  onSelectIssue,
}) {
  return (
    <div className="cw-table-wrap">

      <table>
        <thead>
          <tr>
            <th>Issue ID</th>
            <th>Photo</th>
            <th>Issue / Location</th>
            <th>Department</th>
            <th>Date</th>
            <th>Status</th>
            <th>Action</th>
          </tr>
        </thead>

        <tbody>

          {issues.map((issue) => {
            const draft = draftUpdates[issue.id] || {};

            const status =
              draft.status ?? issue.status;

            const department =
              draft.department ?? issue.department;

            return (
              <tr key={issue.id}>

                <td>
                  <strong>{issue.tracking_id}</strong>
                </td>

                <td>
                  {issue.photo_url ? (
                    <img
                      src={issue.photo_url.startsWith("http") ? issue.photo_url : `http://localhost:5001${issue.photo_url.startsWith("/") ? "" : "/"}${issue.photo_url}`}
                      alt="Proof"
                      style={{ width: "36px", height: "36px", objectFit: "cover", borderRadius: "5px", cursor: "pointer", border: "1px solid #d8e0db" }}
                      onClick={() => onSelectIssue && onSelectIssue(issue)}
                      title="Click to view photo"
                    />
                  ) : (
                    <div style={{ width: "36px", height: "36px", borderRadius: "5px", background: "#f1f5f9", display: "grid", placeItems: "center", fontSize: "14px", color: "#94a3b8" }}>
                      📷
                    </div>
                  )}
                </td>

                <td>
                  <strong>{issue.title}</strong>
                  <span className="cw-cell-sub">
                    📍 {issue.block ? `${issue.block}, ` : ""}{issue.city || "Mumbai"}{issue.state ? ` • ${issue.state}` : ""}
                    {" · "}
                    {issue.category}
                  </span>
                </td>

                <td>
                  <select
                    value={department}
                    onChange={(e) =>
                      setDraftUpdates((previous) => ({
                        ...previous,
                        [issue.id]: {
                          ...previous[issue.id],
                          department: e.target.value,
                        },
                      }))
                    }
                  >
                    {departments.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </td>

                <td>{formatDate(issue.created_at)}</td>

                <td>
                  <select
                    className={`cw-status-select ${
                      status === "Resolved"
                        ? "resolved"
                        : status === "In Progress"
                          ? "progress"
                          : "pending"
                    }`}
                    value={status}
                    onChange={(e) =>
                      setDraftUpdates((previous) => ({
                        ...previous,
                        [issue.id]: {
                          ...previous[issue.id],
                          status: e.target.value,
                        },
                      }))
                    }
                  >
                    {STATUSES.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </td>

                <td>
                  {onSelectIssue && (
                    <button
                      type="button"
                      onClick={() => onSelectIssue(issue)}
                      style={{ marginRight: "6px", padding: "6px 10px", background: "#f0fdf4", color: "#166534", border: "1px solid #bbf7d0", borderRadius: "5px", cursor: "pointer", fontWeight: "600", fontSize: "11px" }}
                    >
                      View
                    </button>
                  )}
                  <button
                    className="cw-save-button"
                    disabled={!draftUpdates[issue.id]}
                    onClick={() => saveComplaint(issue)}
                  >
                    Save
                  </button>
                </td>

              </tr>
            );
          })}

          {issues.length === 0 && (
            <tr>
              <td colSpan="7">
                No complaints found.
              </td>
            </tr>
          )}

        </tbody>
      </table>

    </div>
  );
}
