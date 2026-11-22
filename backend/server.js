require("dotenv").config();

const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const pool = require("./db");

const app = express();
const PORT = process.env.PORT || 5001;

app.use(cors());
app.use(express.json());

const uploadDirectory = path.join(__dirname, "uploads");
fs.mkdirSync(uploadDirectory, { recursive: true });
app.use("/uploads", express.static(uploadDirectory));

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
// REVERSE GEOCODING
// ==========================================

const reverseGeocodeCache = new Map();
let nominatimQueue = Promise.resolve();
let lastNominatimRequestAt = 0;

function requestNominatim(url) {
  const request = nominatimQueue.then(async () => {
    const waitMs = Math.max(
      0,
      1000 - (Date.now() - lastNominatimRequestAt)
    );

    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }

    lastNominatimRequestAt = Date.now();

    const response = await fetch(url, {
      headers: {
        "User-Agent": "CivicWatch/1.0 (civic issue reporting application)",
        "Accept-Language": "en",
      },
    });

    if (!response.ok) {
      throw new Error(`Nominatim returned HTTP ${response.status}`);
    }

    return response.json();
  });

  nominatimQueue = request.then(() => undefined, () => undefined);

  return request;
}

function getLocationDetails(geocodeResult) {
  const address = geocodeResult.address || {};

  const city =
    address.city ||
    address.town ||
    address.municipality ||
    address.village ||
    address.county ||
    address.state_district ||
    "";

  const state = address.state || address.region || "";

  const isNamedPlace = [
    "amenity",
    "building",
    "leisure",
    "tourism",
    "shop",
    "office",
    "historic",
    "university",
    "man_made",
  ].some((key) => address[key]);

  const areaCandidates = [
    ...(isNamedPlace ? [geocodeResult.name] : []),
    address.neighbourhood,
    address.suburb,
    address.quarter,
    address.residential,
    address.hamlet,
    address.locality,
  ];

  const areaParts = [];

  for (const candidate of areaCandidates) {
    const value = String(candidate || "").trim();

    if (
      value &&
      value.toLowerCase() !== city.toLowerCase() &&
      !areaParts.some(
        (part) => part.toLowerCase() === value.toLowerCase()
      )
    ) {
      areaParts.push(value);
    }
  }

  if (areaParts.length === 0) {
    const fallbackArea =
      address.road ||
      (geocodeResult.name && geocodeResult.name !== city
        ? geocodeResult.name
        : "");

    if (fallbackArea) areaParts.push(String(fallbackArea).trim());
  }

  return {
    location: areaParts.join(", "),
    city: String(city).trim(),
    state: String(state).trim(),
  };
}

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
// TRACKING ID GENERATOR
// ==========================================

function makeTrackingId() {
  return (
    "CW-" +
    Math.random().toString(36).substring(2, 8).toUpperCase()
  );
}

// ==========================================
// ADMIN AUTHENTICATION MIDDLEWARE
// ==========================================

