require("dotenv").config();
const bcrypt = require("bcryptjs");
const pool = require("./db");

async function migrate() {
  console.log("Running database migrations for CivicWatch Admin...");

  // 1. Create admins table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admins (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  console.log("✓ 'admins' table verified/created");

  // 2. Add missing columns to issues, admins and users tables
  await pool.query(`
    ALTER TABLE issues ADD COLUMN IF NOT EXISTS state VARCHAR(100) DEFAULT 'Maharashtra';
    ALTER TABLE issues ADD COLUMN IF NOT EXISTS district VARCHAR(100) DEFAULT 'Mumbai Suburban';
    ALTER TABLE issues ADD COLUMN IF NOT EXISTS city VARCHAR(100) DEFAULT 'Mumbai';
    ALTER TABLE issues ADD COLUMN IF NOT EXISTS block VARCHAR(100) DEFAULT 'Powai';
    ALTER TABLE issues ADD COLUMN IF NOT EXISTS pincode VARCHAR(10);
    ALTER TABLE issues ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMP;
    ALTER TABLE issues ADD COLUMN IF NOT EXISTS title VARCHAR(200);
    ALTER TABLE issues ADD COLUMN IF NOT EXISTS photo_url TEXT;
    ALTER TABLE issues ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;

    ALTER TABLE admins ADD COLUMN IF NOT EXISTS admin_level VARCHAR(30) DEFAULT 'CITY';
    ALTER TABLE admins ADD COLUMN IF NOT EXISTS state VARCHAR(100);
    ALTER TABLE admins ADD COLUMN IF NOT EXISTS district VARCHAR(100);
    ALTER TABLE admins ADD COLUMN IF NOT EXISTS city VARCHAR(100);
    ALTER TABLE admins ADD COLUMN IF NOT EXISTS block VARCHAR(100);

    ALTER TABLE users ADD COLUMN IF NOT EXISTS state VARCHAR(100) DEFAULT 'Maharashtra';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS city VARCHAR(100) DEFAULT 'Mumbai';
  `);
  console.log("✓ Geographic hierarchy columns verified/updated");

  // Populate city/state for existing issues that have NULL
  await pool.query(`
    UPDATE issues SET city = 'Mumbai' WHERE city IS NULL;
    UPDATE issues SET state = 'Maharashtra' WHERE state IS NULL;
    UPDATE issues SET district = 'Mumbai Suburban' WHERE district IS NULL;
    UPDATE issues SET block = 'Powai' WHERE block IS NULL;
  `);

  // 3. Seed Hierarchical Admin Accounts (National, State, City, Block)
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
         SET admin_level = $1, state = $2, district = $3, city = $4, block = $5
         WHERE email = $6`,
        [a.level, a.state, a.district, a.city, a.block, a.email]
      );
    }
  }

  // Check complaint counts
  const issueCount = await pool.query("SELECT COUNT(*)::int AS count FROM issues");
  const userCount = await pool.query("SELECT COUNT(*)::int AS count FROM users");
  console.log(`✓ Current database state: ${issueCount.rows[0].count} issues, ${userCount.rows[0].count} users`);
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
