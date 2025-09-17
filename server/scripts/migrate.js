// server/scripts/migrate.js
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { pool } from "../src/db/pool.js";

// Load .env from repo root (../../.env)
dotenv.config({ path: path.resolve(process.cwd(), "..", "..", ".env") });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function readMigrationsDir() {
  // default to repo/server/src/db/migrations
  const defaultDir = path.resolve(__dirname, "../src/db/migrations");
  const dir = process.env.MIGRATIONS_DIR
    ? path.resolve(process.cwd(), process.env.MIGRATIONS_DIR)
    : defaultDir;

  if (!fs.existsSync(dir)) {
    console.error(`Migrations directory does not exist: ${dir}`);
    process.exit(1);
  }
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  return { dir, files };
}

/**
 * Split SQL into statements while respecting:
 * - dollar-quoted blocks: $tag$ ... $tag$ (including $$ ... $$)
 * - single/double quoted strings
 * - line comments (-- ... \n) and block comments (/* ... *\/)
 * Returns an array of statements (without trailing semicolons), trimmed, non-empty.
 */
function splitSql(sql) {
  const stmts = [];
  let i = 0;
  let start = 0;
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  let inBlockComment = false;
  let dollarTag = null; // e.g. 'tag' for $tag$ ... $tag$
  const n = sql.length;

  const peek = (k = 0) => (i + k < n ? sql[i + k] : "");

  // Normalize line endings and strip BOM
  if (sql.charCodeAt(0) === 0xfeff) sql = sql.slice(1);

  while (i < n) {
    const c = sql[i];

    // End line comment
    if (inLineComment) {
      if (c === "\n") inLineComment = false;
      i++;
      continue;
    }

    // End block comment
    if (inBlockComment) {
      if (c === "*" && peek(1) === "/") {
        inBlockComment = false;
        i += 2;
      } else {
        i++;
      }
      continue;
    }

    // Dollar-quoted block handling
    if (dollarTag !== null) {
      // Look for closing $tag$
      if (c === "$") {
        // Try to match $tag$
        let j = i + 1;
        let tag = "";
        while (j < n && /[A-Za-z0-9_]/.test(sql[j])) {
          tag += sql[j];
          j++;
        }
        if (j < n && sql[j] === "$") {
          // we found $tag$
          if (tag === dollarTag) {
            dollarTag = null;
            i = j + 1;
            continue;
          }
        }
      }
      i++;
      continue;
    }

    // Not in any special block:
    // Comments
    if (c === "-" && peek(1) === "-") {
      inLineComment = true;
      i += 2;
      continue;
    }
    if (c === "/" && peek(1) === "*") {
      inBlockComment = true;
      i += 2;
      continue;
    }

    // Dollar-quote start?
    if (c === "$") {
      // capture tag chars until next $
      let j = i + 1;
      let tag = "";
      while (j < n && /[A-Za-z0-9_]/.test(sql[j])) {
        tag += sql[j];
        j++;
      }
      if (j < n && sql[j] === "$") {
        // start of $tag$ or $$ block
        dollarTag = tag; // '' for $$, or 'tag'
        i = j + 1;
        continue;
      }
    }

    // Strings
    if (!inDouble && c === "'" && !inSingle) {
      inSingle = true;
      i++;
      continue;
    }
    if (inSingle) {
      if (c === "'" && peek(1) === "'") {
        // escaped ''
        i += 2;
        continue;
      }
      if (c === "'") {
        inSingle = false;
      }
      i++;
      continue;
    }

    if (!inSingle && c === '"' && !inDouble) {
      inDouble = true;
      i++;
      continue;
    }
    if (inDouble) {
      if (c === '"' && peek(1) === '"') {
        // escaped ""
        i += 2;
        continue;
      }
      if (c === '"') {
        inDouble = false;
      }
      i++;
      continue;
    }

    // Statement boundary
    if (c === ";") {
      const chunk = sql.slice(start, i).trim();
      if (chunk) stmts.push(chunk);
      start = i + 1;
      i++;
      continue;
    }

    i++;
  }

  // trailing chunk
  const tail = sql.slice(start).trim();
  if (tail) stmts.push(tail);

  // filter out lone comments that survived trimming
  return stmts.filter((s) => s.replace(/--.*$/gm, "").trim() !== "");
}

async function runMigrations() {
  try {
    console.log("DATABASE_URL from env:", process.env.DATABASE_URL);
    console.log("Pool config:", pool.options);

    console.log("Testing database connection...");
    await pool.query("SELECT 1");
    console.log("Database connection successful.");

    const { dir, files } = readMigrationsDir();

    if (files.length === 0) {
      console.log("No migration files found.");
      process.exit(0);
    }
    console.log(`Found ${files.length} migration file${files.length > 1 ? "s" : ""}.`);

    // Ledger
    await pool.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        filename VARCHAR(255) UNIQUE NOT NULL,
        executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    for (const f of files) {
      const { rows } = await pool.query(
        "SELECT 1 FROM migrations WHERE filename = $1",
        [f]
      );
      if (rows.length) {
        console.log(`Skipping already executed migration: ${f}`);
        continue;
      }

      const full = path.join(dir, f);
      const sql = fs.readFileSync(full, "utf8");
      const statements = splitSql(sql);

      console.log(`Running migration: ${f} (${statements.length} statements)`);

      try {
        await pool.query("BEGIN");
        for (let idx = 0; idx < statements.length; idx++) {
          const stmt = statements[idx];
          try {
            await pool.query(stmt);
          } catch (e) {
            console.error(`✗ Statement ${idx + 1}/${statements.length} failed in ${f}`);
            const preview = stmt.length > 240 ? stmt.slice(0, 240) + " …" : stmt;
            console.error("---- STATEMENT PREVIEW ----\n" + preview + "\n---------------------------");
            throw e;
          }
        }
        await pool.query("INSERT INTO migrations (filename) VALUES ($1)", [f]);
        await pool.query("COMMIT");
        console.log(`✓ Migration ${f} completed successfully`);
      } catch (err) {
        try { await pool.query("ROLLBACK"); } catch {}
        console.error(`✗ Error in migration ${f}:`, err.message);
        console.error("Full error:", err);
        process.exit(1);
      }
    }

    console.log("All migrations completed successfully.");
  } catch (err) {
    console.error("Migration process failed:", err.message);
    console.error("Full error:", err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigrations();
