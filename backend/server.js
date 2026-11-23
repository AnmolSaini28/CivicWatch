
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const fs = require("fs");
const pool = require("./db");


const app = express();
const PORT = process.env.PORT || 5001;
const JWT_SECRET = process.env.JWT_SECRET || "civicwatch_admin_jwt_secret_key_2026";

app.use(cors());
app.use(express.json());

const uploadDirectory = path.join(__dirname, "uploads");
fs.mkdirSync(uploadDirectory, { recursive: true });
app.use("/uploads", express.static(uploadDirectory));

// ==========================================
// AUTHORITIES
// ==========================================

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

// ==========================================
// PHOTO UPLOAD CONFIGURATION
// ==========================================

const storage = multer.diskStorage({
  destination: (_req, _file, callback) =>
    callback(null, uploadDirectory),

  filename: (_req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();

    const safeExtension =
      /^\.(jpg|jpeg|png|webp|gif)$/.test(extension)
        ? extension
        : ".jpg";

    callback(
      null,
      `complaint-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 9)}${safeExtension}`
    );
  },
});

const uploadPhoto = multer({
  storage,

  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 1,
  },

  fileFilter: (_req, file, callback) => {
    const allowed = [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif",
    ];

    if (!allowed.includes(file.mimetype)) {
      return callback(
        new Error("Only JPG, PNG, WEBP or GIF images are allowed.")
      );
    }

    callback(null, true);
  },
});

// ==========================================
// TRACKING ID GENERATOR & 10KM BROADCAST HELPER
// ==========================================

function makeTrackingId() {
  return (
    "CW-" +
    Math.random().toString(36).substring(2, 8).toUpperCase()
  );
}

// Haversine formula to compute distance between two GPS coordinates in kilometers
function getDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's mean radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Broadcast alerts to all registered citizens residing within a 10km radius
async function sendNearbyAlerts(issue) {
  try {
    const issueLat = Number(issue.latitude);
    const issueLng = Number(issue.longitude);
    if (!Number.isFinite(issueLat) || !Number.isFinite(issueLng)) return;

    // Fetch registered citizens with established geographic coordinates
    const usersResult = await pool.query(
      `SELECT id, name, latitude, longitude FROM users 
       WHERE latitude IS NOT NULL AND longitude IS NOT NULL`
    );

    for (const u of usersResult.rows) {
      const uLat = Number(u.latitude);
      const uLng = Number(u.longitude);
      if (!Number.isFinite(uLat) || !Number.isFinite(uLng)) continue;

      const dist = getDistanceKm(issueLat, issueLng, uLat, uLng);
      // Alert triggered if within 10 km
      if (dist <= 10.0) {
        const distKm = Math.round(dist * 100) / 100;
        const distText = dist < 0.1 ? "nearby" : `${dist.toFixed(1)} km away`;
        const title = `🚨 New ${issue.category || "Civic"} Report (${distText})`;
        const message = issue.title || "New civic problem reported in your neighborhood";

        await pool.query(
          `INSERT INTO notifications (user_id, issue_id, title, message, distance_km)
           VALUES ($1, $2, $3, $4, $5)`,
          [u.id, issue.id, title, message, distKm]
        );
      }
    }
  } catch (err) {
    console.error("sendNearbyAlerts notice:", err.message);
  }
}


// ADMIN AUTHENTICATION MIDDLEWARE

async function verifyAdmin(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({
      error: "Admin authentication required"
    });
  }

  const token = authHeader.slice(7);

  try {
    const decoded = jwt.verify(
      token,
      JWT_SECRET,
      { algorithms: ["HS256"] }
    );

    if (
      decoded.type !== "admin" ||
      !Number.isInteger(decoded.adminId)
    ) {
      return res.status(403).json({
        error: "Admin access only"
      });
    }

    const result = await pool.query(
      `SELECT id, name, email, admin_level, state, district, city, block
       FROM admins
       WHERE id = $1 AND is_active = TRUE`,
      [decoded.adminId]
    );

    if (result.rows.length === 0) {
      return res.status(403).json({
        error: "Admin account is inactive or unavailable"
      });
    }

    req.admin = result.rows[0];

    next();

  } catch (error) {
    if (
      error.name === "JsonWebTokenError" ||
      error.name === "TokenExpiredError" ||
      error.name === "NotBeforeError"
    ) {
      return res.status(401).json({
        error: "Invalid or expired token"
      });
    }

    console.error("Admin verification:", error.message);

    return res.status(500).json({
      error: "Could not verify admin"
    });
  }
}

// ==========================================
// HOME ROUTE
// ==========================================

app.get("/", (_req, res) => {
  res.json({
    message: "CivicWatch API is running",
  });
});

// ==========================================
// GET AUTHORITIES
// ==========================================

app.get("/api/authorities", (_req, res) => {
  res.json(AUTHORITIES);
});

// ==========================================
// GET ALL ISSUES
// ==========================================

app.get("/api/issues", async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        id,
        tracking_id,
        title,
        category,
        description,
        department,
        photo_url,
        user_id,
        status,
        state,
        district,
        city,
        block,
        pincode,
        latitude,
        longitude,
        upvotes_count,
        downvotes_count,
        comments_count,
        is_duplicate,
        duplicate_of_id,
        is_anonymous,
        created_at
      FROM issues
      ORDER BY created_at DESC
    `);

    res.json(result.rows);

  } catch (error) {
    console.error("GET issues:", error.message);

    res.status(500).json({
      error: "Could not load issues",
    });
  }
});

// ==========================================
// DASHBOARD STATISTICS
// ==========================================

app.get("/api/dashboard", async (_req, res) => {
  try {
    const counts = await pool.query(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (
          WHERE status = 'Pending'
        )::int AS pending,
        COUNT(*) FILTER (
          WHERE status = 'In Progress'
        )::int AS "inProgress",
        COUNT(*) FILTER (
          WHERE status = 'Resolved'
        )::int AS resolved
      FROM issues
    `);

    const categories = await pool.query(`
      SELECT
        category,
        COUNT(*)::int AS count
      FROM issues
      GROUP BY category
      ORDER BY count DESC
    `);

    const recent = await pool.query(`
      SELECT
        id,
        tracking_id,
        category,
        title,
        status
      FROM issues
      ORDER BY created_at DESC
      LIMIT 8
    `);

    res.json({
      ...counts.rows[0],
      categories: categories.rows,
      recent: recent.rows,
    });

  } catch (error) {
    console.error("GET dashboard:", error.message);

    res.status(500).json({
      error: "Could not load dashboard",
    });
  }
});

