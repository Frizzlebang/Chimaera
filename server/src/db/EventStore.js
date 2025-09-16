// server/src/db/EventStore.js
import { query } from "./index.js";
import { randomUUID } from "node:crypto";

/**
 * JSON reducer that mirrors DemoState.
 * state = { players: { [id]: { id, name, hp, xp, role } }, version: number }
 */
export function applyEvent(state, type, payload) {
  state.players ??= {};
  state.version = (state.version || 0) + 1;

  switch (type) {
    case "PLAYER_UPSERT": {
      const { id, name, role } = payload;
      state.players[id] = state.players[id] ?? { id, name: "", hp: 10, xp: 0, role: "player" };
      if (name !== undefined) state.players[id].name = name;
      if (role !== undefined) state.players[id].role = role;
      return;
    }
    case "NAME_SET": {
      const { id, name } = payload;
      if (state.players[id]) state.players[id].name = name || "";
      return;
    }
    case "HP_SET": {
      const { id, hp } = payload;
      if (state.players[id]) state.players[id].hp = Number(hp || 0);
      return;
    }
    case "XP_ADD": {
      const { id, amount } = payload;
      if (state.players[id]) state.players[id].xp += Number(amount || 0);
      return;
    }
    default:
      return; // ignore unknowns
  }
}

export class EventStore {
  constructor(streamId, streamType = "campaign") {
    this.streamId = streamId;      // e.g., campaign/room id
    this.streamType = streamType;  // just a label
  }

  async ensureStream() {
    await query(
      `INSERT INTO streams(stream_id, stream_type)
       VALUES ($1, $2)
       ON CONFLICT (stream_id) DO NOTHING`,
      [this.streamId, this.streamType]
    );
  }

  async headVersion() {
    const { rows } = await query(
      `SELECT COALESCE(MAX(version), 0) AS v
       FROM events WHERE stream_id = $1`,
      [this.streamId]
    );
    return Number(rows[0].v);
  }

  async append(type, payload, opts = {}) {
    await this.ensureStream();
    const next = (await this.headVersion()) + 1;

    const correlationId = opts.correlationId || randomUUID();

    await query(
      `INSERT INTO events(event_id, stream_id, version, type, payload, correlation_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [randomUUID(), this.streamId, next, type, payload, correlationId]
    );

    return next;
  }

  async load() {
    // load latest snapshot
    const snap = await query(
      `SELECT version, state
         FROM snapshots
        WHERE stream_id = $1
        ORDER BY version DESC
        LIMIT 1`,
      [this.streamId]
    );

    let state = { players: {}, version: 0 };
    let version = 0;

    if (snap.rowCount) {
      version = Number(snap.rows[0].version);
      state = snap.rows[0].state || state;
    }

    // replay remaining events
    const { rows } = await query(
      `SELECT version, type, payload
         FROM events
        WHERE stream_id = $1 AND version > $2
        ORDER BY version ASC`,
      [this.streamId, version]
    );

    for (const e of rows) {
      applyEvent(state, e.type, e.payload);
      version = Number(e.version);
    }

    return { version, state };
  }

  async saveSnapshot(version, state) {
    await query(
      `INSERT INTO snapshots(snapshot_id, stream_id, version, state)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (stream_id) DO UPDATE
         SET version = EXCLUDED.version,
             state = EXCLUDED.state,
             created_at = now()`,
      [randomUUID(), this.streamId, version, state]
    );
  }

  async recent(limit = 50) {
    const { rows } = await query(
      `SELECT version, type, payload, created_at
         FROM events
        WHERE stream_id = $1
        ORDER BY version DESC
        LIMIT $2`,
      [this.streamId, limit]
    );
    return rows;
  }
}
