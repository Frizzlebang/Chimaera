// server/src/rooms/DemoRoom.js

import colyseusPkg from "colyseus";
const { Room } = colyseusPkg;

import { EventStore } from "../db/EventStore.js";
import { randomUUID } from "crypto";
import { Schema, MapSchema } from "@colyseus/schema";
import * as schema from "@colyseus/schema"; // for defineTypes

import { assertMember } from "../db/index.js";

class PlayerState extends Schema {}
schema.defineTypes(PlayerState, {
  id: "string",
  name: "string",
  hp: "int16",
  xp: "int32",
  role: "string",
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
  // onAuth: populate client.user from token/options (dev-only)
  async onAuth(client, options) {
    const token = String(options?.token || "");
    let payload = {};
    try {
      const part = token.split(".")[1] || "";
      const json = Buffer.from(part, "base64url").toString("utf8");
      payload = JSON.parse(json || "{}");
    } catch (_) {}

    client.user = {
      id: payload.sub || options?.userId || client.sessionId,
      name: payload.name ?? options?.name ?? "Player",
      role: payload.role ?? options?.role ?? "player",
      campaignId: payload.campaignId ?? options?.campaignId ?? null,
    };

    if (!client.user.campaignId) throw new Error("missing campaignId in token/options");
    return true;
  }

  async onCreate(options) {
    this.campaignId = options?.campaignId;
    this.streamId = this.campaignId; // UUID expected by DB

    this.setState(new DemoState());
    this.eventStore = new EventStore(this.streamId, "demo");

    // rehydrate from snapshots + events (safe if no state yet)
    const { version, state } = await this.eventStore.load?.() ?? { version: 0, state: null };
    if (state?.players) {
      this.state.players.clear();
      for (const [id, v] of Object.entries(state.players)) {
        const p = new PlayerState();
        p.id = v.id;
        p.name = v.name ?? "Player";
        p.role = v.role ?? "player";
        p.hp = Number.isFinite(v.hp) ? v.hp : 10;
        p.xp = Number.isFinite(v.xp) ? v.xp : 0;
        this.state.players.set(id, p);
      }
      this.state.version = version || 0;
    }

    this.onMessage("op", (client, data) => this.handleOp(client, data));
    this.onMessage("chat", (client, data) => this.handleChat(client, data));
  }

  assertSameCampaign(client) {
    if (!this.campaignId) throw new Error("room missing campaignId");
    const cid = client?.user?.campaignId ?? null;
    if (cid !== this.campaignId) throw new Error("campaign mismatch");
  }

  // >>> PATCH A: helper START
  getOrInitPlayer(uid, userLike = null) {
    let ps = this.state.players.get(uid);
    if (!ps) {
      ps = new PlayerState();
      ps.id = uid;
      ps.name = userLike?.name || "Player";
      ps.role = userLike?.role || "player";
      ps.hp = 10;
      ps.xp = 0;
      this.state.players.set(uid, ps);
    } else {
      // Update name/role if provided and current values are default
      if (userLike?.name && (!ps.name || ps.name === "Player")) {
        ps.name = userLike.name;
      }
      if (userLike?.role && (!ps.role || ps.role === "player")) {
        ps.role = userLike.role;
      }
    }
    return ps;
  }
  // >>> PATCH A: helper END

  // Role checking helper
  requireRole(client, allowedRoles) {
    if (!allowedRoles.includes(client.user.role)) {
      throw new Error(`Access denied. Required roles: ${allowedRoles.join(', ')}`);
    }
  }

  // Commit events and update state
  async _commit(event, metadata = {}) {
    try {
      // Apply the event to update state
      this._applyEvent(event);
      
      // Persist the event to the event store
      await this.eventStore.append(event, metadata);
      
      // Increment version
      this.state.version++;
      
    } catch (error) {
      console.error('Error committing event:', error);
      throw error;
    }
  }

  // Apply events to state
  _applyEvent(event) {
    console.log("_applyEvent called with:", event);
    const { type, payload } = event;
    
    switch (type) {
      case "NAME_SET": {
        const ps = this.getOrInitPlayer(payload.id);
        ps.name = payload.name;
        console.log("Name set:", { id: payload.id, name: payload.name });
        break;
      }
      
      case "HP_SET": {
        const ps = this.getOrInitPlayer(payload.id);
        ps.hp = Math.max(0, payload.hp); // Ensure HP doesn't go negative
        console.log("HP set:", { id: payload.id, hp: ps.hp });
        break;
      }
      
      case "XP_ADD": {
        const ps = this.getOrInitPlayer(payload.id);
        ps.xp = Math.max(0, ps.xp + payload.amount); // Ensure XP doesn't go negative
        console.log("XP added:", { id: payload.id, amount: payload.amount, newXP: ps.xp });
        break;
      }
      
      default:
        console.warn(`Unknown event type: ${type}`);
    }
  }

  // >>> PATCH B: onJoin START
  async onJoin(client) {
    this.assertSameCampaign(client);
    await assertMember(this.campaignId, client.user.id);
    this.getOrInitPlayer(client.user.id, client.user);
  }
  // >>> PATCH B: onJoin END

  async handleOp(client, data) {
    this.assertSameCampaign(client);
    await assertMember(this.campaignId, client.user.id);

    const type = data?.type;
    const isPlayer = client.user.role === "player";
    const selfId = client.user.id;

    switch (type) {
      case "SET_NAME": {
        const id = selfId; // players can only name themselves
        const name = String(data?.name ?? "").slice(0, 64);
        await this._commit(
          { type: "NAME_SET", payload: { id, name } },
          { actor: selfId }
        );
        break;
      }

      case "SET_HP": {
        // If player: ignore provided target and force self
        const targetId = isPlayer ? selfId : String(data?.playerId ?? selfId);
        if (!isPlayer) {
          this.requireRole(client, ["owner", "dm"]);
        }
        const ps = this.getOrInitPlayer(targetId, targetId === selfId ? client.user : null);
        const hp = Number(data?.value ?? ps.hp);
        await this._commit(
          { type: "HP_SET", payload: { id: targetId, hp } },
          { actor: selfId }
        );
        break;
      }

      case "HP_ADD": {
        // If player: coerce target to self
        const targetId = isPlayer ? selfId : String(data?.id ?? selfId);
        const ps = this.getOrInitPlayer(targetId, targetId === selfId ? client.user : null);
        const amount = Number(data?.amount ?? 0);
        const hp = ps.hp + amount;
        await this._commit(
          { type: "HP_SET", payload: { id: targetId, hp } },
          { actor: selfId }
        );
        break;
      }

      case "ADD_XP":
      case "XP_ADD": {
        // If player: coerce target to self
        const targetId = isPlayer ? selfId : String(data?.playerId ?? data?.id ?? selfId);
        const amount = Number(data?.amount ?? 0);
        if (!Number.isFinite(amount) || Math.abs(amount) > 1_000_000) {
          throw new Error("invalid xp amount");
        }
        await this._commit(
          { type: "XP_ADD", payload: { id: targetId, amount } },
          { actor: selfId }
        );
        break;
      }

      default:
        // ignore unknown ops
        break;
    }
  }

  // >>> PATCH D: handleChat START
  async handleChat(client, payload) {
    this.assertSameCampaign(client);
    await assertMember(this.campaignId, client.user.id);

    const ps = this.getOrInitPlayer(client.user.id, client.user);
    const msg = String(payload?.text ?? "").slice(0, 500);
    this.broadcast("chat", { from: ps.name, text: msg });
  }
  // >>> PATCH D: handleChat END
}