// ==========================================
// TRACK COMPLAINT
// ==========================================

app.get(
  "/api/issues/track/:trackingId",
  async (req, res) => {
    try {
      const result = await pool.query(
        `
        SELECT
          id,
          tracking_id,
          title,
          category,
          description,
          department,
          photo_url,
          status,
          state,
          district,
          city,
          block,
          pincode,
          latitude,
          longitude,
          upvotes_count,
          downvotes_count,
          comments_count,
          is_duplicate,
          duplicate_of_id,
          created_at,
          resolved_at
        FROM issues
        WHERE UPPER(tracking_id) = UPPER($1)
        `,
        [req.params.trackingId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          error: "No issue found with this tracking ID",
        });
      }

      res.json(result.rows[0]);

    } catch (error) {
      console.error("Track issue:", error.message);

      res.status(500).json({
        error: "Could not track issue",
      });
    }
  }
);

// ==========================================
// CREATE NEW COMPLAINT
// ==========================================

app.post(
  "/api/issues",
  uploadPhoto.single("photo"),
  async (req, res) => {

    const title = (req.body.title || "").trim();
    const category = (req.body.category || "").trim() || "Other";
    const description = (req.body.description || "").trim();
    const authority = (req.body.authority || "").trim();
    const city = (req.body.city || "Mumbai").trim();
    const state = (req.body.state || "Maharashtra").trim();
    const district = (req.body.district || "").trim();
    const block = (req.body.block || "Powai").trim();
    const pincode = (req.body.pincode || "").trim();

    // Anonymous reporting: either user explicitly checked anonymous, or user is guest/not logged in
    const isAnonymous =
      req.body.isAnonymous === "true" ||
      req.body.isAnonymous === true ||
      !req.body.userId;

    const { latitude, longitude } = req.body;

    // Validate required fields
    if (!title || !description || !authority) {
      if (req.file) {
        fs.unlink(req.file.path, () => {});
      }

      return res.status(400).json({
        error: "Title, description and authority are required.",
      });
    }

    if (title.length > 200) {
      if (req.file) {
        fs.unlink(req.file.path, () => {});
      }

      return res.status(400).json({
        error: "Title must be 200 characters or fewer.",
      });
    }

    // Validate authority
    if (!AUTHORITIES.includes(authority)) {
      if (req.file) {
        fs.unlink(req.file.path, () => {});
      }

      return res.status(400).json({
        error: "Please select a valid authority.",
      });
    }

    // Validate latitude and longitude
    const lat = Number(latitude);
    const lng = Number(longitude);

    if (
      latitude === undefined ||
      longitude === undefined ||
      latitude === "" ||
      longitude === "" ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      lat < -90 ||
      lat > 90 ||
      lng < -180 ||
      lng > 180
    ) {
      if (req.file) {
        fs.unlink(req.file.path, () => {});
      }

      return res.status(400).json({
        error: "Please select a valid complaint location on the map.",
      });
    }

    try {
      // If user is logged in, attach their userId so they can see it in their dashboard.
      // If isAnonymous is true, their identity will still be protected from public/admin view.
      let userId = null;

      if (req.body.userId) {
        const userResult = await pool.query(
          "SELECT id FROM users WHERE id = $1",
          [req.body.userId]
        );

        if (userResult.rows.length === 0) {
          if (req.file) {
            fs.unlink(req.file.path, () => {});
          }

          return res.status(400).json({
            error: "The selected user account does not exist.",
          });
        }

        userId = userResult.rows[0].id;
      }

      // Generate unique tracking ID
      let trackingId = makeTrackingId();

      let duplicate = await pool.query(
        "SELECT id FROM issues WHERE tracking_id = $1",
        [trackingId]
      );

      while (duplicate.rows.length > 0) {
        trackingId = makeTrackingId();

        duplicate = await pool.query(
          "SELECT id FROM issues WHERE tracking_id = $1",
          [trackingId]
        );
      }

      // Optional geographic and category details with defaults
      const category = (req.body.category || "").trim() || title;
      const city = (req.body.city || "").trim() || "Mumbai";
      const state = (req.body.state || "").trim() || "Maharashtra";
      const district = (req.body.district || "").trim() || "Mumbai Suburban";
      const block = (req.body.block || "").trim() || "Powai";

      // Photo URL
      const photoUrl = req.file
        ? `/uploads/${req.file.filename}`
        : null;

      // Part 2: Proximity duplicate detection (< 100 meters = 0.10 km in same category)
      let isDuplicate = false;
      let duplicateOfId = null;
      let duplicateNotice = null;

      const nearbyCheck = await pool.query(
        `SELECT id, tracking_id, title, category, latitude, longitude 
         FROM issues 
         WHERE category = $1 AND status != 'Resolved' AND latitude IS NOT NULL AND longitude IS NOT NULL
         ORDER BY created_at DESC 
         LIMIT 30`,
        [category]
      );

      for (const row of nearbyCheck.rows) {
        const dist = getDistanceKm(lat, lng, Number(row.latitude), Number(row.longitude));
        if (dist <= 0.10) { // Within 100 meters
          isDuplicate = true;
          duplicateOfId = row.id;
          duplicateNotice = `Identified existing ${category} report (${row.tracking_id}) within ${(dist * 1000).toFixed(0)}m. Added support verification to original issue.`;
          // Automatically add upvote to original issue to record community agreement
          await pool.query(
            "UPDATE issues SET upvotes_count = upvotes_count + 1 WHERE id = $1",
            [row.id]
          );
          break;
        }
      }

      // Insert complaint into PostgreSQL with all synchronized fields
      const result = await pool.query(
        `
        INSERT INTO issues
        (
          tracking_id,
          title,
          category,
          description,
          department,
          photo_url,
          user_id,
          is_anonymous,
          latitude,
          longitude,
          city,
          state,
          district,
          block,
          pincode,
          is_duplicate,
          duplicate_of_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
        RETURNING
          id,
          tracking_id,
          title,
          category,
          description,
          department,
          photo_url,
          user_id,
          is_anonymous,
          status,
          city,
          state,
          district,
          block,
          pincode,
          latitude,
          longitude,
          upvotes_count,
          downvotes_count,
          comments_count,
          is_duplicate,
          duplicate_of_id,
          created_at
        `,
        [
          trackingId,
          title,
          category,
          description,
          authority,
          photoUrl,
          userId,
          isAnonymous,
          lat,
          lng,
          city,
          state,
          district,
          block,
          pincode,
          isDuplicate,
          duplicateOfId,
        ]
      );

      const createdIssue = {
        ...result.rows[0],
        duplicateNotice,
      };

      // Part 1: Broadcast alert to registered citizens within 10km radius
      sendNearbyAlerts(createdIssue).catch((broadcastErr) => {
        console.error("10km alert broadcast notice:", broadcastErr.message);
      });

      res.status(201).json(createdIssue);

    } catch (error) {
      if (req.file) {
        fs.unlink(req.file.path, () => {});
      }

      console.error("Create complaint:", error.message);

      res.status(500).json({
        error: "Could not save complaint to the database.",
      });
    }
  }
);

