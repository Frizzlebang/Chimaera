// server/src/db/index.js
import { Pool } from "pg";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
export { assertMember } from "../auth/jwt.js";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

// ✅ named export
export function query(text, params) {
  return pool.query(text, params);
}

// ✅ also named export
export async function initSchema() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  const schemaPath = path.join(__dirname, "schema.sql");
  if (!fs.existsSync(schemaPath)) {
    throw new Error("schema.sql not found at " + schemaPath);
  }

  const ddl = fs.readFileSync(schemaPath, "utf8");
  await query(ddl);
  console.log("[db] schema applied from", schemaPath);
}
