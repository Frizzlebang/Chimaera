// BEGIN REPLACE: client/src/devdock/panels/D3Jwt.tsx
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

export default function D3Jwt() {
  const [email, setEmail] = useState("split@test.com");
  const [name, setName] = useState("SplitUser");
  const [token, setToken] = useState<string | null>(
    localStorage.getItem("JWT_BASE")
  );
  const payload = useMemo(() => decodeJwt(token), [token]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/auth/dev-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, name }),
    });
    if (!res.ok) {
      alert("Login failed");
      return;
    }
    const data = await res.json();
    setToken(data.token);
    localStorage.setItem("JWT_BASE", data.token);
  }

  return (
    <div className="p-3 space-y-3">
      <form className="space-y-2" onSubmit={handleLogin}>
        {/* Inputs row (robust layout, no Tailwind dependency) */}
        <div className="row hstack">
          <input
            className="grow"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="email"
          />
          <input
            className=""
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="name"
          />
        </div>

        {/* Actions row (right-aligned) */}
        <div className="row actions-right">
          <button type="submit" className="btn-sm">Dev Login</button>
        </div>
      </form>

      <div>
        <div className="text-sm font-medium">Token (identity-only)</div>
        <textarea className="w-full h-20 p-2" readOnly value={token ?? ""} />
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