// ==========================================
// USER SIGNUP
// ==========================================

app.post("/api/auth/signup", async (req, res) => {
  const {
    name,
    email,
    gender,
    mobile,
    password,
  } = req.body;

  if (!name || !email || !gender || !mobile || !password) {
    return res.status(400).json({
      error: "Please fill in all fields",
    });
  }

  if (password.length < 8) {
    return res.status(400).json({
      error: "Password must be at least 8 characters",
    });
  }

  try {
    const normalizedEmail = email.trim().toLowerCase();

    const normalizedMobile = mobile
      .replace(/[\s-]/g, "")
      .replace(/^\+91|^0/, "");

    const passwordHash = await bcrypt.hash(password, 10);

    const state = (req.body.state || "Maharashtra").trim();
    const city = (req.body.city || "Mumbai").trim();
    const latitude = req.body.latitude ? Number(req.body.latitude) : 19.0760000;
    const longitude = req.body.longitude ? Number(req.body.longitude) : 72.8777000;

    const result = await pool.query(
      `
      INSERT INTO users
      (name, email, gender, mobile, password_hash, state, city, latitude, longitude)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id, name, email, gender, mobile, state, city, latitude, longitude
      `,
      [
        name.trim(),
        normalizedEmail,
        gender,
        normalizedMobile,
        passwordHash,
        state,
        city,
        latitude,
        longitude,
      ]
    );

    res.status(201).json({
      user: result.rows[0],
    });

  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({
        error: "This email or mobile number is already registered",
      });
    }

    console.error("Signup:", error.message);

    res.status(500).json({
      error: "Could not create account",
    });
  }
});

// ==========================================
// USER LOGIN
// ==========================================

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({
      error: "Email and password are required",
    });
  }

  try {
    const result = await pool.query(
      `
      SELECT
        id,
        name,
        email,
        gender,
        mobile,
        state,
        city,
        latitude,
        longitude,
        password_hash
      FROM users
      WHERE email = $1
      `,
      [email.trim().toLowerCase()]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        error: "Incorrect email or password",
      });
    }

    const account = result.rows[0];

    const passwordMatches = await bcrypt.compare(
      password,
      account.password_hash
    );

    if (!passwordMatches) {
      return res.status(401).json({
        error: "Incorrect email or password",
      });
    }

    const {
      password_hash,
      ...safeUser
    } = account;

    res.json({
      user: safeUser,
    });

  } catch (error) {
    console.error("Login:", error.message);

    res.status(500).json({
      error: "Could not log in",
    });
  }
});


// ADMIN LOGIN

app.post("/api/admin/login", async (req, res) => {
  const { email, password } = req.body;

  if (
    typeof email !== "string" ||
    typeof password !== "string" ||
    !email.trim() ||
    !password
  ) {
    return res.status(400).json({
      error: "Email and password are required"
    });
  }

  try {
    const result = await pool.query(
      `SELECT id, name, email, password_hash, admin_level, state, district, city, block
       FROM admins
       WHERE email = $1 AND is_active = TRUE`,
      [email.trim().toLowerCase()]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        error: "Invalid admin credentials"
      });
    }

    const admin = result.rows[0];

    const isValid = await bcrypt.compare(
      password,
      admin.password_hash
    );

    if (!isValid) {
      return res.status(401).json({
        error: "Invalid admin credentials"
      });
    }

    const token = jwt.sign(
      {
        adminId: admin.id,
        type: "admin"
      },
      JWT_SECRET,
      {
        algorithm: "HS256",
        expiresIn: "8h"
      }
    );

    res.json({
      message: "Admin login successful",
      token,
      admin: {
        id: admin.id,
        name: admin.name,
        email: admin.email,
        admin_level: admin.admin_level || "CITY",
        state: admin.state,
        district: admin.district,
        city: admin.city,
        block: admin.block
      }
    });

  } catch (error) {
    console.error("Admin login:", error.message);

    res.status(500).json({
      error: "Admin login failed"
    });
  }
});


// ADMIN - GET ALL COMPLAINTS (Scoped to Admin Hierarchy Level)

