
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const path = require("path");
const fs = require("fs");
const pool = require("./db");

const app = express();
const PORT = process.env.PORT || 5001;


app.use(cors());
app.use(express.json());

// Serve uploaded complaint photos
const uploadDirectory = path.join(__dirname, "uploads");
fs.mkdirSync(uploadDirectory, { recursive: true });

app.use("/uploads", express.static(uploadDirectory));

// ==========================================
// PHOTO UPLOAD MIDDLEWARE
// ==========================================

function uploadSinglePhoto(req, res, next) {
  const contentType = req.headers["content-type"] || "";

  if (!contentType.includes("multipart/form-data")) {
    req.body = req.body || {};
    return next();
  }

  const boundaryMatch = contentType.match(
    /boundary=(?:"([^"]+)"|([^;]+))/i
  );

  if (!boundaryMatch) {
    return res.status(400).json({
      error: "Invalid multipart form data"
    });
  }

  const boundary = Buffer.from(
    `--${boundaryMatch[1] || boundaryMatch[2]}`
  );

  const chunks = [];
  let totalBytes = 0;
  let uploadRejected = false;

  req.on("data", (chunk) => {
    totalBytes += chunk.length;

    if (totalBytes > 6 * 1024 * 1024) {
      uploadRejected = true;

      res.status(413).json({
        error: "Upload is too large (maximum 5 MB)"
      });

      req.destroy();
      return;
    }

    chunks.push(chunk);
  });

  req.on("end", async () => {
    if (uploadRejected) return;

    try {
      const body = Buffer.concat(chunks);

      req.body = {};

      let position = 0;

      while ((position = body.indexOf(boundary, position)) !== -1) {
        position += boundary.length;

        if (body.slice(position, position + 2).toString() === "--") {
          break;
        }

        if (body.slice(position, position + 2).toString() === "\r\n") {
          position += 2;
        }

        const headerEnd = body.indexOf(
          Buffer.from("\r\n\r\n"),
          position
        );

        if (headerEnd === -1) break;

        const headers = body
          .slice(position, headerEnd)
          .toString("utf8");

        const dataStart = headerEnd + 4;

        const nextBoundary = body.indexOf(boundary, dataStart);

        if (nextBoundary === -1) break;

        let dataEnd = nextBoundary;

        if (
          body.slice(dataEnd - 2, dataEnd).toString() === "\r\n"
        ) {
          dataEnd -= 2;
        }

        const disposition = headers.match(
          /content-disposition:\s*form-data;\s*name="([^"]+)"(?:;\s*filename="([^"]*)")?/i
        );

        if (!disposition) {
          position = nextBoundary;
          continue;
        }

        const fieldName = disposition[1];
        const filename = disposition[2];

        const part = body.slice(dataStart, dataEnd);

        if (filename !== undefined && filename !== "") {
          const mimeMatch = headers.match(
            /content-type:\s*([^\r\n]+)/i
          );

          const mimeType = mimeMatch
            ? mimeMatch[1].trim()
            : "application/octet-stream";

          if (!mimeType.startsWith("image/")) {
            return res.status(400).json({
              error: "Only image files are allowed"
            });
          }

          if (part.length > 5 * 1024 * 1024) {
            return res.status(400).json({
              error: "Image must be 5 MB or smaller"
            });
          }

          const extension = path
            .extname(filename)
            .toLowerCase()
            .replace(/[^.a-z0-9]/g, "");

          const storedName =
            `${Date.now()}-${Math.random()
              .toString(36)
              .slice(2, 10)}${extension}`;

          const storedPath = path.join(
            uploadDirectory,
            storedName
          );

          await fs.promises.writeFile(storedPath, part);

          req.file = {
            filename: storedName,
            path: storedPath
          };

        } else {
          req.body[fieldName] = part.toString("utf8");
        }

        position = nextBoundary;
      }

      next();

    } catch (error) {
      next(error);
    }
  });

  req.on("error", next);
}

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
  "Fire and Emergency Services"
];

// ==========================================
// TRACKING ID GENERATOR
// ==========================================

function makeTrackingId() {
  return (
    "CW-" +
    Math.random()
      .toString(36)
      .substring(2, 8)
      .toUpperCase()
  );
}

// ==========================================
// HOME ROUTE
// ==========================================

app.get("/", (req, res) => {
  res.json({
    message: "CivicWatch API is running"
  });
});

// ==========================================
// GET AUTHORITIES
// ==========================================

app.get("/api/authorities", (req, res) => {
  res.json(AUTHORITIES);
});

// ==========================================
// GET ALL ISSUES
// ==========================================

app.get("/api/issues", async (req, res) => {
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
        user_id,
        status,
        latitude,
        longitude,
        created_at
       FROM issues
       ORDER BY created_at DESC`
    );

    res.json(result.rows);

  } catch (error) {
    console.error("GET issues:", error.message);

    res.status(500).json({
      error: "Could not load issues"
    });
  }
});

// ==========================================
// DASHBOARD STATISTICS
// ==========================================

app.get("/api/dashboard", async (req, res) => {
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
        status
      FROM issues
      ORDER BY created_at DESC
      LIMIT 8
    `);

    res.json({
      ...counts.rows[0],
      categories: categories.rows,
      recent: recent.rows
    });

  } catch (error) {
    console.error("GET dashboard:", error.message);

    res.status(500).json({
      error: "Could not load dashboard"
    });
  }
});

