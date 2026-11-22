const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const bcrypt = require("bcryptjs");
const pool = require("./db");

async function migrate() {
  console.log("Running database migrations for CivicWatch...");

  // 1. Create users table if not exists
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
  console.log("✓ 'users' table verified/created");

  // 2. Create admins table if not exists
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
  console.log("✓ 'admins' table verified/created");

  // 3. Create issues table if not exists
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
      is_anonymous BOOLEAN DEFAULT FALSE,
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
  console.log("✓ 'issues' table verified/created");

  // 4. Add missing columns to issues, admins and users tables
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS state VARCHAR(100) DEFAULT 'Maharashtra';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS city VARCHAR(100) DEFAULT 'Mumbai';

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
  console.log("✓ Geographic hierarchy and optional columns verified");

  // Populate city/state for existing issues that have NULL
  await pool.query(`
    UPDATE issues SET city = 'Mumbai' WHERE city IS NULL;
    UPDATE issues SET state = 'Maharashtra' WHERE state IS NULL;
    UPDATE issues SET district = 'Mumbai Suburban' WHERE district IS NULL;
    UPDATE issues SET block = 'Powai' WHERE block IS NULL;
    UPDATE issues SET category = 'Other' WHERE category IS NULL;
  `);

  // 5. Seed Hierarchical Admin Accounts (National, State, City, Block)
  const defaultPassword = process.env.ADMIN_PASSWORD || "Admin@12345678";
  const passwordHash = await bcrypt.hash(defaultPassword, 10);

  const demoAdmins = [
    {
      name: "National Nodal Officer (MoHUA)",
      email: "national@civicwatch.gov.in",
      level: "NATIONAL",
      state: null,
      district: null,
      city: null,
      block: null,
    },
    {
      name: "Maharashtra Urban Development",
      email: "state.mh@civicwatch.gov.in",
      level: "STATE",
      state: "Maharashtra",
      district: null,
      city: null,
      block: null,
    },
    {
      name: "Municipal Corp of Greater Mumbai",
      email: "admin.mumbai@civicwatch.gov.in",
      level: "CITY",
      state: "Maharashtra",
      district: "Mumbai Suburban",
      city: "Mumbai",
      block: null,
    },
    {
      name: "Powai Ward-S Officer",
      email: "ward.powai@civicwatch.gov.in",
      level: "BLOCK",
      state: "Maharashtra",
      district: "Mumbai Suburban",
      city: "Mumbai",
      block: "Powai",
    },
    {
      name: "System Administrator",
      email: "admin@civicwatch.gov.in",
      level: "NATIONAL",
      state: null,
      district: null,
      city: null,
      block: null,
    },
  ];

  for (const a of demoAdmins) {
    const existing = await pool.query("SELECT id FROM admins WHERE email = $1", [a.email]);
    if (existing.rows.length === 0) {
      await pool.query(
        `INSERT INTO admins (name, email, password_hash, admin_level, state, district, city, block, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE)`,
        [a.name, a.email, passwordHash, a.level, a.state, a.district, a.city, a.block]
      );
      console.log(`✓ Created admin: ${a.email} (${a.level})`);
    } else {
      await pool.query(
        `UPDATE admins 
         SET admin_level = $1, state = $2, district = $3, city = $4, block = $5, is_active = TRUE
         WHERE email = $6`,
        [a.level, a.state, a.district, a.city, a.block, a.email]
      );
    }
  }

  // 6. Seed demo issues if table is empty
  const issueCountCheck = await pool.query("SELECT COUNT(*)::int AS count FROM issues");
  if (issueCountCheck.rows[0].count === 0) {
    await pool.query(`
      INSERT INTO issues (tracking_id, title, category, description, department, status, latitude, longitude, state, district, city, block)
      VALUES
      ('CW-DEMO01', 'Pothole near main road', 'Road', 'Pothole reported near the main road', 'Public Works Department (PWD)', 'Pending', 19.0760000, 72.8777000, 'Maharashtra', 'Mumbai Suburban', 'Mumbai', 'Powai'),
      ('CW-DEMO02', 'Garbage collection delayed', 'Garbage', 'Garbage collection is delayed in the residential lane', 'Sanitation and Waste Management', 'In Progress', 19.0900000, 72.8650000, 'Maharashtra', 'Mumbai Suburban', 'Mumbai', 'Powai'),
      ('CW-DEMO03', 'Streetlight not working', 'Streetlight', 'Streetlight fixture blinking and off for 3 days', 'Street Lighting Department', 'Resolved', 19.1170000, 72.9050000, 'Maharashtra', 'Mumbai Suburban', 'Mumbai', 'Powai')
      ON CONFLICT (tracking_id) DO NOTHING;
    `);
    console.log("✓ Seeded demo issues");
  }

  const issueCount = await pool.query("SELECT COUNT(*)::int AS count FROM issues");
  const userCount = await pool.query("SELECT COUNT(*)::int AS count FROM users");
  const adminCount = await pool.query("SELECT COUNT(*)::int AS count FROM admins");
  console.log(`✓ Current database state: ${issueCount.rows[0].count} issues, ${userCount.rows[0].count} users, ${adminCount.rows[0].count} admins`);
}

migrate()
  .then(() => {
    console.log("Migration completed successfully!");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  })
  .finally(() => pool.end());