app.get("/api/admin/issues", verifyAdmin, async (req, res) => {
  try {
    const scope = req.query.scope; // optional '?scope=all'
    let whereClause = "WHERE 1=1";
    const params = [];

    if (scope !== "all") {
      const level = req.admin.admin_level || "CITY";
      if (level === "BLOCK" && req.admin.block) {
        params.push(req.admin.block);
        whereClause += ` AND i.block = $${params.length}`;
      } else if (level === "CITY" && req.admin.city) {
        params.push(req.admin.city);
        whereClause += ` AND i.city = $${params.length}`;
      } else if (level === "DISTRICT" && req.admin.district) {
        params.push(req.admin.district);
        whereClause += ` AND i.district = $${params.length}`;
      } else if (level === "STATE" && req.admin.state) {
        params.push(req.admin.state);
        whereClause += ` AND i.state = $${params.length}`;
      }
    }

    const result = await pool.query(`
      SELECT
        i.id,
        i.tracking_id,
        i.title,
        i.category,
        i.description,
        i.department,
        i.photo_url,
        i.status,
        i.state,
        i.district,
        i.city,
        i.block,
        i.pincode,
        i.latitude,
        i.longitude,
        i.upvotes_count,
        i.downvotes_count,
        i.comments_count,
        i.is_duplicate,
        i.duplicate_of_id,
        i.created_at,
        i.resolved_at,
        CASE
          WHEN i.is_anonymous = TRUE THEN 'Anonymous Citizen'
          WHEN u.name IS NOT NULL THEN u.name
          ELSE 'Anonymous Citizen'
        END AS reported_by,
        i.is_anonymous
      FROM issues i
      LEFT JOIN users u ON i.user_id = u.id
      ${whereClause}
      ORDER BY i.created_at DESC, i.id DESC
    `, params);

    res.json(result.rows);

  } catch (error) {
    console.error("Admin get issues:", error.message);

    res.status(500).json({
      error: "Failed to fetch complaints"
    });
  }
});

// ==========================================
// USER DASHBOARD - GET OWN COMPLAINTS
// (Allows registered users to view all their reported complaints,
// including ones filed anonymously, securely on their personal dashboard)
// ==========================================

app.get("/api/user/issues/:userId", async (req, res) => {
  const userId = parseInt(req.params.userId, 10);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: "Invalid user ID" });
  }

  try {
    const result = await pool.query(
      `SELECT
        id,
        tracking_id,
        title,
        category,
        description,
        department,
        photo_url,
        status,
        city,
        state,
        district,
        block,
        pincode,
        latitude,
        longitude,
        upvotes_count,
        downvotes_count,
        comments_count,
        is_duplicate,
        duplicate_of_id,
        is_anonymous,
        created_at,
        resolved_at
      FROM issues
      WHERE user_id = $1
      ORDER BY created_at DESC, id DESC`,
      [userId]
    );

    res.json(result.rows);

  } catch (error) {
    console.error("User get issues:", error.message);

    res.status(500).json({
      error: "Failed to fetch user complaints"
    });
  }
});

// ==========================================
// USER PROFILE UPDATE
// ==========================================

app.put("/api/user/profile/:userId", async (req, res) => {
  const userId = parseInt(req.params.userId, 10);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: "Invalid user ID" });
  }

  const { name, mobile, gender, city, state, latitude, longitude } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: "Name is required" });
  }

  const lat = latitude !== undefined && latitude !== null && latitude !== "" ? Number(latitude) : null;
  const lng = longitude !== undefined && longitude !== null && longitude !== "" ? Number(longitude) : null;

  try {
    const result = await pool.query(
      `UPDATE users
       SET name = $1,
           mobile = COALESCE($2, mobile),
           gender = COALESCE($3, gender),
           city = COALESCE($4, city),
           state = COALESCE($5, state),
           latitude = COALESCE($6, latitude),
           longitude = COALESCE($7, longitude)
       WHERE id = $8
       RETURNING id, name, email, gender, mobile, state, city, latitude, longitude`,
      [
        name.trim(),
        mobile ? mobile.trim() : null,
        gender || null,
        city ? city.trim() : null,
        state ? state.trim() : null,
        lat,
        lng,
        userId
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({
      message: "Profile updated successfully",
      user: result.rows[0],
    });
  } catch (error) {
    console.error("Update profile:", error.message);
    res.status(500).json({ error: "Failed to update profile" });
  }
});

// ==========================================
// PART 2: COMMUNITY VERIFICATION VOTING
// ==========================================

// Cast or toggle vote on an issue (1 Citizen = 1 Vote)
app.post("/api/issues/:id/vote", async (req, res) => {
  const issueId = parseInt(req.params.id, 10);
  const { userId, voteType } = req.body;

  if (!Number.isInteger(issueId) || !Number.isInteger(Number(userId))) {
    return res.status(400).json({ error: "Valid issue ID and user ID are required" });
  }
  if (!["upvote", "downvote"].includes(voteType)) {
    return res.status(400).json({ error: "Vote type must be 'upvote' or 'downvote'" });
  }

  const uId = Number(userId);

  try {
    // Check if user already cast a vote on this issue
    const existing = await pool.query(
      "SELECT id, vote_type FROM issue_votes WHERE issue_id = $1 AND user_id = $2",
      [issueId, uId]
    );

    let activeVote = null;

    if (existing.rows.length === 0) {
      // 1. New vote cast
      await pool.query(
        "INSERT INTO issue_votes (issue_id, user_id, vote_type) VALUES ($1, $2, $3)",
        [issueId, uId, voteType]
      );
      if (voteType === "upvote") {
        await pool.query("UPDATE issues SET upvotes_count = upvotes_count + 1 WHERE id = $1", [issueId]);
      } else {
        await pool.query("UPDATE issues SET downvotes_count = downvotes_count + 1 WHERE id = $1", [issueId]);
      }
      activeVote = voteType;
    } else if (existing.rows[0].vote_type === voteType) {
      // 2. Same vote clicked again -> remove/retract vote (toggle off)
      await pool.query("DELETE FROM issue_votes WHERE id = $1", [existing.rows[0].id]);
      if (voteType === "upvote") {
        await pool.query("UPDATE issues SET upvotes_count = GREATEST(0, upvotes_count - 1) WHERE id = $1", [issueId]);
      } else {
        await pool.query("UPDATE issues SET downvotes_count = GREATEST(0, downvotes_count - 1) WHERE id = $1", [issueId]);
      }
      activeVote = null;
    } else {
      // 3. Opposite vote clicked -> switch vote
      await pool.query(
        "UPDATE issue_votes SET vote_type = $1, created_at = CURRENT_TIMESTAMP WHERE id = $2",
        [voteType, existing.rows[0].id]
      );
      if (voteType === "upvote") {
        await pool.query(
          "UPDATE issues SET upvotes_count = upvotes_count + 1, downvotes_count = GREATEST(0, downvotes_count - 1) WHERE id = $1",
          [issueId]
        );
      } else {
        await pool.query(
          "UPDATE issues SET downvotes_count = downvotes_count + 1, upvotes_count = GREATEST(0, upvotes_count - 1) WHERE id = $1",
          [issueId]
        );
      }
      activeVote = voteType;
    }

    // Return updated issue vote stats
    const updated = await pool.query(
      "SELECT id, upvotes_count, downvotes_count, is_duplicate FROM issues WHERE id = $1",
      [issueId]
    );

    res.json({
      success: true,
      userVote: activeVote,
      upvotes_count: updated.rows[0]?.upvotes_count || 0,
      downvotes_count: updated.rows[0]?.downvotes_count || 0,
      is_duplicate: updated.rows[0]?.is_duplicate || false,
    });
  } catch (error) {
    console.error("Cast vote error:", error.message);
    res.status(500).json({ error: "Failed to record vote" });
  }
});

