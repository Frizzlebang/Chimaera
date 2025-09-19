// client/src/net/joinDemo.js
import { Client } from "colyseus.js";
import { getToken, getCampaign, isTokenExpired } from "../auth/token.js";

function makeWsBase() {
  const http = window.location.origin;
  if (http.startsWith("https://")) return "wss://" + http.slice("https://".length);
  return http.replace(/^http/, "ws");
}

export async function joinDemoRoom() {
  const token = getToken();
  const campaign = getCampaign();

  if (!token || !campaign?.id) {
    throw new Error("Missing token or campaignId. Please join again.");
  }
  if (isTokenExpired(token)) {
    const e = new Error("SESSION_EXPIRED");
    e.code = "SESSION_EXPIRED";
    throw e;
  }

  const client = new Client(makeWsBase());
  const room = await client.joinOrCreate("demo", {
    token,
    campaignId: campaign.id,
  });

  // Proof listeners
  room.onStateChange.once((state) => console.log("[demo] initial state:", state));
  room.onMessage("chat", (m) => console.log("[demo] chat:", m));

  // hello
  room.send("chat", { text: "hello from client" });

  return room;
}
