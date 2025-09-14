import colyseusPkg from "colyseus";
const { Room } = colyseusPkg;
import { Schema, MapSchema } from "@colyseus/schema";
import * as schema from "@colyseus/schema";
import { verifyJwt } from "../auth/jwt.js";
import { pool } from "../db/pool.js";
import { EventStore } from "../db/EventStore.js";

class PlayerState extends Schema {}
schema.defineTypes(PlayerState, {
  id: "string",
  name: "string",
  hp: "int16",
  xp: "int32",
  role: "string", // 'owner'|'dm'|'player'|'viewer'
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
  static roomNameForCampaign(campaignId) {
    return `demo:${campaignId}`;
  }

  async onCreate(options) {
    this.setState(new DemoState());
    this.maxClients = 32;

    this.campaignId = options.campaignId;
    this.roomKind = "demo";
    if (!this.campaignId) throw new Error("missing campaignId");

    // Needed for .filterBy(["campaignId"]) in index.js
    this.setMetadata({ campaignId: this.campaignId });

    // --- Persistence wiring (EventStore contract) ---
    this.eventStore = new EventStore(this.campaignId, "campaign");
    await this.eventStore.ensureStream();

    // Load snapshot+replay (EventStore returns final state & version)
    const { version, state } = await this.eventStore.load();

    // Rebuild schema state from plain object
    if (state?.players) {
      for (const [id, p] of Object.entries(state.players)) {
        const ps = new PlayerState();
        ps.id = p.id;
        ps.name = p.name ?? "";
        ps.hp = p.hp ?? 10;
        ps.xp = p.xp ?? 0;
        ps.role = p.role ?? "player";
        this.state.players.set(id, ps);
      }
    }
    this.state.version = version || 0;

    this.onMessage("op", (client, payload) => this.handleOp(client, payload));
    this.onMessage("chat", (client, payload) => this.handleChat(client, payload));
  }

  // Auth: expects { token, campaignId } in join options
  async onAuth(client, options, request) {
    const { campaignId } = options || {};
    if (!campaignId) throw new Error("campaignId missing in join options");

    // token from options (browser) OR from header (node client)
    const authz = request?.headers?.authorization || request?.headers?.Authorization;
    const headerToken =
      authz && authz.toLowerCase().startsWith("bearer ") ? authz.slice(7).trim() : null;
    const token = options?.token || headerToken;
    if (!token) throw new Error("missing token");

    let claims;
    try {
      claims = verifyJwt(token);
    } catch {
      throw new Error("Invalid token");
    }
    const userId = claims?.sub;
    if (!userId) throw new Error("Token missing subject");

    if (this.campaignId && this.campaignId !== campaignId) {
      throw new Error("room bound to different campaign");
    }

    // If token has a claim and it disagrees, warn (don't block)
    if (claims.campaign_id && claims.campaign_id !== campaignId) {
      console.warn(
        `[onAuth] token.campaign_id=${claims.campaign_id} != join.campaignId=${campaignId}`
      );
    }

    // ✅ Membership check keyed by the JOIN OPTIONS campaignId
    const { rows } = await pool.query(
      `select role from membership where user_id = $1 and campaign_id = $2 limit 1`,
      [userId, campaignId]
    );
    if (rows.length === 0) throw new Error("not a member");
    const role = rows[0].role;

    // Optional ACL per room kind (also keyed by the options campaignId)
    const { rows: acl } = await pool.query(
      `select can_join_roles from room_acl where campaign_id=$1 and room_kind=$2`,
      [campaignId, this.roomKind]
    );
    if (acl.length && !acl[0].can_join_roles.includes(role)) {
      throw new Error("role not allowed in this room");
    }

    client.user = {
      id: userId,
      name: claims.name,
      role,
      campaignId, // <- source of truth
    };
    return true;
  }

  async onJoin(client) {
    this.assertSameCampaign(client);

    const uid = client.user.id;
    if (!this.state.players.has(uid)) {
      const ps = new PlayerState();
      ps.id = uid;
      ps.name = client.user.name;
      ps.hp = 10;
      ps.xp = 0;
      ps.role = client.user.role;
      this.state.players.set(uid, ps);
    }
  }

  async onLeave(_client) {
    // keep players in state; persistence handled via EventStore
  }

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

  // Map client ops to EventStore contract: HP_ADD / XP_ADD with { id, amount }
  async handleOp(client, payload) {
    this.assertSameCampaign(client);

    const { type, data } = payload ?? {};
    switch (type) {
      // Back-compat: absolute -> additive
      case "SET_HP": {
        if (client.user.role === "player") {
          if (data.playerId !== client.user.id) throw new Error("players may only adjust self");
          if (data.value < 0 || data.value > 30) throw new Error("out of bounds");
        } else {
          this.assertRole(client, ["owner", "dm"]);
        }

        const ps = this.state.players.get(data.playerId);
        if (!ps) throw new Error("player not found");

        const delta = Number(data.value) - Number(ps.hp);
        await this.eventStore.append("HP_ADD", { id: data.playerId, amount: delta });

        ps.hp = Math.max(0, Number(data.value));
        this.state.version++;
        break;
      }

      case "HP_ADD": {
        if (client.user.role === "player" && data.id !== client.user.id) {
          throw new Error("players may only adjust self");
        }
        const amount = Number(data.amount || 0);
        if (!Number.isFinite(amount)) throw new Error("invalid hp amount");

        const ps = this.state.players.get(data.id);
        if (!ps) throw new Error("player not found");

        await this.eventStore.append("HP_ADD", { id: data.id, amount });
        ps.hp = Math.max(0, ps.hp + amount);
        this.state.version++;
        break;
      }

      // Back-compat: translate ADD_XP -> XP_ADD
      case "ADD_XP": {
        const targetId = data.playerId;
        if (client.user.role === "player" && targetId !== client.user.id) {
          throw new Error("players may only add XP to self");
        }
        const amount = Number(data.amount || 0);
        if (amount < 0 || amount > 100) throw new Error("invalid xp");

        const ps = this.state.players.get(targetId);
        if (!ps) throw new Error("player not found");

        await this.eventStore.append("XP_ADD", { id: targetId, amount });
        ps.xp += amount;
        this.state.version++;
        break;
      }

      case "XP_ADD": {
        if (client.user.role === "player" && data.id !== client.user.id) {
          throw new Error("players may only add XP to self");
        }
        const amount = Number(data.amount || 0);
        if (amount < 0 || amount > 100) throw new Error("invalid xp");

        const ps = this.state.players.get(data.id);
        if (!ps) throw new Error("player not found");

        await this.eventStore.append("XP_ADD", { id: data.id, amount });
        ps.xp += amount;
        this.state.version++;
        break;
      }

      default:
        throw new Error("unknown op");
    }

    // Snapshot every 50 ops
    if (this.state.version % 50 === 0) {
      const snapshotPayload = {
        players: Object.fromEntries(
          Array.from(this.state.players.entries()).map(([id, p]) => [
            id,
            { id: p.id, name: p.name, hp: p.hp, xp: p.xp, role: p.role },
          ])
        ),
        version: this.state.version,
      };
      await this.eventStore.saveSnapshot(this.state.version, snapshotPayload);
    }
  }

  handleChat(client, payload) {
    this.assertSameCampaign(client);
    const msg = String(payload?.text ?? "").slice(0, 500);
    this.broadcast("chat", { from: client.user.name, text: msg });
  }
}
