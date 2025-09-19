// BEGIN FILE: server/src/db/EventStore.js
import { pool } from "./pool.js";
import { randomUUID } from "crypto";

export default class EventStore {
  constructor() {
    this.pool = pool;
  }

  async getCurrentVersion(streamId, client = null) {
    const run = client ?? this.pool;
    const { rows } = await run.query(
      `SELECT COALESCE(MAX(version), 0) AS version
         FROM events
        WHERE stream_id = $1`,
      [streamId]
    );
    return Number(rows[0]?.version || 0);
  }

  async append(streamId, type, payload, opts = {}) {
    const { expectedVersion, correlationId } = opts;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const current = await this.getCurrentVersion(streamId, client);
      if (typeof expectedVersion === "number" && current !== expectedVersion) {
        throw new Error(
          `ConcurrencyError: expected v${expectedVersion} but stream ${streamId} is at v${current}`
        );
      }
      const newVersion = current + 1;

      await client.query(
        `INSERT INTO events (stream_id, version, type, payload, correlation_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          streamId,
          newVersion,
          type,
          JSON.stringify(payload ?? {}),
          correlationId || null,
        ]
      );

      await client.query("COMMIT");
      return newVersion;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async getLatestSnapshot(streamId) {
    const { rows } = await this.pool.query(
      `SELECT version, state
         FROM snapshots
        WHERE stream_id = $1
        ORDER BY version DESC
        LIMIT 1`,
      [streamId]
    );
    if (rows.length === 0) return null;
    return {
      version: Number(rows[0].version),
      state: rows[0].state,
    };
  }

  async saveSnapshot(streamId, version, state) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      
      // Generate a unique snapshot_id
      const snapshotId = randomUUID();
      
      await client.query(
        `INSERT INTO snapshots (snapshot_id, stream_id, version, state)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (stream_id, version)
         DO UPDATE SET 
           snapshot_id = EXCLUDED.snapshot_id,
           state = EXCLUDED.state, 
           created_at = NOW()`,
        [snapshotId, streamId, version, JSON.stringify(state ?? {})]
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async getEventsAfter(streamId, afterVersion = 0, limit = 10000) {
    const { rows } = await this.pool.query(
      `SELECT version, type, payload
         FROM events
        WHERE stream_id = $1
          AND version > $2
        ORDER BY version ASC
        LIMIT $3`,
      [streamId, afterVersion, limit]
    );
    return rows.map((r) => ({
      version: Number(r.version),
      type: r.type,
      payload: r.payload,
    }));
  }

  async loadForRehydrate(streamId) {
    const [snapshot, currentVersion] = await Promise.all([
      this.getLatestSnapshot(streamId),
      this.getCurrentVersion(streamId),
    ]);

    const baseVersion = snapshot?.version ?? 0;
    const tail = await this.getEventsAfter(streamId, baseVersion);
    return { snapshot, tail, currentVersion };
  }

  /** Ensure a stream row exists (idempotent). */
  async ensureStream(streamId, streamType = "demo") {
    await this.pool.query(
      `INSERT INTO streams (stream_id, stream_type)
       VALUES ($1, $2)
       ON CONFLICT (stream_id) DO NOTHING`,
      [streamId, streamType]
    );
  }
}
// END FILE: server/src/db/EventStore.js