import colyseusPkg from "colyseus";
const { Room } = colyseusPkg;
import { Schema, MapSchema } from "@colyseus/schema";
import * as schema from "@colyseus/schema";
import { verifyJwt } from "../auth/jwt.js";
import { pool } from "../db/pool.js";
import { EventStore, applyEvent } from "../db/EventStore.js"; // your existing modules

class PlayerState extends Schema {}
schema.defineTypes(PlayerState, {
  id: "string",
  name: "string",
  hp: "int16",
  xp: "int32",
  role: "string" // 'owner'|'dm'|'player'|'viewer'
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
  // IMPORTANT: create rooms using a campaign-bound id: `demo:<campaignId>`
  static roomNameForCampaign(campaignId) {
    return `demo:${campaignId}`;
  }

  async onCreate(options) {
    this.setState(new DemoState());
    this.maxClients = 32;

    // Load snapshot + events for this.campaignId
    this.campaignId = options.campaignId;
    this.roomKind = "demo";

    // S4 safety: campaignId is required to bind the room
    if (!this.campaignId) {
      throw new Error("missing campaignId");
    }

    this.onMessage("op", (client, payload) => this.handleOp(client, payload));
    this.onMessage("chat", (client, payload) => this.handleChat(client, payload));
  }

  async onAuth(client, options, request) {
    // Expect token in options.token
    const token = options?.token;
    if (!token) throw new Error("missing token");

    const claims = verifyJwt(token);

    // Per-campaign isolation: require the room’s campaign to match the token
    if (!options.campaignId) throw new Error("missing campaignId");
    if (claims.campaign_id !== options.campaignId) throw new Error("wrong campaign");
    
    // If this room is already bound to a campaign, enforce consistency
    if (this.campaignId && this.campaignId !== options.campaignId) {
      throw new Error("room bound to different campaign");
    }


    // Check membership from DB (server-side check, not just trust JWT)
    const { rows } = await pool.query(
      `select m.role
         from membership m
        where m.user_id = $1 and m.campaign_id = $2`,
      [claims.sub, claims.campaign_id]
    );
    if (rows.length === 0) throw new Error("not a member");
    const role = rows[0].role;

    // Room ACL (optional hardening)
    const { rows: acl } = await pool.query(
      `select can_join_roles from room_acl where campaign_id=$1 and room_kind=$2`,
      [claims.campaign_id, this.roomKind]
    );
    if (acl.length && !acl[0].can_join_roles.includes(role)) {
      throw new Error("role not allowed in this room");
    }

    // Attach to client for later checks
    client.user = {
      id: claims.sub,
      name: claims.name,
      role,
      campaignId: claims.campaign_id
    };
    return true;
  }

  async onJoin(client) {
    // S4 safety: ensure joined client matches the room's campaign
    this.assertSameCampaign(client);

    // Add to state if not present
    const uid = client.user.id;
    if (!this.state.players.has(uid)) {
      const ps = new PlayerState();
      ps.id = uid;
      ps.name = client.user.name;
      ps.hp = 10; // default or from DB snapshot
      ps.xp = 0;
      ps.role = client.user.role;
      this.state.players.set(uid, ps);
    }
  }

  async onLeave(client) {
    // keep players in state; persistence handled via EventStore
  }

  // ---- Server-side checks & ops ----

  assertRole(client, allowed) {
    if (!allowed.includes(client.user.role)) {
      throw new Error(`forbidden: role ${client.user.role}`);
    }
  }

  assertSameCampaign(client) {
    if (client.user.campaignId !== this.campaignId) {
      throw new Error("campaign mismatch");
    }
  }

  // Example op: adjust HP
  async handleOp(client, payload) {
    this.assertSameCampaign(client);

    const { type, data } = payload ?? {};
    switch (type) {
      case "SET_HP": {
        // Only DM/owner can set arbitrary HP; players can SET_HP only on self within bounds
        if (client.user.role === "player") {
          if (data.playerId !== client.user.id) throw new Error("players may only adjust self");
          if (data.value < 0 || data.value > 30) throw new Error("out of bounds");
        } else {
          this.assertRole(client, ["owner","dm"]);
        }

        const event = { t: "SET_HP", by: client.user.id, pid: data.playerId, val: data.value };
        // Persist first (event-sourced)
        const eventStore = new EventStore(this.campaignId, 'campaign');
        await eventStore.ensureStream();
        await eventStore.append(event.t, event);

        // Apply server-validated change
        const ps = this.state.players.get(data.playerId);
        if (!ps) throw new Error("player not found");
        ps.hp = data.value;
        this.state.version++;
        break;
      }

      case "ADD_XP": {
        // players can add XP to self (bounded), dm/owner to anyone
        if (client.user.role === "player" && data.playerId !== client.user.id) {
          throw new Error("players may only add XP to self");
        }
        if (data.amount < 0 || data.amount > 100) throw new Error("invalid xp");

        const event = { t: "ADD_XP", by: client.user.id, pid: data.playerId, amt: data.amount };
        const eventStore = new EventStore(this.campaignId, 'campaign');
        await eventStore.ensureStream();
        await eventStore.append(event.t, event);

        const ps = this.state.players.get(data.playerId);
        if (!ps) throw new Error("player not found");
        ps.xp += data.amount;
        this.state.version++;
        break;
      }

      default:
        throw new Error("unknown op");
    }
  }

  handleChat(client, payload) {
    this.assertSameCampaign(client);
    const msg = String(payload?.text ?? "").slice(0, 500);
    this.broadcast("chat", { from: client.user.name, text: msg });
  }
}
