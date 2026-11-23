import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  MapContainer,
  TileLayer,
  Marker,
  CircleMarker,
  Popup,
  useMap,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./admin.css";
import { translations, translateStatus, translateCategory, translateAuthority, translatePrivacy, translateGender } from "./translations";

const API = import.meta.env.VITE_API_URL || "http://localhost:5001/api";

const CATEGORIES = [
  "Road",
  "Garbage",
  "Water Supply",
  "Street Light",
  "Drainage",
  "Electricity",
  "Traffic",
  "Parks",
  "Pollution",
  "Other",
];

const AUTHORITIES = [
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

// Fix Leaflet default marker icon issue in Vite/Webpack
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

function formatDate(val) {
  if (!val) return "N/A";
  return new Date(val).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function StatCard({ label, value, color = "green", icon }) {
  const colorMap = {
    green: { bg: "#ecfdf5", border: "#a7f3d0", text: "#065f46" },
    orange: { bg: "#fffbeb", border: "#fde68a", text: "#b45309" },
    blue: { bg: "#eff6ff", border: "#bfdbfe", text: "#1d4ed8" },
    purple: { bg: "#faf5ff", border: "#e9d5ff", text: "#7e22ce" },
  };
  const theme = colorMap[color] || colorMap.green;

  return (
    <div
      className="cw-stat-card"
      style={{
        background: "white",
        border: "1px solid #e2e8e5",
        borderRadius: "10px",
        padding: "16px 18px",
        boxShadow: "0 2px 6px rgba(0,0,0,0.02)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      <div>
        <div style={{ fontSize: "12px", fontWeight: "600", color: "#64748b", textTransform: "uppercase" }}>
          {label}
        </div>
        <div style={{ fontSize: "28px", fontWeight: "800", color: "#0f172a", marginTop: "4px" }}>
          {value}
        </div>
      </div>
      {icon && (
        <div
          style={{
            width: "42px",
            height: "42px",
            borderRadius: "10px",
            background: theme.bg,
            border: `1px solid ${theme.border}`,
            color: theme.text,
            display: "grid",
            placeItems: "center",
            fontSize: "20px",
          }}
        >
          {icon}
        </div>
      )}
    </div>
  );
}

// Map helper to capture user pin clicks
function LocationClickHandler({ onSelect }) {
  useMapEvents({
    click(e) {
      onSelect({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });
  return null;
}

function LocationMapUpdater({ position }) {
  const map = useMap();
  useEffect(() => {
    if (position) map.setView(position, Math.max(map.getZoom(), 15));
  }, [map, position]);
  return null;
}

function GlobalMapViewport({ points }) {
  const map = useMap();
  useEffect(() => {
    if (!points || points.length === 0) return;
    if (points.length === 1) {
      map.setView(points[0], 14);
      return;
    }
    try {
      const bounds = L.latLngBounds(points);
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
    } catch {
      // ignore
    }
  }, [map, points]);
  return null;
}

function getDistanceKm(lat1, lon1, lat2, lon2) {
  if (lat1 === null || lat1 === undefined || lon1 === null || lon1 === undefined) return null;
  if (lat2 === null || lat2 === undefined || lon2 === null || lon2 === undefined) return null;
  const nLat1 = Number(lat1);
  const nLon1 = Number(lon1);
  const nLat2 = Number(lat2);
  const nLon2 = Number(lon2);
  if (isNaN(nLat1) || isNaN(nLon1) || isNaN(nLat2) || isNaN(nLon2)) return null;
  const R = 6371; // Earth radius in km
  const dLat = (nLat2 - nLat1) * (Math.PI / 180);
  const dLon = (nLon2 - nLon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(nLat1 * (Math.PI / 180)) *
      Math.cos(nLat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Number((R * c).toFixed(1));
}

export default function UserDashboard({
  user,
  onLogout,
  onNavigate,
  onUserUpdate,
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
  const [currentUser, setCurrentUser] = useState(() => user || JSON.parse(localStorage.getItem("cw_session") || "{}"));

  const getInitialTab = () => {
    if (window.history.state && window.history.state.page === "user-dashboard" && window.history.state.tab) {
      return window.history.state.tab;
    }
    const hash = window.location.hash;
    const match = hash.match(/tab=([^&]+)/);
    if (match) {
      try {
        const decoded = decodeURIComponent(match[1]);
        const valid = ["My Dashboard", "Report a Problem", "My Reports", "My Locations", "Global Map", "Profile & Settings", "Help & FAQs"];
        if (valid.includes(decoded)) return decoded;
      } catch {
        // ignore
      }
    }
    return "My Dashboard";
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
        { page: "user-dashboard", tab: tabName },
        "",
        `#user-dashboard?tab=${encodeURIComponent(tabName)}`
      );
    }
  }

  useEffect(() => {
    const currentTab = getInitialTab();
    if (!window.history.state || window.history.state.page !== "user-dashboard" || !window.history.state.tab) {
      window.history.replaceState(
        { page: "user-dashboard", tab: currentTab },
        "",
        `#user-dashboard?tab=${encodeURIComponent(currentTab)}`
      );
    }
  }, []);

  useEffect(() => {
    const handlePopState = (event) => {
      if (event.state && event.state.page === "user-dashboard" && event.state.tab) {
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
            setActivePage("My Dashboard");
          }
        }
      }
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);
  const [issues, setIssues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Notifications & 10km Nearby Citizen Alerts state
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifDropdownOpen, setNotifDropdownOpen] = useState(false);
  const [loadingNotifs, setLoadingNotifs] = useState(false);

  const loadNotifications = async () => {
    if (!currentUser?.id) return;
    setLoadingNotifs(true);
    try {
      const res = await axios.get(`${API}/notifications/${currentUser.id}`);
      setNotifications(res.data.notifications || []);
      setUnreadCount(res.data.unreadCount || 0);
    } catch (err) {
      console.error("Notifications fetch error:", err);
    } finally {
      setLoadingNotifs(false);
    }
  };

  const markNotificationRead = async (notifId) => {
    try {
      await axios.put(`${API}/notifications/${notifId}/read`);
      setNotifications((prev) =>
        prev.map((n) => (n.id === notifId ? { ...n, is_read: true } : n))
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch (err) {
      console.error("Mark notification read error:", err);
    }
  };

  const markAllNotificationsRead = async () => {
    if (!currentUser?.id) return;
    try {
      await axios.put(`${API}/notifications/user/${currentUser.id}/read-all`);
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
      setUnreadCount(0);
    } catch (err) {
      console.error("Mark all notifications read error:", err);
    }
  };

  // Global Platform Issues for Public Issue Map
  const [globalIssues, setGlobalIssues] = useState([]);
  const [globalLoading, setGlobalLoading] = useState(false);

  const mappedGlobalIssues = useMemo(
    () =>
      globalIssues.filter((issue) => {
        if (!issue.latitude || !issue.longitude) return false;
        const lat = Number(issue.latitude);
        const lng = Number(issue.longitude);
        return !isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
      }),
    [globalIssues]
  );

  const globalPoints = useMemo(
    () => mappedGlobalIssues.map((i) => [Number(i.latitude), Number(i.longitude)]),
    [mappedGlobalIssues]
  );

  const loadGlobalIssues = async () => {
    setGlobalLoading(true);
    try {
      const res = await axios.get(`${API}/issues`);
      setGlobalIssues(res.data || []);
    } catch (err) {
      console.error("Load global issues error:", err);
    } finally {
      setGlobalLoading(false);
    }
  };

  const handleOpenGlobalIssue = async (issue) => {
    let issueData = { ...issue };
    if (currentUser?.id) {
      try {
        const vRes = await axios.get(`${API}/issues/${issue.id}/vote/${currentUser.id}`);
        issueData.userVote = vRes.data?.userVote || null;
      } catch {
        issueData.userVote = null;
      }
    }
    setSelectedIssue(issueData);
  };

  // Dashboard reports view toggle & 4 filters (Status, Category, Privacy, Distance)
  const [dashboardTab, setDashboardTab] = useState("all"); // "all" or "alerts"
  const [dashStatusFilter, setDashStatusFilter] = useState("All");
  const [dashCategoryFilter, setDashCategoryFilter] = useState("All");
  const [dashPrivacyFilter, setDashPrivacyFilter] = useState("All");
  const [dashDistanceFilter, setDashDistanceFilter] = useState("All");
  const [dashCustomDistance, setDashCustomDistance] = useState("");

  const maxDistanceKm = useMemo(() => {
    if (dashDistanceFilter === "All") return null;
    if (dashDistanceFilter === "custom") {
      const val = parseFloat(dashCustomDistance);
      return isNaN(val) || val <= 0 ? null : val;
    }
    const val = parseFloat(dashDistanceFilter);
    return isNaN(val) ? null : val;
  }, [dashDistanceFilter, dashCustomDistance]);

  const filteredDashboardReports = useMemo(() => {
    const userLat = currentUser?.latitude || 19.076;
    const userLng = currentUser?.longitude || 72.8777;

    if (dashboardTab === "all") {
      return globalIssues.filter((issue) => {
        // Status filter
        if (dashStatusFilter !== "All" && String(issue.status || "Pending").toLowerCase() !== dashStatusFilter.toLowerCase()) {
          return false;
        }
        // Category filter
        if (dashCategoryFilter !== "All" && issue.category !== dashCategoryFilter) {
          return false;
        }
        // Privacy filter
        if (dashPrivacyFilter === "Anonymous" && !issue.is_anonymous) {
          return false;
        }
        if (dashPrivacyFilter === "Registered" && issue.is_anonymous) {
          return false;
        }
        // Distance filter
        if (maxDistanceKm !== null) {
          const dist = getDistanceKm(userLat, userLng, issue.latitude, issue.longitude);
          if (dist === null || dist > maxDistanceKm) return false;
        }
        return true;
      });
    } else {
      // Alert reports (notifications)
      return notifications.filter((n) => {
        // Status filter
        if (dashStatusFilter !== "All" && String(n.status || "Pending").toLowerCase() !== dashStatusFilter.toLowerCase()) {
          return false;
        }
        // Category filter
        if (dashCategoryFilter !== "All" && n.category !== dashCategoryFilter) {
          return false;
        }
        // Privacy filter
        if (dashPrivacyFilter === "Anonymous" && !n.is_anonymous) {
          return false;
        }
        if (dashPrivacyFilter === "Registered" && n.is_anonymous) {
          return false;
        }
        // Distance filter
        if (maxDistanceKm !== null) {
          const dist = n.distance_km !== undefined && n.distance_km !== null
            ? Number(n.distance_km)
            : getDistanceKm(userLat, userLng, n.issue_lat, n.issue_lng);
          if (dist === null || dist > maxDistanceKm) return false;
        }
        return true;
      });
    }
  }, [
    dashboardTab,
    globalIssues,
    notifications,
    dashStatusFilter,
    dashCategoryFilter,
    dashPrivacyFilter,
    maxDistanceKm,
    currentUser?.latitude,
    currentUser?.longitude,
  ]);

  // Filter & Search states for My Reports
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [privacyFilter, setPrivacyFilter] = useState("All");

  // Selected issue for detail modal
  const [selectedIssue, setSelectedIssue] = useState(null);

  // Report Form state
  const [complaint, setComplaint] = useState({
    title: "",
    category: "Road",
    authority: "Municipal Corporation",
    description: "",
    state: currentUser?.state || "Maharashtra",
    city: currentUser?.city || "Mumbai",
    block: "Powai",
    pincode: "400076",
    isAnonymous: false,
    latitude: 19.076,
    longitude: 72.8777,
  });
  const [complaintPhoto, setComplaintPhoto] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // Saved user locations
  const [savedLocations, setSavedLocations] = useState(() => {
    try {
      const stored = localStorage.getItem(`cw_locations_${currentUser?.id}`);
      return stored
        ? JSON.parse(stored)
        : [
            { id: 1, name: "Home", city: "Mumbai", area: "Powai", pincode: "400076", state: "Maharashtra" },
            { id: 2, name: "Office / Work", city: "Mumbai", area: "Bandra Kurla Complex (BKC)", pincode: "400051", state: "Maharashtra" },
          ];
    } catch {
      return [];
    }
  });
  const [newLocation, setNewLocation] = useState({ name: "", city: "Mumbai", area: "", pincode: "", state: "Maharashtra" });

  // Profile & settings form state
  const [profileForm, setProfileForm] = useState({
    name: currentUser?.name || "",
    email: currentUser?.email || "",
    mobile: currentUser?.mobile || "",
    gender: currentUser?.gender || "Other",
    city: currentUser?.city || "Mumbai",
    state: currentUser?.state || "Maharashtra",
  });
  const [profileSaving, setProfileSaving] = useState(false);

  // Password change state
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [passwordSaving, setPasswordSaving] = useState(false);

  // Preference settings
  const [preferences, setPreferences] = useState(() => {
    try {
      const saved = localStorage.getItem(`cw_pref_${currentUser?.id}`);
      return saved
        ? JSON.parse(saved)
        : {
            alwaysAnonymous: false,
            emailAlerts: true,
            smsAlerts: false,
          };
    } catch {
      return { alwaysAnonymous: false, emailAlerts: true, smsAlerts: false };
    }
  });

  // FAQs active category & search
  const [faqSearch, setFaqSearch] = useState("");
  const [openFaq, setOpenFaq] = useState(null);

  // Load user's complaints
  const loadUserIssues = async () => {
    if (!currentUser?.id) return;
    setLoading(true);
    setError("");
    try {
      const res = await axios.get(`${API}/user/issues/${currentUser.id}`);
      setIssues(res.data);
    } catch (err) {
      setError(err.response?.data?.error || "Could not load your complaints.");
    } finally {
      setLoading(false);
    }
  };


  // Part 3: Modal Citizen Discussion Comments state
  const [modalComments, setModalComments] = useState([]);
  const [modalCommentText, setModalCommentText] = useState("");
  const [modalCommentPosting, setModalCommentPosting] = useState(false);

  const loadModalComments = async (issueId) => {
    try {
      const res = await axios.get(`${API}/issues/${issueId}/comments`);
      setModalComments(res.data || []);
    } catch {
      setModalComments([]);
    }
  };

  const handlePostModalComment = async (e) => {
    e.preventDefault();
    if (!currentUser?.id || !selectedIssue?.id) return;
    const text = modalCommentText.trim();
    if (!text) return;
    setModalCommentPosting(true);
    try {
      const res = await axios.post(`${API}/issues/${selectedIssue.id}/comments`, {
        userId: currentUser.id,
        comment: text,
      });
      setModalComments((prev) => [...prev, res.data]);
      setModalCommentText("");
      setSelectedIssue((prev) => ({
        ...prev,
        comments_count: (Number(prev?.comments_count) || 0) + 1,
      }));
      setGlobalIssues((prevList) =>
        prevList.map((item) =>
          item.id === selectedIssue.id
            ? { ...item, comments_count: (Number(item.comments_count) || 0) + 1 }
            : item
        )
      );
    } catch (err) {
      alert(err.response?.data?.error || "Could not post comment.");
    } finally {
      setModalCommentPosting(false);
    }
  };

  useEffect(() => {
    if (selectedIssue?.id) {
      loadModalComments(selectedIssue.id);
    } else {
      setModalComments([]);
    }
  }, [selectedIssue?.id]);

  useEffect(() => {
    loadUserIssues();
    loadGlobalIssues();
    loadNotifications();
    const interval = setInterval(loadNotifications, 15000);
    return () => clearInterval(interval);
  }, [currentUser?.id]);

  // Sync photo preview
  useEffect(() => {
    if (!complaintPhoto) {
      setPhotoPreview(null);
      return;
    }
    const objectUrl = URL.createObjectURL(complaintPhoto);
    setPhotoPreview(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [complaintPhoto]);

  // Statistics calculation
  const stats = useMemo(() => {
    const total = issues.length;
    const pending = issues.filter((i) => String(i.status).toLowerCase() === "pending").length;
    const inProgress = issues.filter((i) => String(i.status).toLowerCase() === "in progress").length;
    const resolved = issues.filter((i) => String(i.status).toLowerCase() === "resolved").length;
    const anonymous = issues.filter((i) => i.is_anonymous).length;
    return { total, pending, inProgress, resolved, anonymous };
  }, [issues]);

  // Filtered issues for My Reports
  const filteredIssues = useMemo(() => {
    return issues.filter((item) => {
      // Status filter
      if (statusFilter !== "All" && String(item.status).toLowerCase() !== statusFilter.toLowerCase()) {
        return false;
      }
      // Category filter
      if (categoryFilter !== "All" && item.category !== categoryFilter) {
        return false;
      }
      // Privacy filter
      if (privacyFilter === "Anonymous" && !item.is_anonymous) return false;
      if (privacyFilter === "Registered" && item.is_anonymous) return false;

      // Search filter
      if (searchTerm.trim()) {
        const query = searchTerm.toLowerCase();
        const matchTitle = (item.title || "").toLowerCase().includes(query);
        const matchDesc = (item.description || "").toLowerCase().includes(query);
        const matchTrack = (item.tracking_id || "").toLowerCase().includes(query);
        const matchLoc = (item.block || "").toLowerCase().includes(query) || (item.city || "").toLowerCase().includes(query);
        const matchDept = (item.department || "").toLowerCase().includes(query);
        if (!matchTitle && !matchDesc && !matchTrack && !matchLoc && !matchDept) return false;
      }
      return true;
    });
  }, [issues, statusFilter, categoryFilter, privacyFilter, searchTerm]);

  // Submit Complaint Handler
  async function handleSubmitComplaint(e) {
    e.preventDefault();
    if (submitting) return;

    if (!complaint.title.trim() || !complaint.description.trim()) {
      setError("Please provide a title and detailed description.");
      return;
    }
    if (complaint.latitude === null || complaint.longitude === null) {
      setError("Please click on the map to pin the complaint location.");
      return;
    }

    setSubmitting(true);
    setError("");
    setSuccess("");

    const formData = new FormData();
    formData.append("title", complaint.title.trim());
    formData.append("category", complaint.category);
    formData.append("department", complaint.authority);
    formData.append("authority", complaint.authority);
    formData.append("description", complaint.description.trim());
    formData.append("state", complaint.state.trim());
    formData.append("city", complaint.city.trim());
    formData.append("block", complaint.block.trim());
    formData.append("pincode", complaint.pincode.trim());
    formData.append("latitude", String(complaint.latitude));
    formData.append("longitude", String(complaint.longitude));
    formData.append("userId", String(currentUser.id));
    formData.append("isAnonymous", String(complaint.isAnonymous));

    if (complaintPhoto) {
      formData.append("photo", complaintPhoto);
    }

    try {
      const res = await axios.post(`${API}/issues`, formData);
      setSuccess(`🎉 Complaint registered successfully! Tracking ID: ${res.data.tracking_id}`);
      setComplaint({
        title: "",
        category: "Road",
        authority: "Municipal Corporation",
        description: "",
        state: currentUser?.state || "Maharashtra",
        city: currentUser?.city || "Mumbai",
        block: "Powai",
        pincode: "400076",
        isAnonymous: preferences.alwaysAnonymous,
        latitude: 19.076,
        longitude: 72.8777,
      });
      setComplaintPhoto(null);
      await loadUserIssues();
      switchTab("My Reports");
    } catch (err) {
      setError(err.response?.data?.error || "Failed to submit complaint. Please check your connection.");
    } finally {
      setSubmitting(false);
    }
  }

  // Use Current Geolocation
  function handleUseCurrentLocation() {
    if (!navigator.geolocation) {
      setError("Geolocation is not supported by your browser.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setComplaint((prev) => ({
          ...prev,
          latitude: Number(pos.coords.latitude.toFixed(7)),
          longitude: Number(pos.coords.longitude.toFixed(7)),
        }));
        setSuccess("📍 Updated map coordinates to your device's live location.");
      },
      () => {
        setError("Could not retrieve current location. Please click on the map to select.");
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  // Cancel Complaint
  async function handleCancelIssue(issueId) {
    if (!window.confirm("Are you sure you want to withdraw and cancel this pending complaint?")) return;
    try {
      await axios.delete(`${API}/user/issues/${issueId}?userId=${currentUser.id}`);
      setSuccess("Complaint has been successfully withdrawn and deleted.");
      if (selectedIssue?.id === issueId) setSelectedIssue(null);
      await loadUserIssues();
    } catch (err) {
      setError(err.response?.data?.error || "Could not cancel complaint.");
    }
  }

  // Profile Update Handler
  async function handleUpdateProfile(e) {
    e.preventDefault();
    setProfileSaving(true);
    setError("");
    setSuccess("");
    try {
      const res = await axios.put(`${API}/user/profile/${currentUser.id}`, profileForm);
      setCurrentUser(res.data.user);
      localStorage.setItem("cw_session", JSON.stringify(res.data.user));
      if (onUserUpdate) onUserUpdate(res.data.user);
      setSuccess("Your profile information has been saved successfully.");
    } catch (err) {
      setError(err.response?.data?.error || "Failed to update profile.");
    } finally {
      setProfileSaving(false);
    }
  }

  // Password Update Handler
  async function handleUpdatePassword(e) {
    e.preventDefault();
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setError("New password and confirm password do not match.");
      return;
    }
    setPasswordSaving(true);
    setError("");
    setSuccess("");
    try {
      await axios.put(`${API}/user/password/${currentUser.id}`, {
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword,
      });
      setSuccess("Your password has been changed successfully.");
      setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
    } catch (err) {
      setError(err.response?.data?.error || "Failed to change password. Verify your current password.");
    } finally {
      setPasswordSaving(false);
    }
  }

  // Add Saved Location
  function handleAddLocation(e) {
    e.preventDefault();
    if (!newLocation.name.trim() || !newLocation.area.trim()) return;
    const updated = [...savedLocations, { ...newLocation, id: Date.now() }];
    setSavedLocations(updated);
    localStorage.setItem(`cw_locations_${currentUser?.id}`, JSON.stringify(updated));
    setNewLocation({ name: "", city: "Mumbai", area: "", pincode: "", state: "Maharashtra" });
    setSuccess("New location saved to your favorites.");
  }

  function handleDeleteLocation(id) {
    const updated = savedLocations.filter((l) => l.id !== id);
    setSavedLocations(updated);
    localStorage.setItem(`cw_locations_${currentUser?.id}`, JSON.stringify(updated));
  }

  function handleQuickReportAtLocation(loc) {
    setComplaint((prev) => ({
      ...prev,
      city: loc.city || prev.city,
      block: loc.area || prev.block,
      pincode: loc.pincode || prev.pincode,
      state: loc.state || prev.state,
    }));
    switchTab("Report a Problem");
  }

  // Export CSV
  function handleExportCSV() {
    if (issues.length === 0) {
      alert("No complaints available to export.");
      return;
    }
    const headers = ["Tracking ID", "Title", "Category", "Department", "Status", "City", "Area", "Pincode", "Date", "Anonymous"];
    const rows = issues.map((i) => [
      i.tracking_id,
      `"${(i.title || "").replace(/"/g, '""')}"`,
      i.category,
      `"${i.department}"`,
      i.status,
      i.city,
      i.block,
      i.pincode,
      formatDate(i.created_at),
      i.is_anonymous ? "YES" : "NO",
    ]);
    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `CivicWatch_My_Reports_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // FAQs data
  const faqs = [
    {
      q: "How does Anonymous Reporting protect my identity?",
      a: "When you select 'Report Anonymously', your name, email, and phone number are strictly concealed from government administrators, municipal staff, and public records. The database displays your identity as 'Anonymous Citizen'. You can still view, follow, and manage your report securely inside your personal dashboard.",
      cat: "Privacy & Safety",
    },
    {
      q: "How do I track my report resolution status?",
      a: "Every submission generates a unique Tracking ID (e.g., CW-A4LFBY). You can track it anytime via your 'My Reports' tab or by entering the Tracking ID into the public Track page without logging in.",
      cat: "Tracking",
    },
    {
      q: "Can I cancel or edit a complaint after submitting?",
      a: "Yes! If your complaint is in 'Pending' status, you can cancel and withdraw it from the 'My Reports' view or the detail modal. Once government officers have marked it 'In Progress' or 'Resolved', it cannot be deleted to preserve the public audit trail.",
      cat: "Complaints",
    },
    {
      q: "Which department should I choose for garbage vs streetlights?",
      a: "For potholes and damaged roads, choose Public Works Department (PWD). For uncollected waste or overflow, select Sanitation & Waste Management. For dark or blinking street lamps, select Street Lighting Department.",
      cat: "Departments",
    },
    {
      q: "What should I do in an emergency (water main burst, live wire, fire)?",
      a: "For immediate life-safety emergencies, please call the dedicated emergency hotlines: 101 for Fire, 1916 for Municipal Disaster Management, and 100 for Police.",
      cat: "Emergency",
    },
  ];

  const filteredFaqs = faqs.filter(
    (f) =>
      f.q.toLowerCase().includes(faqSearch.toLowerCase()) ||
      f.a.toLowerCase().includes(faqSearch.toLowerCase()) ||
      f.cat.toLowerCase().includes(faqSearch.toLowerCase())
  );

  return (
    <div className="cw-admin">
      {/* SIDEBAR - Exactly styled like AdminDashboard */}
      <aside className="cw-sidebar">
        <div className="cw-brand">
          <div className="cw-brand-icon">CW</div>
          <div>
            <strong>CivicWatch</strong>
            <span style={{ color: "#86efac", fontWeight: "700" }}>{t("citizenPortal")}</span>
          </div>
        </div>

        <nav className="cw-navigation">
          {[
            ["My Dashboard", "▦", t("myDashboard")],
            ["Report a Problem", "✎", t("reportProblemTab")],
            ["My Reports", "▤", t("myReportsTab")],
            ["My Locations", "⌖", t("myLocationsTab")],
            ["Global Map", "🗺️", t("globalMapTab")],
            ["Profile & Settings", "⚙", t("profileSettingsTab")],
            ["Help & FAQs", "❓", t("helpFaqsTab")],
          ].map(([name, icon, label]) => (
            <button
              key={name}
              className={activePage === name ? "active" : ""}
              onClick={() => switchTab(name)}
            >
              <span>{icon}</span>
              {label}
            </button>
          ))}
        </nav>

        <div className="cw-sidebar-bottom">
          <div className="cw-admin-profile">
            <div className="cw-avatar" style={{ background: "#fef3c7", color: "#92400e" }}>
              {(currentUser?.name || "C").charAt(0).toUpperCase()}
            </div>
            <div>
              <strong>{currentUser?.name || "Citizen"}</strong>
              <span style={{ color: "#d1fae5" }}>
                {t("verifiedCitizen")} • {currentUser?.city || "Mumbai"}
              </span>
            </div>
          </div>

          <button className="cw-logout" onClick={onLogout} title="Log out from CivicWatch">
            ↪ {t("logout")}
          </button>

          {onNavigate && (
            <button
              className="cw-logout"
              onClick={() => onNavigate("home")}
              style={{
                marginTop: "6px",
                background: "rgba(255,255,255,0.08)",
                border: "1px solid rgba(255,255,255,0.2)",
              }}
            >
              ← {t("publicHome")}
            </button>
          )}
        </div>
      </aside>

      {/* MAIN VIEW */}
      <main className="cw-main">
        {/* Top Header */}
        <header className="cw-header">
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
              <h1>
                {activePage === "My Dashboard" ? t("myDashboard") :
                 activePage === "Report a Problem" ? t("reportProblemTab") :
                 activePage === "My Reports" ? t("myReportsTab") :
                 activePage === "My Locations" ? t("myLocationsTab") :
                 activePage === "Global Map" ? t("globalMapTab") :
                 activePage === "Profile & Settings" ? t("profileSettingsTab") :
                 activePage === "Help & FAQs" ? t("helpFaqsTab") : activePage}
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
                🏙️ {t("citizenRole")}: {currentUser?.city || "MUMBAI"}, {currentUser?.state || "MAHARASHTRA"}
              </span>
              {stats.anonymous > 0 && (
                <span
                  style={{
                    fontSize: "11px",
                    fontWeight: "700",
                    padding: "4px 9px",
                    borderRadius: "12px",
                    background: "#ecfdf5",
                    color: "#065f46",
                    border: "1px solid #a7f3d0",
                  }}
                >
                  🛡️ {stats.anonymous} {t("anonymousReportsCount")}
                </span>
              )}
            </div>
            <p>{t("dashboardSubtitle")}</p>
          </div>

          <div className="cw-header-actions">
            {/* Language Switcher */}
            <div style={{ position: "relative" }}>
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
            </div>

            <button
              className="cw-refresh"
              onClick={() => {
                loadUserIssues();
                loadNotifications();
                setSuccess(language === "hi" ? "डेटा रीफ़्रेश हो गया।" : "Data refreshed.");
              }}
              disabled={loading}
            >
              ↻ {t("refresh")}
            </button>

            {/* Part 1: Notification Bell & Nearby Alerts Dropdown */}
            <div style={{ position: "relative" }}>
              <button
                type="button"
                onClick={() => setNotifDropdownOpen((prev) => !prev)}
                style={{
                  position: "relative",
                  padding: "7px 12px",
                  borderRadius: "8px",
                  background: notifDropdownOpen ? "#082f26" : "#ffffff",
                  color: notifDropdownOpen ? "#ffffff" : "#1e293b",
                  border: "1px solid #cbd5e1",
                  fontSize: "13px",
                  fontWeight: "600",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
                  transition: "all 0.15s ease",
                }}
                title="10km Radius Nearby Civic Alerts"
              >
                <span style={{ fontSize: "16px" }}>🔔</span>
                <span style={{ fontSize: "12px", display: "inline-block" }}>{t("alerts")}</span>
                {unreadCount > 0 && (
                  <span
                    style={{
                      background: "#ef4444",
                      color: "white",
                      borderRadius: "999px",
                      padding: "1px 6px",
                      fontSize: "11px",
                      fontWeight: "800",
                      lineHeight: "14px",
                      boxShadow: "0 1px 2px rgba(239, 68, 68, 0.4)",
                    }}
                  >
                    {unreadCount}
                  </span>
                )}
              </button>

              {notifDropdownOpen && (
                <div
                  style={{
                    position: "absolute",
                    right: 0,
                    top: "calc(100% + 8px)",
                    width: "360px",
                    maxWidth: "90vw",
                    background: "white",
                    borderRadius: "12px",
                    boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.15), 0 8px 10px -6px rgba(0, 0, 0, 0.1)",
                    border: "1px solid #cbd5e1",
                    zIndex: 1000,
                    overflow: "hidden",
                    textAlign: "left",
                  }}
                >
                  <div
                    style={{
                      padding: "12px 16px",
                      background: "#082f26",
                      color: "white",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <span style={{ fontSize: "15px" }}>🚨</span>
                      <span style={{ fontSize: "13px", fontWeight: "700" }}>
                        Nearby Alerts (&le; 10km)
                      </span>
                      {unreadCount > 0 && (
                        <span
                          style={{
                            background: "#f59e0b",
                            color: "#082f26",
                            fontSize: "10px",
                            fontWeight: "800",
                            padding: "1px 6px",
                            borderRadius: "999px",
                          }}
                        >
                          {unreadCount} New
                        </span>
                      )}
                    </div>
                    {unreadCount > 0 && (
                      <button
                        type="button"
                        onClick={markAllNotificationsRead}
                        style={{
                          background: "transparent",
                          border: "none",
                          color: "#a7f3d0",
                          fontSize: "11px",
                          fontWeight: "600",
                          cursor: "pointer",
                          textDecoration: "underline",
                          padding: "0",
                        }}
                      >
                        Mark all read
                      </button>
                    )}
                  </div>

                  <div style={{ maxHeight: "320px", overflowY: "auto" }}>
                    {notifications.length === 0 ? (
                      <div style={{ padding: "28px 16px", textAlign: "center", color: "#64748b", fontSize: "13px" }}>
                        <div style={{ fontSize: "28px", marginBottom: "6px" }}>📡</div>
                        No civic alerts reported within 10 km yet.
                      </div>
                    ) : (
                      notifications.map((n) => (
                        <div
                          key={n.id}
                          onClick={() => {
                            if (!n.is_read) markNotificationRead(n.id);
                          }}
                          style={{
                            padding: "12px 14px",
                            borderBottom: "1px solid #f1f5f9",
                            background: n.is_read ? "white" : "#f0fdf4",
                            cursor: "pointer",
                            transition: "background 0.15s ease",
                            display: "flex",
                            flexDirection: "column",
                            gap: "4px",
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                            <span
                              style={{
                                fontSize: "10px",
                                fontWeight: "800",
                                textTransform: "uppercase",
                                padding: "2px 6px",
                                borderRadius: "4px",
                                background: n.is_read ? "#e2e8f0" : "#dcfce7",
                                color: n.is_read ? "#475569" : "#166534",
                              }}
                            >
                              {n.category || "Issue"} • 📍 {n.distance_km} km away
                            </span>
                            <span style={{ fontSize: "10px", color: "#94a3b8" }}>
                              {new Date(n.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                            </span>
                          </div>
                          <div style={{ fontSize: "12px", fontWeight: n.is_read ? "500" : "700", color: "#1e293b" }}>
                            {n.title}
                          </div>
                          {n.message && (
                            <div style={{ fontSize: "11px", color: "#64748b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {n.message}
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            <span className="cw-header-user">
              👤 {currentUser?.name ? currentUser.name.split(" ")[0] : "Citizen"}
            </span>

            <button
              type="button"
              className="cw-header-logout"
              onClick={onLogout}
              title="Logout of Citizen Portal"
            >
              ↪ {t("logout")}
            </button>
          </div>
        </header>

        {/* Global Notifications */}
        {error && (
          <div className="cw-alert cw-error" style={{ marginBottom: "16px" }}>
            {error}
          </div>
        )}
        {success && (
          <div className="cw-alert cw-success" style={{ marginBottom: "16px" }}>
            {success}
          </div>
        )}

        {/* ==================================================== */}
        {/* PAGE 1: MY DASHBOARD */}
        {/* ==================================================== */}
        {activePage === "My Dashboard" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            {/* Stat Counters */}
            <div className="cw-stat-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "14px" }}>
              <StatCard label={t("totalComplaints")} value={stats.total} color="green" icon="▤" />
              <StatCard label={t("pending")} value={stats.pending} color="orange" icon="◷" />
              <StatCard label={t("inProgress")} value={stats.inProgress} color="blue" icon="↻" />
              <StatCard label={t("resolved")} value={stats.resolved} color="purple" icon="✓" />
            </div>

            {/* Quick Banner */}
            <div
              style={{
                background: "linear-gradient(135deg, #0b3d2e 0%, #176447 100%)",
                color: "white",
                borderRadius: "12px",
                padding: "24px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: "16px",
                boxShadow: "0 4px 14px rgba(11, 61, 46, 0.15)",
              }}
            >
              <div style={{ maxWidth: "600px" }}>
                <span
                  style={{
                    background: "rgba(245, 158, 11, 0.25)",
                    color: "#fef3c7",
                    border: "1px solid rgba(245, 158, 11, 0.4)",
                    padding: "3px 10px",
                    borderRadius: "12px",
                    fontSize: "11px",
                    fontWeight: "700",
                    textTransform: "uppercase",
                  }}
                >
                  {language === "hi" ? "नागरिक एक्शन हब" : "Citizen Action Hub"}
                </span>
                <h2 style={{ margin: "8px 0 6px", fontSize: "20px", color: "white" }}>
                  {language === "hi" ? "क्या आपने अपने क्षेत्र में कोई नागरिक समस्या देखी?" : "Noticed a civic issue in your neighborhood?"}
                </h2>
                <p style={{ margin: "0", color: "#d1fae5", fontSize: "13px", lineHeight: "1.5" }}>
                  {language === "hi" ? "सड़क के गड्ढे, कचरे के ढेर, खराब स्ट्रीट लाइट या पानी के रिसाव की रिपोर्ट 60 सेकंड में करें। आप 100% गुमनाम भी रह सकते हैं।" : "Report potholes, waste dumps, broken street lights, or water leaks in under 60 seconds. You can choose to remain 100% anonymous."}
                </p>
              </div>
              <button
                onClick={() => switchTab("Report a Problem")}
                style={{
                  background: "#f59e0b",
                  color: "#172033",
                  border: "none",
                  borderRadius: "8px",
                  padding: "12px 20px",
                  fontSize: "14px",
                  fontWeight: "700",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
                }}
              >
                <span>✎</span> {language === "hi" ? "अभी शिकायत दर्ज करें" : "File a Complaint Now"}
              </button>
            </div>

            {/* Civic Reports & Alerts Hub with 2 Toggle Buttons and 4 Dropdown Filters */}
            <div
              className="cw-card"
              style={{
                background: "white",
                borderRadius: "10px",
                border: "1px solid #e2e8e5",
                padding: "20px",
                boxShadow: "0 2px 6px rgba(0,0,0,0.02)",
              }}
            >
              {/* Top Row: 2 Buttons (All Reports / Alert Reports) & Refresh */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: "12px",
                  paddingBottom: "14px",
                  borderBottom: "1px solid #f1f5f9",
                }}
              >
                <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
                  <button
                    type="button"
                    onClick={() => setDashboardTab("all")}
                    style={{
                      padding: "9px 18px",
                      borderRadius: "8px",
                      border: dashboardTab === "all" ? "2px solid #082f26" : "1px solid #cbd5e1",
                      background: dashboardTab === "all" ? "#082f26" : "#ffffff",
                      color: dashboardTab === "all" ? "#ffffff" : "#334155",
                      fontWeight: "700",
                      fontSize: "13px",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      boxShadow: dashboardTab === "all" ? "0 2px 6px rgba(8, 47, 38, 0.2)" : "none",
                      transition: "all 0.15s ease",
                    }}
                  >
                    <span>📋</span> {t("allReports")} ({globalIssues.length})
                  </button>

                  <button
                    type="button"
                    onClick={() => setDashboardTab("alerts")}
                    style={{
                      padding: "9px 18px",
                      borderRadius: "8px",
                      border: dashboardTab === "alerts" ? "2px solid #082f26" : "1px solid #cbd5e1",
                      background: dashboardTab === "alerts" ? "#082f26" : "#ffffff",
                      color: dashboardTab === "alerts" ? "#ffffff" : "#334155",
                      fontWeight: "700",
                      fontSize: "13px",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      boxShadow: dashboardTab === "alerts" ? "0 2px 6px rgba(8, 47, 38, 0.2)" : "none",
                      transition: "all 0.15s ease",
                    }}
                  >
                    <span>🚨</span> {t("alertReports")} ({notifications.length})
                    {unreadCount > 0 && (
                      <span
                        style={{
                          background: "#ef4444",
                          color: "white",
                          fontSize: "10px",
                          fontWeight: "800",
                          padding: "1px 6px",
                          borderRadius: "999px",
                        }}
                      >
                        {unreadCount} NEW
                      </span>
                    )}
                  </button>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  {dashboardTab === "alerts" && unreadCount > 0 && (
                    <button
                      type="button"
                      onClick={markAllNotificationsRead}
                      style={{
                        background: "#f1f5f9",
                        border: "1px solid #cbd5e1",
                        color: "#334155",
                        borderRadius: "6px",
                        padding: "6px 12px",
                        fontSize: "12px",
                        fontWeight: "600",
                        cursor: "pointer",
                      }}
                    >
                      ✓ Mark All Read
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      loadGlobalIssues();
                      loadNotifications();
                      setSuccess("Reports refreshed.");
                    }}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "#0b3d2e",
                      fontWeight: "700",
                      cursor: "pointer",
                      fontSize: "12px",
                    }}
                  >
                    ↻ Refresh
                  </button>
                </div>
              </div>

              {/* 4 Dropdown Filters Bar (Status, All Categories, All Privacy, Distance) */}
              <div
                style={{
                  display: "flex",
                  gap: "10px",
                  alignItems: "center",
                  flexWrap: "wrap",
                  padding: "12px 14px",
                  background: "#f8fafc",
                  borderRadius: "8px",
                  border: "1px solid #e2e8e5",
                  marginTop: "14px",
                  marginBottom: "16px",
                }}
              >
                <span style={{ fontSize: "12px", fontWeight: "700", color: "#475569", display: "flex", alignItems: "center", gap: "4px" }}>
                  <span>🔍</span> {language === "hi" ? "फ़िल्टर:" : "Filter:"}
                </span>

                {/* 1. Status Filter */}
                <select
                  value={dashStatusFilter}
                  onChange={(e) => setDashStatusFilter(e.target.value)}
                  style={{
                    padding: "6px 10px",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    fontSize: "12px",
                    background: "white",
                    color: "#0f172a",
                    fontWeight: "600",
                    cursor: "pointer",
                  }}
                >
                  <option value="All">{t("filterAllStatus")}</option>
                  <option value="Pending">{t("pending")}</option>
                  <option value="In Progress">{t("inProgress")}</option>
                  <option value="Resolved">{t("resolved")}</option>
                </select>

                {/* 2. Category Filter */}
                <select
                  value={dashCategoryFilter}
                  onChange={(e) => setDashCategoryFilter(e.target.value)}
                  style={{
                    padding: "6px 10px",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    fontSize: "12px",
                    background: "white",
                    color: "#0f172a",
                    fontWeight: "600",
                    cursor: "pointer",
                  }}
                >
                  <option value="All">{t("filterAllCategories")}</option>
                  {CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {translateCategory(cat, language)}
                    </option>
                  ))}
                </select>

                {/* 3. Privacy Filter */}
                <select
                  value={dashPrivacyFilter}
                  onChange={(e) => setDashPrivacyFilter(e.target.value)}
                  style={{
                    padding: "6px 10px",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    fontSize: "12px",
                    background: "white",
                    color: "#0f172a",
                    fontWeight: "600",
                    cursor: "pointer",
                  }}
                >
                  <option value="All">{t("filterAllPrivacy")}</option>
                  <option value="Registered">{t("filterPrivacyRegistered")}</option>
                  <option value="Anonymous">{t("filterPrivacyAnonymous")}</option>
                </select>

                {/* 4. Distance Filter (1, 2, 5, 10, All, Custom) */}
                <select
                  value={dashDistanceFilter}
                  onChange={(e) => setDashDistanceFilter(e.target.value)}
                  style={{
                    padding: "6px 10px",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    fontSize: "12px",
                    background: "white",
                    color: "#0f172a",
                    fontWeight: "600",
                    cursor: "pointer",
                  }}
                >
                  <option value="All">{t("filterAllDistance")}</option>
                  <option value="1">{t("filterWithin1km")}</option>
                  <option value="2">{t("filterWithin2km")}</option>
                  <option value="5">{t("filterWithin5km")}</option>
                  <option value="10">{t("filterWithin10km")}</option>
                  <option value="custom">{t("filterCustomKm")}</option>
                </select>

                {/* Custom manual distance input */}
                {dashDistanceFilter === "custom" && (
                  <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                    <input
                      type="number"
                      min="0.1"
                      step="0.5"
                      placeholder="Enter km (e.g. 3)"
                      value={dashCustomDistance}
                      onChange={(e) => setDashCustomDistance(e.target.value)}
                      style={{
                        width: "120px",
                        padding: "6px 8px",
                        borderRadius: "6px",
                        border: "1px solid #082f26",
                        fontSize: "12px",
                        background: "white",
                      }}
                    />
                    <span style={{ fontSize: "11px", fontWeight: "700", color: "#64748b" }}>km</span>
                  </div>
                )}

                {/* Active filter count / Reset */}
                {(dashStatusFilter !== "All" || dashCategoryFilter !== "All" || dashPrivacyFilter !== "All" || dashDistanceFilter !== "All" || dashCustomDistance) && (
                  <button
                    type="button"
                    onClick={() => {
                      setDashStatusFilter("All");
                      setDashCategoryFilter("All");
                      setDashPrivacyFilter("All");
                      setDashDistanceFilter("All");
                      setDashCustomDistance("");
                    }}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "#b91c1c",
                      fontSize: "11px",
                      fontWeight: "700",
                      cursor: "pointer",
                      textDecoration: "underline",
                      marginLeft: "auto",
                    }}
                  >
                    {language === "hi" ? "फ़िल्टर रीसेट करें" : "Reset Filters"}
                  </button>
                )}
              </div>

              {/* Reports Stream */}
              {filteredDashboardReports.length === 0 ? (
                <div
                  style={{
                    padding: "36px 20px",
                    textAlign: "center",
                    background: "#f8fafc",
                    borderRadius: "8px",
                    border: "1px dashed #cbd5e1",
                    color: "#64748b",
                    fontSize: "13px",
                  }}
                >
                  <div style={{ fontSize: "28px", marginBottom: "6px" }}>🔍</div>
                  <b>{language === "hi" ? "आपके चयनित मानदंडों से कोई रिपोर्ट मेल नहीं खाती।" : "No reports found matching your selected criteria."}</b>
                  <p style={{ margin: "4px 0 0", fontSize: "12px" }}>
                    Try switching between "All Reports" and "Alert Reports", or clearing the distance/status filters.
                  </p>
                </div>
              ) : (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(310px, 1fr))",
                    gap: "14px",
                  }}
                >
                  {filteredDashboardReports.map((report) => {
                    const issueId = report.issue_id || report.id;
                    const userLat = currentUser?.latitude || 19.076;
                    const userLng = currentUser?.longitude || 72.8777;
                    const repLat = report.latitude || report.issue_lat;
                    const repLng = report.longitude || report.issue_lng;
                    const dist = report.distance_km !== undefined && report.distance_km !== null
                      ? Number(report.distance_km)
                      : getDistanceKm(userLat, userLng, repLat, repLng);
                    const isRead = report.is_read !== undefined ? report.is_read : true;
                    const trackingId = report.tracking_id || "CW-REPORT";
                    const status = report.status || "Pending";

                    return (
                      <div
                        key={`${dashboardTab}-${report.id}`}
                        onClick={() => {
                          if (report.is_read === false) markNotificationRead(report.id);
                          handleOpenGlobalIssue({
                            id: issueId,
                            tracking_id: trackingId,
                            title: report.title,
                            description: report.description || report.message,
                            category: report.category,
                            status: status,
                            department: report.department,
                            city: report.city,
                            block: report.block,
                            latitude: repLat,
                            longitude: repLng,
                            photo_url: report.photo_url,
                            upvotes_count: report.upvotes_count,
                            downvotes_count: report.downvotes_count,
                            comments_count: report.comments_count,
                            is_duplicate: report.is_duplicate,
                            is_anonymous: report.is_anonymous,
                            created_at: report.created_at,
                          });
                        }}
                        style={{
                          background: isRead ? "#ffffff" : "#f0fdf4",
                          border: isRead ? "1px solid #e2e8e5" : "1px solid #86efac",
                          borderRadius: "10px",
                          padding: "14px",
                          cursor: "pointer",
                          transition: "all 0.15s ease",
                          display: "flex",
                          flexDirection: "column",
                          justifyContent: "space-between",
                          boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.borderColor = "#082f26")}
                        onMouseLeave={(e) => (e.currentTarget.style.borderColor = isRead ? "#e2e8e5" : "#86efac")}
                      >
                        <div>
                          {/* Top Row: Category, Distance, Status Badge */}
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px", flexWrap: "wrap", gap: "6px" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                              <span
                                style={{
                                  fontSize: "10px",
                                  fontWeight: "800",
                                  textTransform: "uppercase",
                                  padding: "2px 7px",
                                  borderRadius: "4px",
                                  background: "#ecfdf5",
                                  color: "#065f46",
                                }}
                              >
                                {translateCategory(report.category, language) || (language === "hi" ? "नागरिक" : "Civic")}
                              </span>
                              {dist !== null && (
                                <span style={{ fontSize: "11px", fontWeight: "700", color: "#0b3d2e", background: "#f0fdf4", border: "1px solid #bbf7d0", padding: "1px 6px", borderRadius: "4px" }}>
                                  📍 {dist} km
                                </span>
                              )}
                            </div>
                            <span className={`cw-badge ${String(status).toLowerCase().replace(/\s+/g, "-")}`} style={{ fontSize: "10px", padding: "2px 7px", borderRadius: "8px" }}>
                              {translateStatus(status, language)}
                            </span>
                          </div>

                          {/* Title & Description */}
                          <div style={{ fontSize: "14px", fontWeight: "700", color: "#0f172a", marginBottom: "4px", lineHeight: "1.3" }}>
                            {report.title}
                          </div>
                          <p style={{ margin: "0 0 8px", fontSize: "12px", color: "#475569", lineHeight: "1.4", maxHeight: "40px", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {report.description || report.message || "No detailed description provided."}
                          </p>

                          {/* Location & Tracking ID */}
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "11px", color: "#64748b", marginBottom: "10px" }}>
                            <span>{[report.block, report.city].filter(Boolean).join(", ") || "City Area"}</span>
                            <span style={{ fontFamily: "monospace", fontWeight: "700", color: "#082f26" }}>
                              {trackingId}
                            </span>
                          </div>
                        </div>

                        {/* Bottom Card Actions: Voting & Comments */}
                        <div
                          style={{
                            paddingTop: "8px",
                            borderTop: "1px solid #f1f5f9",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: "8px",
                            flexWrap: "wrap",
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                            <button
                              type="button"
                              onClick={async (e) => {
                                e.stopPropagation();
                                if (!currentUser?.id || !issueId) return;
                                try {
                                  const res = await axios.post(`${API}/issues/${issueId}/vote`, {
                                    userId: currentUser.id,
                                    voteType: "upvote",
                                  });
                                  const updateItem = (item) => {
                                    const id = item.issue_id || item.id;
                                    return id === issueId
                                      ? { ...item, upvotes_count: res.data.upvotes_count, downvotes_count: res.data.downvotes_count, userVote: res.data.userVote }
                                      : item;
                                  };
                                  setGlobalIssues((prev) => prev.map(updateItem));
                                  setNotifications((prev) => prev.map(updateItem));
                                } catch (err) {
                                  console.error("Vote error:", err);
                                }
                              }}
                              style={{
                                background: report.userVote === "upvote" ? "#dcfce7" : "#ffffff",
                                border: report.userVote === "upvote" ? "1px solid #16a34a" : "1px solid #cbd5e1",
                                color: report.userVote === "upvote" ? "#15803d" : "#334155",
                                borderRadius: "6px",
                                padding: "4px 8px",
                                fontSize: "11px",
                                fontWeight: "700",
                                cursor: "pointer",
                                display: "flex",
                                alignItems: "center",
                                gap: "4px",
                              }}
                              title="Verify Issue (Upvote)"
                            >
                              <span>👍</span> {report.upvotes_count || 0}
                            </button>

                            <button
                              type="button"
                              onClick={async (e) => {
                                e.stopPropagation();
                                if (!currentUser?.id || !issueId) return;
                                try {
                                  const res = await axios.post(`${API}/issues/${issueId}/vote`, {
                                    userId: currentUser.id,
                                    voteType: "downvote",
                                  });
                                  const updateItem = (item) => {
                                    const id = item.issue_id || item.id;
                                    return id === issueId
                                      ? { ...item, upvotes_count: res.data.upvotes_count, downvotes_count: res.data.downvotes_count, userVote: res.data.userVote }
                                      : item;
                                  };
                                  setGlobalIssues((prev) => prev.map(updateItem));
                                  setNotifications((prev) => prev.map(updateItem));
                                } catch (err) {
                                  console.error("Vote error:", err);
                                }
                              }}
                              style={{
                                background: report.userVote === "downvote" ? "#fee2e2" : "#ffffff",
                                border: report.userVote === "downvote" ? "1px solid #dc2626" : "1px solid #cbd5e1",
                                color: report.userVote === "downvote" ? "#b91c1c" : "#334155",
                                borderRadius: "6px",
                                padding: "4px 8px",
                                fontSize: "11px",
                                fontWeight: "700",
                                cursor: "pointer",
                                display: "flex",
                                alignItems: "center",
                                gap: "4px",
                              }}
                              title="Flag Issue (Downvote)"
                            >
                              <span>👎</span> {report.downvotes_count || 0}
                            </button>

                            <span
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "4px",
                                fontSize: "11px",
                                color: "#475569",
                                padding: "4px 6px",
                                borderRadius: "4px",
                                background: "#f8fafc",
                              }}
                            >
                              <span>💬</span> {report.comments_count || 0}
                            </span>
                          </div>

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (report.is_read === false) markNotificationRead(report.id);
                              handleOpenGlobalIssue({
                                id: issueId,
                                tracking_id: trackingId,
                                title: report.title,
                                description: report.description || report.message,
                                category: report.category,
                                status: status,
                                department: report.department,
                                city: report.city,
                                block: report.block,
                                latitude: repLat,
                                longitude: repLng,
                                photo_url: report.photo_url,
                                upvotes_count: report.upvotes_count,
                                downvotes_count: report.downvotes_count,
                                comments_count: report.comments_count,
                                is_duplicate: report.is_duplicate,
                                is_anonymous: report.is_anonymous,
                                created_at: report.created_at,
                              });
                            }}
                            style={{
                              background: "#082f26",
                              color: "white",
                              border: "none",
                              borderRadius: "5px",
                              padding: "5px 10px",
                              fontSize: "11px",
                              fontWeight: "700",
                              cursor: "pointer",
                            }}
                          >
                            {t("view")} →
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Civic Advisory & Information Cards */}
            <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: "20px", marginTop: "16px" }}>
              {/* Municipal Advisory Card */}
              <div style={{ background: "white", borderRadius: "10px", border: "1px solid #e2e8e5", padding: "18px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                  <span style={{ fontSize: "18px" }}>📢</span>
                  <h3 style={{ margin: 0, fontSize: "14px", color: "#0b3d2e" }}>{t("civicNoticeBoard")}</h3>
                </div>
                <div style={{ fontSize: "12px", color: "#475569", lineHeight: "1.5" }}>
                  <div style={{ padding: "8px 0", borderBottom: "1px solid #f1f5f9" }}>
                    <b>{t("notice1Title")}:</b> {t("notice1Desc")}
                  </div>
                  <div style={{ padding: "8px 0", borderBottom: "1px solid #f1f5f9" }}>
                    <b>{t("notice2Title")}:</b> {t("notice2Desc")}
                  </div>
                  <div style={{ padding: "8px 0" }}>
                    <b>{t("notice3Title")}:</b> {t("notice3Desc")}
                  </div>
                </div>
              </div>

              {/* Identity Protection Status Card */}
              <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: "10px", padding: "18px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                  <span style={{ fontSize: "18px" }}>🛡️</span>
                  <strong style={{ color: "#065f46", fontSize: "13px" }}>{language === "hi" ? "पहचान सुरक्षा सक्रिय" : "Identity Guard Active"}</strong>
                </div>
                <p style={{ margin: 0, fontSize: "12px", color: "#166534", lineHeight: "1.4" }}>
                  {language === "hi" ? "जब गुमनाम रिपोर्टिंग चालू होती है, तो आपकी पहचान सार्वजनिक मानचित्रों और सरकारी अधिकारी कंसोल से पूरी तरह सुरक्षित रहती है।" : "When anonymous reporting is toggled ON, your identity is cryptographically isolated from public maps and municipal officer consoles."}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ==================================================== */}
        {/* PAGE 2: REPORT A PROBLEM (15 synchronized fields) */}
        {/* ==================================================== */}
        {activePage === "Report a Problem" && (
          <div className="cw-card" style={{ background: "white", borderRadius: "10px", border: "1px solid #e2e8e5", padding: "24px" }}>
            <div style={{ marginBottom: "20px", borderBottom: "1px solid #f1f5f9", paddingBottom: "14px" }}>
              <h2 style={{ margin: "0 0 6px", fontSize: "18px", color: "#0f172a" }}>{t("reportProblem")}</h2>
              <p style={{ margin: 0, color: "#64748b", fontSize: "13px" }}>
                {t("reportDescription")}
              </p>
            </div>

            <form onSubmit={handleSubmitComplaint} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              {/* Row 1: Title and Category */}
              <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: "16px" }}>
                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: "700", color: "#1e293b", marginBottom: "6px" }}>
                    {t("complaintTitle")} *
                  </label>
                  <input
                    type="text"
                    value={complaint.title}
                    onChange={(e) => setComplaint({ ...complaint, title: e.target.value })}
                    maxLength={200}
                    placeholder={t("complaintTitlePlaceholder")}
                    required
                    style={{ width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "13px" }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: "700", color: "#1e293b", marginBottom: "6px" }}>
                    {t("category")} *
                  </label>
                  <select
                    value={complaint.category}
                    onChange={(e) => setComplaint({ ...complaint, category: e.target.value })}
                    required
                    style={{ width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "13px", background: "white" }}
                  >
                    {CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Row 2: Authority & Photo */}
              <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: "16px" }}>
                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: "700", color: "#1e293b", marginBottom: "6px" }}>
                    {t("forwardAuthority")} *
                  </label>
                  <select
                    value={complaint.authority}
                    onChange={(e) => setComplaint({ ...complaint, authority: e.target.value })}
                    required
                    style={{ width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "13px", background: "white" }}
                  >
                    {AUTHORITIES.map((auth) => (
                      <option key={auth} value={auth}>
                        {auth}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: "700", color: "#1e293b", marginBottom: "6px" }}>
                    {t("uploadPhoto")}
                  </label>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => setComplaintPhoto(e.target.files?.[0] || null)}
                    style={{ width: "100%", padding: "8px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "12px", background: "#f8fafc" }}
                  />
                  {photoPreview && (
                    <div style={{ marginTop: "6px", display: "flex", alignItems: "center", gap: "8px" }}>
                      <img src={photoPreview} alt="Preview" style={{ width: "40px", height: "40px", borderRadius: "4px", objectFit: "cover" }} />
                      <span style={{ fontSize: "11px", color: "#166534", fontWeight: "600" }}>✓ Image attached</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Row 3: Description */}
              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: "700", color: "#1e293b", marginBottom: "6px" }}>
                  {t("description")} *
                </label>
                <textarea
                  value={complaint.description}
                  onChange={(e) => setComplaint({ ...complaint, description: e.target.value })}
                  placeholder={t("descriptionPlaceholder")}
                  rows={3}
                  required
                  style={{ width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "13px", fontFamily: "inherit" }}
                />
              </div>

              {/* Row 4: Geographic Hierarchy (State, City, Block, Pincode) */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1.2fr 0.8fr", gap: "12px" }}>
                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: "700", color: "#1e293b", marginBottom: "4px" }}>
                    {t("state")} *
                  </label>
                  <input
                    type="text"
                    value={complaint.state}
                    onChange={(e) => setComplaint({ ...complaint, state: e.target.value })}
                    required
                    style={{ width: "100%", padding: "9px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "12px" }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: "700", color: "#1e293b", marginBottom: "4px" }}>
                    {t("city")} *
                  </label>
                  <input
                    type="text"
                    value={complaint.city}
                    onChange={(e) => setComplaint({ ...complaint, city: e.target.value })}
                    required
                    style={{ width: "100%", padding: "9px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "12px" }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: "700", color: "#1e293b", marginBottom: "4px" }}>
                    {t("block")} *
                  </label>
                  <input
                    type="text"
                    value={complaint.block}
                    onChange={(e) => setComplaint({ ...complaint, block: e.target.value })}
                    placeholder="e.g. Powai / Ward 5"
                    required
                    style={{ width: "100%", padding: "9px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "12px" }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: "700", color: "#1e293b", marginBottom: "4px" }}>
                    {t("pincode")}
                  </label>
                  <input
                    type="text"
                    value={complaint.pincode}
                    onChange={(e) => setComplaint({ ...complaint, pincode: e.target.value })}
                    maxLength={6}
                    placeholder="400076"
                    style={{ width: "100%", padding: "9px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "12px" }}
                  />
                </div>
              </div>

              {/* Row 5: Map Location Picker */}
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                  <div>
                    <label style={{ fontSize: "12px", fontWeight: "700", color: "#1e293b" }}>
                      {t("chooseLocation")} *
                    </label>
                    <span style={{ fontSize: "11px", color: "#64748b", marginLeft: "8px" }}>
                      {t("locationInstructions")}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={handleUseCurrentLocation}
                    style={{
                      background: "#f1f5f9",
                      border: "1px solid #cbd5e1",
                      borderRadius: "5px",
                      padding: "6px 10px",
                      fontSize: "12px",
                      fontWeight: "600",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "5px",
                    }}
                  >
                    📍 {t("currentLocation")}
                  </button>
                </div>

                <div style={{ height: "260px", width: "100%", borderRadius: "8px", overflow: "hidden", border: "1px solid #cbd5e1" }}>
                  <MapContainer
                    center={[complaint.latitude || 19.076, complaint.longitude || 72.8777]}
                    zoom={14}
                    scrollWheelZoom={false}
                    style={{ height: "100%", width: "100%" }}
                  >
                    <TileLayer
                      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    />
                    <LocationClickHandler
                      onSelect={(pos) => setComplaint((prev) => ({ ...prev, latitude: Number(pos.lat.toFixed(7)), longitude: Number(pos.lng.toFixed(7)) }))}
                    />
                    <LocationMapUpdater position={[complaint.latitude, complaint.longitude]} />
                    <Marker
                      position={[complaint.latitude, complaint.longitude]}
                      draggable={true}
                      eventHandlers={{
                        dragend: (e) => {
                          const p = e.target.getLatLng();
                          setComplaint((prev) => ({ ...prev, latitude: Number(p.lat.toFixed(7)), longitude: Number(p.lng.toFixed(7)) }));
                        },
                      }}
                    >
                      <Popup>{language === "hi" ? "चयनित शिकायत स्थान" : "Selected complaint spot"}</Popup>
                    </Marker>
                  </MapContainer>
                </div>

                <div style={{ display: "flex", gap: "16px", marginTop: "6px", fontSize: "11px", color: "#475569" }}>
                  <span><b>Lat:</b> {complaint.latitude}</span>
                  <span><b>Lng:</b> {complaint.longitude}</span>
                </div>
              </div>

              {/* Row 6: Anonymous Reporting Toggle Card */}
              <div
                style={{
                  background: complaint.isAnonymous ? "#ecfdf5" : "#f8fafc",
                  border: `1px solid ${complaint.isAnonymous ? "#6ee7b7" : "#e2e8f0"}`,
                  borderRadius: "8px",
                  padding: "14px 16px",
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "12px",
                  transition: "all 0.2s",
                }}
              >
                <input
                  type="checkbox"
                  id="userAnonymousCheckbox"
                  checked={complaint.isAnonymous}
                  onChange={(e) => setComplaint({ ...complaint, isAnonymous: e.target.checked })}
                  style={{ width: "18px", height: "18px", marginTop: "2px", accentColor: "#0b3d2e", cursor: "pointer" }}
                />
                <label htmlFor="userAnonymousCheckbox" style={{ cursor: "pointer" }}>
                  <div style={{ fontWeight: "700", fontSize: "13px", color: "#065f46", display: "flex", alignItems: "center", gap: "6px" }}>
                    🛡️ {t("anonymousReportTitle")}
                  </div>
                  <p style={{ margin: "4px 0 0", fontSize: "12px", color: "#334155", lineHeight: "1.4" }}>
                    {t("anonymousHelpLogged")}
                  </p>
                </label>
              </div>

              {/* Submit Button */}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "6px" }}>
                <button
                  type="button"
                  onClick={() => switchTab("My Reports")}
                  style={{ padding: "10px 18px", borderRadius: "6px", border: "1px solid #cbd5e1", background: "#f8fafc", cursor: "pointer", fontWeight: "600" }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  style={{
                    padding: "10px 24px",
                    borderRadius: "6px",
                    border: "none",
                    background: "#0b3d2e",
                    color: "white",
                    fontWeight: "700",
                    fontSize: "13px",
                    cursor: submitting ? "not-allowed" : "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                  }}
                >
                  {submitting ? t("submitting") : `${t("submitComplaint")} →`}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* ==================================================== */}
        {/* PAGE 3: MY REPORTS (Table view like Admin Complaints) */}
        {/* ==================================================== */}
        {activePage === "My Reports" && (
          <div className="cw-card" style={{ background: "white", borderRadius: "10px", border: "1px solid #e2e8e5", padding: "18px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px", marginBottom: "16px" }}>
              <div>
                <h2 style={{ margin: "0 0 4px", fontSize: "16px", color: "#0f172a" }}>{language === "hi" ? "सभी दर्ज शिकायतें" : "All Submitted Complaints"}</h2>
                <span style={{ fontSize: "12px", color: "#64748b" }}>
                  Showing {filteredIssues.length} of {issues.length} complaints
                </span>
              </div>
              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  onClick={handleExportCSV}
                  style={{ padding: "6px 12px", borderRadius: "6px", border: "1px solid #cbd5e1", background: "white", fontSize: "12px", fontWeight: "600", cursor: "pointer" }}
                >
                  📥 Export CSV
                </button>
                <button
                  onClick={() => switchTab("Report a Problem")}
                  style={{ padding: "6px 14px", borderRadius: "6px", border: "none", background: "#0b3d2e", color: "white", fontSize: "12px", fontWeight: "700", cursor: "pointer" }}
                >
                  + {t("reportProblem")}
                </button>
              </div>
            </div>

            {/* Filter Bar - Exactly like AdminDashboard */}
            <div
              className="cw-filter-bar"
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "10px",
                alignItems: "center",
                background: "#f8fafc",
                padding: "12px",
                borderRadius: "8px",
                border: "1px solid #e2e8f0",
                marginBottom: "16px",
              }}
            >
              <input
                type="text"
                placeholder={language === "hi" ? "समस्या शीर्षक, ट्रैकिंग आईडी, क्षेत्र खोजें..." : "Search issue title, tracking ID, area..."}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={{ flex: 1, minWidth: "220px", padding: "8px 12px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "12px" }}
              />

              <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                <span style={{ fontSize: "11px", fontWeight: "600", color: "#64748b" }}>Status:</span>
                {["All", "Pending", "In Progress", "Resolved"].map((s) => (
                  <button
                    key={s}
                    onClick={() => setStatusFilter(s)}
                    style={{
                      padding: "5px 10px",
                      borderRadius: "6px",
                      fontSize: "11px",
                      fontWeight: "600",
                      cursor: "pointer",
                      border: statusFilter === s ? "1px solid #0b3d2e" : "1px solid #cbd5e1",
                      background: statusFilter === s ? "#0b3d2e" : "white",
                      color: statusFilter === s ? "white" : "#334155",
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>

              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                style={{ padding: "8px 10px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "12px", background: "white" }}
              >
                <option value="All">{language === "hi" ? "सभी श्रेणियां" : "All Categories"}</option>
                {CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>

              <select
                value={privacyFilter}
                onChange={(e) => setPrivacyFilter(e.target.value)}
                style={{ padding: "8px 10px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "12px", background: "white" }}
              >
                <option value="All">{language === "hi" ? "सभी गोपनीयता" : "All Privacy"}</option>
                <option value="Anonymous">🛡️ Anonymous Only</option>
                <option value="Registered">✓ Registered Only</option>
              </select>
            </div>

            {/* Reports Table */}
            {filteredIssues.length === 0 ? (
              <div style={{ textAlign: "center", padding: "40px", color: "#64748b" }}>
                <p style={{ margin: "0 0 10px", fontSize: "14px" }}>{language === "hi" ? "चयनित फ़िल्टर मानदंडों से कोई शिकायत मेल नहीं खाती।" : "No complaints match the selected filter criteria."}</p>
                <button
                  onClick={() => {
                    setSearchTerm("");
                    setStatusFilter("All");
                    setCategoryFilter("All");
                    setPrivacyFilter("All");
                  }}
                  style={{ padding: "6px 12px", background: "#f1f5f9", border: "1px solid #cbd5e1", borderRadius: "5px", cursor: "pointer", fontSize: "12px" }}
                >
                  Reset Filters
                </button>
              </div>
            ) : (
              <div className="cw-table-wrapper" style={{ overflowX: "auto" }}>
                <table className="cw-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                  <thead>
                    <tr style={{ background: "#f8fafc", textAlign: "left", borderBottom: "1px solid #e2e8e5" }}>
                      <th style={{ padding: "10px" }}>{t("trackingId")}</th>
                      <th style={{ padding: "10px" }}>{language === "hi" ? "फोटो" : "Photo"}</th>
                      <th style={{ padding: "10px" }}>{language === "hi" ? "शीर्षक और स्थान" : "Title & Location"}</th>
                      <th style={{ padding: "10px" }}>{t("department")}</th>
                      <th style={{ padding: "10px" }}>{t("date")}</th>
                      <th style={{ padding: "10px" }}>{t("status")}</th>
                      <th style={{ padding: "10px" }}>{language === "hi" ? "गोपनीयता" : "Privacy"}</th>
                      <th style={{ padding: "10px" }}>{t("action")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredIssues.map((issue) => (
                      <tr key={issue.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                        <td style={{ padding: "10px", fontFamily: "monospace", fontWeight: "700", color: "#0b3d2e" }}>
                          {issue.tracking_id}
                        </td>
                        <td style={{ padding: "10px" }}>
                          {issue.photo_url ? (
                            <img
                              src={issue.photo_url.startsWith("http") ? issue.photo_url : `http://localhost:5001${issue.photo_url}`}
                              alt="Proof"
                              onClick={() => setSelectedIssue(issue)}
                              style={{ width: "36px", height: "36px", borderRadius: "4px", objectFit: "cover", cursor: "pointer", border: "1px solid #cbd5e1" }}
                            />
                          ) : (
                            <span style={{ color: "#94a3b8", fontSize: "10px" }}>{language === "hi" ? "कोई फोटो नहीं" : "No photo"}</span>
                          )}
                        </td>
                        <td style={{ padding: "10px", maxWidth: "260px" }}>
                          <div style={{ fontWeight: "700", color: "#0f172a" }}>{issue.title}</div>
                          <div style={{ fontSize: "11px", color: "#64748b", marginTop: "2px" }}>
                            📍 {[issue.block, issue.city].filter(Boolean).join(", ")} {issue.pincode ? `(${issue.pincode})` : ""}
                          </div>
                        </td>
                        <td style={{ padding: "10px", color: "#334155", maxWidth: "160px" }}>
                          {issue.department}
                        </td>
                        <td style={{ padding: "10px", color: "#64748b", whiteSpace: "nowrap" }}>
                          {formatDate(issue.created_at)}
                        </td>
                        <td style={{ padding: "10px" }}>
                          <span className={`cw-badge ${String(issue.status || "pending").toLowerCase().replace(/\s+/g, "-")}`}>
                            {issue.status}
                          </span>
                        </td>
                        <td style={{ padding: "10px" }}>
                          {issue.is_anonymous ? (
                            <span
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "4px",
                                background: "#ecfdf5",
                                color: "#065f46",
                                border: "1px solid #a7f3d0",
                                padding: "2px 7px",
                                borderRadius: "12px",
                                fontSize: "10px",
                                fontWeight: "700",
                              }}
                              title="Your name is hidden from admin consoles"
                            >
                              🛡️ Anonymous
                            </span>
                          ) : (
                            <span style={{ color: "#64748b", fontSize: "11px" }}>✓ Registered</span>
                          )}
                        </td>
                        <td style={{ padding: "10px", whiteSpace: "nowrap" }}>
                          <div style={{ display: "flex", gap: "6px" }}>
                            <button
                              onClick={() => setSelectedIssue(issue)}
                              style={{ padding: "4px 8px", background: "#f1f5f9", border: "1px solid #cbd5e1", borderRadius: "4px", cursor: "pointer", fontSize: "11px", fontWeight: "600" }}
                            >
                              View
                            </button>
                            {String(issue.status).toLowerCase() === "pending" && (
                              <button
                                onClick={() => handleCancelIssue(issue.id)}
                                title="Withdraw this pending complaint"
                                style={{ padding: "4px 8px", background: "#fef2f2", color: "#b91c1c", border: "1px solid #fecaca", borderRadius: "4px", cursor: "pointer", fontSize: "11px", fontWeight: "600" }}
                              >
                                Cancel
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ==================================================== */}
        {/* PAGE 4: MY LOCATIONS */}
        {/* ==================================================== */}
        {activePage === "My Locations" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
              {/* Saved Locations List */}
              <div className="cw-card" style={{ background: "white", borderRadius: "10px", border: "1px solid #e2e8e5", padding: "20px" }}>
                <h3 style={{ margin: "0 0 6px", fontSize: "16px", color: "#0f172a" }}>{t("savedLocations")}</h3>
                <p style={{ margin: "0 0 16px", fontSize: "12px", color: "#64748b" }}>
                  {t("savedLocationsSubtitle")}
                </p>

                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  {savedLocations.map((loc) => (
                    <div
                      key={loc.id}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        padding: "12px 14px",
                        background: "#f8fafc",
                        border: "1px solid #e2e8f0",
                        borderRadius: "8px",
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: "700", color: "#0b3d2e", fontSize: "13px" }}>
                          📍 {loc.name}
                        </div>
                        <div style={{ fontSize: "11px", color: "#64748b", marginTop: "2px" }}>
                          {loc.area}, {loc.city} ({loc.pincode})
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: "6px" }}>
                        <button
                          onClick={() => handleQuickReportAtLocation(loc)}
                          style={{
                            padding: "5px 10px",
                            background: "#0b3d2e",
                            color: "white",
                            border: "none",
                            borderRadius: "5px",
                            fontSize: "11px",
                            fontWeight: "600",
                            cursor: "pointer",
                          }}
                        >
                          Report Here
                        </button>
                        <button
                          onClick={() => handleDeleteLocation(loc.id)}
                          style={{
                            padding: "5px 8px",
                            background: "white",
                            color: "#b91c1c",
                            border: "1px solid #fecaca",
                            borderRadius: "5px",
                            fontSize: "11px",
                            cursor: "pointer",
                          }}
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Add New Saved Location */}
              <div className="cw-card" style={{ background: "white", borderRadius: "10px", border: "1px solid #e2e8e5", padding: "20px" }}>
                <h3 style={{ margin: "0 0 6px", fontSize: "16px", color: "#0f172a" }}>{language === "hi" ? "पसंदीदा स्थान जोड़ें" : "Add a Favorite Place"}</h3>
                <p style={{ margin: "0 0 16px", fontSize: "12px", color: "#64748b" }}>
                  Quickly bookmark a locality to populate complaint addresses automatically.
                </p>

                <form onSubmit={handleAddLocation} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  <div>
                    <label style={{ display: "block", fontSize: "11px", fontWeight: "700", marginBottom: "4px" }}>
                      Label Name *
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. My Gym / Kids School"
                      value={newLocation.name}
                      onChange={(e) => setNewLocation({ ...newLocation, name: e.target.value })}
                      required
                      style={{ width: "100%", padding: "8px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "12px" }}
                    />
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                    <div>
                      <label style={{ display: "block", fontSize: "11px", fontWeight: "700", marginBottom: "4px" }}>
                        Area / Ward *
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. Powai / Andheri East"
                        value={newLocation.area}
                        onChange={(e) => setNewLocation({ ...newLocation, area: e.target.value })}
                        required
                        style={{ width: "100%", padding: "8px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "12px" }}
                      />
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: "11px", fontWeight: "700", marginBottom: "4px" }}>
                        Pincode
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. 400076"
                        value={newLocation.pincode}
                        onChange={(e) => setNewLocation({ ...newLocation, pincode: e.target.value })}
                        maxLength={6}
                        style={{ width: "100%", padding: "8px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "12px" }}
                      />
                    </div>
                  </div>
                  <button
                    type="submit"
                    style={{
                      background: "#0b3d2e",
                      color: "white",
                      border: "none",
                      borderRadius: "6px",
                      padding: "9px",
                      fontWeight: "700",
                      fontSize: "12px",
                      cursor: "pointer",
                      marginTop: "6px",
                    }}
                  >
                    + Save Location
                  </button>
                </form>
              </div>
            </div>

            {/* Interactive Map of Reported Issues */}
            <div className="cw-card" style={{ background: "white", borderRadius: "10px", border: "1px solid #e2e8e5", padding: "20px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px", flexWrap: "wrap", gap: "10px" }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: "15px", color: "#0f172a" }}>{language === "hi" ? "आपकी दर्ज समस्याओं का नक्शा" : "Your Reported Issues Map"}</h3>
                  <span style={{ fontSize: "12px", color: "#64748b" }}>{language === "hi" ? "आपकी दर्ज समस्याओं और पड़ोस के लाइव पिन" : "Live geocoded pins for your submitted issues & neighborhood"}</span>
                </div>
                <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                  <button
                    onClick={() => switchTab("Global Map")}
                    style={{
                      background: "#082f26",
                      color: "white",
                      border: "none",
                      borderRadius: "6px",
                      padding: "6px 12px",
                      fontSize: "11px",
                      fontWeight: "700",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                    }}
                  >
                    <span>🗺️</span> Open Full Global Map →
                  </button>
                  <div style={{ display: "flex", gap: "8px", fontSize: "11px" }}>
                    <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                      <span style={{ width: "9px", height: "9px", borderRadius: "50%", background: "#f59e0b" }}></span> Pending
                    </span>
                    <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                      <span style={{ width: "9px", height: "9px", borderRadius: "50%", background: "#2563eb" }}></span> In Progress
                    </span>
                    <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                      <span style={{ width: "9px", height: "9px", borderRadius: "50%", background: "#16a34a" }}></span> Resolved
                    </span>
                  </div>
                </div>
              </div>

              <div style={{ height: "350px", width: "100%", borderRadius: "8px", overflow: "hidden", border: "1px solid #e2e8e5" }}>
                <MapContainer center={[19.076, 72.8777]} zoom={12} scrollWheelZoom={true} style={{ height: "100%", width: "100%" }}>
                  <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                  {issues
                    .filter((i) => i.latitude && i.longitude)
                    .map((item) => (
                      <Marker
                        key={item.id}
                        position={[Number(item.latitude), Number(item.longitude)]}
                      >
                        <Popup>
                          <div className="issue-popup" style={{ minWidth: "200px", maxWidth: "270px" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                              <span style={{ fontSize: "11px", fontWeight: "700", color: "#065f46" }}>{item.category || "Issue"}</span>
                              <span className={`cw-badge ${String(item.status || "pending").toLowerCase().replace(/\s+/g, "-")}`} style={{ fontSize: "9px", padding: "1px 6px" }}>
                                {item.status}
                              </span>
                            </div>
                            <strong style={{ fontSize: "13px", color: "#0f172a", display: "block", marginBottom: "4px" }}>{item.title}</strong>
                            <p style={{ margin: "0 0 6px", fontSize: "11px", color: "#475569", maxHeight: "36px", overflow: "hidden" }}>
                              {item.description}
                            </p>
                            <div style={{ fontSize: "10px", color: "#64748b", marginBottom: "6px" }}>ID: {item.tracking_id}</div>
                            <button
                              type="button"
                              className="map-popup-btn"
                              onClick={() => handleOpenGlobalIssue(item)}
                            >
                              <span>🔍</span> View Full Report & Discuss →
                            </button>
                          </div>
                        </Popup>
                      </Marker>
                    ))}
                </MapContainer>
              </div>
            </div>
          </div>
        )}

        {/* ==================================================== */}
        {/* PAGE: GLOBAL MAP (ALL PUBLIC ISSUES) */}
        {/* ==================================================== */}
        {activePage === "Global Map" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <div className="cw-card" style={{ background: "white", borderRadius: "10px", border: "1px solid #e2e8e5", padding: "20px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "14px", flexWrap: "wrap", gap: "10px" }}>
                <div>
                  <h2 style={{ margin: "0 0 4px", fontSize: "22px", color: "#0f172a", fontWeight: "800" }}>
                    Public Issue Map
                  </h2>
                  <p style={{ margin: 0, fontSize: "13px", color: "#64748b" }}>
                    Explore public map
                  </p>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <span style={{ fontSize: "12px", background: "#f0fdf4", color: "#166534", border: "1px solid #bbf7d0", padding: "5px 12px", borderRadius: "6px", fontWeight: "700" }}>
                    📍 {mappedGlobalIssues.length} Mapped Reports
                  </span>
                  <button
                    onClick={loadGlobalIssues}
                    disabled={globalLoading}
                    style={{
                      background: "#082f26",
                      color: "white",
                      border: "none",
                      borderRadius: "6px",
                      padding: "7px 15px",
                      fontSize: "12px",
                      fontWeight: "700",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                    }}
                  >
                    ↻ {globalLoading ? "Refreshing..." : "Refresh Map"}
                  </button>
                </div>
              </div>

              {/* Leaflet Global Map Container */}
              <div style={{ height: "560px", width: "100%", borderRadius: "10px", overflow: "hidden", border: "1px solid #cbd5e1", position: "relative" }}>
                <MapContainer
                  center={[19.076, 72.8777]}
                  zoom={12}
                  minZoom={4}
                  maxZoom={19}
                  scrollWheelZoom={true}
                  style={{ height: "100%", width: "100%" }}
                >
                  <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    maxZoom={19}
                  />
                  <GlobalMapViewport points={globalPoints} />
                  {mappedGlobalIssues.map((issue) => (
                    <Marker
                      key={issue.id}
                      position={[Number(issue.latitude), Number(issue.longitude)]}
                    >
                      <Popup>
                        <div className="issue-popup" style={{ minWidth: "210px", maxWidth: "280px" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px", flexWrap: "wrap", gap: "4px" }}>
                            <span style={{ fontSize: "11px", fontWeight: "800", textTransform: "uppercase", color: "#065f46", letterSpacing: "0.5px" }}>
                              {issue.category || "Civic Issue"}
                            </span>
                            <span
                              className={`cw-badge ${String(issue.status || "pending").toLowerCase().replace(/\s+/g, "-")}`}
                              style={{ fontSize: "10px", padding: "2px 7px", borderRadius: "10px" }}
                            >
                              {issue.status || "Pending"}
                            </span>
                          </div>

                          <h4 style={{ margin: "2px 0 6px", fontSize: "14px", fontWeight: "700", color: "#0f172a", lineHeight: "1.3" }}>
                            {issue.title || issue.category || "Reported Issue"}
                          </h4>

                          <p style={{ margin: "0 0 8px", fontSize: "12px", color: "#475569", lineHeight: "1.4", maxHeight: "42px", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {issue.description || "No description provided."}
                          </p>

                          <div style={{ display: "flex", gap: "6px", alignItems: "center", marginBottom: "8px", flexWrap: "wrap" }}>
                            <span style={{ fontSize: "11px", background: "#f0fdf4", color: "#166534", border: "1px solid #bbf7d0", padding: "2px 6px", borderRadius: "4px", fontWeight: "700" }}>
                              👍 {issue.upvotes_count || 0}
                            </span>
                            <span style={{ fontSize: "11px", background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca", padding: "2px 6px", borderRadius: "4px", fontWeight: "700" }}>
                              👎 {issue.downvotes_count || 0}
                            </span>
                            <span style={{ fontSize: "11px", background: "#f8fafc", color: "#475569", border: "1px solid #e2e8f0", padding: "2px 6px", borderRadius: "4px", fontWeight: "600" }}>
                              💬 {issue.comments_count || 0}
                            </span>
                          </div>

                          {issue.tracking_id && (
                            <div style={{ fontSize: "11px", color: "#64748b", marginBottom: "8px", fontFamily: "monospace" }}>
                              <b>Tracking ID:</b> {issue.tracking_id}
                            </div>
                          )}

                          <button
                            type="button"
                            className="map-popup-btn"
                            onClick={() => handleOpenGlobalIssue(issue)}
                          >
                            <span>🔍</span> View Full Report, Vote & Discuss →
                          </button>
                        </div>
                      </Popup>
                    </Marker>
                  ))}
                </MapContainer>
              </div>

              {/* Map Footer Summary */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "14px", flexWrap: "wrap", gap: "10px", fontSize: "12px", color: "#64748b" }}>
                <div>
                  Showing <b>{mappedGlobalIssues.length}</b> live civic reports across Mumbai & India.
                </div>
                <div style={{ display: "flex", gap: "14px" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                    <span style={{ width: "9px", height: "9px", borderRadius: "50%", background: "#f59e0b" }}></span> Pending
                  </span>
                  <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                    <span style={{ width: "9px", height: "9px", borderRadius: "50%", background: "#2563eb" }}></span> In Progress
                  </span>
                  <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                    <span style={{ width: "9px", height: "9px", borderRadius: "50%", background: "#16a34a" }}></span> Resolved
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ==================================================== */}
        {/* PAGE 5: PROFILE & SETTINGS */}
        {/* ==================================================== */}
        {activePage === "Profile & Settings" && (
          <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: "20px" }}>
            {/* Personal Details Form */}
            <div className="cw-card" style={{ background: "white", borderRadius: "10px", border: "1px solid #e2e8e5", padding: "20px" }}>
              <h3 style={{ margin: "0 0 6px", fontSize: "16px", color: "#0f172a" }}>{t("profileSettings")}</h3>
              <p style={{ margin: "0 0 16px", fontSize: "12px", color: "#64748b" }}>
                Update your contact details and default municipal jurisdiction.
              </p>

              <form onSubmit={handleUpdateProfile} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <div>
                  <label style={{ display: "block", fontSize: "11px", fontWeight: "700", marginBottom: "4px" }}>
                    {t("fullName")} *
                  </label>
                  <input
                    type="text"
                    value={profileForm.name}
                    onChange={(e) => setProfileForm({ ...profileForm, name: e.target.value })}
                    required
                    style={{ width: "100%", padding: "8px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "12px" }}
                  />
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                  <div>
                    <label style={{ display: "block", fontSize: "11px", fontWeight: "700", marginBottom: "4px" }}>
                      {t("email")} ({language === "hi" ? "पंजीकृत" : "Registered"})
                    </label>
                    <input
                      type="email"
                      value={profileForm.email}
                      disabled
                      style={{ width: "100%", padding: "8px", borderRadius: "6px", border: "1px solid #e2e8f0", background: "#f8fafc", fontSize: "12px", color: "#64748b" }}
                    />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: "11px", fontWeight: "700", marginBottom: "4px" }}>
                      {t("mobileNumber")}
                    </label>
                    <input
                      type="text"
                      value={profileForm.mobile}
                      onChange={(e) => setProfileForm({ ...profileForm, mobile: e.target.value })}
                      style={{ width: "100%", padding: "8px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "12px" }}
                    />
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px" }}>
                  <div>
                    <label style={{ display: "block", fontSize: "11px", fontWeight: "700", marginBottom: "4px" }}>
                      {t("gender")}
                    </label>
                    <select
                      value={profileForm.gender}
                      onChange={(e) => setProfileForm({ ...profileForm, gender: e.target.value })}
                      style={{ width: "100%", padding: "8px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "12px", background: "white" }}
                    >
                      <option value="Male">{t("male")}</option>
                      <option value="Female">{t("female")}</option>
                      <option value="Other">{t("other")}</option>
                      <option value="Prefer not to say">{t("preferNotToSay")}</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: "11px", fontWeight: "700", marginBottom: "4px" }}>
                      {t("city")}
                    </label>
                    <input
                      type="text"
                      value={profileForm.city}
                      onChange={(e) => setProfileForm({ ...profileForm, city: e.target.value })}
                      style={{ width: "100%", padding: "8px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "12px" }}
                    />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: "11px", fontWeight: "700", marginBottom: "4px" }}>
                      {t("state")}
                    </label>
                    <input
                      type="text"
                      value={profileForm.state}
                      onChange={(e) => setProfileForm({ ...profileForm, state: e.target.value })}
                      style={{ width: "100%", padding: "8px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "12px" }}
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={profileSaving}
                  style={{
                    background: "#0b3d2e",
                    color: "white",
                    border: "none",
                    borderRadius: "6px",
                    padding: "9px",
                    fontWeight: "700",
                    fontSize: "12px",
                    cursor: "pointer",
                    marginTop: "6px",
                  }}
                >
                  {profileSaving ? t("submitting") : t("saveProfile")}
                </button>

                {/* Part 1: Geolocation Coordinates & Detection */}
                <div style={{ marginTop: "12px", padding: "12px", background: "#f8fafc", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px" }}>
                    <div>
                      <span style={{ fontSize: "11px", fontWeight: "700", color: "#334155", textTransform: "uppercase" }}>
                        📍 Registered GPS Coordinates (10km Radius Base)
                      </span>
                      <div style={{ fontSize: "12px", color: "#0f172a", marginTop: "2px", fontFamily: "monospace" }}>
                        Lat: {currentUser?.latitude || "19.0760"}, Lng: {currentUser?.longitude || "72.8777"}
                      </div>
                      <span style={{ fontSize: "10px", color: "#64748b" }}>
                        Used to calculate 10 km distance when local complaints are broadcast
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        if ("geolocation" in navigator) {
                          navigator.geolocation.getCurrentPosition(
                            async (pos) => {
                              const lat = pos.coords.latitude;
                              const lng = pos.coords.longitude;
                              try {
                                const res = await axios.put(`${API}/user/location/${currentUser.id}`, { latitude: lat, longitude: lng });
                                setCurrentUser(res.data.user);
                                localStorage.setItem("cw_session", JSON.stringify(res.data.user));
                                setSuccess("Base location updated to your GPS coordinates!");
                              } catch {
                                setError("Could not update coordinates on server.");
                              }
                            },
                            () => setError("Location permission denied or unavailable.")
                          );
                        } else {
                          setError("Geolocation is not supported by your browser.");
                        }
                      }}
                      style={{
                        background: "#082f26",
                        color: "white",
                        border: "none",
                        borderRadius: "6px",
                        padding: "7px 12px",
                        fontSize: "11px",
                        fontWeight: "700",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                      }}
                    >
                      <span>📍</span> Detect Current GPS
                    </button>
                  </div>
                </div>
              </form>
            </div>

            {/* Right Column: Security & Privacy Preferences */}
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              {/* Change Password Card */}
              <div className="cw-card" style={{ background: "white", borderRadius: "10px", border: "1px solid #e2e8e5", padding: "20px" }}>
                <h3 style={{ margin: "0 0 6px", fontSize: "16px", color: "#0f172a" }}>{t("changePassword")}</h3>
                <form onSubmit={handleUpdatePassword} style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  <div>
                    <label style={{ display: "block", fontSize: "11px", fontWeight: "700", marginBottom: "4px" }}>
                      {t("currentPassword")} *
                    </label>
                    <input
                      type="password"
                      value={passwordForm.currentPassword}
                      onChange={(e) => setPasswordForm({ ...passwordForm, currentPassword: e.target.value })}
                      required
                      placeholder="••••••••"
                      style={{ width: "100%", padding: "8px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "12px" }}
                    />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: "11px", fontWeight: "700", marginBottom: "4px" }}>
                      {t("newPassword")} *
                    </label>
                    <input
                      type="password"
                      value={passwordForm.newPassword}
                      onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
                      required
                      minLength={8}
                      placeholder="••••••••"
                      style={{ width: "100%", padding: "8px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "12px" }}
                    />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: "11px", fontWeight: "700", marginBottom: "4px" }}>
                      {t("confirmNewPassword")} *
                    </label>
                    <input
                      type="password"
                      value={passwordForm.confirmPassword}
                      onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })}
                      required
                      minLength={8}
                      placeholder="••••••••"
                      style={{ width: "100%", padding: "8px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "12px" }}
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={passwordSaving}
                    style={{
                      background: "#f1f5f9",
                      border: "1px solid #cbd5e1",
                      borderRadius: "6px",
                      padding: "8px",
                      fontWeight: "700",
                      fontSize: "12px",
                      cursor: "pointer",
                      marginTop: "4px",
                    }}
                  >
                    {passwordSaving ? t("submitting") : t("updatePassword")}
                  </button>
                </form>
              </div>

              {/* Privacy Preferences Card */}
              <div className="cw-card" style={{ background: "white", borderRadius: "10px", border: "1px solid #e2e8e5", padding: "18px" }}>
                <h4 style={{ margin: "0 0 10px", fontSize: "13px", color: "#0f172a" }}>{language === "hi" ? "डिफ़ॉल्ट गोपनीयता सेटिंग्स" : "Default Privacy Settings"}</h4>
                <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontSize: "12px" }}>
                  <input
                    type="checkbox"
                    checked={preferences.alwaysAnonymous}
                    onChange={(e) => {
                      const updated = { ...preferences, alwaysAnonymous: e.target.checked };
                      setPreferences(updated);
                      localStorage.setItem(`cw_pref_${currentUser?.id}`, JSON.stringify(updated));
                    }}
                    style={{ accentColor: "#0b3d2e" }}
                  />
                  <span>{language === "hi" ? "हमेशा डिफ़ॉल्ट रूप से \"गुमनाम रिपोर्ट करें\" चुनें" : "Always check \"Report Anonymously\" by default"}</span>
                </label>
              </div>
            </div>
          </div>
        )}

        {/* ==================================================== */}
        {/* PAGE 6: HELP & FAQS */}
        {/* ==================================================== */}
        {activePage === "Help & FAQs" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            {/* Search Header */}
            <div className="cw-card" style={{ background: "white", borderRadius: "10px", border: "1px solid #e2e8e5", padding: "20px" }}>
              <h2 style={{ margin: "0 0 6px", fontSize: "18px", color: "#0f172a" }}>{language === "hi" ? "नागरिक सहायता केंद्र और ज्ञानकोश" : "Citizen Help Center & Knowledge Base"}</h2>
              <p style={{ margin: "0 0 14px", fontSize: "13px", color: "#64748b" }}>
                Answers regarding anonymous reporting, resolution workflows, and municipal department escalations.
              </p>
              <input
                type="text"
                placeholder="Search FAQs (e.g. anonymity, tracking, cancellation, emergency)..."
                value={faqSearch}
                onChange={(e) => setFaqSearch(e.target.value)}
                style={{ width: "100%", padding: "10px 14px", borderRadius: "8px", border: "1px solid #cbd5e1", fontSize: "13px" }}
              />
            </div>

            {/* Accordion FAQ List & Helplines Grid */}
            <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: "20px" }}>
              {/* FAQs Accordion */}
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {filteredFaqs.map((faq, index) => {
                  const isOpen = openFaq === index;
                  return (
                    <div
                      key={index}
                      style={{
                        background: "white",
                        border: "1px solid #e2e8e5",
                        borderRadius: "8px",
                        overflow: "hidden",
                        boxShadow: "0 1px 3px rgba(0,0,0,0.02)",
                      }}
                    >
                      <button
                        onClick={() => setOpenFaq(isOpen ? null : index)}
                        style={{
                          width: "100%",
                          textAlign: "left",
                          padding: "14px 16px",
                          background: isOpen ? "#f8fafc" : "white",
                          border: "none",
                          fontWeight: "700",
                          fontSize: "13px",
                          color: "#0f172a",
                          cursor: "pointer",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                        }}
                      >
                        <span>{faq.q}</span>
                        <span style={{ fontSize: "16px", color: "#64748b" }}>{isOpen ? "−" : "+"}</span>
                      </button>
                      {isOpen && (
                        <div style={{ padding: "14px 16px", borderTop: "1px solid #f1f5f9", fontSize: "13px", color: "#334155", lineHeight: "1.5" }}>
                          {faq.a}
                          <div style={{ marginTop: "8px" }}>
                            <span style={{ background: "#f1f5f9", padding: "2px 8px", borderRadius: "4px", fontSize: "10px", fontWeight: "700", color: "#64748b" }}>
                              {faq.cat}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Emergency Civic Helplines */}
              <div className="cw-card" style={{ background: "white", borderRadius: "10px", border: "1px solid #e2e8e5", padding: "20px" }}>
                <h3 style={{ margin: "0 0 10px", fontSize: "15px", color: "#b91c1c" }}>🚨 Emergency Civic Helplines</h3>
                <p style={{ margin: "0 0 14px", fontSize: "12px", color: "#64748b" }}>
                  Direct emergency dial numbers for Mumbai & Maharashtra state authorities:
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px", fontSize: "12px" }}>
                  <div style={{ padding: "8px 10px", background: "#fef2f2", borderRadius: "6px", display: "flex", justifyContent: "space-between" }}>
                    <span>{language === "hi" ? "आपदा प्रबंधन कक्ष:" : "BMC Disaster Cell:"}</span>
                    <b>1916</b>
                  </div>
                  <div style={{ padding: "8px 10px", background: "#fef2f2", borderRadius: "6px", display: "flex", justifyContent: "space-between" }}>
                    <span>{language === "hi" ? "अग्निशमन विभाग:" : "Fire Department:"}</span>
                    <b>101</b>
                  </div>
                  <div style={{ padding: "8px 10px", background: "#fef2f2", borderRadius: "6px", display: "flex", justifyContent: "space-between" }}>
                    <span>{language === "hi" ? "पुलिस नियंत्रण कक्ष:" : "Police Control Room:"}</span>
                    <b>100</b>
                  </div>
                  <div style={{ padding: "8px 10px", background: "#fef2f2", borderRadius: "6px", display: "flex", justifyContent: "space-between" }}>
                    <span>{language === "hi" ? "यातायात पुलिस हेल्पलाइन:" : "Traffic Police Helpline:"}</span>
                    <b>8454999999</b>
                  </div>
                  <div style={{ padding: "8px 10px", background: "#fef2f2", borderRadius: "6px", display: "flex", justifyContent: "space-between" }}>
                    <span>{language === "hi" ? "चाइल्डलाइन हेल्पलाइन:" : "Childline Helpline:"}</span>
                    <b>1098</b>
                  </div>
                  <div style={{ padding: "8px 10px", background: "#fef2f2", borderRadius: "6px", display: "flex", justifyContent: "space-between" }}>
                    <span>{language === "hi" ? "महिला हेल्पलाइन:" : "Women Helpline:"}</span>
                    <b>1090</b>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ==================================================== */}
        {/* COMPLAINT DETAIL MODAL */}
        {/* ==================================================== */}
        {selectedIssue && (
          <div
            className="cw-modal-overlay"
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: "rgba(15, 23, 42, 0.65)",
              display: "grid",
              placeItems: "center",
              zIndex: 9999,
              padding: "20px",
            }}
            onClick={() => setSelectedIssue(null)}
          >
            <div
              className="cw-modal"
              style={{
                background: "white",
                borderRadius: "12px",
                width: "100%",
                maxWidth: "680px",
                maxHeight: "90vh",
                overflowY: "auto",
                padding: "24px",
                boxShadow: "0 10px 25px rgba(0,0,0,0.2)",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: "1px solid #e2e8f0", paddingBottom: "12px", marginBottom: "16px" }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span style={{ fontFamily: "monospace", fontWeight: "800", color: "#0b3d2e", fontSize: "16px" }}>
                      {selectedIssue.tracking_id}
                    </span>
                    <span className={`cw-badge ${String(selectedIssue.status || "pending").toLowerCase().replace(/\s+/g, "-")}`}>
                      {translateStatus(selectedIssue.status, language)}
                    </span>
                    {selectedIssue.is_anonymous ? (
                      <span style={{ background: "#ecfdf5", color: "#065f46", border: "1px solid #a7f3d0", padding: "2px 8px", borderRadius: "10px", fontSize: "11px", fontWeight: "700" }}>
                        🛡️ Anonymous Submission
                      </span>
                    ) : (
                      <span style={{ fontSize: "11px", color: "#64748b" }}>✓ Registered</span>
                    )}
                  </div>
                  <h3 style={{ margin: "8px 0 0", fontSize: "18px", color: "#0f172a" }}>
                    {selectedIssue.title}
                  </h3>
                </div>
                <button
                  onClick={() => setSelectedIssue(null)}
                  style={{ background: "#f1f5f9", border: "none", borderRadius: "50%", width: "30px", height: "30px", cursor: "pointer", fontSize: "14px" }}
                >
                  ✕
                </button>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "14px", fontSize: "13px" }}>
                <div>
                  <b style={{ color: "#475569", display: "block", marginBottom: "4px" }}>{t("description")}:</b>
                  <p style={{ margin: 0, color: "#1e293b", lineHeight: "1.5", background: "#f8fafc", padding: "10px", borderRadius: "6px" }}>
                    {selectedIssue.description}
                  </p>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", background: "#f8fafc", padding: "12px", borderRadius: "6px" }}>
                  <div>
                    <span style={{ color: "#64748b", fontSize: "11px", display: "block" }}>{t("category")}</span>
                    <b>{translateCategory(selectedIssue.category, language)}</b>
                  </div>
                  <div>
                    <span style={{ color: "#64748b", fontSize: "11px", display: "block" }}>{t("department")}</span>
                    <b>{translateAuthority(selectedIssue.department, language)}</b>
                  </div>
                  <div>
                    <span style={{ color: "#64748b", fontSize: "11px", display: "block" }}>{t("locationLabel")}</span>
                    <b>{[selectedIssue.block, selectedIssue.city, selectedIssue.state].filter(Boolean).join(", ")} {selectedIssue.pincode ? `(${selectedIssue.pincode})` : ""}</b>
                  </div>
                  <div>
                    <span style={{ color: "#64748b", fontSize: "11px", display: "block" }}>{t("dateSubmitted")}</span>
                    <b>{formatDate(selectedIssue.created_at)}</b>
                  </div>
                </div>

                {selectedIssue.photo_url && (
                  <div>
                    <b style={{ color: "#475569", display: "block", marginBottom: "6px" }}>{language === "hi" ? "साक्ष्य फोटो:" : "Evidence Photo:"}</b>
                    <img
                      src={selectedIssue.photo_url.startsWith("http") ? selectedIssue.photo_url : `http://localhost:5001${selectedIssue.photo_url}`}
                      alt="Complaint evidence"
                      style={{ maxHeight: "200px", borderRadius: "8px", border: "1px solid #cbd5e1", objectFit: "cover" }}
                    />
                  </div>
                )}

                {selectedIssue.latitude && selectedIssue.longitude && (
                  <div>
                    <b style={{ color: "#475569", display: "block", marginBottom: "6px" }}>{t("coordinates")}:</b>
                    <span style={{ fontFamily: "monospace", color: "#0b3d2e", fontSize: "12px" }}>
                      Latitude: {selectedIssue.latitude}, Longitude: {selectedIssue.longitude}
                    </span>
                  </div>
                )}

                {/* Part 2 & 3: Community Verification & Citizen Discussion */}
                <div style={{ marginTop: "12px", padding: "14px", background: "#f8fafc", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px", flexWrap: "wrap", gap: "8px" }}>
                    <div>
                      <span style={{ fontSize: "11px", fontWeight: "700", textTransform: "uppercase", color: "#64748b" }}>
                        {t("communityVerification")}
                      </span>
                      <div style={{ fontSize: "13px", fontWeight: "700", color: "#0f172a" }}>
                        {selectedIssue.upvotes_count || 0} {t("citizensVerified")} • {selectedIssue.downvotes_count || 0} {t("citizensFlagged")}
                      </div>
                    </div>
                    {selectedIssue.is_duplicate && (
                      <span style={{ fontSize: "11px", fontWeight: "800", color: "#854d0e", background: "#fef9c3", border: "1px solid #fef08a", padding: "3px 8px", borderRadius: "4px" }}>
                        ⚠️ {t("mergedDuplicateIssue")}
                      </span>
                    )}
                  </div>

                  <div style={{ display: "flex", gap: "10px", marginBottom: "14px" }}>
                    <button
                      type="button"
                      onClick={async () => {
                        if (!currentUser?.id || !selectedIssue?.id) return;
                        try {
                          const res = await axios.post(`${API}/issues/${selectedIssue.id}/vote`, {
                            userId: currentUser.id,
                            voteType: "upvote",
                          });
                          setSelectedIssue((prev) => ({
                            ...prev,
                            upvotes_count: res.data.upvotes_count,
                            downvotes_count: res.data.downvotes_count,
                            userVote: res.data.userVote,
                          }));
                          setGlobalIssues((prevList) =>
                            prevList.map((item) =>
                              item.id === selectedIssue.id
                                ? { ...item, upvotes_count: res.data.upvotes_count, downvotes_count: res.data.downvotes_count }
                                : item
                            )
                          );
                        } catch {
                          alert("Could not register vote.");
                        }
                      }}
                      style={{
                        flex: 1,
                        padding: "8px 12px",
                        borderRadius: "6px",
                        border: selectedIssue.userVote === "upvote" ? "1px solid #16a34a" : "1px solid #cbd5e1",
                        background: selectedIssue.userVote === "upvote" ? "#dcfce7" : "#ffffff",
                        color: selectedIssue.userVote === "upvote" ? "#15803d" : "#334155",
                        fontWeight: "700",
                        fontSize: "12px",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "6px",
                      }}
                    >
                      <span>👍</span> {selectedIssue.userVote === "upvote" ? t("verifiedByYou") : t("verifyIssue")}
                    </button>

                    <button
                      type="button"
                      onClick={async () => {
                        if (!currentUser?.id || !selectedIssue?.id) return;
                        try {
                          const res = await axios.post(`${API}/issues/${selectedIssue.id}/vote`, {
                            userId: currentUser.id,
                            voteType: "downvote",
                          });
                          setSelectedIssue((prev) => ({
                            ...prev,
                            upvotes_count: res.data.upvotes_count,
                            downvotes_count: res.data.downvotes_count,
                            userVote: res.data.userVote,
                          }));
                          setGlobalIssues((prevList) =>
                            prevList.map((item) =>
                              item.id === selectedIssue.id
                                ? { ...item, upvotes_count: res.data.upvotes_count, downvotes_count: res.data.downvotes_count }
                                : item
                            )
                          );
                        } catch {
                          alert("Could not register flag.");
                        }
                      }}
                      style={{
                        flex: 1,
                        padding: "8px 12px",
                        borderRadius: "6px",
                        border: selectedIssue.userVote === "downvote" ? "1px solid #dc2626" : "1px solid #cbd5e1",
                        background: selectedIssue.userVote === "downvote" ? "#fee2e2" : "#ffffff",
                        color: selectedIssue.userVote === "downvote" ? "#b91c1c" : "#334155",
                        fontWeight: "700",
                        fontSize: "12px",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "6px",
                      }}
                    >
                      <span>👎</span> {selectedIssue.userVote === "downvote" ? t("flaggedByYou") : t("flagIssue")}
                    </button>
                  </div>

                  {/* Citizen Discussion Feed */}
                  <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: "12px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                      <span style={{ fontSize: "13px", fontWeight: "700", color: "#0f172a", display: "flex", alignItems: "center", gap: "6px" }}>
                        <span>💬</span> {t("citizenDiscussion")} ({modalComments.length})
                      </span>
                      <span style={{ fontSize: "11px", color: "#64748b" }}>{t("discussionSubtitle")}</span>
                    </div>

                    <div style={{ maxHeight: "200px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "8px", marginBottom: "12px" }}>
                      {modalComments.length === 0 ? (
                        <div style={{ padding: "14px", textAlign: "center", color: "#94a3b8", fontSize: "12px", background: "white", borderRadius: "6px", border: "1px dashed #cbd5e1" }}>
                          {t("noCommentsYet")}
                        </div>
                      ) : (
                        modalComments.map((c) => (
                          <div
                            key={c.id}
                            style={{
                              padding: "8px 10px",
                              background: "white",
                              borderRadius: "6px",
                              border: "1px solid #e2e8f0",
                              display: "flex",
                              gap: "8px",
                              alignItems: "flex-start",
                            }}
                          >
                            <div
                              style={{
                                width: "28px",
                                height: "28px",
                                borderRadius: "50%",
                                background: "#082f26",
                                color: "#a7f3d0",
                                fontWeight: "700",
                                fontSize: "11px",
                                display: "grid",
                                placeItems: "center",
                                flexShrink: 0,
                              }}
                            >
                              {c.user_name ? c.user_name.charAt(0).toUpperCase() : "C"}
                            </div>
                            <div style={{ flex: 1 }}>
                              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                <span style={{ fontSize: "11px", fontWeight: "700", color: "#0f172a" }}>
                                  {c.user_name || "Citizen"}
                                </span>
                                <span style={{ fontSize: "9px", color: "#94a3b8" }}>
                                  {new Date(c.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                </span>
                              </div>
                              <p style={{ margin: "2px 0 0", fontSize: "12px", color: "#334155" }}>
                                {c.comment}
                              </p>
                            </div>
                          </div>
                        ))
                      )}
                    </div>

                    <form onSubmit={handlePostModalComment} style={{ display: "flex", gap: "8px" }}>
                      <input
                        type="text"
                        value={modalCommentText}
                        onChange={(e) => setModalCommentText(e.target.value)}
                        placeholder={language === "hi" ? "ज़मीनी स्थिति या टिप्पणी यहाँ लिखें..." : "Write a comment..."}
                        disabled={modalCommentPosting}
                        style={{
                          flex: 1,
                          padding: "8px 10px",
                          borderRadius: "6px",
                          border: "1px solid #cbd5e1",
                          fontSize: "12px",
                          background: "white",
                        }}
                      />
                      <button
                        type="submit"
                        disabled={!modalCommentText.trim() || modalCommentPosting}
                        style={{
                          background: modalCommentText.trim() ? "#082f26" : "#cbd5e1",
                          color: "white",
                          border: "none",
                          borderRadius: "6px",
                          padding: "6px 14px",
                          fontSize: "12px",
                          fontWeight: "700",
                          cursor: modalCommentText.trim() ? "pointer" : "not-allowed",
                        }}
                      >
                        {modalCommentPosting ? "..." : (language === "hi" ? "भेजें" : "Send")}
                      </button>
                    </form>
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid #e2e8f0", paddingTop: "14px", marginTop: "18px" }}>
                <div>
                  {String(selectedIssue.status).toLowerCase() === "pending" && (
                    <button
                      onClick={() => handleCancelIssue(selectedIssue.id)}
                      style={{ padding: "8px 14px", background: "#fef2f2", color: "#b91c1c", border: "1px solid #fecaca", borderRadius: "6px", fontWeight: "700", cursor: "pointer", fontSize: "12px" }}
                    >
                      {t("withdrawComplaint")}
                    </button>
                  )}
                </div>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button
                    onClick={() => window.print()}
                    style={{ padding: "8px 14px", background: "#f1f5f9", border: "1px solid #cbd5e1", borderRadius: "6px", fontWeight: "600", cursor: "pointer", fontSize: "12px" }}
                  >
                    {language === "hi" ? "🖨️ रसीद प्रिंट करें" : "🖨️ Print Receipt"}
                  </button>
                  <button
                    onClick={() => setSelectedIssue(null)}
                    style={{ padding: "8px 18px", background: "#0b3d2e", color: "white", border: "none", borderRadius: "6px", fontWeight: "700", cursor: "pointer", fontSize: "12px" }}
                  >
                    {t("close")}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