// ==========================================
// TRACK COMPLAINT
// ==========================================

app.get("/api/issues/track/:trackingId", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
        tracking_id,
        category,
        description,
        department,
        status
       FROM issues
       WHERE UPPER(tracking_id) = UPPER($1)`,
      [req.params.trackingId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "No issue found with this tracking ID"
      });
    }

    res.json(result.rows[0]);

  } catch (error) {
    console.error("Track issue:", error.message);

    res.status(500).json({
      error: "Could not track issue"
    });
  }
});

// ==========================================
// CREATE NEW COMPLAINT
// ==========================================

app.post("/api/issues", uploadSinglePhoto, async (req, res) => {
  const {
    title,
    description,
    authority,
    latitude,
    longitude,
    userId
  } = req.body;

  const cleanTitle = (title || "").trim();
  const cleanDescription = (description || "").trim();

  // Validate required fields
  if (!cleanTitle || !cleanDescription || !authority) {
    if (req.file) {
      fs.unlink(req.file.path, () => {});
    }

    return res.status(400).json({
      error: "Title, description and authority are required"
    });
  }

  // Validate authority
  if (!AUTHORITIES.includes(authority)) {
    if (req.file) {
      fs.unlink(req.file.path, () => {});
    }

    return res.status(400).json({
      error: "Please select a valid authority"
    });
  }

  try {
    // Anonymous complaints have NULL user_id
    let resolvedUserId = null;

    if (userId !== undefined && userId !== "") {
      const userResult = await pool.query(
        "SELECT id FROM users WHERE id = $1",
        [userId]
      );

      if (userResult.rows.length === 0) {
        if (req.file) {
          fs.unlink(req.file.path, () => {});
        }

        return res.status(400).json({
          error: "Invalid user account"
        });
      }

      resolvedUserId = userResult.rows[0].id;
    }

    // Generate unique tracking ID
    let trackingId = makeTrackingId();

    let exists = await pool.query(
      "SELECT id FROM issues WHERE tracking_id = $1",
      [trackingId]
    );

    while (exists.rows.length > 0) {
      trackingId = makeTrackingId();

      exists = await pool.query(
        "SELECT id FROM issues WHERE tracking_id = $1",
        [trackingId]
      );
    }

    // Save photo URL
    const photoUrl = req.file
      ? `/uploads/${req.file.filename}`
      : null;

    // Insert complaint into database
    const result = await pool.query(
      `INSERT INTO issues
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
          created_at`,
      [
        trackingId,
        cleanTitle,
        cleanDescription,
        authority,
        photoUrl,
        resolvedUserId,
        latitude === "" || latitude === undefined
          ? null
          : latitude,
        longitude === "" || longitude === undefined
          ? null
          : longitude
      ]
    );

    res.status(201).json(result.rows[0]);

  } catch (error) {
    if (req.file) {
      fs.unlink(req.file.path, () => {});
    }

    console.error("Create issue:", error.message);

    res.status(500).json({
      error: "Could not create complaint"
    });
  }
});

// ==========================================
// USER SIGNUP
// ==========================================

app.post("/api/auth/signup", async (req, res) => {
  const {
    name,
    email,
    gender,
    mobile,
    password
  } = req.body;

  if (!name || !email || !gender || !mobile || !password) {
    return res.status(400).json({
      error: "Please fill in all fields"
    });
  }

  if (password.length < 8) {
    return res.status(400).json({
      error: "Password must be at least 8 characters"
    });
  }

  try {
    const normalizedEmail = email.trim().toLowerCase();

    const normalizedMobile = mobile
      .replace(/[\s-]/g, "")
      .replace(/^\+91|^0/, "");

    const passwordHash = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO users
        (name, email, gender, mobile, password_hash)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, email, gender, mobile`,
      [
        name.trim(),
        normalizedEmail,
        gender,
        normalizedMobile,
        passwordHash
      ]
    );

    res.status(201).json({
      user: result.rows[0]
    });

  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({
        error: "This email or mobile number is already registered"
      });
    }

    console.error("Signup:", error.message);

    res.status(500).json({
      error: "Could not create account"
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
      error: "Email and password are required"
    });
  }

  try {
    const result = await pool.query(
      `SELECT
        id,
        name,
        email,
        gender,
        mobile,
        password_hash
       FROM users
       WHERE email = $1`,
      [email.trim().toLowerCase()]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        error: "Incorrect email or password"
      });
    }

    const account = result.rows[0];

    const passwordMatches = await bcrypt.compare(
      password,
      account.password_hash
    );

    if (!passwordMatches) {
      return res.status(401).json({
        error: "Incorrect email or password"
      });
    }

    const {
      password_hash,
      ...safeUser
    } = account;

    res.json({
      user: safeUser
    });

  } catch (error) {
    console.error("Login:", error.message);

    res.status(500).json({
      error: "Could not log in"
    });
  }
});

// ==========================================
// ERROR HANDLING
// ==========================================

app.use((error, req, res, next) => {
  if (error.message === "Only image files are allowed") {
    return res.status(400).json({
      error: error.message
    });
  }

  console.error(error);

  res.status(500).json({
    error: "Unexpected server error"
  });
});

// ==========================================
// START SERVER
// ==========================================

async function startServer() {
  try {
    await pool.query("SELECT NOW()");

    console.log("Connected to PostgreSQL");

    app.listen(PORT, () => {
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
