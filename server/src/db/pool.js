// server/src/db/pool.js
import pg from "pg";
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgres://weave:weavepass@localhost:5432/weave",
});

export { pool };


