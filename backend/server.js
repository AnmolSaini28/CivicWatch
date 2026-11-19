
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
// TRACKING ID GENERATOR
// ==========================================

function makeTrackingId() {
  return (
    "CW-" +
    Math.random().toString(36).substring(2, 8).toUpperCase()
  );
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
      process.env.JWT_SECRET,
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
      `SELECT id, name, email
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
      // Anonymous complaints have NULL user_id
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

      // Photo URL
      const photoUrl = req.file
        ? `/uploads/${req.file.filename}`
        : null;

      // Insert complaint into PostgreSQL
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
          latitude,
          longitude
        )
        VALUES ($1, $2, $2, $3, $4, $5, $6, $7, $8)
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
      `SELECT id, name, email, password_hash
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
      process.env.JWT_SECRET,
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
        email: admin.email
      }
    });

  } catch (error) {
    console.error("Admin login:", error.message);

    res.status(500).json({
      error: "Admin login failed"
    });
  }
});


// ADMIN - GET ALL COMPLAINTS

app.get("/api/admin/issues", verifyAdmin, async (req, res) => {
  try {
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
        i.city,
        i.latitude,
        i.longitude,
        i.created_at,
        i.resolved_at,
        u.name AS reported_by
      FROM issues i
      LEFT JOIN users u ON i.user_id = u.id
      ORDER BY i.created_at DESC, i.id DESC
    `);

    res.json(result.rows);

  } catch (error) {
    console.error("Admin get issues:", error.message);

    res.status(500).json({
      error: "Failed to fetch complaints"
    });
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
// START SERVER
// ==========================================

async function startServer() {
  try {
    await pool.query("SELECT NOW()");

    console.log("Connected to PostgreSQL");

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
