
import React, { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Popup,
} from "react-leaflet";

import "leaflet/dist/leaflet.css";
import "./admin.css";
import { translations, translateStatus, translateCategory, translateAuthority, translatePrivacy, translateGender } from "./translations";

const API =
  import.meta.env.VITE_API_URL || "http://localhost:5001/api";

const STATUSES = ["Pending", "In Progress", "Resolved"];

// Calculate seriousness score on the basis of likes (upvotes), dislikes (downvotes), and comments
export function calculateSeriousness(issue) {
  if (!issue) return 0;
  const upvotes = Number(issue.upvotes_count || 0);
  const downvotes = Number(issue.downvotes_count || 0);
  const comments = Number(issue.comments_count || 0);
  // Formula: likes verify issue (+2), comments indicate active discussion/escalation (+3), dislikes reduce trust (-1)
  const score = (upvotes * 2) + (comments * 3) - downvotes;
  return Math.max(0, score);
}

// Classify seriousness score into High, Mid, Low
export function getPriorityLevel(score) {
  if (score >= 12) return "high";
  if (score >= 3) return "mid";
  return "low";
}

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
  language: propLang,
  setLanguage: propSetLang,
}) {
  const [internalLang, setInternalLang] = useState(() => localStorage.getItem("cw_language") === "hi" ? "hi" : "en");
  const language = propLang || internalLang;
  const changeLanguage = (newLang) => {
    localStorage.setItem("cw_language", newLang);
    setInternalLang(newLang);
    if (propSetLang) propSetLang(newLang);
  };
  const t = (key) => translations[language]?.[key] ?? translations.en[key] ?? key;
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

  const getInitialTab = () => {
    if (window.history.state && window.history.state.page === "admin" && window.history.state.tab) {
      return window.history.state.tab;
    }
    const hash = window.location.hash;
    const match = hash.match(/tab=([^&]+)/);
    if (match) {
      try {
        const decoded = decodeURIComponent(match[1]);
        const valid = ["Overview", "Live Issue Map", "Complaints", "Analytics", "Department Workload", "Notice Board"];
        if (valid.includes(decoded)) return decoded;
      } catch {
        // ignore
      }
    }
    return "Overview";
  };

  const [activePage, setActivePage] = useState(getInitialTab);

  function switchTab(tabName, pushHistory = true) {
    if (tabName === activePage) return;
    setActivePage(tabName);
    setError("");
    setSuccess("");
    window.scrollTo(0, 0);
    if (pushHistory) {
      window.history.pushState(
        { page: "admin", tab: tabName },
        "",
        `#admin?tab=${encodeURIComponent(tabName)}`
      );
    }
  }

  useEffect(() => {
    const currentTab = getInitialTab();
    if (!window.history.state || window.history.state.page !== "admin" || !window.history.state.tab) {
      window.history.replaceState(
        { page: "admin", tab: currentTab },
        "",
        `#admin?tab=${encodeURIComponent(currentTab)}`
      );
    }
  }, []);

  useEffect(() => {
    const handlePopState = (event) => {
      if (event.state && event.state.page === "admin" && event.state.tab) {
        setActivePage(event.state.tab);
        setError("");
        setSuccess("");
      } else {
        const hash = window.location.hash;
        const match = hash.match(/tab=([^&]+)/);
        if (match) {
          try {
            const decoded = decodeURIComponent(match[1]);
            setActivePage(decoded);
          } catch {
            setActivePage("Overview");
          }
        }
      }
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

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

  // Priority filter state: "", "all", "high", "mid", "low"
  const [priorityFilter, setPriorityFilter] = useState("");
  const [priorityMenuOpen, setPriorityMenuOpen] = useState(false);
  const priorityMenuRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (priorityMenuRef.current && !priorityMenuRef.current.contains(event.target)) {
        setPriorityMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Selected complaint for detail modal.
  const [selectedIssue, setSelectedIssue] = useState(null);

  // Part 3: Admin comments & duplicate moderation state
  const [adminComments, setAdminComments] = useState([]);
  const [adminCommentsLoading, setAdminCommentsLoading] = useState(false);

  const loadAdminComments = async (issueId) => {
    setAdminCommentsLoading(true);
    try {
      const res = await axios.get(`${API}/issues/${issueId}/comments`);
      setAdminComments(res.data || []);
    } catch {
      setAdminComments([]);
    } finally {
      setAdminCommentsLoading(false);
    }
  };

  const handleDeleteComment = async (commentId) => {
    if (!window.confirm(t("confirmDeleteComment"))) return;
    try {
      await axios.delete(`${API}/comments/${commentId}`);
      setAdminComments((prev) => prev.filter((c) => c.id !== commentId));
      setSelectedIssue((prev) => ({
        ...prev,
        comments_count: Math.max(0, (Number(prev?.comments_count) || 0) - 1),
      }));
      setIssues((prev) =>
        prev.map((i) =>
          i.id === selectedIssue?.id
            ? { ...i, comments_count: Math.max(0, (Number(i.comments_count) || 0) - 1) }
            : i
        )
      );
    } catch {
      alert(t("failedDeleteComment"));
    }
  };

  const handleToggleDuplicate = async (issueId, currentDuplicate) => {
    const nextDup = !currentDuplicate;
    try {
      const res = await axios.put(`${API}/admin/issues/${issueId}/mark-duplicate`, {
        isDuplicate: nextDup,
      });
      setSelectedIssue((prev) => ({
        ...prev,
        is_duplicate: res.data.issue.is_duplicate,
      }));
      setIssues((prev) =>
        prev.map((i) => (i.id === issueId ? { ...i, is_duplicate: res.data.issue.is_duplicate } : i))
      );
    } catch {
      alert(t("failedUpdateDuplicate"));
    }
  };

  useEffect(() => {
    if (selectedIssue?.id) {
      loadAdminComments(selectedIssue.id);
    } else {
      setAdminComments([]);
    }
  }, [selectedIssue?.id]);

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

  // Counts of pending and in-progress requests across priority levels
  const priorityCounts = useMemo(() => {
    const activeRequests = issues.filter(
      (i) => i.status === "Pending" || i.status === "In Progress"
    );
    let high = 0;
    let mid = 0;
    let low = 0;
    activeRequests.forEach((issue) => {
      const score = calculateSeriousness(issue);
      const level = getPriorityLevel(score);
      if (level === "high") high++;
      else if (level === "mid") mid++;
      else low++;
    });
    return {
      all: activeRequests.length,
      high,
      mid,
      low,
    };
  }, [issues]);

  // Apply all filters together.
  const filteredIssues = useMemo(() => {
    let result = issues.filter((issue) => {
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

      // Status and Priority filtering
      if (priorityFilter) {
        // Priority filter requirement: strictly only "Pending" and "In Progress" requests!
        if (issue.status !== "Pending" && issue.status !== "In Progress") {
          return false;
        }
        if (priorityFilter !== "all") {
          const score = calculateSeriousness(issue);
          const level = getPriorityLevel(score);
          if (level !== priorityFilter) {
            return false;
          }
        }
      } else {
        if (
          filters.status &&
          issue.status !== filters.status
        ) return false;
      }

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

    // When priority filter is applied, sort in decreasing order of seriousness score!
    if (priorityFilter) {
      result = [...result].sort((a, b) => {
        const scoreA = calculateSeriousness(a);
        const scoreB = calculateSeriousness(b);
        if (scoreB !== scoreA) {
          return scoreB - scoreA; // Highest seriousness first!
        }
        return new Date(b.created_at || 0) - new Date(a.created_at || 0);
      });
    }

    return result;
  }, [issues, filters, priorityFilter]);

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
      "priority",
      "seriousness_score",
      "created_at",
    ];

    const rows = searchedIssues.map((issue) => {
      const score = calculateSeriousness(issue);
      const priority = issue.status === "Resolved" ? "Resolved" : getPriorityLevel(score).toUpperCase();
      const rowItem = {
        ...issue,
        priority,
        seriousness_score: score,
        created_at: formatDate(issue.created_at),
      };
      return columns.map((key) => {
        const value = String(rowItem[key] ?? "")
          .replace(/"/g, '""');

        return `"${value}"`;
      }).join(",");
    });

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
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><span style={{ fontSize: "11px", color: "#64748b", display: "block" }}>{t("adminLoginTitle")}</span><select value={language} onChange={(e) => changeLanguage(e.target.value)} style={{ padding: "2px 6px", fontSize: "11px", borderRadius: "4px", border: "1px solid #cbd5e1", background: "#f8fafc" }}><option value="en">English</option><option value="hi">हिन्दी</option></select></div>
            </div>
          </div>
          {loginError && (
            <div className="cw-alert cw-error">{loginError}</div>
          )}
          <form onSubmit={handleLogin} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <label style={{ fontSize: "12px", fontWeight: "600" }}>{t("adminEmail")}</label>
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
              <label style={{ fontSize: "12px", fontWeight: "600" }}>{t("password")}</label>
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
              {loginBusy ? t("loggingIn") : t("loginToAdmin")}
            </button>
            <div style={{ marginTop: "6px" }}>
              <span style={{ fontSize: "11px", fontWeight: "700", color: "#64748b", textTransform: "uppercase", display: "block", marginBottom: "6px" }}>
                {t("testHierarchyAccounts")}
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
              {t("backToCitizenPortal")}
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
            <span>{t("adminPortal")}</span>
          </div>
        </div>

        <nav className="cw-navigation">
          {[
            ["Overview", "▦", t("overviewTab")],
            ["Complaints", "▤", t("complaintsTab")],
            ["Live Issue Map", "⌖", t("liveIssueMapTab")],
            ["Departments", "▥", t("departmentsTab")],
            ["Users", "♙", t("usersTab")],
            ["Analytics", "▧", t("analyticsTab")],
          ].map(([name, icon, label]) => (
            <button
              key={name}
              className={
                activePage === name ? "active" : ""
              }
              onClick={() => switchTab(name)}
            >
              <span>{icon}</span>
              {label}
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
              <span>{t("adminRole")}</span>
            </div>
          </div>

          <button
            className="cw-logout"
            onClick={handleLogout}
          >
            ↪ {t("logout")}
          </button>

          <button
            className="cw-logout"
            onClick={onLogout}
            style={{ marginTop: "6px", background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.2)" }}
          >
            ← {t("citizenPortalLink")}
          </button>
        </div>
      </aside>

      {/* MAIN CONTENT */}
      <main className="cw-main">

        <header className="cw-header">
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
              <h1>
                {activePage === "Overview" ? t("overviewTab") :
                 activePage === "Complaints" ? t("complaintsTab") :
                 activePage === "Live Issue Map" ? t("liveIssueMapTab") :
                 activePage === "Departments" ? t("departmentsTab") :
                 activePage === "Users" ? t("usersTab") :
                 activePage === "Analytics" ? t("analyticsTab") : activePage}
              </h1>
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
                  ? `🇮🇳 ${t("nationalPanIndia")}`
                  : admin?.admin_level === "STATE"
                    ? `🚩 ${t("stateLevel")}: ${admin.state}`
                    : admin?.admin_level === "BLOCK"
                      ? `📍 ${t("blockLevel")}: ${admin.block} (${admin.city})`
                      : `🏙️ ${t("cityLevel")}: ${admin?.city || "MUMBAI"}`}
              </span>
            </div>
            <p>{t("adminSubtitle")}</p>
          </div>

          <div className="cw-header-actions">
            {/* Language Switcher */}
            <select
              aria-label="Language"
              value={language}
              onChange={(e) => changeLanguage(e.target.value)}
              style={{
                background: "#082f26",
                color: "#ffffff",
                border: "1px solid #16a34a",
                borderRadius: "8px",
                padding: "6px 12px",
                fontSize: "12px",
                fontWeight: "700",
                cursor: "pointer",
                outline: "none",
              }}
            >
              <option value="en" style={{ background: "#082f26", color: "white" }}>English</option>
              <option value="hi" style={{ background: "#082f26", color: "white" }}>हिन्दी</option>
            </select>

            <button
              className="cw-refresh"
              onClick={loadData}
              disabled={loading}
            >
              ↻ {t("refresh")}
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
              ↪ {t("logout")}
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
                    label={t("totalComplaints")}
                    value={stats.total}
                    color="green"
                  />

                  <StatCard
                    label={t("pending")}
                    value={stats.pending}
                    color="orange"
                  />

                  <StatCard
                    label={t("inProgress")}
                    value={stats.inProgress}
                    color="blue"
                  />

                  <StatCard
                    label={t("resolved")}
                    value={stats.resolved}
                    color="green"
                  />
                </div>

                <div className="cw-overview-grid">

                  <section className="cw-panel cw-wide">
                    <div className="cw-panel-heading">
                      <h2>{t("complaintTrends")}</h2>
                      <span>{t("last6Months")}</span>
                    </div>

                    <MonthlyChart
                      data={monthlyStats}
                      max={maxMonthly}
                    />
                  </section>

                  <section className="cw-panel">
                    <div className="cw-panel-heading">
                      <h2>{t("complaintStatus")}</h2>
                    </div>

                    <StatusChart stats={stats} language={language} t={t} />
                  </section>

                </div>

                <section className="cw-panel">
                  <div className="cw-panel-heading">
                    <h2>{language === "hi" ? "हाल की शिकायतें" : "Recent Complaints"}</h2>
                    <button
                      onClick={() => switchTab("Complaints")}
                    >
                      {t("viewAll")} →
                    </button>
                  </div>

                  <ComplaintTable
                      language={language}
                      t={t}
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
                  <h2>{t("allComplaints")} ({searchedIssues.length})</h2>

                  <button onClick={exportCSV}>
                    {t("exportCSV")}
                  </button>
                </div>

                <div style={{ display: "flex", gap: "8px", marginBottom: "14px", flexWrap: "wrap", alignItems: "center" }}>
                  {[
                    [t("all"), ""],
                    [`🟠 ${t("pending")}`, "Pending"],
                    [`🔵 ${t("inProgress")}`, "In Progress"],
                    [`🟢 ${t("resolved")}`, "Resolved"],
                  ].map(([label, val]) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => {
                        setPriorityFilter("");
                        updateFilter("status", val);
                      }}
                      style={{
                        padding: "6px 14px",
                        borderRadius: "20px",
                        border: "1px solid",
                        borderColor: !priorityFilter && filters.status === val ? "#0b3d2e" : "#d8e0db",
                        background: !priorityFilter && filters.status === val ? "#0b3d2e" : "#ffffff",
                        color: !priorityFilter && filters.status === val ? "#ffffff" : "#334155",
                        fontWeight: "600",
                        fontSize: "12px",
                        cursor: "pointer",
                        transition: "all 0.15s ease",
                      }}
                    >
                      {label}
                    </button>
                  ))}

                  {/* Priority Filter dropdown button next to Resolved */}
                  <div ref={priorityMenuRef} style={{ position: "relative", display: "inline-block" }}>
                    <button
                      type="button"
                      onClick={() => setPriorityMenuOpen((prev) => !prev)}
                      style={{
                        padding: "6px 14px",
                        borderRadius: "20px",
                        border: "1px solid",
                        borderColor: priorityFilter ? "#0b3d2e" : "#cbd5e1",
                        background: priorityFilter
                          ? priorityFilter === "high"
                            ? "#991b1b"
                            : priorityFilter === "mid"
                              ? "#854d0e"
                              : priorityFilter === "low"
                                ? "#166534"
                                : "#0b3d2e"
                          : "#f8fafc",
                        color: priorityFilter ? "#ffffff" : "#1e293b",
                        fontWeight: "700",
                        fontSize: "12px",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                        boxShadow: priorityFilter ? "0 2px 4px rgba(0,0,0,0.12)" : "none",
                        transition: "all 0.15s ease",
                      }}
                      title={language === "hi" ? "लाइक, डिसलाइक और टिप्पणियों के आधार पर गंभीरता अनुसार क्रमबद्ध करें" : "Filter and sort by seriousness based on Likes, Dislikes, and Comments"}
                    >
                      <span>⚡ {t("priority")}</span>
                      {priorityFilter && (
                        <span
                          style={{
                            background: "rgba(255,255,255,0.25)",
                            padding: "1px 6px",
                            borderRadius: "10px",
                            fontSize: "10px",
                            fontWeight: "800",
                          }}
                        >
                          {priorityFilter === "high"
                            ? `🔴 ${t("priorityHigh")}`
                            : priorityFilter === "mid"
                              ? `🟡 ${t("priorityMid")}`
                              : priorityFilter === "low"
                                ? `🟢 ${t("priorityLow")}`
                                : t("all")}
                        </span>
                      )}
                      <span style={{ fontSize: "10px" }}>▾</span>
                    </button>

                    {priorityMenuOpen && (
                      <div
                        style={{
                          position: "absolute",
                          left: 0,
                          top: "calc(100% + 6px)",
                          zIndex: 9999,
                          background: "#ffffff",
                          borderRadius: "10px",
                          boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.15), 0 8px 10px -6px rgba(0, 0, 0, 0.1)",
                          border: "1px solid #e2e8f0",
                          minWidth: "260px",
                          overflow: "hidden",
                          padding: "6px",
                        }}
                      >
                        <div
                          style={{
                            padding: "8px 10px 6px",
                            fontSize: "11px",
                            fontWeight: "800",
                            color: "#64748b",
                            textTransform: "uppercase",
                            letterSpacing: "0.5px",
                            borderBottom: "1px solid #f1f5f9",
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                          }}
                        >
                          <span>⚡ Seriousness Filter</span>
                          <span style={{ fontSize: "10px", fontWeight: "600", color: "#94a3b8" }}>
                            Likes • Dislikes • Comments
                          </span>
                        </div>

                        {/* 1. All */}
                        <button
                          type="button"
                          onClick={() => {
                            setPriorityFilter("all");
                            setPriorityMenuOpen(false);
                          }}
                          style={{
                            width: "100%",
                            textAlign: "left",
                            padding: "8px 10px",
                            border: "none",
                            borderRadius: "6px",
                            background: priorityFilter === "all" ? "#f0fdf4" : "transparent",
                            cursor: "pointer",
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            fontSize: "12px",
                            fontWeight: priorityFilter === "all" ? "700" : "500",
                            color: priorityFilter === "all" ? "#166534" : "#1e293b",
                            marginTop: "4px",
                          }}
                        >
                          <div>
                            <div style={{ fontWeight: "700" }}>{t("allPriorities")} ({t("pending")} & {t("inProgress")})</div>
                            <div style={{ fontSize: "11px", color: "#64748b" }}>
                              Sorted by seriousness (high to low)
                            </div>
                          </div>
                          <span
                            style={{
                              background: "#f1f5f9",
                              padding: "2px 7px",
                              borderRadius: "10px",
                              fontSize: "11px",
                              fontWeight: "700",
                              color: "#475569",
                            }}
                          >
                            {priorityCounts.all}
                          </span>
                        </button>

                        {/* 2. High */}
                        <button
                          type="button"
                          onClick={() => {
                            setPriorityFilter("high");
                            setPriorityMenuOpen(false);
                          }}
                          style={{
                            width: "100%",
                            textAlign: "left",
                            padding: "8px 10px",
                            border: "none",
                            borderRadius: "6px",
                            background: priorityFilter === "high" ? "#fef2f2" : "transparent",
                            cursor: "pointer",
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            fontSize: "12px",
                            fontWeight: priorityFilter === "high" ? "700" : "500",
                            color: priorityFilter === "high" ? "#991b1b" : "#1e293b",
                          }}
                        >
                          <div>
                            <div style={{ fontWeight: "700", display: "flex", alignItems: "center", gap: "6px" }}>
                              <span>🔴 High Priority</span>
                            </div>
                            <div style={{ fontSize: "11px", color: "#64748b" }}>
                              Score ≥ 12 (Critical community urgency)
                            </div>
                          </div>
                          <span
                            style={{
                              background: "#fee2e2",
                              padding: "2px 7px",
                              borderRadius: "10px",
                              fontSize: "11px",
                              fontWeight: "700",
                              color: "#991b1b",
                            }}
                          >
                            {priorityCounts.high}
                          </span>
                        </button>

                        {/* 3. Mid */}
                        <button
                          type="button"
                          onClick={() => {
                            setPriorityFilter("mid");
                            setPriorityMenuOpen(false);
                          }}
                          style={{
                            width: "100%",
                            textAlign: "left",
                            padding: "8px 10px",
                            border: "none",
                            borderRadius: "6px",
                            background: priorityFilter === "mid" ? "#fefce8" : "transparent",
                            cursor: "pointer",
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            fontSize: "12px",
                            fontWeight: priorityFilter === "mid" ? "700" : "500",
                            color: priorityFilter === "mid" ? "#854d0e" : "#1e293b",
                          }}
                        >
                          <div>
                            <div style={{ fontWeight: "700", display: "flex", alignItems: "center", gap: "6px" }}>
                              <span>🟡 Mid Priority</span>
                            </div>
                            <div style={{ fontSize: "11px", color: "#64748b" }}>
                              Score 3 - 11 (Moderate attention)
                            </div>
                          </div>
                          <span
                            style={{
                              background: "#fef08a",
                              padding: "2px 7px",
                              borderRadius: "10px",
                              fontSize: "11px",
                              fontWeight: "700",
                              color: "#854d0e",
                            }}
                          >
                            {priorityCounts.mid}
                          </span>
                        </button>

                        {/* 4. Low */}
                        <button
                          type="button"
                          onClick={() => {
                            setPriorityFilter("low");
                            setPriorityMenuOpen(false);
                          }}
                          style={{
                            width: "100%",
                            textAlign: "left",
                            padding: "8px 10px",
                            border: "none",
                            borderRadius: "6px",
                            background: priorityFilter === "low" ? "#f0fdf4" : "transparent",
                            cursor: "pointer",
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            fontSize: "12px",
                            fontWeight: priorityFilter === "low" ? "700" : "500",
                            color: priorityFilter === "low" ? "#166534" : "#1e293b",
                          }}
                        >
                          <div>
                            <div style={{ fontWeight: "700", display: "flex", alignItems: "center", gap: "6px" }}>
                              <span>🟢 Low Priority</span>
                            </div>
                            <div style={{ fontSize: "11px", color: "#64748b" }}>
                              Score &lt; 3 (Early stage / low engagement)
                            </div>
                          </div>
                          <span
                            style={{
                              background: "#dcfce7",
                              padding: "2px 7px",
                              borderRadius: "10px",
                              fontSize: "11px",
                              fontWeight: "700",
                              color: "#166534",
                            }}
                          >
                            {priorityCounts.low}
                          </span>
                        </button>

                        {priorityFilter && (
                          <div style={{ borderTop: "1px solid #f1f5f9", marginTop: "4px", paddingTop: "4px" }}>
                            <button
                              type="button"
                              onClick={() => {
                                setPriorityFilter("");
                                setPriorityMenuOpen(false);
                              }}
                              style={{
                                width: "100%",
                                padding: "6px 10px",
                                background: "#f8fafc",
                                border: "none",
                                borderRadius: "4px",
                                fontSize: "11px",
                                fontWeight: "600",
                                color: "#64748b",
                                cursor: "pointer",
                                textAlign: "center",
                              }}
                            >
                              ✕ Reset Priority Filter
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {priorityFilter && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      marginBottom: "12px",
                      padding: "8px 12px",
                      background: "#f0fdf4",
                      border: "1px solid #bbf7d0",
                      borderRadius: "8px",
                      fontSize: "12px",
                    }}
                  >
                    <span style={{ fontWeight: "700", color: "#166534" }}>⚡ Active Priority Filter:</span>
                    <span style={{ fontWeight: "600", color: "#1e293b" }}>
                      {priorityFilter === "high"
                        ? "🔴 High Priority"
                        : priorityFilter === "mid"
                          ? "🟡 Mid Priority"
                          : priorityFilter === "low"
                            ? "🟢 Low Priority"
                            : "All Priorities"}{" "}
                      (Showing {searchedIssues.length} Pending & In Progress complaints sorted by seriousness)
                    </span>
                    <button
                      type="button"
                      onClick={() => setPriorityFilter("")}
                      style={{
                        marginLeft: "auto",
                        background: "none",
                        border: "none",
                        color: "#dc2626",
                        fontWeight: "700",
                        fontSize: "11px",
                        cursor: "pointer",
                      }}
                    >
                      Clear ✕
                    </button>
                  </div>
                )}

                <input
                  className="cw-search"
                  placeholder={t("searchComplaintsPlaceholder")}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />

                <ComplaintTable
                      language={language}
                      t={t}
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
                  <h2>{t("reportedIssueLocations")}</h2>
                  <span>
                    {mapIssues.length} {t("mappedComplaints")}
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
                          {issue.city || (language === "hi" ? "शहर निर्दिष्ट नहीं" : "City not specified")}
                          <br />
                          {t("status")}: {translateStatus(issue.status, language)}
                        </Popup>
                      </CircleMarker>
                    ))}
                  </MapContainer>
                </div>

                <p className="cw-muted">
                  {t("onlyValidCoordinatesAppear")}
                </p>

              </section>
            )}

            {/* DEPARTMENTS */}
            {activePage === "Departments" && (
              <section className="cw-panel">

                <div className="cw-panel-heading">
                  <h2>{t("departmentPerformance")}</h2>
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
                          <strong>{translateAuthority(name, language)}</strong>
                          <span>
                            {count} {language === "hi" ? "शिकायतें" : "complaints"} · {resolved} {t("resolvedCount")}
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
                  <h2>{t("registeredUsers")} ({users.length})</h2>
                </div>

                <div className="cw-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>{t("name")}</th>
                        <th>{t("email")}</th>
                        <th>{t("mobile")}</th>
                        <th>{t("complaintsTab")}</th>
                        <th>{t("joined")}</th>
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
                          <td colSpan="6">{t("noUsersFound")}</td>
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
                      <h2>{t("complaintAnalytics")}</h2>
                      <p className="cw-muted">
                        {t("analyticsSubtitle")}
                      </p>
                    </div>

                    <button
                      className="cw-clear"
                      onClick={clearFilters}
                    >
                      {t("clearFilters")}
                    </button>
                  </div>

                  <div className="cw-filter-grid">

                    <FilterSelect
                      label={t("cityFilter")}
                      value={filters.city}
                      onChange={(v) => updateFilter("city", v)}
                      options={cities}
                      language={language}
                    />

                    <FilterSelect
                      label={t("issueTypeFilter")}
                      value={filters.category}
                      onChange={(v) => updateFilter("category", v)}
                      options={categories}
                      language={language}
                    />

                    <FilterSelect
                      label={t("status")}
                      value={filters.status}
                      onChange={(v) => updateFilter("status", v)}
                      options={STATUSES}
                      language={language}
                    />

                    <FilterSelect
                      label={t("department")}
                      value={filters.department}
                      onChange={(v) => updateFilter("department", v)}
                      options={departments}
                      language={language}
                    />

                    <div className="cw-filter-field">
                      <label>{t("monthFilter")}</label>
                      <input
                        type="month"
                        value={filters.month}
                        onChange={(e) =>
                          updateFilter("month", e.target.value)
                        }
                      />
                    </div>

                    <div className="cw-filter-field">
                      <label>{t("fromDate")}</label>
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
                      <label>{t("toDate")}</label>
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
                      {hasFilters ? t("filtersApplied") : t("showingAllComplaints")}
                    </span>

                    <strong>
                      {filteredIssues.length} {t("resultsCount")}
                    </strong>
                  </div>

                </section>

                <div className="cw-stat-grid">
                  <StatCard
                    label={t("totalComplaints")}
                    value={stats.total}
                    color="green"
                  />

                  <StatCard
                    label={t("pending")}
                    value={stats.pending}
                    color="orange"
                  />

                  <StatCard
                    label={t("inProgress")}
                    value={stats.inProgress}
                    color="blue"
                  />

                  <StatCard
                    label={t("resolved")}
                    value={stats.resolved}
                    color="green"
                  />
                </div>

                <div className="cw-overview-grid">

                  <section className="cw-panel">
                    <h2>{t("cityWiseComplaints")}</h2>

                    <HorizontalChart
                      data={cityStats}
                      language={language}
                    />
                  </section>

                  <section className="cw-panel">
                    <h2>{t("issueWiseComplaints")}</h2>

                    <HorizontalChart
                      data={categoryStats}
                      language={language}
                    />
                  </section>

                </div>

                <section className="cw-panel">
                  <div className="cw-panel-heading">
                    <h2>{t("monthWiseComplaints")}</h2>
                    <span>{t("last6Months")}</span>
                  </div>

                  <MonthlyChart
                    data={monthlyStats}
                    max={maxMonthly}
                  />
                </section>

                <section className="cw-panel">
                  <div className="cw-panel-heading">
                    <h2>{t("filteredRecords")}</h2>

                    <button onClick={exportCSV}>
                      {t("exportCSV")}
                    </button>
                  </div>

                  <input
                    className="cw-search"
                    placeholder={t("searchFilteredPlaceholder")}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />

                  <ComplaintTable
                      language={language}
                      t={t}
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
                  📷 {t("noPhotoUploaded")}
                </div>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", fontSize: "13px", marginBottom: "16px" }}>
                <div><strong>{t("status")}:</strong> <span className={`cw-status-select ${selectedIssue.status.toLowerCase().replace(/\s+/g, "")}`} style={{ padding: "3px 8px", borderRadius: "10px" }}>{translateStatus(selectedIssue.status, language)}</span></div>
                <div>
                  <strong>{t("priority")}:</strong>{" "}
                  {selectedIssue.status === "Resolved" ? (
                    <span style={{ fontSize: "12px", color: "#64748b" }}>{t("resolved")}</span>
                  ) : (
                    (() => {
                      const score = calculateSeriousness(selectedIssue);
                      const level = getPriorityLevel(score);
                      return (
                        <span
                          style={{
                            padding: "2px 8px",
                            borderRadius: "10px",
                            fontSize: "12px",
                            fontWeight: "700",
                            background: level === "high" ? "#fee2e2" : level === "mid" ? "#fef08a" : "#dcfce7",
                            color: level === "high" ? "#991b1b" : level === "mid" ? "#854d0e" : "#166534",
                            border: `1px solid ${level === "high" ? "#fecaca" : level === "mid" ? "#fef08a" : "#bbf7d0"}`,
                          }}
                        >
                          {(level === "high" ? `🔴 ${t("priorityHigh")}` : level === "mid" ? `🟡 ${t("priorityMid")}` : `🟢 ${t("priorityLow")}`)} ({score})
                        </span>
                      );
                    })()
                  )}
                </div>
                <div><strong>{t("department")}:</strong> {translateAuthority(selectedIssue.department, language)}</div>
                <div><strong>{t("location")}:</strong> {selectedIssue.city || (language === "hi" ? "शहर निर्दिष्ट नहीं" : "City not specified")}</div>
                <div><strong>{t("reportedBy")}:</strong> {selectedIssue.reported_by || t("anonymousCitizen")}</div>
                <div><strong>{t("reportedDate")}:</strong> {formatDate(selectedIssue.created_at)}</div>
                <div><strong>{t("resolvedDate")}:</strong> {formatDate(selectedIssue.resolved_at)}</div>
              </div>

              <div style={{ background: "#f8fafc", padding: "12px", borderRadius: "6px", marginBottom: "16px" }}>
                <strong style={{ display: "block", fontSize: "12px", color: "#475569", marginBottom: "4px" }}>{t("description")}:</strong>
                <p style={{ margin: 0, fontSize: "13px", color: "#1e293b", whiteSpace: "pre-wrap" }}>{selectedIssue.description || t("noDescription")}</p>
              </div>

              {selectedIssue.latitude && selectedIssue.longitude && (
                <div style={{ marginBottom: "16px", fontSize: "12px" }}>
                  <strong>{t("gpsCoordinates")}:</strong> {selectedIssue.latitude}, {selectedIssue.longitude}{" "}
                  <a
                    href={`https://www.google.com/maps?q=${selectedIssue.latitude},${selectedIssue.longitude}`}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: "#2563eb", marginLeft: "6px" }}
                  >
                    {t("viewOnGoogleMaps")}
                  </a>
                </div>
              )}

              {/* Part 2 & 3: Community Verification, Duplicate Management & Citizen Discussion */}
              <div style={{ background: "#f8fafc", padding: "14px", borderRadius: "8px", border: "1px solid #e2e8f0", marginBottom: "16px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px", flexWrap: "wrap", gap: "8px" }}>
                  <div>
                    <span style={{ fontSize: "11px", fontWeight: "700", textTransform: "uppercase", color: "#64748b" }}>
                      {t("communityVerificationTrust")}
                    </span>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "2px" }}>
                      <span style={{ fontSize: "12px", fontWeight: "700", color: "#166534", background: "#dcfce7", padding: "2px 8px", borderRadius: "10px", border: "1px solid #bbf7d0" }}>
                        👍 {selectedIssue.upvotes_count || 0} {t("citizensVerified")}
                      </span>
                      <span style={{ fontSize: "12px", fontWeight: "700", color: "#991b1b", background: "#fee2e2", padding: "2px 8px", borderRadius: "10px", border: "1px solid #fecaca" }}>
                        👎 {selectedIssue.downvotes_count || 0} {t("citizensFlagged")}
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleToggleDuplicate(selectedIssue.id, selectedIssue.is_duplicate)}
                    style={{
                      padding: "6px 12px",
                      borderRadius: "6px",
                      border: selectedIssue.is_duplicate ? "1px solid #eab308" : "1px solid #cbd5e1",
                      background: selectedIssue.is_duplicate ? "#fef9c3" : "#ffffff",
                      color: selectedIssue.is_duplicate ? "#854d0e" : "#475569",
                      fontWeight: "700",
                      fontSize: "11px",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "4px",
                    }}
                  >
                    <span>⚠️</span> {selectedIssue.is_duplicate ? t("duplicateFlaggedUnlink") : t("markAsDuplicate")}
                  </button>
                </div>

                {/* Citizen Discussion Stream for Admin Review */}
                <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: "10px", marginTop: "10px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                    <strong style={{ fontSize: "12px", color: "#334155", display: "flex", alignItems: "center", gap: "6px" }}>
                      <span>💬</span> {t("groundCitizenDiscussion")} ({adminComments.length})
                    </strong>
                    <span style={{ fontSize: "11px", color: "#64748b" }}>{t("reviewBeforeDispatch")}</span>
                  </div>

                  {adminCommentsLoading ? (
                    <div style={{ padding: "10px", textAlign: "center", fontSize: "12px", color: "#64748b" }}>{t("loadingComments")}</div>
                  ) : adminComments.length === 0 ? (
                    <div style={{ padding: "10px", textAlign: "center", fontSize: "12px", color: "#94a3b8", background: "white", borderRadius: "6px", border: "1px dashed #cbd5e1" }}>
                      {t("noCommentsPosted")}
                    </div>
                  ) : (
                    <div style={{ maxHeight: "160px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "6px" }}>
                      {adminComments.map((c) => (
                        <div
                          key={c.id}
                          style={{
                            padding: "8px 10px",
                            background: "white",
                            borderRadius: "6px",
                            border: "1px solid #e2e8f0",
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "flex-start",
                            gap: "8px",
                          }}
                        >
                          <div>
                            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                              <span style={{ fontSize: "11px", fontWeight: "700", color: "#0f172a" }}>
                                {c.user_name || t("anonymousCitizen")}
                              </span>
                              <span style={{ fontSize: "10px", color: "#94a3b8" }}>
                                {new Date(c.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                              </span>
                            </div>
                            <p style={{ margin: "2px 0 0", fontSize: "12px", color: "#334155" }}>
                              {c.comment}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleDeleteComment(c.id)}
                            style={{
                              background: "transparent",
                              border: "none",
                              color: "#dc2626",
                              fontSize: "11px",
                              cursor: "pointer",
                              padding: "2px 4px",
                            }}
                            title="Moderate / Delete comment"
                          >
                            🗑️ {t("delete")}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

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
                      {t("markInProgress")}
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
                      {t("markResolved")}
                    </button>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => setSelectedIssue(null)}
                  style={{ padding: "7px 14px", background: "#f1f5f9", border: "1px solid #cbd5e1", borderRadius: "5px", cursor: "pointer", fontSize: "12px" }}
                >
                  {t("close")}
                </button>
              </div>
            </div>
          </div>
        )}

        <footer className="cw-footer">
          CivicWatch {t("adminPortal")}
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
  language = "en",
}) {
  return (
    <div className="cw-filter-field">
      <label>{label}</label>

      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{language === "hi" ? "सभी" : "All"} {label}</option>

        {options.map((option) => (
          <option key={option} value={option}>
            {language === "hi"
              ? (translateStatus(option, language) !== option
                  ? translateStatus(option, language)
                  : translateCategory(option, language) !== option
                    ? translateCategory(option, language)
                    : translateAuthority(option, language) !== option
                      ? translateAuthority(option, language)
                      : option)
              : option}
          </option>
        ))}
      </select>
    </div>
  );
}

function StatusChart({ stats, language = "en", t = (k) => k }) {
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
          <span>{language === "hi" ? "कुल" : "Total"}</span>
        </div>
      </div>

      <div className="cw-status-legend">
        <span>🟢 {t("resolved")}: {stats.resolved}</span>
        <span>🔵 {t("inProgress")}: {stats.inProgress}</span>
        <span>🟠 {t("pending")}: {stats.pending}</span>
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

function HorizontalChart({ data, language = "en" }) {
  const max = Math.max(1, ...data.map((item) => item[1]));

  if (!data.length) {
    return <p className="cw-muted">{language === "hi" ? "कोई डेटा उपलब्ध नहीं।" : "No data available."}</p>;
  }

  return (
    <div className="cw-horizontal-chart">

      {data.map(([name, count]) => (
        <div className="cw-horizontal-row" key={name}>

          <span>{language === "hi" ? (translateCategory(name, language) !== name ? translateCategory(name, language) : translateAuthority(name, language)) : name}</span>

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
  language = "en",
  t = (k) => k,
}) {
  return (
    <div className="cw-table-wrap">

      <table>
        <thead>
          <tr>
            <th>{t("issueId")}</th>
            <th>{language === "hi" ? "फोटो" : "Photo"}</th>
            <th>{t("issueAndLocation")}</th>
            <th>{t("department")}</th>
            <th>{t("communityTrust")}</th>
            <th>{t("discussion")}</th>
            <th>{t("priority")}</th>
            <th>{t("date")}</th>
            <th>{t("status")}</th>
            <th>{t("action")}</th>
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
                      title={language === "hi" ? "फोटो देखने के लिए क्लिक करें" : "Click to view photo"}
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
                    {translateCategory(issue.category, language)}
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
                        {translateAuthority(name, language)}
                      </option>
                    ))}
                  </select>
                </td>

                <td>
                  <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                      <span style={{ fontSize: "11px", fontWeight: "700", color: "#166534", background: "#dcfce7", padding: "2px 6px", borderRadius: "8px", border: "1px solid #bbf7d0" }}>
                        👍 {issue.upvotes_count || 0}
                      </span>
                      <span style={{ fontSize: "11px", fontWeight: "700", color: "#991b1b", background: "#fee2e2", padding: "2px 6px", borderRadius: "8px", border: "1px solid #fecaca" }}>
                        👎 {issue.downvotes_count || 0}
                      </span>
                    </div>
                    {issue.is_duplicate && (
                      <span style={{ fontSize: "10px", fontWeight: "800", color: "#854d0e", background: "#fef9c3", border: "1px solid #fef08a", padding: "1px 5px", borderRadius: "4px" }}>
                        ⚠️ {t("duplicate")}
                      </span>
                    )}
                  </div>
                </td>

                <td>
                  <button
                    type="button"
                    onClick={() => onSelectIssue && onSelectIssue(issue)}
                    style={{
                      background: "#f1f5f9",
                      border: "1px solid #cbd5e1",
                      borderRadius: "6px",
                      padding: "3px 8px",
                      fontSize: "11px",
                      fontWeight: "700",
                      color: "#334155",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "4px",
                    }}
                    title={language === "hi" ? "नागरिक टिप्पणियाँ देखें" : "View citizen comments"}
                  >
                    <span>💬</span> {issue.comments_count || 0}
                  </button>
                </td>

                <td>
                  {(() => {
                    if (issue.status === "Resolved") {
                      return (
                        <span style={{ fontSize: "11px", color: "#94a3b8", fontWeight: "600" }}>
                          —
                        </span>
                      );
                    }
                    const score = calculateSeriousness(issue);
                    const level = getPriorityLevel(score);
                    if (level === "high") {
                      return (
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "3px",
                            fontSize: "11px",
                            fontWeight: "800",
                            color: "#991b1b",
                            background: "#fef2f2",
                            border: "1px solid #fecaca",
                            padding: "2px 8px",
                            borderRadius: "12px",
                            whiteSpace: "nowrap",
                          }}
                          title={`High Priority • Seriousness Score: ${score} (Likes: ${issue.upvotes_count || 0}, Dislikes: ${issue.downvotes_count || 0}, Comments: ${issue.comments_count || 0})`}
                        >
                          🔴 {t("priorityHigh")} ({score})
                        </span>
                      );
                    }
                    if (level === "mid") {
                      return (
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "3px",
                            fontSize: "11px",
                            fontWeight: "800",
                            color: "#854d0e",
                            background: "#fefce8",
                            border: "1px solid #fef08a",
                            padding: "2px 8px",
                            borderRadius: "12px",
                            whiteSpace: "nowrap",
                          }}
                          title={`Mid Priority • Seriousness Score: ${score} (Likes: ${issue.upvotes_count || 0}, Dislikes: ${issue.downvotes_count || 0}, Comments: ${issue.comments_count || 0})`}
                        >
                          🟡 {t("priorityMid")} ({score})
                        </span>
                      );
                    }
                    return (
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "3px",
                          fontSize: "11px",
                          fontWeight: "800",
                          color: "#166534",
                          background: "#f0fdf4",
                          border: "1px solid #bbf7d0",
                          padding: "2px 8px",
                          borderRadius: "12px",
                          whiteSpace: "nowrap",
                        }}
                        title={`Low Priority • Seriousness Score: ${score} (Likes: ${issue.upvotes_count || 0}, Dislikes: ${issue.downvotes_count || 0}, Comments: ${issue.comments_count || 0})`}
                      >
                        🟢 {t("priorityLow")} ({score})
                      </span>
                    );
                  })()}
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
                    {t("save")}
                  </button>
                </td>

              </tr>
            );
          })}

          {issues.length === 0 && (
            <tr>
              <td colSpan="10">
                {t("noComplaintsFound")}
              </td>
            </tr>
          )}

        </tbody>
      </table>

    </div>
  );
}
