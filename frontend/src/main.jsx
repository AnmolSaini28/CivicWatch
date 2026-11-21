import React, { useEffect, useMemo, useState } from "react";

import { createRoot } from "react-dom/client";

import axios from "axios";

import {

  MapContainer,

  TileLayer,

  Marker,

  Popup,

  useMap,

  useMapEvents,

} from "react-leaflet";

import "leaflet/dist/leaflet.css";

import "./styles.css";

const API = "http://localhost:5001/api";

// The backend stores user accounts in PostgreSQL.

// This key only remembers the UI's logged-in user for the current browser.

const SESSION_KEY = "cw_session";

// Default map view: India

const INDIA_CENTER = [22.9734, 78.6569];

const INDIA_ZOOM = 5;

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

// Clicking the map selects a complaint location.

function LocationClickHandler({ onSelect }) {

  useMapEvents({

    click(event) {

      onSelect({ lat: event.latlng.lat, lng: event.latlng.lng });

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

// Automatically position the map based on available issue locations.

function MapViewport({ points }) {

  const map = useMap();

  useEffect(() => {

    if (points.length === 0) {

      map.setView(INDIA_CENTER, INDIA_ZOOM);

    } else if (points.length === 1) {

      map.setView(points[0], 12);

    } else {

      map.fitBounds(points, {

        padding: [35, 35],

        maxZoom: 12,

      });

    }

  }, [map, points]);

  return null;

}

const translations = {

  en: {

    home: "Home", map: "Map", dashboard: "Dashboard", track: "Track",

    login: "Login", signup: "Sign up", logout: "Logout", hello: "Hi,",

    language: "Language",

    heroTitle: "See a civic problem? Make it visible.",

    heroDescription: "Report public issues anonymously, help communities identify problems, and track their resolution.",

    createAccount: "Create free account", publicMap: "View Public Map",

    totalReports: "Total reports", pending: "Pending", resolved: "Resolved",

    publicIssueMap: "Public Issue Map",

    exploreMap: "Explore civic issues reported across India. Select a marker to view the report details.",

    status: "Status", trackingId: "Tracking ID", civicIssue: "Civic issue",

    noDescription: "No description provided.", indiaIssueMap: "India Issue Map",

    noMappedReports: "No mapped reports yet. India is shown as the default view. Reports with valid latitude and longitude will appear here.",

    mappedReports: "Mapped reports", invalidCoordinates: "Reports without valid coordinates",

    refreshMap: "Refresh map view", governmentDashboard: "Government Dashboard",

    total: "Total", inProgress: "In Progress", mostReported: "Most Reported Problems",

    noData: "No data yet.", recentReports: "Recent Reports", noRecentReports: "No recent reports.",

    trackYourReport: "Track Your Report", trackingPlaceholder: "Enter tracking ID e.g. CW-XXXX",

    trackButton: "Track", department: "Department", welcomeBack: "Welcome back",

    loginDescription: "Log in to your CivicWatch account.", email: "Email", password: "Password",

    loggingIn: "Logging in...", logIn: "Log in", newToCivicWatch: "New to CivicWatch?",

    createAccountLink: "Create an account", createYourAccount: "Create your account",

    signupDescription: "It takes less than a minute.", fullName: "Full name",

    yourName: "Your name", mobileNumber: "Mobile number", mobilePlaceholder: "10-digit mobile number",

    gender: "Gender", selectGender: "Select gender", male: "Male", female: "Female",

    other: "Other", preferNotToSay: "Prefer not to say", confirmPassword: "Confirm password",

    passwordPlaceholder: "At least 8 characters", creatingAccount: "Creating account...",

    alreadyHaveAccount: "Already have an account?", footer: "CivicWatch • Community-powered civic issue visibility",

    fullNameError: "Please enter your full name.", genderError: "Please select your gender.",

    mobileError: "Enter a valid 10-digit Indian mobile number.", passwordError: "Password must be at least 8 characters.",

    passwordMismatch: "Passwords do not match.", backendError: "Cannot connect to the backend. Check that it is running on port 5001.",

    signupError: "Signup failed. Please try again.", loginError: "Login failed. Please try again.",
    report: "Report", reportProblem: "Report a Problem", submitComplaint: "Submit a Complaint",
    reportDescription: "Describe the civic issue, select the responsible authority, and pin its exact location on the map.",
    signedInAs: "Signed in as", anonymousSubmit: "You can submit anonymously.", complaintTitle: "Complaint title",
    complaintTitlePlaceholder: "e.g. Large pothole on Main Road", description: "Description",
    descriptionPlaceholder: "Explain the issue and any useful details...", forwardAuthority: "Forward complaint to authority",
    selectAuthority: "-- Select Authority --", uploadPhoto: "Upload a photo (optional, max 5 MB)",
    chooseLocation: "Choose Complaint Location", locationInstructions: "Click the map to place a pin, or drag the pin to adjust it.",
    currentLocation: "Use My Current Location", selectedLocation: "Selected complaint location", latitude: "Latitude", longitude: "Longitude",
    noLocation: "No location selected yet. Select a point on the map.", submitting: "Submitting...", submit: "Submit Complaint",
    locationUnsupported: "Geolocation is not supported by this browser.", locationDenied: "Location permission was denied. You can select the location manually on the map.",
    locationFailed: "Could not get your current location. Please select it on the map.", selectLocationError: "Please select the complaint location on the map.",
    submitSuccess: "Complaint submitted successfully. Tracking ID:", submitError: "Could not submit complaint. Check that the backend is running.",
    authority0: "Municipal Corporation", authority1: "Public Works Department (PWD)", authority2: "Traffic Police Department",
    authority3: "Water Supply Department", authority4: "Electricity Department", authority5: "Sanitation and Waste Management",
    authority6: "Drainage and Sewerage Department", authority7: "Street Lighting Department", authority8: "Parks and Garden Department",
    authority9: "Pollution Control Board", authority10: "Urban Development Authority", authority11: "Fire and Emergency Services",

  },

  hi: {

    home: "होम", map: "नक्शा", dashboard: "डैशबोर्ड", track: "ट्रैक करें",

    login: "लॉग इन", signup: "साइन अप", logout: "लॉग आउट", hello: "नमस्ते,",

    language: "भाषा",

    heroTitle: "कोई नागरिक समस्या दिखे? उसे सामने लाएँ।",

    heroDescription: "सार्वजनिक समस्याओं की गुमनाम रिपोर्ट करें, समुदायों को समस्याएँ पहचानने में मदद करें और उनके समाधान को ट्रैक करें।",

    createAccount: "मुफ़्त खाता बनाएँ", publicMap: "सार्वजनिक नक्शा देखें",

    totalReports: "कुल रिपोर्ट", pending: "लंबित", resolved: "हल की गई",

    publicIssueMap: "सार्वजनिक समस्या नक्शा",

    exploreMap: "भारत में दर्ज नागरिक समस्याएँ देखें। रिपोर्ट का विवरण देखने के लिए किसी मार्कर को चुनें।",

    status: "स्थिति", trackingId: "ट्रैकिंग आईडी", civicIssue: "नागरिक समस्या",

    noDescription: "कोई विवरण उपलब्ध नहीं है।", indiaIssueMap: "भारत समस्या नक्शा",

    noMappedReports: "अभी तक नक्शे पर कोई रिपोर्ट नहीं है। डिफ़ॉल्ट रूप से भारत दिखाया गया है। सही अक्षांश और देशांतर वाली रिपोर्ट यहाँ दिखाई देंगी।",

    mappedReports: "नक्शे पर रिपोर्ट", invalidCoordinates: "बिना मान्य निर्देशांक वाली रिपोर्ट",

    refreshMap: "नक्शा रीफ़्रेश करें", governmentDashboard: "सरकारी डैशबोर्ड",

    total: "कुल", inProgress: "प्रगति पर", mostReported: "सबसे ज़्यादा रिपोर्ट की गई समस्याएँ",

    noData: "अभी कोई डेटा नहीं है।", recentReports: "हाल की रिपोर्ट", noRecentReports: "कोई हाल की रिपोर्ट नहीं है।",

    trackYourReport: "अपनी रिपोर्ट ट्रैक करें", trackingPlaceholder: "ट्रैकिंग आईडी दर्ज करें, जैसे CW-XXXX",

    trackButton: "ट्रैक करें", department: "विभाग", welcomeBack: "वापसी पर स्वागत है",

    loginDescription: "अपने CivicWatch खाते में लॉग इन करें।", email: "ईमेल", password: "पासवर्ड",

    loggingIn: "लॉग इन हो रहा है...", logIn: "लॉग इन", newToCivicWatch: "CivicWatch पर नए हैं?",

    createAccountLink: "खाता बनाएँ", createYourAccount: "अपना खाता बनाएँ",

    signupDescription: "इसमें एक मिनट से भी कम समय लगेगा।", fullName: "पूरा नाम",

    yourName: "अपना नाम लिखें", mobileNumber: "मोबाइल नंबर", mobilePlaceholder: "10 अंकों का मोबाइल नंबर",

    gender: "लिंग", selectGender: "लिंग चुनें", male: "पुरुष", female: "महिला",

    other: "अन्य", preferNotToSay: "बताना नहीं चाहते", confirmPassword: "पासवर्ड की पुष्टि करें",

    passwordPlaceholder: "कम से कम 8 अक्षर", creatingAccount: "खाता बनाया जा रहा है...",

    alreadyHaveAccount: "पहले से खाता है?", footer: "CivicWatch • समुदाय की भागीदारी से नागरिक समस्याओं को सामने लाना",

    fullNameError: "कृपया अपना पूरा नाम दर्ज करें।", genderError: "कृपया अपना लिंग चुनें।",

    mobileError: "मान्य 10 अंकों का भारतीय मोबाइल नंबर दर्ज करें।", passwordError: "पासवर्ड कम से कम 8 अक्षरों का होना चाहिए।",

    passwordMismatch: "दोनों पासवर्ड मेल नहीं खाते।", backendError: "बैकएंड से कनेक्ट नहीं हो पा रहा है। जाँचें कि वह पोर्ट 5001 पर चल रहा है।",

    signupError: "साइन अप नहीं हो पाया। कृपया फिर से प्रयास करें।", loginError: "लॉग इन नहीं हो पाया। कृपया फिर से प्रयास करें।",
    report: "रिपोर्ट", reportProblem: "समस्या की रिपोर्ट करें", submitComplaint: "शिकायत दर्ज करें",
    reportDescription: "नागरिक समस्या का विवरण दें, जिम्मेदार विभाग चुनें और नक्शे पर उसका सही स्थान चुनें।",
    signedInAs: "लॉग इन हैं:", anonymousSubmit: "आप गुमनाम रूप से शिकायत दर्ज कर सकते हैं।", complaintTitle: "शिकायत का शीर्षक",
    complaintTitlePlaceholder: "जैसे: मुख्य सड़क पर बड़ा गड्ढा", description: "विवरण",
    descriptionPlaceholder: "समस्या और उससे जुड़ी उपयोगी जानकारी बताएँ...", forwardAuthority: "शिकायत संबंधित विभाग को भेजें",
    selectAuthority: "-- विभाग चुनें --", uploadPhoto: "फोटो अपलोड करें (वैकल्पिक, अधिकतम 5 MB)",
    chooseLocation: "शिकायत का स्थान चुनें", locationInstructions: "नक्शे पर पिन लगाने के लिए क्लिक करें या पिन को खींचकर सही स्थान पर रखें।",
    currentLocation: "मेरी वर्तमान लोकेशन का उपयोग करें", selectedLocation: "चुना गया शिकायत स्थान", latitude: "अक्षांश", longitude: "देशांतर",
    noLocation: "अभी तक कोई स्थान नहीं चुना गया है। नक्शे पर एक स्थान चुनें।", submitting: "शिकायत भेजी जा रही है...", submit: "शिकायत दर्ज करें",
    locationUnsupported: "इस ब्राउज़र में लोकेशन सुविधा उपलब्ध नहीं है।", locationDenied: "लोकेशन की अनुमति नहीं मिली। आप नक्शे पर स्वयं स्थान चुन सकते हैं।",
    locationFailed: "वर्तमान लोकेशन नहीं मिल सकी। कृपया नक्शे पर स्थान चुनें।", selectLocationError: "कृपया नक्शे पर शिकायत का स्थान चुनें।",
    submitSuccess: "शिकायत सफलतापूर्वक दर्ज हुई। ट्रैकिंग आईडी:", submitError: "शिकायत दर्ज नहीं हो सकी। कृपया बैकएंड जाँचें।",
    authority0: "नगर निगम", authority1: "लोक निर्माण विभाग (PWD)", authority2: "यातायात पुलिस विभाग",
    authority3: "जल आपूर्ति विभाग", authority4: "बिजली विभाग", authority5: "स्वच्छता एवं अपशिष्ट प्रबंधन विभाग",
    authority6: "जल निकासी एवं सीवरेज विभाग", authority7: "स्ट्रीट लाइट विभाग", authority8: "उद्यान एवं पार्क विभाग",
    authority9: "प्रदूषण नियंत्रण बोर्ड", authority10: "शहरी विकास प्राधिकरण", authority11: "अग्निशमन एवं आपातकालीन सेवाएँ",

  },

};

function translateStatus(status, language) {

  if (language !== "hi") return status;

  const labels = {

    pending: "लंबित",

    "in progress": "प्रगति पर",

    resolved: "हल हो गया",

  };

  return labels[String(status || "").toLowerCase()] || status;

}

function App() {

  const [page, setPage] = useState("home");

  const [language, setLanguage] = useState(() => localStorage.getItem("cw_language") === "hi" ? "hi" : "en");

  const t = (key) => translations[language]?.[key] ?? translations.en[key] ?? key;

  useEffect(() => {

    localStorage.setItem("cw_language", language);

  }, [language]);

  const [issues, setIssues] = useState([]);

  const [dash, setDash] = useState(null);

  const [user, setUser] = useState(() => {

    try {

      const savedUser = JSON.parse(localStorage.getItem(SESSION_KEY));

      // Ignore sessions created by the old localStorage-only signup flow.

      return savedUser?.id && savedUser?.name ? savedUser : null;

    } catch {

      return null;

    }

  });

  const [authBusy, setAuthBusy] = useState(false);

  const [authMsg, setAuthMsg] = useState({

    type: "",

    text: "",

  });

  const [trackId, setTrackId] = useState("");

  const [tracked, setTracked] = useState(null);

  const [complaint, setComplaint] = useState({

    title: "",

    description: "",

    authority: "",

    latitude: null,

    longitude: null,

  });

  const [complaintPhoto, setComplaintPhoto] = useState(null);

  const [complaintBusy, setComplaintBusy] = useState(false);

  const [complaintMessage, setComplaintMessage] = useState({ type: "", text: "" });

  const loadIssues = () =>

    axios

      .get(API + "/issues")

      .then((response) => setIssues(response.data))

      .catch(() => setIssues([]));

  const loadDash = () =>

    axios

      .get(API + "/dashboard")

      .then((response) => setDash(response.data))

      .catch(() => setDash(null));

  useEffect(() => {

    loadIssues();

    loadDash();

  }, []);

  // Keep only issues with valid geographic coordinates.

  const mapIssues = useMemo(

    () =>

      issues.filter((issue) => {

        if (

          issue.latitude === null ||

          issue.latitude === undefined ||

          issue.latitude === "" ||

          issue.longitude === null ||

          issue.longitude === undefined ||

          issue.longitude === ""

        ) {

          return false;

        }

        const lat = Number(issue.latitude);

        const lng = Number(issue.longitude);

        return (

          Number.isFinite(lat) &&

          Number.isFinite(lng) &&

          lat >= -90 &&

          lat <= 90 &&

          lng >= -180 &&

          lng <= 180

        );

      }),

    [issues]

  );

  const mapPoints = useMemo(

    () =>

      mapIssues.map((issue) => [

        Number(issue.latitude),

        Number(issue.longitude),

      ]),

    [mapIssues]

  );

  async function track(event) {

    event.preventDefault();

    try {

      const response = await axios.get(

        API + "/issues/track/" + encodeURIComponent(trackId.trim())

      );

      setTracked(response.data);

    } catch {

      setTracked({

        error: "No issue found with this tracking ID",

      });

    }

  }

  // Authentication requests are sent to the Node/Express backend.

  function go(nextPage) {

    setAuthMsg({ type: "", text: "" });

    setPage(nextPage);

    window.scrollTo(0, 0);

  }

  async function signup(event) {

    event.preventDefault();

    if (authBusy) return;

    setAuthMsg({ type: "", text: "" });

    const form = Object.fromEntries(new FormData(event.currentTarget));

    const email = form.email.trim().toLowerCase();

    if (form.name.trim().length < 2) {

      return setAuthMsg({

        type: "error",

        text: t("fullNameError"),

      });

    }

    if (!form.gender) {

      return setAuthMsg({

        type: "error",

        text: t("genderError"),

      });

    }

    const mobile = form.mobile

      .replace(/[\s-]/g, "")

     .replace(/^(?:\+?91|0)/, "");

    if (!/^[6-9]\d{9}$/.test(mobile)) {

      return setAuthMsg({

        type: "error",

        text: t("mobileError"),

      });

    }

    if (form.password.length < 8) {

      return setAuthMsg({

        type: "error",

        text: t("passwordError"),

      });

    }

    if (form.password !== form.confirm) {

      return setAuthMsg({

        type: "error",

        text: t("passwordMismatch"),

      });

    }

    setAuthBusy(true);

    try {

      // Backend hashes the password and INSERTs the user into PostgreSQL.

      const response = await axios.post(API + "/auth/signup", {

        name: form.name.trim(),

        email,

        gender: form.gender,

        mobile,

        password: form.password,

      });

      const account = response.data.user;

      localStorage.setItem(SESSION_KEY, JSON.stringify(account));

      setUser(account);

      go("home");

    } catch (error) {

      setAuthMsg({

        type: "error",

        text:

          error.response?.data?.error ||

          (error.request

            ? t("backendError")

            : t("signupError")),

      });

    } finally {

      setAuthBusy(false);

    }

  }

  async function login(event) {

    event.preventDefault();

    if (authBusy) return;

    setAuthMsg({ type: "", text: "" });

    const form = Object.fromEntries(new FormData(event.currentTarget));

    setAuthBusy(true);

    try {

      // Backend validates the password against the PostgreSQL user record.

      const response = await axios.post(API + "/auth/login", {

        email: form.email.trim().toLowerCase(),

        password: form.password,

      });

      const account = response.data.user;

      localStorage.setItem(SESSION_KEY, JSON.stringify(account));

      setUser(account);

      go("home");

    } catch (error) {

      setAuthMsg({

        type: "error",

        text:

          error.response?.data?.error ||

          (error.request

            ? t("backendError")

            : t("loginError")),

      });

    } finally {

      setAuthBusy(false);

    }

  }

  function logout() {

    localStorage.removeItem(SESSION_KEY);

    setUser(null);

    go("home");

  }

  function updateComplaintLocation(location) {

    setComplaint((current) => ({

      ...current,

      latitude: Number(location.lat.toFixed(7)),

      longitude: Number(location.lng.toFixed(7)),

    }));

  }

  function useCurrentLocation() {

    if (!navigator.geolocation) {

      setComplaintMessage({ type: "error", text: t("locationUnsupported") });

      return;

    }

    navigator.geolocation.getCurrentPosition(

      (position) => updateComplaintLocation({

        lat: position.coords.latitude,

        lng: position.coords.longitude,

      }),

      (error) => setComplaintMessage({

        type: "error",

        text: error.code === 1

          ? "Location permission was denied. You can select the location manually on the map."

          : "Could not get your current location. Please select it on the map.",

      }),

      { enableHighAccuracy: true, timeout: 12000 }

    );

  }

  async function submitComplaint(event) {

    event.preventDefault();

    // Keep a stable reference: React clears event.currentTarget after the

    // submit event finishes, including while this async function is awaiting.

    const formElement = event.currentTarget;

    if (complaintBusy) return;

    if (complaint.latitude === null || complaint.longitude === null) {

      setComplaintMessage({ type: "error", text: t("selectLocationError") });

      return;

    }

    const formData = new FormData();

    formData.append("title", complaint.title.trim());

    formData.append("description", complaint.description.trim());

    formData.append("authority", complaint.authority);

    formData.append("latitude", String(complaint.latitude));

    formData.append("longitude", String(complaint.longitude));

    if (user?.id) formData.append("userId", String(user.id));

    if (complaintPhoto) formData.append("photo", complaintPhoto);

    setComplaintBusy(true);

    setComplaintMessage({ type: "", text: "" });

    try {

      const response = await axios.post(API + "/issues", formData);

      const created = response.data;

      setComplaintMessage({

        type: "success",

        text: `${t("submitSuccess")} ${created.tracking_id}`,

      });

      setComplaint({ title: "", description: "", authority: "", latitude: null, longitude: null });

      setComplaintPhoto(null);

      const photoInput = formElement.querySelector('input[type="file"]');

      if (photoInput) photoInput.value = "";

      await Promise.all([loadIssues(), loadDash()]);

    } catch (error) {

      setComplaintMessage({

        type: "error",

        text: error.response?.data?.error || t("submitError"),

      });

    } finally {

      setComplaintBusy(false);

    }

  }

  const statusClass = (status) =>

    String(status || "pending").toLowerCase().replace(/\s+/g, "-");

  function Nav() {

    return (

      <nav>

        <div className="brand">🇮🇳 CivicWatch</div>

        <div className="links">

          {["home", "report", "map", "dashboard", "track"].map((item) => (

            <button

              key={item}

              onClick={() => go(item)}

              className={page === item ? "active" : ""}

            >

              {t(item)}

            </button>

          ))}

          <label className="language-picker">

            <span className="sr-only">{t("language")}</span>

            <select

              aria-label={t("language")}

              title={t("language")}

              value={language}

              onChange={(event) => setLanguage(event.target.value)}

            >

              <option value="en">English</option>

              <option value="hi">हिन्दी</option>

            </select>

          </label>

        </div>

        <div className="auth">

          {user ? (

            <>

              <span className="hello">

                {t("hello")} {user.name.split(" ")[0]}

              </span>

              <button onClick={logout}>{t("logout")}</button>

            </>

          ) : (

            <>

              <button

                onClick={() => go("login")}

                className={page === "login" ? "active" : ""}

              >

                {t("login")}

              </button>

              <button className="primary" onClick={() => go("signup")}>

                {t("signup")}

              </button>

            </>

          )}

        </div>

      </nav>

    );

  }

  return (

    <>

      <Nav />

      <main>

        {/* HOME */}

        {page === "home" && (

          <section className="hero">

            <h1>{t("heroTitle")}</h1>

            <p>

              {t("heroDescription")}

            </p>

            {!user && (

              <button className="primary" onClick={() => go("signup")}>

                {t("createAccount")}

              </button>

            )}

            <button

              className={user ? "primary" : ""}

              onClick={() => go("map")}

            >

              {t("publicMap")}

            </button>

            <button className="primary" onClick={() => go("report")}>

              {t("reportProblem")}

            </button>

            <div className="cards">

              <div>

                <b>{dash?.total ?? 0}</b>

                <span>{t("totalReports")}</span>

              </div>

              <div>

                <b>{dash?.pending ?? 0}</b>

                <span>{t("pending")}</span>

              </div>

              <div>

                <b>{dash?.resolved ?? 0}</b>

                <span>{t("resolved")}</span>

              </div>

            </div>

          </section>

        )}

        {/* REPORT A PROBLEM */}
        {page === "report" && (
          <section>
            <h2>{t("submitComplaint")}</h2>
            <p className="map-description">
              {t("reportDescription")}
              {user ? ` ${t("signedInAs")} ${user.name}.` : ` ${t("anonymousSubmit")}`}
            </p>
            <form className="form complaint-form" onSubmit={submitComplaint}>
              <label>
                {t("complaintTitle")} *
                <input value={complaint.title} onChange={(event) => setComplaint({ ...complaint, title: event.target.value })} maxLength={200} placeholder={t("complaintTitlePlaceholder")} required />
              </label>
              <label>
                {t("description")} *
                <textarea value={complaint.description} onChange={(event) => setComplaint({ ...complaint, description: event.target.value })} placeholder={t("descriptionPlaceholder")} required />
              </label>
              <label>
                {t("forwardAuthority")} *
                <select value={complaint.authority} onChange={(event) => setComplaint({ ...complaint, authority: event.target.value })} required>
                  <option value="">{t("selectAuthority")}</option>
                  {AUTHORITIES.map((authority, index) => <option key={authority} value={authority}>{t(`authority${index}`)}</option>)}
                </select>
              </label>
              <label>
                {t("uploadPhoto")}
                <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(event) => setComplaintPhoto(event.target.files?.[0] || null)} />
              </label>
              <div className="location-picker-heading">
                <div>
                  <h3>{t("chooseLocation")} *</h3>
                  <p className="muted">{t("locationInstructions")}</p>
                </div>
                <button type="button" onClick={useCurrentLocation}>{t("currentLocation")}</button>
              </div>
              <div className="map report-map">
                <MapContainer center={complaint.latitude !== null ? [complaint.latitude, complaint.longitude] : [19.076, 72.8777]} zoom={complaint.latitude !== null ? 15 : 11} scrollWheelZoom style={{ height: "100%", width: "100%" }}>
                  <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" maxZoom={19} />
                  <LocationClickHandler onSelect={updateComplaintLocation} />
                  <LocationMapUpdater position={complaint.latitude !== null ? [complaint.latitude, complaint.longitude] : null} />
                  {complaint.latitude !== null && (
                    <Marker position={[complaint.latitude, complaint.longitude]} draggable eventHandlers={{ dragend: (event) => { const point = event.target.getLatLng(); updateComplaintLocation(point); } }}>
                      <Popup>{t("selectedLocation")}</Popup>
                    </Marker>
                  )}
                </MapContainer>
              </div>
              {complaint.latitude !== null ? (
                <div className="coordinates-box">
                  <span><b>{t("latitude")}:</b> {complaint.latitude}</span>
                  <span><b>{t("longitude")}:</b> {complaint.longitude}</span>
                </div>
              ) : <p className="muted">{t("noLocation")}</p>}
              {complaintMessage.text && <div className={`authmsg ${complaintMessage.type}`} role="alert">{complaintMessage.text}</div>}
              <button className="primary" type="submit" disabled={complaintBusy}>{complaintBusy ? t("submitting") : t("submit")}</button>
            </form>
          </section>
        )}

        {/* INDIA MAP */}

        {page === "map" && (

          <section>

            <h2>{t("publicIssueMap")}</h2>

            <p className="map-description">

              {t("exploreMap")}

            </p>

            <div className="map">

              <MapContainer

                center={INDIA_CENTER}

                zoom={INDIA_ZOOM}

                minZoom={3}

                maxZoom={18}

                scrollWheelZoom={true}

                style={{ height: "100%", width: "100%" }}

              >

                <TileLayer

                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'

                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"

                  maxZoom={19}

                />

                <MapViewport points={mapPoints} />

                {mapIssues.map((issue) => (

                  <Marker

                    key={issue.id}

                    position={[

                      Number(issue.latitude),

                      Number(issue.longitude),

                    ]}

                  >

                    <Popup>

                      <div className="issue-popup">

                        <h3>{issue.category || t("civicIssue")}</h3>

                        <p>

                          {issue.description || t("noDescription")}

                        </p>

                        <p>

                          <b>{t("status")}:</b>{" "}

                          <span

                            className={

                              "status " + statusClass(issue.status)

                            }

                          >

                            {translateStatus(issue.status || "Pending", language)}

                          </span>

                        </p>

                        {issue.tracking_id && (

                          <p>

                            <b>{t("trackingId")}:</b> {issue.tracking_id}

                          </p>

                        )}

                      </div>

                    </Popup>

                  </Marker>

                ))}

              </MapContainer>

              {mapIssues.length === 0 && (

                <div className="map-empty">

                  <strong>{t("indiaIssueMap")}</strong>

                  <span>

                    {t("noMappedReports")}

                  </span>

                </div>

              )}

            </div>

            <div className="map-summary">

              <div>

                <b>{mapIssues.length}</b>

                <span>{t("mappedReports")}</span>

              </div>

              <div>

                <b>{issues.length - mapIssues.length}</b>

                <span>{t("invalidCoordinates")}</span>

              </div>

              <button

                onClick={() => {

                  setPage("map");

                  window.scrollTo(0, 0);

                }}

              >

                {t("refreshMap")}

              </button>

            </div>

          </section>

        )}

        {/* DASHBOARD */}

        {page === "dashboard" && (

          <section>

            <h2>{t("governmentDashboard")}</h2>

            <div className="cards dashboard">

              <div>

                <b>{dash?.total ?? 0}</b>

                <span>{t("total")}</span>

              </div>

              <div>

                <b>{dash?.pending ?? 0}</b>

                <span>{t("pending")}</span>

              </div>

              <div>

                <b>{dash?.inProgress ?? 0}</b>

                <span>{t("inProgress")}</span>

              </div>

              <div>

                <b>{dash?.resolved ?? 0}</b>

                <span>{t("resolved")}</span>

              </div>

            </div>

            <h3>{t("mostReported")}</h3>

            <div className="list">

              {dash?.categories?.length ? (

                dash.categories.map((category) => (

                  <div key={category.category}>

                    <span>{category.category}</span>

                    <b>{category.count}</b>

                  </div>

                ))

              ) : (

                <p>{t("noData")}</p>

              )}

            </div>

            <h3>{t("recentReports")}</h3>

            <div className="table">

              {dash?.recent?.length ? (

                dash.recent.map((issue) => (

                  <div key={issue.id} className="row">

                    <span>{issue.tracking_id}</span>

                    <span>{issue.category}</span>

                    <span className={"status " + statusClass(issue.status)}>

                      {translateStatus(issue.status, language)}

                    </span>

                  </div>

                ))

              ) : (

                <p className="empty">{t("noRecentReports")}</p>

              )}

            </div>

          </section>

        )}

        {/* TRACK REPORT */}

        {page === "track" && (

          <section>

            <h2>{t("trackYourReport")}</h2>

            <form className="track" onSubmit={track}>

              <input

                value={trackId}

                onChange={(event) => setTrackId(event.target.value)}

                placeholder={t("trackingPlaceholder")}

                required

              />

              <button className="primary" type="submit">

                {t("trackButton")}

              </button>

            </form>

            {tracked && (

              <div className="tracked">

                {tracked.error ? (

                  <p>{tracked.error}</p>

                ) : (

                  <>

                    <h3>{tracked.category}</h3>

                    <p>{tracked.description}</p>

                    <p>

                      <b>{t("trackingId")}:</b> {tracked.tracking_id}

                    </p>

                    <p>

                      <b>{t("department")}:</b> {tracked.department}

                    </p>

                    <p>

                      <b>{t("status")}:</b>{" "}

                      <span className={"status " + statusClass(tracked.status)}>

                        {translateStatus(tracked.status, language)}

                      </span>

                    </p>

                  </>

                )}

              </div>

            )}

          </section>

        )}

        {/* LOGIN */}

        {page === "login" && (

          <section className="authpage">

            <form onSubmit={login} className="form authform">

              <h2>{t("welcomeBack")}</h2>

              <p className="muted">{t("loginDescription")}</p>

              <label>

                {t("email")}

                <input

                  name="email"

                  type="email"

                  required

                  autoComplete="email"

                  placeholder="you@example.com"

                />

              </label>

              <label>

                {t("password")}

                <input

                  name="password"

                  type="password"

                  required

                  autoComplete="current-password"

                />

              </label>

              {authMsg.text && (

                <div className={"authmsg " + authMsg.type} role="alert">

                  {authMsg.text}

                </div>

              )}

              <button className="primary" type="submit" disabled={authBusy}>

                {authBusy ? t("loggingIn") : t("logIn")}

              </button>

              <p className="switch">

                {t("newToCivicWatch")}{" "}

                <a

                  href="#signup"

                  onClick={(event) => {

                    event.preventDefault();

                    go("signup");

                  }}

                >

                  {t("createAccountLink")}

                </a>

              </p>

            </form>

          </section>

        )}

        {/* SIGNUP */}

        {page === "signup" && (

          <section className="authpage">

            <form onSubmit={signup} className="form authform">

              <h2>{t("createYourAccount")}</h2>

              <p className="muted">{t("signupDescription")}</p>

              <label>

                {t("fullName")}

                <input

                  name="name"

                  required

                  autoComplete="name"

                  placeholder={t("yourName")}

                />

              </label>

              <label>

                {t("email")}

                <input

                  name="email"

                  type="email"

                  required

                  autoComplete="email"

                  placeholder="you@example.com"

                />

              </label>

              <label>

                {t("mobileNumber")}

                <input

                  name="mobile"

                  type="tel"

                  required

                  inputMode="numeric"

                  autoComplete="tel"

                  placeholder={t("mobilePlaceholder")}

                />

              </label>

              <label>

                {t("gender")}

                <select name="gender" required defaultValue="">

                  <option value="" disabled>

                    {t("selectGender")}

                  </option>

                  <option value="Male">{t("male")}</option>

                  <option value="Female">{t("female")}</option>

                  <option value="Other">{t("other")}</option>

                  <option value="Prefer not to say">{t("preferNotToSay")}</option>

                </select>

              </label>

              <label>

                {t("password")}

                <input

                  name="password"

                  type="password"

                  required

                  minLength={8}

                  autoComplete="new-password"

                  placeholder={t("passwordPlaceholder")}

                />

              </label>

              <label>

                {t("confirmPassword")}

                <input

                  name="confirm"

                  type="password"

                  required

                  minLength={8}

                  autoComplete="new-password"

                />

              </label>

              {authMsg.text && (

                <div className={"authmsg " + authMsg.type} role="alert">

                  {authMsg.text}

                </div>

              )}

              <button className="primary" type="submit" disabled={authBusy}>

                {authBusy ? t("creatingAccount") : t("signup")}

              </button>

              <p className="switch">

                {t("alreadyHaveAccount")}{" "}

                <a

                  href="#login"

                  onClick={(event) => {

                    event.preventDefault();

                    go("login");

                  }}

                >

                  {t("logIn")}

                </a>

              </p>

            </form>

          </section>

        )}

      </main>

      <footer>

        {t("footer")}

      </footer>

    </>

  );

}

createRoot(document.getElementById("root")).render(<App />);
