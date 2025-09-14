// server/scripts/migrate.js
import dotenv from 'dotenv';
import fs from "fs";
import path from "path";
import { pool } from "../src/db/pool.js"; // Back to using your pool.js

// Load .env from root directory (two levels up)
dotenv.config({ path: '../../.env' });

async function runMigrations() {
  try {
    // Debug: Show what we're actually connecting with
    console.log("DATABASE_URL from env:", process.env.DATABASE_URL);
    console.log("Pool config:", pool.options);
    
    // Test database connection first
    console.log("Testing database connection...");
    await pool.query("SELECT 1");
    console.log("Database connection successful.");

    const dir = path.join(process.cwd(), "src/db/migrations");
    
    // Check if migrations directory exists
    if (!fs.existsSync(dir)) {
      console.error(`Migrations directory does not exist: ${dir}`);
      process.exit(1);
    }

    const files = fs.readdirSync(dir)
      .filter(f => f.endsWith(".sql"))
      .sort();

    if (files.length === 0) {
      console.log("No migration files found.");
      process.exit(0);
    }

    console.log(`Found ${files.length} migration files.`);

    // Create migrations table if it doesn't exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        filename VARCHAR(255) UNIQUE NOT NULL,
        executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    for (const f of files) {
      // Check if migration has already been run
      const { rows } = await pool.query(
        "SELECT filename FROM migrations WHERE filename = $1",
        [f]
      );

      if (rows.length > 0) {
        console.log(`Skipping already executed migration: ${f}`);
        continue;
      }

      const sql = fs.readFileSync(path.join(dir, f), "utf8");
      console.log(`Running migration: ${f}`);
      
      try {
        // Run migration in a transaction
        await pool.query("BEGIN");
        await pool.query(sql);
        await pool.query(
          "INSERT INTO migrations (filename) VALUES ($1)",
          [f]
        );
        await pool.query("COMMIT");
        console.log(`✓ Migration ${f} completed successfully`);
      } catch (err) {
        await pool.query("ROLLBACK");
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
    // Close database connection
    await pool.end();
  }
}

runMigrations();