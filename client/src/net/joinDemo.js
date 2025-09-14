// client/src/net/joinDemo.js
import { Client } from "colyseus.js";
import { getToken, getCampaignId } from "../auth/token";

// Same-origin WS (works with your Cloudflare tunnel setup)
function makeWsUrl() {
  return window.location.origin.replace(/^http/, "ws");
}

export async function joinDemoRoom() {
  const token = getToken();
  const campaignId = getCampaignId();
  if (!token || !campaignId) {
    throw new Error("Missing token or campaignId. Run devLogin() first or set localStorage.");
  }

  const client = new Client(makeWsUrl());
  // S4: send { token, campaignId }
  const room = await client.joinOrCreate("demo", { token, campaignId });

  // Basic listeners to prove it works
  room.onStateChange.once((state) => {
    console.log("[demo] initial state:", state);
  });
  room.onMessage("chat", (msg) => {
    console.log("[demo] chat:", msg);
  });

  // Quick hello
  room.send("chat", { text: "hello from client" });

  return room;
}