// GET user's current vote status on an issue
app.get("/api/issues/:id/vote/:userId", async (req, res) => {
  const issueId = parseInt(req.params.id, 10);
  const userId = parseInt(req.params.userId, 10);

  if (!Number.isInteger(issueId) || !Number.isInteger(userId)) {
    return res.status(400).json({ error: "Invalid issue ID or user ID" });
  }

  try {
    const voteRes = await pool.query(
      "SELECT vote_type FROM issue_votes WHERE issue_id = $1 AND user_id = $2",
      [issueId, userId]
    );
    const issueRes = await pool.query(
      "SELECT upvotes_count, downvotes_count, is_duplicate FROM issues WHERE id = $1",
      [issueId]
    );

    res.json({
      userVote: voteRes.rows.length > 0 ? voteRes.rows[0].vote_type : null,
      upvotes_count: issueRes.rows[0]?.upvotes_count || 0,
      downvotes_count: issueRes.rows[0]?.downvotes_count || 0,
      is_duplicate: issueRes.rows[0]?.is_duplicate || false,
    });
  } catch (error) {
    console.error("Get vote status error:", error.message);
    res.status(500).json({ error: "Failed to get vote status" });
  }
});

// ==========================================
// PART 1: NOTIFICATION ENDPOINTS
// ==========================================

// GET user notifications
app.get("/api/notifications/:userId", async (req, res) => {
  const userId = parseInt(req.params.userId, 10);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: "Invalid user ID" });
  }

  try {
    const result = await pool.query(
      `SELECT
        n.id,
        n.user_id,
        n.issue_id,
        n.title,
        n.message,
        n.distance_km,
        n.is_read,
        n.created_at,
        i.tracking_id,
        i.category,
        i.status,
        i.department,
        i.city,
        i.block,
        i.latitude as issue_lat,
        i.longitude as issue_lng,
        i.upvotes_count,
        i.downvotes_count,
        i.comments_count,
        i.is_duplicate,
        i.duplicate_of_id,
        i.is_anonymous,
        i.photo_url
      FROM notifications n
      LEFT JOIN issues i ON n.issue_id = i.id
      WHERE n.user_id = $1
      ORDER BY n.created_at DESC, n.id DESC
      LIMIT 50`,
      [userId]
    );

    const unreadCount = result.rows.filter((n) => !n.is_read).length;

    res.json({
      notifications: result.rows,
      unreadCount,
    });
  } catch (error) {
    console.error("Fetch notifications error:", error.message);
    res.status(500).json({ error: "Failed to fetch notifications" });
  }
});

// PUT mark single notification as read
app.put("/api/notifications/:id/read", async (req, res) => {
  const notifId = parseInt(req.params.id, 10);
  if (!Number.isInteger(notifId) || notifId <= 0) {
    return res.status(400).json({ error: "Invalid notification ID" });
  }

  try {
    await pool.query("UPDATE notifications SET is_read = TRUE WHERE id = $1", [notifId]);
    res.json({ success: true });
  } catch (error) {
    console.error("Mark notification read error:", error.message);
    res.status(500).json({ error: "Failed to mark notification read" });
  }
});

// PUT mark all user notifications as read
app.put("/api/notifications/user/:userId/read-all", async (req, res) => {
  const userId = parseInt(req.params.userId, 10);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: "Invalid user ID" });
  }

  try {
    await pool.query("UPDATE notifications SET is_read = TRUE WHERE user_id = $1", [userId]);
    res.json({ success: true });
  } catch (error) {
    console.error("Mark all read error:", error.message);
    res.status(500).json({ error: "Failed to mark all notifications read" });
  }
});

// PUT update user location coordinates
app.put("/api/user/location/:userId", async (req, res) => {
  const userId = parseInt(req.params.userId, 10);
  const { latitude, longitude } = req.body;
  const lat = Number(latitude);
  const lng = Number(longitude);

  if (!Number.isInteger(userId) || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: "Valid user ID, latitude, and longitude are required" });
  }

  try {
    const result = await pool.query(
      `UPDATE users
       SET latitude = $1, longitude = $2
       WHERE id = $3
       RETURNING id, name, email, latitude, longitude`,
      [lat, lng, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({ success: true, user: result.rows[0] });
  } catch (error) {
    console.error("Update user location error:", error.message);
    res.status(500).json({ error: "Failed to update user location" });
  }
});

// ==========================================
// PART 3: CITIZEN DISCUSSION & COMMENTS
// ==========================================

