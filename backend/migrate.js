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

  // 2. Add missing columns to issues table
  await pool.query(`
    ALTER TABLE issues ADD COLUMN IF NOT EXISTS city VARCHAR(100);
    ALTER TABLE issues ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMP;
    ALTER TABLE issues ADD COLUMN IF NOT EXISTS title VARCHAR(200);
    ALTER TABLE issues ADD COLUMN IF NOT EXISTS photo_url TEXT;
    ALTER TABLE issues ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
  `);
  console.log("✓ 'issues' table columns verified/updated");

  // Populate city for existing issues that have NULL city
  await pool.query(`
    UPDATE issues SET city = 'Mumbai' WHERE city IS NULL;
  `);

  // 3. Create or update default admin account
  const defaultEmail = "admin@civicwatch.gov.in";
  const defaultPassword = process.env.ADMIN_PASSWORD || "Admin@12345678";
  const defaultName = process.env.ADMIN_NAME || "System Administrator";

  const existingAdmin = await pool.query(
    "SELECT id, email FROM admins WHERE email = $1",
    [defaultEmail]
  );

  if (existingAdmin.rows.length === 0) {
    const passwordHash = await bcrypt.hash(defaultPassword, 10);
    await pool.query(
      `INSERT INTO admins (name, email, password_hash, is_active)
       VALUES ($1, $2, $3, TRUE)`,
      [defaultName, defaultEmail, passwordHash]
    );
    console.log(`✓ Created default admin: ${defaultEmail} (Password: ${defaultPassword})`);
  } else {
    console.log(`✓ Admin already exists: ${defaultEmail}`);
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
