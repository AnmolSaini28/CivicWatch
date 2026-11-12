require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const pool = require("./db");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Small helper to create readable tracking IDs.
function makeTrackingId() {
  return "CW-" + Math.random().toString(36).substring(2, 8).toUpperCase();
}

app.get("/", (req, res) => {
  res.json({ message: "CivicWatch API is running" });
});

// Get all public issues for the map.
app.get("/api/issues", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, tracking_id, category, description, department, status, latitude, longitude, created_at FROM issues ORDER BY created_at DESC"
    );
    res.json(result.rows);
  } catch (error) {
    console.error("GET issues:", error.message);
    res.status(500).json({ error: "Could not load issues" });
  }
});

// Dashboard statistics.
app.get("/api/dashboard", async (req, res) => {
  try {
    const counts = await pool.query(`
      SELECT COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status = 'Pending')::int AS pending,
        COUNT(*) FILTER (WHERE status = 'In Progress')::int AS "inProgress",
        COUNT(*) FILTER (WHERE status = 'Resolved')::int AS resolved
      FROM issues
    `);
    const categories = await pool.query(`
      SELECT category, COUNT(*)::int AS count
      FROM issues GROUP BY category ORDER BY count DESC
    `);
    const recent = await pool.query(`
      SELECT id, tracking_id, category, status
      FROM issues ORDER BY created_at DESC LIMIT 8
    `);
    res.json({ ...counts.rows[0], categories: categories.rows, recent: recent.rows });
  } catch (error) {
    console.error("GET dashboard:", error.message);
    res.status(500).json({ error: "Could not load dashboard" });
  }
});

// Find a report using its tracking ID.
app.get("/api/issues/track/:trackingId", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT tracking_id, category, description, department, status
       FROM issues WHERE UPPER(tracking_id) = UPPER($1)`,
      [req.params.trackingId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "No issue found with this tracking ID" });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Track issue:", error.message);
    res.status(500).json({ error: "Could not track issue" });
  }
});

// Create a new public issue. Coordinates are optional.
app.post("/api/issues", async (req, res) => {
  const { category, description, department, latitude, longitude } = req.body;
  if (!category || !description || !category.trim() || !description.trim()) {
    return res.status(400).json({ error: "Category and description are required" });
  }

  try {
    let trackingId = makeTrackingId();
    // Retry in the extremely unlikely event of a duplicate tracking ID.
    let exists = await pool.query("SELECT id FROM issues WHERE tracking_id = $1", [trackingId]);
    while (exists.rows.length > 0) {
      trackingId = makeTrackingId();
      exists = await pool.query("SELECT id FROM issues WHERE tracking_id = $1", [trackingId]);
    }

    const result = await pool.query(
      `INSERT INTO issues (tracking_id, category, description, department, latitude, longitude)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, tracking_id, category, description, department, status, latitude, longitude, created_at`,
      [
        trackingId,
        category.trim(),
        description.trim(),
        department && department.trim() ? department.trim() : "Municipal Corporation",
        latitude === "" || latitude === undefined ? null : latitude,
        longitude === "" || longitude === undefined ? null : longitude
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Create issue:", error.message);
    res.status(500).json({ error: "Could not create issue" });
  }
});

// Create an account. Passwords are hashed before saving.
app.post("/api/auth/signup", async (req, res) => {
  const { name, email, gender, mobile, password } = req.body;
  if (!name || !email || !gender || !mobile || !password) {
    return res.status(400).json({ error: "Please fill in all fields" });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters" });
  }

  try {
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedMobile = mobile.replace(/[\s-]/g, "").replace(/^\+91|^0/, "");
    const passwordHash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (name, email, gender, mobile, password_hash)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, email, gender, mobile`,
      [name.trim(), normalizedEmail, gender, normalizedMobile, passwordHash]
    );
    res.status(201).json({ user: result.rows[0] });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "This email or mobile number is already registered" });
    }
    console.error("Signup:", error.message);
    res.status(500).json({ error: "Could not create account" });
  }
});

// Log in by checking the password against the stored hash.
app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }
  try {
    const result = await pool.query(
      "SELECT id, name, email, gender, mobile, password_hash FROM users WHERE email = $1",
      [email.trim().toLowerCase()]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Incorrect email or password" });
    }
    const account = result.rows[0];
    const passwordMatches = await bcrypt.compare(password, account.password_hash);
    if (!passwordMatches) {
      return res.status(401).json({ error: "Incorrect email or password" });
    }
    const { password_hash, ...safeUser } = account;
    res.json({ user: safeUser });
  } catch (error) {
    console.error("Login:", error.message);
    res.status(500).json({ error: "Could not log in" });
  }
});

// Check the database connection at startup.
async function startServer() {
  try {
    await pool.query("SELECT NOW()");
    console.log("Connected to PostgreSQL");
    app.listen(PORT, () => console.log(`CivicWatch API listening at http://localhost:${PORT}`));
  } catch (error) {
    console.error("Could not connect to PostgreSQL:", error.message);
    process.exit(1);
  }
}
startServer();
