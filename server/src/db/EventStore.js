// BEGIN FILE: server/src/db/EventStore.js
import { pool } from "./pool.js";

/**
 * EventStore (UUID streams; multi-snapshot by version)
 *
 * Tables (expected):
 *  events(
 *    event_id UUID PK,
 *    stream_id UUID NOT NULL REFERENCES streams(stream_id) ON DELETE CASCADE,
 *    version BIGINT NOT NULL,
 *    type TEXT NOT NULL,
 *    payload JSONB NOT NULL,
 *    correlation_id UUID NULL,
 *    created_at TIMESTAMPTZ DEFAULT NOW(),
 *    UNIQUE(stream_id, version)
 *  );
 *
 *  snapshots(
 *    snapshot_id UUID PK,
 *    stream_id UUID NOT NULL REFERENCES streams(stream_id) ON DELETE CASCADE,
 *    version BIGINT NOT NULL,
 *    state JSONB NOT NULL,
 *    created_at TIMESTAMPTZ DEFAULT NOW(),
 *    UNIQUE(stream_id, version)
 *  );
 */
export default class EventStore {
  constructor() {
    this.pool = pool;
  }

  /** Get the current (max) version for a stream. */
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

  /**
   * Append a new event with optimistic concurrency.
   * @param {string} streamId (UUID string)
   * @param {string} type
   * @param {object} payload
   * @param {{expectedVersion?:number, correlationId?:string|null}} opts
   * @returns {number} newVersion
   */
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
          correlationId || null, // must be UUID or null to satisfy schema
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

  /**
   * Load the LATEST snapshot (highest version) if any.
   * @returns {object|null} { version, state } or null
   */
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

  /**
   * Save snapshot at specific version (allows multiple snapshots per stream).
   * Uses the (stream_id, version) UNIQUE constraint for idempotency.
   */
  async saveSnapshot(streamId, version, state) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO snapshots (stream_id, version, state)
         VALUES ($1, $2, $3)
         ON CONFLICT (stream_id, version)
         DO UPDATE SET state = EXCLUDED.state, created_at = NOW()`,
        [streamId, version, JSON.stringify(state ?? {})]
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  /** Load events AFTER a specific version (exclusive). */
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

  /**
   * Helper to fetch snapshot + tail for fast rehydrate.
   * @returns {object} { snapshot: {version,state} | null, tail: Event[], currentVersion: number }
   */
  async loadForRehydrate(streamId) {
    const [snapshot, currentVersion] = await Promise.all([
      this.getLatestSnapshot(streamId),
      this.getCurrentVersion(streamId),
    ]);

    const baseVersion = snapshot?.version ?? 0;
    const tail = await this.getEventsAfter(streamId, baseVersion);
    return { snapshot, tail, currentVersion };
  }
}
// END FILE: server/src/db/EventStore.js