// GET all comments for an issue
app.get("/api/issues/:id/comments", async (req, res) => {
  const issueId = parseInt(req.params.id, 10);
  if (!Number.isInteger(issueId) || issueId <= 0) {
    return res.status(400).json({ error: "Invalid issue ID" });
  }

  try {
    const result = await pool.query(
      `SELECT
        c.id,
        c.issue_id,
        c.user_id,
        c.comment,
        c.created_at,
        u.name as user_name,
        u.city as user_city
      FROM issue_comments c
      JOIN users u ON c.user_id = u.id
      WHERE c.issue_id = $1
      ORDER BY c.created_at ASC`,
      [issueId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error("Fetch comments error:", error.message);
    res.status(500).json({ error: "Failed to fetch comments" });
  }
});

// POST a new comment on an issue
app.post("/api/issues/:id/comments", async (req, res) => {
  const issueId = parseInt(req.params.id, 10);
  const { userId, comment } = req.body;

  if (!Number.isInteger(issueId) || !Number.isInteger(Number(userId))) {
    return res.status(400).json({ error: "Valid issue ID and user ID are required" });
  }

  const commentText = (comment || "").trim();
  if (!commentText) {
    return res.status(400).json({ error: "Comment text cannot be empty" });
  }
  if (commentText.length > 1000) {
    return res.status(400).json({ error: "Comment is too long (maximum 1000 characters)" });
  }

  try {
    // Verify user exists
    const userRes = await pool.query("SELECT id, name, city FROM users WHERE id = $1", [userId]);
    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    // Verify issue exists
    const issueRes = await pool.query("SELECT id FROM issues WHERE id = $1", [issueId]);
    if (issueRes.rows.length === 0) {
      return res.status(404).json({ error: "Issue not found" });
    }

    const insertRes = await pool.query(
      `INSERT INTO issue_comments (issue_id, user_id, comment)
       VALUES ($1, $2, $3)
       RETURNING id, issue_id, user_id, comment, created_at`,
      [issueId, Number(userId), commentText]
    );

    // Increment comments_count in issues table
    await pool.query(
      "UPDATE issues SET comments_count = comments_count + 1 WHERE id = $1",
      [issueId]
    );

    const newComment = {
      ...insertRes.rows[0],
      user_name: userRes.rows[0].name,
      user_city: userRes.rows[0].city,
    };

    res.status(201).json(newComment);
  } catch (error) {
    console.error("Post comment error:", error.message);
    res.status(500).json({ error: "Failed to post comment" });
  }
});

// DELETE a comment (Owner or Admin moderation)
app.delete("/api/comments/:id", async (req, res) => {
  const commentId = parseInt(req.params.id, 10);
  if (!Number.isInteger(commentId) || commentId <= 0) {
    return res.status(400).json({ error: "Invalid comment ID" });
  }

  try {
    const commentRes = await pool.query("SELECT id, issue_id FROM issue_comments WHERE id = $1", [commentId]);
    if (commentRes.rows.length === 0) {
      return res.status(404).json({ error: "Comment not found" });
    }

    const issueId = commentRes.rows[0].issue_id;

    await pool.query("DELETE FROM issue_comments WHERE id = $1", [commentId]);

    await pool.query(
      "UPDATE issues SET comments_count = GREATEST(0, comments_count - 1) WHERE id = $1",
      [issueId]
    );

    res.json({ success: true, message: "Comment deleted successfully" });
  } catch (error) {
    console.error("Delete comment error:", error.message);
    res.status(500).json({ error: "Failed to delete comment" });
  }
});

// PUT admin mark or unmark an issue as duplicate
app.put("/api/admin/issues/:id/mark-duplicate", async (req, res) => {
  const issueId = parseInt(req.params.id, 10);
  const { isDuplicate, duplicateOfId } = req.body;

  if (!Number.isInteger(issueId) || issueId <= 0) {
    return res.status(400).json({ error: "Invalid issue ID" });
  }

  try {
    const dupBool = isDuplicate === true || isDuplicate === "true";
    const dupId = duplicateOfId ? parseInt(duplicateOfId, 10) : null;

    const result = await pool.query(
      `UPDATE issues 
       SET is_duplicate = $1, duplicate_of_id = $2
       WHERE id = $3
       RETURNING id, tracking_id, is_duplicate, duplicate_of_id`,
      [dupBool, dupId, issueId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Issue not found" });
    }

    res.json({ success: true, issue: result.rows[0] });
  } catch (error) {
    console.error("Mark duplicate error:", error.message);
    res.status(500).json({ error: "Failed to update duplicate status" });
  }
});

// ==========================================
// USER PASSWORD UPDATE
// ==========================================

app.put("/api/user/password/:userId", async (req, res) => {
  const userId = parseInt(req.params.userId, 10);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: "Invalid user ID" });
  }

  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: "Current and new passwords are required" });
  }

  if (newPassword.length < 8) {
    return res.status(400).json({ error: "New password must be at least 8 characters" });
  }

  try {
    const userRes = await pool.query("SELECT password_hash FROM users WHERE id = $1", [userId]);
    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const matches = await bcrypt.compare(currentPassword, userRes.rows[0].password_hash);
    if (!matches) {
      return res.status(401).json({ error: "Current password is incorrect" });
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    await pool.query("UPDATE users SET password_hash = $1 WHERE id = $2", [newHash, userId]);

    res.json({ message: "Password updated successfully" });
  } catch (error) {
    console.error("Change password:", error.message);
    res.status(500).json({ error: "Failed to update password" });
  }
});

// ==========================================
// CANCEL / WITHDRAW PENDING COMPLAINT
// ==========================================

