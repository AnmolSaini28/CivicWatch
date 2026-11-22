const { Pool } = require("pg");
const path = require("path");

require("dotenv").config({
  path: path.join(__dirname, ".env"),
});

// Pool manages PostgreSQL connections for us.
const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    "postgresql://postgres:postgres@localhost:5432/civicwatch",
});

pool.on("error", (err) => {
  console.error("Unexpected error on idle PostgreSQL client:", err.message || err);
});

module.exports = pool;
