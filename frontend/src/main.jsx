
import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import axios from "axios";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  useMap,
} from "react-leaflet";

import "leaflet/dist/leaflet.css";
import "./styles.css";

const API = "http://localhost:5000/api";

const USERS_KEY = "cw_users";
const SESSION_KEY = "cw_session";

// Default map view: India
const INDIA_CENTER = [22.9734, 78.6569];
const INDIA_ZOOM = 5;

const readUsers = () => {
  try {
    return JSON.parse(localStorage.getItem(USERS_KEY)) || [];
  } catch {
    return [];
  }
};

async function hash(text) {
  const buffer = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text)
  );

  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
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

function App() {
  const [page, setPage] = useState("home");
  const [issues, setIssues] = useState([]);
  const [dash, setDash] = useState(null);

  const [user, setUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(SESSION_KEY));
    } catch {
      return null;
    }
  });

  const [authMsg, setAuthMsg] = useState({
    type: "",
    text: "",
  });

  const [trackId, setTrackId] = useState("");
  const [tracked, setTracked] = useState(null);

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

  // Frontend-only demo authentication.
  // Replace with backend authentication when available.
  function go(nextPage) {
    setAuthMsg({ type: "", text: "" });
    setPage(nextPage);
    window.scrollTo(0, 0);
  }

  async function signup(event) {
    event.preventDefault();

    const form = Object.fromEntries(new FormData(event.target));
    const email = form.email.trim().toLowerCase();

    if (form.name.trim().length < 2) {
      return setAuthMsg({
        type: "error",
        text: "Please enter your full name.",
      });
    }

    if (!form.gender) {
      return setAuthMsg({
        type: "error",
        text: "Please select your gender.",
      });
    }

    const mobile = form.mobile
      .replace(/[\s-]/g, "")
      .replace(/^(\+91|0)/, "");

    if (!/^[6-9]\d{9}$/.test(mobile)) {
      return setAuthMsg({
        type: "error",
        text: "Enter a valid 10-digit Indian mobile number.",
      });
    }

    if (form.password.length < 8) {
      return setAuthMsg({
        type: "error",
        text: "Password must be at least 8 characters.",
      });
    }

    if (form.password !== form.confirm) {
      return setAuthMsg({
        type: "error",
        text: "Passwords do not match.",
      });
    }

    const users = readUsers();

    if (users.some((existingUser) => existingUser.email === email)) {
      return setAuthMsg({
        type: "error",
        text: "An account with this email already exists. Please log in.",
      });
    }

    if (users.some((existingUser) => existingUser.mobile === mobile)) {
      return setAuthMsg({
        type: "error",
        text: "This mobile number is already registered.",
      });
    }

    users.push({
      name: form.name.trim(),
      email,
      gender: form.gender,
      mobile,
      password: await hash(form.password),
    });

    localStorage.setItem(USERS_KEY, JSON.stringify(users));

    const session = {
      name: form.name.trim(),
      email,
    };

    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    setUser(session);
    go("home");
  }

  async function login(event) {
    event.preventDefault();

    const form = Object.fromEntries(new FormData(event.target));
    const email = form.email.trim().toLowerCase();

    const found = readUsers().find(
      (existingUser) => existingUser.email === email
    );

    if (!found || found.password !== (await hash(form.password))) {
      return setAuthMsg({
        type: "error",
        text: "Incorrect email or password.",
      });
    }

    const session = {
      name: found.name,
      email,
    };

    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    setUser(session);
    go("home");
  }

  function logout() {
    localStorage.removeItem(SESSION_KEY);
    setUser(null);
    go("home");
  }

  const statusClass = (status) =>
    String(status || "pending").toLowerCase().replace(/\s+/g, "-");

  function Nav() {
    return (
      <nav>
        <div className="brand">🇮🇳 CivicWatch</div>

        <div className="links">
          {["home", "map", "dashboard", "track"].map((item) => (
            <button
              key={item}
              onClick={() => go(item)}
              className={page === item ? "active" : ""}
            >
              {item[0].toUpperCase() + item.slice(1)}
            </button>
          ))}
        </div>

        <div className="auth">
          {user ? (
            <>
              <span className="hello">
                Hi, {user.name.split(" ")[0]}
              </span>
              <button onClick={logout}>Logout</button>
            </>
          ) : (
            <>
              <button
                onClick={() => go("login")}
                className={page === "login" ? "active" : ""}
              >
                Login
              </button>

              <button className="primary" onClick={() => go("signup")}>
                Sign up
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
            <h1>See a civic problem? Make it visible.</h1>

            <p>
              Report public issues anonymously, help communities identify
              problems, and track their resolution.
            </p>

            {!user && (
              <button className="primary" onClick={() => go("signup")}>
                Create free account
              </button>
            )}

            <button
              className={user ? "primary" : ""}
              onClick={() => go("map")}
            >
              View Public Map
            </button>

            <div className="cards">
              <div>
                <b>{dash?.total ?? 0}</b>
                <span>Total reports</span>
              </div>

              <div>
                <b>{dash?.pending ?? 0}</b>
                <span>Pending</span>
              </div>

              <div>
                <b>{dash?.resolved ?? 0}</b>
                <span>Resolved</span>
              </div>
            </div>
          </section>
        )}

        {/* INDIA MAP */}
        {page === "map" && (
          <section>
            <h2>Public Issue Map</h2>

            <p className="map-description">
              Explore civic issues reported across India. Select a marker
              to view the report details.
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
                        <h3>{issue.category || "Civic issue"}</h3>

                        <p>
                          {issue.description || "No description provided."}
                        </p>

                        <p>
                          <b>Status:</b>{" "}
                          <span
                            className={
                              "status " + statusClass(issue.status)
                            }
                          >
                            {issue.status || "Pending"}
                          </span>
                        </p>

                        {issue.tracking_id && (
                          <p>
                            <b>Tracking ID:</b> {issue.tracking_id}
                          </p>
                        )}
                      </div>
                    </Popup>
                  </Marker>
                ))}
              </MapContainer>

              {mapIssues.length === 0 && (
                <div className="map-empty">
                  <strong>India Issue Map</strong>
                  <span>
                    No mapped reports yet. India is shown as the default
                    view. Reports with valid latitude and longitude will
                    appear here.
                  </span>
                </div>
              )}
            </div>

            <div className="map-summary">
              <div>
                <b>{mapIssues.length}</b>
                <span>Mapped reports</span>
              </div>

              <div>
                <b>{issues.length - mapIssues.length}</b>
                <span>Reports without valid coordinates</span>
              </div>

              <button
                onClick={() => {
                  setPage("map");
                  window.scrollTo(0, 0);
                }}
              >
                Refresh map view
              </button>
            </div>
          </section>
        )}

        {/* DASHBOARD */}
        {page === "dashboard" && (
          <section>
            <h2>Government Dashboard</h2>

            <div className="cards dashboard">
              <div>
                <b>{dash?.total ?? 0}</b>
                <span>Total</span>
              </div>

              <div>
                <b>{dash?.pending ?? 0}</b>
                <span>Pending</span>
              </div>

              <div>
                <b>{dash?.inProgress ?? 0}</b>
                <span>In Progress</span>
              </div>

              <div>
                <b>{dash?.resolved ?? 0}</b>
                <span>Resolved</span>
              </div>
            </div>

            <h3>Most Reported Problems</h3>

            <div className="list">
              {dash?.categories?.length ? (
                dash.categories.map((category) => (
                  <div key={category.category}>
                    <span>{category.category}</span>
                    <b>{category.count}</b>
                  </div>
                ))
              ) : (
                <p>No data yet.</p>
              )}
            </div>

            <h3>Recent Reports</h3>

            <div className="table">
              {dash?.recent?.length ? (
                dash.recent.map((issue) => (
                  <div key={issue.id} className="row">
                    <span>{issue.tracking_id}</span>
                    <span>{issue.category}</span>
                    <span className={"status " + statusClass(issue.status)}>
                      {issue.status}
                    </span>
                  </div>
                ))
              ) : (
                <p className="empty">No recent reports.</p>
              )}
            </div>
          </section>
        )}

        {/* TRACK REPORT */}
        {page === "track" && (
          <section>
            <h2>Track Your Report</h2>

            <form className="track" onSubmit={track}>
              <input
                value={trackId}
                onChange={(event) => setTrackId(event.target.value)}
                placeholder="Enter tracking ID e.g. CW-XXXX"
                required
              />

              <button className="primary" type="submit">
                Track
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
                      <b>Tracking ID:</b> {tracked.tracking_id}
                    </p>

                    <p>
                      <b>Department:</b> {tracked.department}
                    </p>

                    <p>
                      <b>Status:</b>{" "}
                      <span className={"status " + statusClass(tracked.status)}>
                        {tracked.status}
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
              <h2>Welcome back</h2>
              <p className="muted">Log in to your CivicWatch account.</p>

              <label>
                Email
                <input
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="you@example.com"
                />
              </label>

              <label>
                Password
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

              <button className="primary" type="submit">
                Log in
              </button>

              <p className="switch">
                New to CivicWatch?{" "}
                <a
                  href="#signup"
                  onClick={(event) => {
                    event.preventDefault();
                    go("signup");
                  }}
                >
                  Create an account
                </a>
              </p>
            </form>
          </section>
        )}

        {/* SIGNUP */}
        {page === "signup" && (
          <section className="authpage">
            <form onSubmit={signup} className="form authform">
              <h2>Create your account</h2>
              <p className="muted">It takes less than a minute.</p>

              <label>
                Full name
                <input
                  name="name"
                  required
                  autoComplete="name"
                  placeholder="Your name"
                />
              </label>

              <label>
                Email
                <input
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="you@example.com"
                />
              </label>

              <label>
                Mobile number
                <input
                  name="mobile"
                  type="tel"
                  required
                  inputMode="numeric"
                  autoComplete="tel"
                  placeholder="10-digit mobile number"
                />
              </label>

              <label>
                Gender
                <select name="gender" required defaultValue="">
                  <option value="" disabled>
                    Select gender
                  </option>
                  <option>Male</option>
                  <option>Female</option>
                  <option>Other</option>
                  <option>Prefer not to say</option>
                </select>
              </label>

              <label>
                Password
                <input
                  name="password"
                  type="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  placeholder="At least 8 characters"
                />
              </label>

              <label>
                Confirm password
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

              <button className="primary" type="submit">
                Sign up
              </button>

              <p className="switch">
                Already have an account?{" "}
                <a
                  href="#login"
                  onClick={(event) => {
                    event.preventDefault();
                    go("login");
                  }}
                >
                  Log in
                </a>
              </p>
            </form>
          </section>
        )}
      </main>

      <footer>
        CivicWatch • Community-powered civic issue visibility
      </footer>
    </>
  );
}

createRoot(document.getElementById("root")).render(<App />);
