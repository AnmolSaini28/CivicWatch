const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const { Pool } = require("pg");

// Pool manages PostgreSQL connections for us.
const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    "postgresql://ajeet@localhost:5432/civicwatch",
});

pool.on("error", (err) => {
  console.error("Unexpected error on idle PostgreSQL client:", err.message || err);
});

module.exports = pool;
