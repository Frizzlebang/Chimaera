// ESM version of your room
import colyseusPkg from "colyseus";
const { Room } = colyseusPkg;

import { Schema, MapSchema } from "@colyseus/schema";
import * as schema from "@colyseus/schema"; // for defineTypes in JS


class PlayerState extends Schema {}
schema.defineTypes(PlayerState, {
  id: "string",
  name: "string",
  hp: "int16",  // use schema ints, not "number"
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

export class DemoRoom extends Room {
  onCreate() {
    this.setState(new DemoState());

    this.onMessage("join", (client, { name }) => {
      const p = new PlayerState();
      p.id = client.sessionId;
      p.name = name || `Player ${client.sessionId.slice(0, 4)}`;
      p.hp = 10;
      p.xp = 0;
      this.state.players.set(client.sessionId, p);
      this.broadcast("info", `${p.name} joined`);
    });

    this.onMessage("op", (client, { kind, value }) => {
      const p = this.state.players.get(client.sessionId);
      if (!p) return;
      const n = Number(value || 0);
      if (kind === "hp_delta") p.hp = p.hp + n;
      if (kind === "xp_delta") p.xp = p.xp + n;
      this.state.version++;
    });
  }

  onLeave(client) {
    try {
      this.state.players?.delete(client.sessionId);
    } catch (e) {
      console.error("onLeave error:", e);
    }
  }
}
