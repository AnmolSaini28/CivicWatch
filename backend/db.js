const { Pool } = require("pg");
require("dotenv").config();

// Pool manages PostgreSQL connections for us.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

module.exports = pool;
