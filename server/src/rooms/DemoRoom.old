// server/src/rooms/DemoRoom.js

// Colyseus is CommonJS; import default and destructure
import colyseusPkg from "colyseus";
const { Room } = colyseusPkg;

import { Schema, MapSchema } from "@colyseus/schema";
import * as schema from "@colyseus/schema"; // for defineTypes in JS

import { EventStore } from "../../db/EventStore.js";

// ---------- Schema ----------
class PlayerState extends Schema {}
schema.defineTypes(PlayerState, {
  id: "string",
  name: "string",
  hp: "int16",
  xp: "int32",
});

class DemoState extends Schema {
  constructor() {
    super();
    this.players = new MapSchema();
    this.version = 0;
  }
}
schema.defineTypes(DemoState, {
  players: { map: PlayerState },
  version: "int32",
});

const SNAPSHOT_EVERY = 50;

// ---------- Room ----------
export class DemoRoom extends Room {
  async onCreate() {
    this.setState(new DemoState());

    // --- persistence bootstrap ---
    this.store = new EventStore(this.roomId, "campaign");
    await this.store.ensureStream();

    // Load snapshot + events, rehydrate schema state
    const { state, version } = await this.store.load();
    for (const [id, p] of Object.entries(state.players || {})) {
      const pl = new PlayerState();
      pl.id = id;
      pl.name = p.name ?? "";
      pl.hp = p.hp ?? 10;
      pl.xp = p.xp ?? 0;
      this.state.players.set(id, pl);
    }
    this.state.version = version || 0;

    // --- messages ---
    this.onMessage("join", async (client, { name }) => {
      const p = new PlayerState();
      p.id = client.sessionId;
      p.name = name || `Player ${client.sessionId.slice(0, 4)}`;
      p.hp = 10;
      p.xp = 0;
      this.state.players.set(client.sessionId, p);
      this.broadcast("info", `${p.name} joined`);

      const v = await this.store.append("PLAYER_JOIN", { id: client.sessionId, name });
      if (v % SNAPSHOT_EVERY === 0) {
        await this.store.saveSnapshot(v, serializeState(this.state));
      }
    });

    this.onMessage("op", async (client, { kind, value }) => {
      const p = this.state.players.get(client.sessionId);
      if (!p) return;

      const n = Number(value || 0);
      if (kind === "hp_delta") p.hp = p.hp + n;
      if (kind === "xp_delta") p.xp = p.xp + n;
      this.state.version++;

      const id = client.sessionId;
      const type =
        kind === "hp_delta" ? "HP_ADD" :
        kind === "xp_delta" ? "XP_ADD" : null;

      if (type) {
        const v = await this.store.append(type, { id, amount: n });
        if (v % SNAPSHOT_EVERY === 0) {
          await this.store.saveSnapshot(v, serializeState(this.state));
        }
      }
    });
  }

  async onLeave(client) {
    try {
      this.state.players?.delete(client.sessionId);
      const v = await this.store.append("PLAYER_LEAVE", { id: client.sessionId });
      if (v % SNAPSHOT_EVERY === 0) {
        await this.store.saveSnapshot(v, serializeState(this.state));
      }
    } catch (e) {
      console.error("onLeave error:", e);
    }
  }
}

// ---------- helper ----------
function serializeState(schemaState) {
  const out = { players: {}, version: Number(schemaState.version || 0) };
  for (const [id, p] of schemaState.players) {
    out.players[id] = { id, name: p.name, hp: p.hp, xp: p.xp };
  }
  return out;
}