app.delete("/api/user/issues/:issueId", async (req, res) => {
  const issueId = parseInt(req.params.issueId, 10);
  const userId = parseInt(req.query.userId, 10);

  if (!Number.isInteger(issueId) || !Number.isInteger(userId)) {
    return res.status(400).json({ error: "Invalid issue ID or user ID" });
  }

  try {
    const result = await pool.query(
      `DELETE FROM issues
       WHERE id = $1 AND user_id = $2 AND status = 'Pending'
       RETURNING id, tracking_id`,
      [issueId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({
        error: "Complaint not found or cannot be cancelled once In Progress / Resolved"
      });
    }

    res.json({
      message: `Complaint ${result.rows[0].tracking_id} successfully cancelled`,
      id: issueId
    });
  } catch (error) {
    console.error("Delete issue:", error.message);
    res.status(500).json({ error: "Failed to cancel complaint" });
  }
});


// ADMIN - UPDATE COMPLAINT

app.patch(
  "/api/admin/issues/:id",
  verifyAdmin,
  async (req, res) => {
    const { status, department } = req.body;

    const validStatuses = [
      "Pending",
      "In Progress",
      "Resolved"
    ];

    const issueId = Number(req.params.id);

    if (!Number.isSafeInteger(issueId) || issueId <= 0) {
      return res.status(400).json({
        error: "Invalid complaint ID"
      });
    }

    if (
      status === undefined &&
      department === undefined
    ) {
      return res.status(400).json({
        error: "Provide status or department"
      });
    }

    if (
      status !== undefined &&
      !validStatuses.includes(status)
    ) {
      return res.status(400).json({
        error: "Invalid complaint status"
      });
    }

    if (
      department !== undefined &&
      !AUTHORITIES.includes(department)
    ) {
      return res.status(400).json({
        error: "Invalid department"
      });
    }

    try {
      const result = await pool.query(
        `
        UPDATE issues
        SET
          status = COALESCE($1, status),
          department = COALESCE($2, department),
          resolved_at = CASE
            WHEN $1::varchar = 'Resolved'
              AND status <> 'Resolved'
              THEN CURRENT_TIMESTAMP

            WHEN $1::varchar IS NOT NULL
              AND $1::varchar <> 'Resolved'
              THEN NULL

            ELSE resolved_at
          END
        WHERE id = $3
        RETURNING *
        `,
        [
          status ?? null,
          department ?? null,
          issueId
        ]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          error: "Complaint not found"
        });
      }

      res.json({
        message: "Complaint updated successfully",
        issue: result.rows[0]
      });

    } catch (error) {
      console.error("Update complaint:", error.message);

      res.status(500).json({
        error: "Failed to update complaint"
      });
    }
  }
);


// ADMIN - GET REGISTERED USERS

