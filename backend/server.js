require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const pool = require("./db");

const app = express();
const PORT = process.env.PORT || 5001;

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

  const normalizedName =
    typeof name === "string" ? name.trim() : "";

  const normalizedEmail =
    typeof email === "string"
      ? email.trim().toLowerCase()
      : "";

  const normalizedMobile =
    typeof mobile === "string" ? mobile.trim() : "";

  if (
    !normalizedName ||
    !normalizedEmail ||
    !gender ||
    !normalizedMobile ||
    !password
  ) {
    return res.status(400).json({
      error: "Please fill in all fields.",
    });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  if (!emailRegex.test(normalizedEmail)) {
    return res.status(400).json({
      error: "Please enter a valid email address.",
    });
  }

  if (!/^[0-9]{10}$/.test(normalizedMobile)) {
    return res.status(400).json({
      error: "Mobile number must contain exactly 10 digits.",
    });
  }

  if (
    !["Male", "Female", "Other", "Prefer not to say"]
      .includes(gender)
  ) {
    return res.status(400).json({
      error: "Please select a valid gender.",
    });
  }

  const strongPassword =
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9\s]).{8,}$/;

  if (
    typeof password !== "string" ||
    !strongPassword.test(password)
  ) {
    return res.status(400).json({
      error:
        "Password must be at least 8 characters and contain uppercase, lowercase, number, and special character.",
    });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO users
       (name, email, gender, mobile, password_hash)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, email, gender, mobile`,
      [
        normalizedName,
        normalizedEmail,
        gender,
        normalizedMobile,
        passwordHash,
      ]
    );

    return res.status(201).json({
      user: result.rows[0],
    });

  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({
        error: "Email or mobile number is already registered.",
      });
    }

    console.error("Signup:", error.message);

    return res.status(500).json({
      error: "Could not create account.",
    });
  }
});

// Log in by checking the password against the stored hash.

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};

    // 1. Validate required fields
    if (
      typeof email !== "string" ||
      typeof password !== "string" ||
      !email.trim() ||
      !password
    ) {
      return res.status(400).json({
        error: "Email and password are required.",
      });
    }

    // 2. Normalize email
    const normalizedEmail = email.trim().toLowerCase();

    // 3. Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

    if (!emailRegex.test(normalizedEmail)) {
      return res.status(400).json({
        error: "Please enter a valid email address.",
      });
    }

    // 4. Check password length
    if (password.length < 8) {
      return res.status(400).json({
        error: "Password must be at least 8 characters long.",
      });
    }

    // 5. Find the user in PostgreSQL
    const result = await pool.query(
      `SELECT id, name, email, gender, mobile, password_hash
       FROM users
       WHERE email = $1`,
      [normalizedEmail]
    );

    // 6. Check whether user exists
    if (result.rows.length === 0) {
      return res.status(401).json({
        error: "Incorrect email or password.",
      });
    }

    const account = result.rows[0];

    // 7. Compare entered password with stored hash
    const passwordMatches = await bcrypt.compare(
      password,
      account.password_hash
    );

    if (!passwordMatches) {
      return res.status(401).json({
        error: "Incorrect email or password.",
      });
    }

    // 8. Remove password hash from response
    const { password_hash, ...safeUser } = account;

    // 9. Return successful login response
    return res.status(200).json({
      message: "Login successful.",
      user: safeUser,
    });

  } catch (error) {
    console.error("Login:", error.message);

    return res.status(500).json({
      error: "Something went wrong. Please try again later.",
    });
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
