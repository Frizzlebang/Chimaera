// BEGIN FILE: server/src/rooms/DemoRoom.js
import colyseusPkg from "colyseus";
const { Room } = colyseusPkg;

import { Schema, MapSchema } from "@colyseus/schema";
import * as schema from "@colyseus/schema";
import EventStore from "../db/EventStore.js";
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
  async onCreate(options) {
    this.setPatchRate(100);

    this.campaignId = String(options?.campaignId ?? "");
    if (!this.campaignId) throw new Error("room missing campaignId");
    this.streamId = this.campaignId;

    this.eventStore = new EventStore();
    await this.eventStore.ensureStream(this.streamId, `demo:${this.campaignId}`);

    this.setState(new DemoState());

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

    this.persistedVersion = currentVersion;
    this.snapshotVersion = snapshot?.version ?? 0;

    this.setMetadata({
      rehydratedAt: new Date().toISOString(),
      persistedVersion: this.persistedVersion,
      snapshotVersion: this.snapshotVersion,
      replayCount,
    });
    this.emitMeta?.();

    this.onMessage("op", (client, data) => this.handleOp(client, data));
    this.onMessage("chat", (client, data) => this.handleChat(client, data));

    this.snapshotEveryN = 50;
  }

  async onAuth(client, options) {
    const token = String(options?.token || "");
    let payload = {};
    try {
      const part = token.split(".")[1] || "";
      const json = Buffer.from(part, "base64url").toString("utf8");
      payload = JSON.parse(json || "{}");
    } catch (_) {}

    // Debug logging to see what's being passed
    console.log("=== AUTH DEBUG ===");
    console.log("Raw options:", options);
    console.log("JWT payload:", payload);
    console.log("client.sessionId:", client.sessionId);
    console.log("Computed userId:", payload.sub || options?.userId || client.sessionId);

    // Use email as fallback ID if available, otherwise sessionId
    const userId = payload.sub || options?.userId || options?.email || client.sessionId;

    client.user = {
      id: userId,
      name: payload.name ?? options?.name ?? "Player",
      role: payload.role ?? options?.role ?? "player",
      campaignId: payload.campaignId ?? options?.campaignId ?? this.campaignId ?? null,
    };
    if (!client.user.campaignId) throw new Error("missing campaignId in token/options");
    
    console.log("Final client.user:", client.user);
    console.log("==================");
    return true;
  }

  async onJoin(client) {
    console.log("=== ON JOIN ===");
    console.log("client.user on join:", client.user);
    this.assertSameCampaign(client);
    await assertMember(this.campaignId, client.user.id);
    
    // Create player immediately on join with a PLAYER_UPSERT event
    await this.commitEvent("PLAYER_UPSERT", {
      id: client.user.id,
      name: client.user.name,
      role: client.user.role
    });
    
    console.log("Player created via PLAYER_UPSERT event");
    console.log("===============");
  }

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
    console.log(`getOrInitPlayer called with uid: ${uid}, userLike:`, userLike);
    
    let ps = this.state.players.get(uid);
    if (!ps) {
      ps = new PlayerState();
      ps.id = uid;
      ps.name = userLike?.name ?? "Player";
      ps.role = userLike?.role ?? "player";
      ps.hp = 10;
      ps.xp = 0;
      this.state.players.set(uid, ps);
      console.log(`Created new player: ${uid} with name: ${ps.name}, role: ${ps.role}`);
    } else {
      // Always update name if provided and different
      const oldRole = ps.role;
      const oldName = ps.name;
      
      if (userLike?.name && userLike.name !== ps.name) {
        ps.name = userLike.name;
      }
      
      // Don't downgrade from owner/dm to player
      if (userLike?.role && userLike.role !== ps.role) {
        if (ps.role === "owner" || ps.role === "dm") {
          console.log(`Refusing to downgrade ${uid} from ${ps.role} to ${userLike.role}`);
        } else {
          ps.role = userLike.role;
        }
      }
      
      console.log(`Updated existing player: ${uid} - name: ${oldName} -> ${ps.name}, role: ${oldRole} -> ${ps.role}`);
    }
    return ps;
  }

  initFreshState() {
    if (!this.state) this.setState(new DemoState());
    if (!this.state.players) this.state.players = new MapSchema();
  }

  applyFullState(stateJson) {
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
    const out = { players: {}, version: this.state.version ?? 0 };
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
        break;
    }
  }

  async commitEvent(type, payload, opts = {}) {
    this.applyEvent(type, payload);
    const newVersion = await this.eventStore.append(
      this.streamId,
      type,
      payload ?? {},
      {
        expectedVersion: this.persistedVersion,
        correlationId: opts.correlationId ?? null,
      }
    );
    this.state.version++;
    this.persistedVersion = newVersion;

    const since = this.persistedVersion - (this.snapshotVersion || 0);
    if (since >= (this.snapshotEveryN || 50)) {
      const snap = this.serializeState();
      await this.eventStore.saveSnapshot(this.streamId, this.persistedVersion, snap);
      this.snapshotVersion = this.persistedVersion;
    }

    this.setMetadata({
      ...this.metadata,
      persistedVersion: this.persistedVersion,
      snapshotVersion: this.snapshotVersion ?? 0,
    });
    this.emitMeta?.();
  }

  async handleOp(client, data) {
    console.log(`=== HANDLE OP ===`);
    console.log(`Operation: ${data?.type}, from client:`, client.user);
    
    this.assertSameCampaign(client);
    await assertMember(this.campaignId, client.user.id);

    const type = String(data?.type || "");
    const isPlayer = client.user.role === "player";
    const selfId = client.user.id;

    console.log(`isPlayer: ${isPlayer}, selfId: ${selfId}`);

    switch (type) {
      case "PLAYER_UPSERT": {
        const id = isPlayer ? selfId : String(data?.id ?? selfId);
        const name = (data?.name ?? "").toString().slice(0, 64);
        // Don't override role - keep the original role from client.user
        const role = data?.role ?? client.user.role;
        console.log(`PLAYER_UPSERT: id=${id}, name=${name}, role=${role} (client.user.role=${client.user.role})`);
        await this.commitEvent("PLAYER_UPSERT", { id, name, role }, { correlationId: data?.correlation_id });
        break;
      }
      case "SET_NAME": {
        const id = isPlayer ? selfId : String(data?.id ?? selfId);
        const name = (data?.name ?? "").toString().slice(0, 64);
        console.log(`SET_NAME: id=${id}, name=${name}`);
        await this.commitEvent("NAME_SET", { id, name }, { correlationId: data?.correlation_id });
        break;
      }
      case "SET_HP": {
        const targetId = isPlayer ? selfId : String(data?.id ?? selfId);
        if (!isPlayer) this.requireRole(client, ["owner", "dm"]);
        const hp = Number(data?.value);
        console.log(`SET_HP: targetId=${targetId}, hp=${hp}`);
        await this.commitEvent("HP_SET", { id: targetId, hp }, { correlationId: data?.correlation_id });
        break;
      }
      case "HP_ADD": {
        const targetId = isPlayer ? selfId : String(data?.id ?? selfId);
        const ps = this.getOrInitPlayer(targetId, targetId === selfId ? client.user : null);
        const amount = Math.trunc(Number(data?.amount ?? 0));
        const next = (Number(ps.hp) || 0) + amount;
        console.log(`HP_ADD: targetId=${targetId}, amount=${amount}, next=${next}`);
        await this.commitEvent("HP_SET", { id: targetId, hp: next }, { correlationId: data?.correlation_id });
        break;
      }
      case "XP_ADD": {
        const targetId = isPlayer ? selfId : String(data?.id ?? selfId);
        const amount = Math.trunc(Number(data?.amount ?? 0));
        if (!Number.isFinite(amount) || Math.abs(amount) > 1_000_000) {
          throw new Error("invalid xp amount");
        }
        console.log(`XP_ADD: targetId=${targetId}, amount=${amount}`);
        await this.commitEvent("XP_ADD", { id: targetId, amount }, { correlationId: data?.correlation_id });
        break;
      }
      default:
        console.log(`Unknown operation: ${type}`);
        break;
    }
    console.log(`================`);
  }

  async handleChat(client, payload) {
    this.assertSameCampaign(client);
    await assertMember(this.campaignId, client.user.id);
    const ps = this.getOrInitPlayer(client.user.id, client.user);
    const text = String(payload?.text ?? "").slice(0, 500);
    this.broadcast("chat", { from: ps.name, text });
  }
}
// END FILE: server/src/rooms/DemoRoom.js