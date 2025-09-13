// server/src/db/pool.js
import pg from "pg";
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/weave",
  // or configure individually:
  // host: process.env.PGHOST || "localhost",
  // user: process.env.PGUSER || "postgres",
  // password: process.env.PGPASSWORD || "postgres",
  // database: process.env.PGDATABASE || "weave",
  // port: process.env.PGPORT || 5432,
});

export { pool };
