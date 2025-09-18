// server/src/rooms/DemoRoom.js
import colyseusPkg from "colyseus";
const { Room } = colyseusPkg;

import { Schema, MapSchema } from "@colyseus/schema";
import * as schema from "@colyseus/schema";
import EventStore from "../db/EventStore.js";
import { assertMember } from "../db/index.js";

/* =========================
 * State schema (no decorators)
 * ========================= */
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
    this.version = 0; // logical in-memory version
  }
}
schema.defineTypes(DemoState, {
  players: { map: PlayerState },
  version: "int32",
});

/* =========================
 * Room
 * ========================= */
export class DemoRoom extends Room {
  async onCreate(options) {
    this.setPatchRate(100);

    // --- Identity & store ---
    this.campaignId = String(options?.campaignId ?? "");
    if (!this.campaignId) throw new Error("room missing campaignId");
    // stream_id is a UUID (FK to streams), do NOT prefix
    this.streamId = this.campaignId;

    this.eventStore = new EventStore();
    this.setState(new DemoState());

    // --- Rehydrate: snapshot + tail ---
    const { snapshot, tail, currentVersion } =
      await this.eventStore.loadForRehydrate(this.streamId);

    if (snapshot?.state) {
      this.applyFullState(snapshot.state);
    } else {
      this.initFreshState();
    }

    let replayCount = 0;
    for (const evt of tail) {
      this.applyEvent(evt.type, evt.payload);
      replayCount++;
    }

    // Track versions
    this.persistedVersion = currentVersion;         // latest version in DB
    this.snapshotVersion  = snapshot?.version ?? 0; // snapshot point (if any)

    // Emit metadata for Dev Dock / diagnostics
    this.setMetadata({
      rehydratedAt: new Date().toISOString(),
      persistedVersion: this.persistedVersion,
      snapshotVersion: this.snapshotVersion,
      replayCount,
    });
    this.emitMeta?.();

    // Message handlers
    this.onMessage("op", (client, data) => this.handleOp(client, data));
    this.onMessage("chat", (client, data) => this.handleChat(client, data));

    // Snapshot policy (leave at 50 as agreed)
    this.snapshotEveryN = 50;
  }