app.get("/api/admin/users", verifyAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        u.id,
        u.name,
        u.email,
        u.gender,
        u.mobile,
        u.created_at,
        COUNT(i.id)::int AS total_complaints
      FROM users u
      LEFT JOIN issues i ON i.user_id = u.id
      GROUP BY
        u.id,
        u.name,
        u.email,
        u.gender,
        u.mobile,
        u.created_at
      ORDER BY u.created_at DESC
    `);

    res.json(result.rows);

  } catch (error) {
    console.error("Admin get users:", error.message);

    res.status(500).json({
      error: "Failed to fetch users"
    });
  }
});

// ==========================================
// ERROR HANDLING
// ==========================================

app.use((error, _req, res, _next) => {
  console.error("Request error:", error.message);

  if (
    error instanceof multer.MulterError &&
    error.code === "LIMIT_FILE_SIZE"
  ) {
    return res.status(400).json({
      error: "Photo must be 5 MB or smaller.",
    });
  }

  res.status(400).json({
    error: error.message || "Invalid request.",
  });
});

// ==========================================
// DATABASE AUTO-INITIALIZATION & SEED
// ==========================================

async function initDatabase() {
  try {
    // 1. Ensure users table exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        gender VARCHAR(40) NOT NULL,
        mobile VARCHAR(15) UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        state VARCHAR(100) DEFAULT 'Maharashtra',
        city VARCHAR(100) DEFAULT 'Mumbai',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 2. Ensure admins table and geographic columns exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS admins (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        admin_level VARCHAR(30) NOT NULL DEFAULT 'CITY'
          CHECK (admin_level IN ('NATIONAL', 'STATE', 'DISTRICT', 'CITY', 'BLOCK')),
        state VARCHAR(100),
        district VARCHAR(100),
        city VARCHAR(100),
        block VARCHAR(100),
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 3. Ensure issues table exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS issues (
        id SERIAL PRIMARY KEY,
        tracking_id VARCHAR(20) UNIQUE NOT NULL,
        title VARCHAR(200) NOT NULL,
        category VARCHAR(100) NOT NULL,
        description TEXT NOT NULL,
        department VARCHAR(120) NOT NULL DEFAULT 'Municipal Corporation',
        photo_url TEXT,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        status VARCHAR(30) NOT NULL DEFAULT 'Pending'
          CHECK (status IN ('Pending', 'In Progress', 'Resolved')),
        latitude NUMERIC(10, 7),
        longitude NUMERIC(10, 7),
        state VARCHAR(100) DEFAULT 'Maharashtra',
        district VARCHAR(100) DEFAULT 'Mumbai Suburban',
        city VARCHAR(100) DEFAULT 'Mumbai',
        block VARCHAR(100) DEFAULT 'Powai',
        pincode VARCHAR(10),
        resolved_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 4. Upgrade missing columns if tables already existed
    await pool.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS state VARCHAR(100) DEFAULT 'Maharashtra';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS city VARCHAR(100) DEFAULT 'Mumbai';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS latitude NUMERIC(10, 7) DEFAULT 19.0760000;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS longitude NUMERIC(10, 7) DEFAULT 72.8777000;

      ALTER TABLE admins ADD COLUMN IF NOT EXISTS admin_level VARCHAR(30) DEFAULT 'CITY';
      ALTER TABLE admins ADD COLUMN IF NOT EXISTS state VARCHAR(100);
      ALTER TABLE admins ADD COLUMN IF NOT EXISTS district VARCHAR(100);
      ALTER TABLE admins ADD COLUMN IF NOT EXISTS city VARCHAR(100);
      ALTER TABLE admins ADD COLUMN IF NOT EXISTS block VARCHAR(100);
      ALTER TABLE admins ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;

      ALTER TABLE issues ADD COLUMN IF NOT EXISTS title VARCHAR(200);
      ALTER TABLE issues ADD COLUMN IF NOT EXISTS category VARCHAR(100);
      ALTER TABLE issues ADD COLUMN IF NOT EXISTS photo_url TEXT;
      ALTER TABLE issues ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
      ALTER TABLE issues ADD COLUMN IF NOT EXISTS is_anonymous BOOLEAN DEFAULT FALSE;
      ALTER TABLE issues ADD COLUMN IF NOT EXISTS state VARCHAR(100) DEFAULT 'Maharashtra';
      ALTER TABLE issues ADD COLUMN IF NOT EXISTS district VARCHAR(100) DEFAULT 'Mumbai Suburban';
      ALTER TABLE issues ADD COLUMN IF NOT EXISTS city VARCHAR(100) DEFAULT 'Mumbai';
      ALTER TABLE issues ADD COLUMN IF NOT EXISTS block VARCHAR(100) DEFAULT 'Powai';
      ALTER TABLE issues ADD COLUMN IF NOT EXISTS pincode VARCHAR(10);
      ALTER TABLE issues ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMP;
    `);

    // 4b. Ensure notifications table exists (Part 1: 10km Nearby Citizen Alerts)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        issue_id INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
        title VARCHAR(200) NOT NULL,
        message TEXT,
        distance_km NUMERIC(5, 2) NOT NULL,
        is_read BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_notifications_user_unread 
        ON notifications(user_id, is_read);
      CREATE INDEX IF NOT EXISTS idx_notifications_issue 
        ON notifications(issue_id);
    `);

    // 4c. Part 2: Upvotes, Downvotes, Duplicate detection & issue_votes table
    await pool.query(`
      ALTER TABLE issues ADD COLUMN IF NOT EXISTS upvotes_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE issues ADD COLUMN IF NOT EXISTS downvotes_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE issues ADD COLUMN IF NOT EXISTS is_duplicate BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE issues ADD COLUMN IF NOT EXISTS duplicate_of_id INTEGER REFERENCES issues(id) ON DELETE SET NULL;

      CREATE TABLE IF NOT EXISTS issue_votes (
        id SERIAL PRIMARY KEY,
        issue_id INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        vote_type VARCHAR(10) NOT NULL CHECK (vote_type IN ('upvote', 'downvote')),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT unique_issue_user_vote UNIQUE (issue_id, user_id)
      );

      CREATE INDEX IF NOT EXISTS idx_issue_votes_lookup 
        ON issue_votes(issue_id, user_id);
    `);

    // 4d. Part 3: Social Media Style Citizen Discussion & Comments table
    await pool.query(`
      ALTER TABLE issues ADD COLUMN IF NOT EXISTS comments_count INTEGER NOT NULL DEFAULT 0;

      CREATE TABLE IF NOT EXISTS issue_comments (
        id SERIAL PRIMARY KEY,
        issue_id INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        comment TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_issue_comments_issue 
        ON issue_comments(issue_id, created_at ASC);
    `);

    // 5. Ensure default demo admin accounts exist with known password
    const defaultPassword = process.env.ADMIN_PASSWORD || "Admin@12345678";
    const passwordHash = await bcrypt.hash(defaultPassword, 10);

    const demoAdmins = [
      { name: "System Administrator", email: "admin@civicwatch.gov.in", level: "NATIONAL" },
      { name: "National Nodal Officer (MoHUA)", email: "national@civicwatch.gov.in", level: "NATIONAL" },
      { name: "Maharashtra Urban Development", email: "state.mh@civicwatch.gov.in", level: "STATE", state: "Maharashtra" },
      { name: "Municipal Corp of Greater Mumbai", email: "admin.mumbai@civicwatch.gov.in", level: "CITY", state: "Maharashtra", district: "Mumbai Suburban", city: "Mumbai" },
      { name: "Powai Ward-S Officer", email: "ward.powai@civicwatch.gov.in", level: "BLOCK", state: "Maharashtra", district: "Mumbai Suburban", city: "Mumbai", block: "Powai" },
    ];

    for (const a of demoAdmins) {
      const existing = await pool.query("SELECT id FROM admins WHERE email = $1", [a.email]);
      if (existing.rows.length === 0) {
        await pool.query(
          `INSERT INTO admins (name, email, password_hash, admin_level, state, district, city, block, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE)`,
          [a.name, a.email, passwordHash, a.level, a.state || null, a.district || null, a.city || null, a.block || null]
        );
      } else {
        await pool.query(
          `UPDATE admins 
           SET password_hash = $1, admin_level = $2, is_active = TRUE 
           WHERE email = $3`,
          [passwordHash, a.level, a.email]
        );
      }
    }

    // 6. Seed demo issues if table is empty
    const checkIssues = await pool.query("SELECT COUNT(*)::int AS count FROM issues");
    if (checkIssues.rows[0].count === 0) {
      await pool.query(`
        INSERT INTO issues (tracking_id, title, category, description, department, status, latitude, longitude, state, district, city, block)
        VALUES
        ('CW-DEMO01', 'Pothole near main road', 'Road', 'Pothole reported near the main road', 'Public Works Department (PWD)', 'Pending', 19.0760000, 72.8777000, 'Maharashtra', 'Mumbai Suburban', 'Mumbai', 'Powai'),
        ('CW-DEMO02', 'Garbage collection delayed', 'Garbage', 'Garbage collection is delayed in the residential lane', 'Sanitation and Waste Management', 'In Progress', 19.0900000, 72.8650000, 'Maharashtra', 'Mumbai Suburban', 'Mumbai', 'Powai'),
        ('CW-DEMO03', 'Streetlight not working', 'Streetlight', 'Streetlight fixture blinking and off for 3 days', 'Street Lighting Department', 'Resolved', 19.1170000, 72.9050000, 'Maharashtra', 'Mumbai Suburban', 'Mumbai', 'Powai')
        ON CONFLICT (tracking_id) DO NOTHING;
      `);
    }

    console.log("✓ Database tables and demo accounts verified");

  } catch (err) {
    console.error("Database initialization notice:", err.message);
  }
}

// ==========================================
// START SERVER
// ==========================================

async function startServer() {
  try {
    await pool.query("SELECT NOW()");

    console.log("Connected to PostgreSQL");

    await initDatabase();

    app.listen(PORT, "0.0.0.0", () => {
      console.log(
        `CivicWatch API listening at http://localhost:${PORT}`
      );
    });

  } catch (error) {
    const errorMsg =
      error.message ||
      (error.errors && error.errors.map((e) => e.message || e.code).join(", ")) ||
      error.code ||
      String(error);

    console.error("Could not connect to PostgreSQL:", errorMsg);
    console.error("Check that PostgreSQL is running on port 5432 and credentials in backend/.env are valid.");

    process.exit(1);
  }
}

startServer();
