import { Pool } from "pg";
import fs from "node:fs";
import path from "node:path";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const query = (text, params) => pool.query(text, params);

export async function initSchema() {
  // try both dev and container paths
  const candidates = [
    path.join(process.cwd(), "server/db/schema.sql"),
    path.join(process.cwd(), "db/schema.sql"),
  ];
  let ddl;
  for (const p of candidates) {
    if (fs.existsSync(p)) { ddl = fs.readFileSync(p, "utf8"); break; }
  }
  if (!ddl) throw new Error("schema.sql not found");
  await query(ddl);
}