  /* =========================
   * Auth / Join
   * ========================= */
  async onAuth(client, options) {
    // Dev-friendly: parse JWT payload without verify (ok for local/dev only)
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
      campaignId: payload.campaignId ?? options?.campaignId ?? this.campaignId ?? null,
    };
    if (!client.user.campaignId) throw new Error("missing campaignId in token/options");
    return true;
  }

  async onJoin(client) {
    this.assertSameCampaign(client);
    await assertMember(this.campaignId, client.user.id);
    this.getOrInitPlayer(client.user.id, client.user);
  }

  /* =========================
   * Guards & helpers
   * ========================= */
  assertSameCampaign(client) {
    const cid = client?.user?.campaignId ?? null;
    if (!this.campaignId || cid !== this.campaignId) {
      throw new Error("campaign mismatch");
    }
  }

  requireRole(client, allowed) {
    if (!allowed.includes(client.user.role)) {
      throw new Error(`access denied (needs: ${allowed.join(", ")})`);
    }
  }

  getOrInitPlayer(uid, userLike = null) {
    let ps = this.state.players.get(uid);
    if (!ps) {
      ps = new PlayerState();
      ps.id = uid;
      ps.name = userLike?.name ?? "Player";
      ps.role = userLike?.role ?? "player";
      ps.hp = 10;
      ps.xp = 0;
      this.state.players.set(uid, ps);
    } else {
      if (userLike?.name && (!ps.name || ps.name === "Player")) ps.name = userLike.name;
      if (userLike?.role && (!ps.role || ps.role === "player")) ps.role = userLike.role;
    }
    return ps;
  }

  /* =========================
   * Rehydrate helpers
   * ========================= */
  initFreshState() {
    if (!this.state) this.setState(new DemoState());
    if (!this.state.players) this.state.players = new MapSchema();
  }

  applyFullState(stateJson) {
    // Convert plain JSON snapshot back to Schema/MapSchema
    this.initFreshState();
    this.state.players.clear();

    const players = stateJson?.players || {};
    for (const [id, v] of Object.entries(players)) {
      const ps = new PlayerState();
      ps.id = v.id ?? id;
      ps.name = v.name ?? "Player";
      ps.role = v.role ?? "player";
      ps.hp = Number.isFinite(v.hp) ? v.hp : 10;
      ps.xp = Number.isFinite(v.xp) ? v.xp : 0;
      this.state.players.set(id, ps);
    }

    if (Number.isFinite(stateJson?.version)) {
      this.state.version = stateJson.version;
    }
  }

  serializeState() {
    const out = {
      players: {},
      version: this.state.version ?? 0,
    };
    this.state.players.forEach((p, id) => {
      out.players[id] = {
        id: p.id,
        name: p.name,
        hp: p.hp,
        xp: p.xp,
        role: p.role,
      };
    });
    return out;
  }

  /* =========================
   * Event application + commit
   * ========================= */
  applyEvent(type, payload) {
    switch (type) {
      case "PLAYER_UPSERT": {
        const { id, name, role } = payload;
        const p = this.getOrInitPlayer(id);
        if (name) p.name = String(name).slice(0, 64);
        if (role) p.role = String(role);
        break;
      }

      case "NAME_SET": {
        const { id, name } = payload;
        const p = this.getOrInitPlayer(id);
        p.name = String(name ?? "").slice(0, 64);
        break;
      }

      case "HP_SET": {
        const { id, hp } = payload;
        const p = this.getOrInitPlayer(id);
        p.hp = Math.max(0, Math.trunc(Number(hp ?? p.hp)));
        break;
      }

      case "XP_ADD": {
        const { id, amount } = payload;
        const p = this.getOrInitPlayer(id);
        const amt = Math.trunc(Number(amount ?? 0));
        p.xp = Math.max(0, (Number(p.xp) || 0) + amt);
        break;
      }

      default:
        // ignore unknown events for forward-compat
        break;
    }
  }

  async commitEvent(type, payload, opts = {}) {
    // 1) apply to live state
    this.applyEvent(type, payload);

    // 2) persist (optimistic concurrency vs current persistedVersion)
    const newVersion = await this.eventStore.append(
      this.streamId,
      type,
      payload ?? {},
      {
        expectedVersion: this.persistedVersion,
        correlationId: opts.correlationId ?? null, // must be UUID or null (DB schema)
      }
    );

    // 3) bump counters
    this.state.version++;
    this.persistedVersion = newVersion;

    // 4) maybe snapshot
    const since = this.persistedVersion - (this.snapshotVersion || 0);
    if (since >= (this.snapshotEveryN || 50)) {
      const snap = this.serializeState();
      await this.eventStore.saveSnapshot(this.streamId, this.persistedVersion, snap);
      this.snapshotVersion = this.persistedVersion;
    }

    // 5) emit updated meta
    this.setMetadata({
      ...this.metadata,
      persistedVersion: this.persistedVersion,
      snapshotVersion: this.snapshotVersion ?? 0,
    });
    this.emitMeta?.();
  }

  /* =========================
   * Messages
   * ========================= */
  async handleOp(client, data) {
    this.assertSameCampaign(client);
    await assertMember(this.campaignId, client.user.id);

    const type = String(data?.type || "");
    const isPlayer = client.user.role === "player";
    const selfId = client.user.id;

    switch (type) {
      case "PLAYER_UPSERT": {
        // Owners/DMs can upsert anyone; players can only upsert themselves
        const id = isPlayer ? selfId : String(data?.id ?? selfId);
        const name = (data?.name ?? "").toString().slice(0, 64);
        const role = isPlayer ? "player" : (data?.role ?? undefined);
        await this.commitEvent("PLAYER_UPSERT", { id, name, role }, { correlationId: data?.correlation_id });
        break;
      }

      case "SET_NAME": {
        const id = isPlayer ? selfId : String(data?.id ?? selfId);
        const name = (data?.name ?? "").toString().slice(0, 64);
        await this.commitEvent("NAME_SET", { id, name }, { correlationId: data?.correlation_id });
        break;
      }

      case "SET_HP": {
        const targetId = isPlayer ? selfId : String(data?.id ?? selfId);
        if (!isPlayer) this.requireRole(client, ["owner", "dm"]);
        const hp = Number(data?.value);
        await this.commitEvent("HP_SET", { id: targetId, hp }, { correlationId: data?.correlation_id });
        break;
      }

      case "HP_ADD": {
        const targetId = isPlayer ? selfId : String(data?.id ?? selfId);
        const ps = this.getOrInitPlayer(targetId, targetId === selfId ? client.user : null);
        const amount = Math.trunc(Number(data?.amount ?? 0));
        const next = (Number(ps.hp) || 0) + amount;
        await this.commitEvent("HP_SET", { id: targetId, hp: next }, { correlationId: data?.correlation_id });
        break;
      }

      case "XP_ADD": {
        const targetId = isPlayer ? selfId : String(data?.id ?? selfId);
        const amount = Math.trunc(Number(data?.amount ?? 0));
        if (!Number.isFinite(amount) || Math.abs(amount) > 1_000_000) {
          throw new Error("invalid xp amount");
        }
        await this.commitEvent("XP_ADD", { id: targetId, amount }, { correlationId: data?.correlation_id });
        break;
      }

      default:
        // ignore unknown op types
        break;
    }
  }

  async handleChat(client, payload) {
    this.assertSameCampaign(client);
    await assertMember(this.campaignId, client.user.id);
    const ps = this.getOrInitPlayer(client.user.id, client.user);
    const text = String(payload?.text ?? "").slice(0, 500);
    this.broadcast("chat", { from: ps.name, text });
  }
}
