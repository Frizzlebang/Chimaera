// BEGIN REPLACE: client/src/devdock/panels/D5Membership.tsx
import React, { useMemo, useState } from "react";

function b64urlDecode(str: string) {
  const pad = "=".repeat((4 - (str.length % 4)) % 4);
  const s = (str + pad).replace(/-/g, "+").replace(/_/g, "/");
  try {
    return decodeURIComponent(
      atob(s)
        .split("")
        .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join("")
    );
  } catch {
    return "";
  }
}
function decodeJwt(token: string | null) {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    return JSON.parse(b64urlDecode(parts[1]));
  } catch {
    return null;
  }
}

const ROLES = ["owner", "dm", "player", "viewer"] as const;
type Role = (typeof ROLES)[number];

export default function D5Membership() {
  const [slug, setSlug] = useState("demo-campaign");
  const [role, setRole] = useState<Role>("owner");
  const [upgraded, setUpgraded] = useState<string | null>(
    localStorage.getItem("JWT_UPGRADED")
  );
  const payload = useMemo(() => decodeJwt(upgraded), [upgraded]);

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    const base = localStorage.getItem("JWT_BASE");
    if (!base) {
      alert("Missing identity token. Run D3 first.");
      return;
    }

    const res = await fetch("/api/campaigns/join", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${base}`,
      },
      body: JSON.stringify({ campaignSlug: slug, role }),
    });
    if (!res.ok) {
      const t = await res.text();
      alert("Join failed: " + t);
      return;
    }
    const data = await res.json();
    setUpgraded(data.token);
    localStorage.setItem("JWT_UPGRADED", data.token);
  }

  function copyUpgraded() {
    if (!upgraded) return;
    navigator.clipboard.writeText(upgraded);
  }

  return (
    <div className="p-3 space-y-3">
      <form className="space-y-2" onSubmit={handleJoin}>
        {/* Inputs row (robust layout) */}
        <div className="row hstack">
          <input
            className="grow"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="campaign-slug"
          />
          <select
            className=""
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>

        {/* Actions row (right-aligned) */}
        <div className="row actions-right">
          <button type="submit" className="btn-sm">Join / Upgrade</button>
        </div>
      </form>

      <div>
        <div className="inline-actions">
          <div className="text-sm font-medium">Upgraded token (use for room join)</div>
          <button className="btn-sm" onClick={copyUpgraded}>Copy</button>
        </div>
        <textarea className="w-full h-20 p-2" readOnly value={upgraded ?? ""} />
      </div>

      <div>
        <div className="text-sm font-medium">Decoded payload</div>
        <pre className="w-full p-2 overflow-auto text-xs">
          {JSON.stringify(payload, null, 2)}
        </pre>
      </div>
    </div>
  );
}
// END REPLACE