async function verifyAdmin(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({
      error: "Admin authentication required",
    });
  }

  const token = authHeader.slice(7);

  try {
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET,
      { algorithms: ["HS256"] }
    );

    if (
      decoded.type !== "admin" ||
      !Number.isInteger(decoded.adminId)
    ) {
      return res.status(403).json({
        error: "Admin access only",
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
        error: "Admin account is inactive or unavailable",
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
        error: "Invalid or expired token",
      });
    }

    console.error("Admin verification:", error.message);

    return res.status(500).json({
      error: "Could not verify admin",
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
// REVERSE GEOCODE SELECTED MAP LOCATION
// ==========================================

app.get("/api/location/reverse", async (req, res) => {
  const latitude = Number(req.query.lat);
  const longitude = Number(req.query.lon);

  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return res.status(400).json({
      error: "Please provide valid map coordinates.",
    });
  }

  const cacheKey = `${latitude.toFixed(5)},${longitude.toFixed(5)}`;

  try {
    let locationDetails = reverseGeocodeCache.get(cacheKey);

    if (!locationDetails) {
      const nominatimUrl = new URL(
        "https://nominatim.openstreetmap.org/reverse"
      );

      nominatimUrl.search = new URLSearchParams({
        format: "jsonv2",
        lat: String(latitude),
        lon: String(longitude),
        zoom: "18",
        addressdetails: "1",
      }).toString();

      const geocodeResult = await requestNominatim(nominatimUrl);

      locationDetails = getLocationDetails(geocodeResult);

      if (
        !locationDetails.location ||
        !locationDetails.city ||
        !locationDetails.state
      ) {
        return res.status(422).json({
          error:
            "Could not identify the area, city and state for this point. Please select another nearby point.",
        });
      }

      if (reverseGeocodeCache.size >= 500) {
        const oldestKey = reverseGeocodeCache.keys().next().value;
        reverseGeocodeCache.delete(oldestKey);
      }

      reverseGeocodeCache.set(cacheKey, locationDetails);
    }

    return res.json(locationDetails);

  } catch (error) {
    console.error("Reverse geocode:", error.message);

    return res.status(502).json({
      error:
        "Could not retrieve location details right now. Please try another map point.",
    });
  }
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
        location,
        city,
        state,
        latitude,
        longitude,
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
          tracking_id,
          title,
          category,
          description,
          department,
          photo_url,
          status,
          location,
          city,
          state,
          latitude,
          longitude
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
    const description = (req.body.description || "").trim();
    const authority = (req.body.authority || "").trim();
    const location = (req.body.location || "").trim();
    const city = (req.body.city || "").trim();
    const state = (req.body.state || "").trim();

    const { latitude, longitude } = req.body;

    if (
      !title ||
      !description ||
      !authority ||
      !location ||
      !city ||
      !state
    ) {
      if (req.file) {
        fs.unlink(req.file.path, () => {});
      }

      return res.status(400).json({
        error:
          "Title, description, authority, location, city and state are required.",
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

    if (
      location.length > 150 ||
      city.length > 100 ||
      state.length > 100
    ) {
      if (req.file) {
        fs.unlink(req.file.path, () => {});
      }

      return res.status(400).json({
        error: "Location, city or state exceeds the allowed length.",
      });
    }

    if (!AUTHORITIES.includes(authority)) {
      if (req.file) {
        fs.unlink(req.file.path, () => {});
      }

      return res.status(400).json({
        error: "Please select a valid authority.",
      });
    }

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

      const photoUrl = req.file
        ? `/uploads/${req.file.filename}`
        : null;

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
          location,
          city,
          state,
          latitude,
          longitude
        )
        VALUES ($1, $2, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING
          id,
          tracking_id,
          title,
          category,
          description,
          department,
          photo_url,
          user_id,
          status,
          location,
          city,
          state,
          latitude,
          longitude,
          created_at
        `,
        [
          trackingId,
          title,
          description,
          authority,
          photoUrl,
          userId,
          location,
          city,
          state,
          lat,
          lng,
        ]
      );

      res.status(201).json(result.rows[0]);

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

    const result = await pool.query(
      `
      INSERT INTO users
      (name, email, gender, mobile, password_hash)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, name, email, gender, mobile
      `,
      [
        name.trim(),
        normalizedEmail,
        gender,
        normalizedMobile,
        passwordHash,
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

// ==========================================
// ADMIN LOGIN
// ==========================================

app.post("/api/admin/login", async (req, res) => {
  const { email, password } = req.body;

  if (
    typeof email !== "string" ||
    typeof password !== "string" ||
    !email.trim() ||
    !password
  ) {
    return res.status(400).json({
      error: "Email and password are required",
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
        error: "Invalid admin credentials",
      });
    }

    const admin = result.rows[0];

    const isValid = await bcrypt.compare(
      password,
      admin.password_hash
    );

    if (!isValid) {
      return res.status(401).json({
        error: "Invalid admin credentials",
      });
    }

    const token = jwt.sign(
      {
        adminId: admin.id,
        type: "admin",
      },
      process.env.JWT_SECRET,
      {
        algorithm: "HS256",
        expiresIn: "8h",
      }
    );

    res.json({
      message: "Admin login successful",
      token,
      admin: {
        id: admin.id,
        name: admin.name,
        email: admin.email,
      },
    });

  } catch (error) {
    console.error("Admin login:", error.message);

    res.status(500).json({
      error: "Admin login failed",
    });
  }
});

// ==========================================
// ADMIN - GET ALL COMPLAINTS
// ==========================================

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
        i.location,
        i.city,
        i.state,
        i.latitude,
        i.longitude,
        i.created_at,
        i.resolved_at,
        u.name AS reported_by
      FROM issues i
      LEFT JOIN users u ON i.user_id = u.id
      ${whereClause}
      ORDER BY i.created_at DESC, i.id DESC
    `, params);

    res.json(result.rows);

  } catch (error) {
    console.error("Admin get issues:", error.message);

    res.status(500).json({
      error: "Failed to fetch complaints",
    });
  }
});

// ==========================================
// ADMIN - UPDATE COMPLAINT
// ==========================================

app.patch(
  "/api/admin/issues/:id",
  verifyAdmin,
  async (req, res) => {
    const { status, department } = req.body;

    const validStatuses = [
      "Pending",
      "In Progress",
      "Resolved",
    ];

    const issueId = Number(req.params.id);

    if (!Number.isSafeInteger(issueId) || issueId <= 0) {
      return res.status(400).json({
        error: "Invalid complaint ID",
      });
    }

    if (
      status === undefined &&
      department === undefined
    ) {
      return res.status(400).json({
        error: "Provide status or department",
      });
    }

    if (
      status !== undefined &&
      !validStatuses.includes(status)
    ) {
      return res.status(400).json({
        error: "Invalid complaint status",
      });
    }

    if (
      department !== undefined &&
      !AUTHORITIES.includes(department)
    ) {
      return res.status(400).json({
        error: "Invalid department",
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
          issueId,
        ]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          error: "Complaint not found",
        });
      }

      res.json({
        message: "Complaint updated successfully",
        issue: result.rows[0],
      });

    } catch (error) {
      console.error("Update complaint:", error.message);

      res.status(500).json({
        error: "Failed to update complaint",
      });
    }
  }
);

