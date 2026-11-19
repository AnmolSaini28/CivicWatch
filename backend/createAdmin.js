require("dotenv").config();

const bcrypt = require("bcryptjs");
const pool = require("./db");

async function createAdmin() {
  const name = process.env.NEW_ADMIN_NAME?.trim();
  const email = process.env.NEW_ADMIN_EMAIL
    ?.trim()
    .toLowerCase();
  const password = process.env.NEW_ADMIN_PASSWORD;

  if (!name || !email || !password) {
    throw new Error("Admin name, email and password are required");
  }

  if (password.length < 12) {
    throw new Error("Admin password must be at least 12 characters");
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const result = await pool.query(
    `
    INSERT INTO admins (name, email, password_hash)
    VALUES ($1, $2, $3)
    ON CONFLICT (email) DO NOTHING
    RETURNING id, name, email
    `,
    [name, email, passwordHash]
  );

  if (result.rows.length === 0) {
    console.log("Admin email already exists");
  } else {
    console.log("Admin created:", result.rows[0].email);
  }
}

createAdmin()
  .catch((error) => {
    console.error("Create admin:", error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());