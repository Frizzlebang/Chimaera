// server/db/EventStore.js (ESM)
import { query } from "./index.js";
import { randomUUID } from "node:crypto";

/**
 * JSON reducer that mirrors your DemoState
 * state = { players: { [id]: { id, name, hp, xp } }, version: number }
 */
export function applyEvent(state, type, payload) {
  state.players ??= {};
  state.version = (state.version || 0) + 1;

  switch (type) {
    case "PLAYER_JOIN": {
      const { id, name } = payload;
      state.players[id] = state.players[id] ?? { id, name: name || "", hp: 10, xp: 0 };
      return;
    }
    case "PLAYER_LEAVE": {
      const { id } = payload;
      delete state.players[id];
      return;
    }
    case "SET_NAME": {
      const { id, name } = payload;
      state.players[id] = state.players[id] ?? { id, name: "", hp: 10, xp: 0 };
      state.players[id].name = name || "";
      return;
    }
    case "HP_ADD": {
      const { id, amount } = payload;
      state.players[id] = state.players[id] ?? { id, name: "", hp: 10, xp: 0 };
      state.players[id].hp = (state.players[id].hp || 0) + Number(amount || 0);
      return;
    }
    case "XP_ADD": {
      const { id, amount } = payload;
      state.players[id] = state.players[id] ?? { id, name: "", hp: 10, xp: 0 };
      state.players[id].xp = (state.players[id].xp || 0) + Number(amount || 0);
      return;
    }
    default:
      return; // ignore unknowns
  }
}

export class EventStore {
  constructor(streamId, streamType = "campaign") {
    this.streamId = streamId;      // e.g., your room/campaign id (uuid)
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

  async append(type, payload) {
    const next = (await this.headVersion()) + 1;
    await query(
      `INSERT INTO events(event_id, stream_id, version, type, payload)
       VALUES ($1, $2, $3, $4, $5)`,
      [randomUUID(), this.streamId, next, type, payload]
    );
    return next;
  }

  async load() {
    // try snapshot
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
       VALUES ($1, $2, $3, $4)`,
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