// ==========================================
// ADMIN - GET REGISTERED USERS
// ==========================================

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
      error: "Failed to fetch users",
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
    // 1. Ensure admins table and geographic columns exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS admins (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        admin_level VARCHAR(30) NOT NULL DEFAULT 'CITY',
        state VARCHAR(100),
        district VARCHAR(100),
        city VARCHAR(100),
        block VARCHAR(100),
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      ALTER TABLE admins ADD COLUMN IF NOT EXISTS admin_level VARCHAR(30) DEFAULT 'CITY';
      ALTER TABLE admins ADD COLUMN IF NOT EXISTS state VARCHAR(100);
      ALTER TABLE admins ADD COLUMN IF NOT EXISTS district VARCHAR(100);
      ALTER TABLE admins ADD COLUMN IF NOT EXISTS city VARCHAR(100);
      ALTER TABLE admins ADD COLUMN IF NOT EXISTS block VARCHAR(100);

      ALTER TABLE issues ADD COLUMN IF NOT EXISTS state VARCHAR(100) DEFAULT 'Maharashtra';
      ALTER TABLE issues ADD COLUMN IF NOT EXISTS district VARCHAR(100) DEFAULT 'Mumbai Suburban';
      ALTER TABLE issues ADD COLUMN IF NOT EXISTS city VARCHAR(100) DEFAULT 'Mumbai';
      ALTER TABLE issues ADD COLUMN IF NOT EXISTS block VARCHAR(100) DEFAULT 'Powai';
      ALTER TABLE issues ADD COLUMN IF NOT EXISTS pincode VARCHAR(10);
      ALTER TABLE issues ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMP;
      ALTER TABLE issues ADD COLUMN IF NOT EXISTS photo_url TEXT;
      ALTER TABLE issues ADD COLUMN IF NOT EXISTS user_id INTEGER;
    `);

    // 2. Ensure default demo admin accounts exist with known password
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

    console.log("✓ Admin accounts and tables verified");

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
    console.error(
      "Could not connect to PostgreSQL:",
      error.message
    );

    process.exit(1);
  }
}

startServer();