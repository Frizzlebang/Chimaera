// BEGIN REPLACE: client/src/devdock/DevDock.tsx
import React, { useState, useEffect } from "react";
import "./devdock.css";
import { createPortal } from "react-dom";
import D3Jwt from "./panels/D3Jwt";
import D5Membership from "./panels/D5Membership";

// Gate by env only (keep local flag for dev convenience)
const VITE_FLAG = import.meta.env.VITE_DEVTOOLS === "1";

/** Small helper to copy to clipboard with fallback */
async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    return true;
  }
}

/** Collapsible wrapper used for D3/D5 blocks; renders an optional Console button */
function CollapsibleBlock({
  title,
  children,
  defaultOpen = false,
  consoleSnippet,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  /** Returns a string to copy to clipboard (console snippet + relevant output) */
  consoleSnippet?: () => string;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  const [justCopied, setJustCopied] = React.useState(false);

  const doCopy = async () => {
    if (!consoleSnippet) return;
    const text = consoleSnippet();
    await copyText(text);
    setJustCopied(true);
    setTimeout(() => setJustCopied(false), 900);
  };

  return (
    <section className={`collapsible ${open ? "open" : "closed"}`}>
      <button
        className="collapsible-head"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={title.replace(/\s+/g, "-").toLowerCase()}
      >
        <span className="collapsible-title">{title}</span>
        <span className={`collapsible-icon ${open ? "rot" : ""}`}>▾</span>
      </button>

      {open && (
        <div
          id={title.replace(/\s+/g, "-").toLowerCase()}
          className="collapsible-body"
        >
          {children}

          {consoleSnippet && (
            <div className="console-row">
              <button className={`btn-orange ${justCopied ? "copied" : ""}`} onClick={doCopy}>
                {justCopied ? "Copied!" : "Console"}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export default function DevDock() {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isEnabled, setIsEnabled] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    let localFlag = false;
    try {
      localFlag = localStorage.getItem("DEV_ENABLED") === "1";
    } catch {
      /* no-op */
    }
    const enabled =
      VITE_FLAG && (localFlag || import.meta.env.MODE === "development");
    setIsEnabled(enabled);
    setMounted(true);
  }, []);

  if (!isEnabled || !mounted) return null;

  // --- Console snippet generators ---
  const d3Snippet = () => {
    const base = localStorage.getItem("JWT_BASE") || "";
    return `// D3 — Identity Token (Base JWT)
const base = localStorage.getItem("JWT_BASE") || ${JSON.stringify(base)};
console.log("JWT_BASE:", base);

// quick decoder
function decodeJwt(t){try{const p=t.split(".")[1];return JSON.parse(atob(p.replace(/-/g,"+").replace(/_/g,"/")));}catch(e){return null;}}
console.log("payload:", decodeJwt(base));`;
  };

// Fixed d5Snippet function for DevDock.tsx
const d5Snippet = () => {
  const up = localStorage.getItem("JWT_UPGRADED") || "";
  
  return `// D5 — Upgraded Token (Room join)
const token = localStorage.getItem("JWT_UPGRADED") || ${JSON.stringify(up)};
console.log("JWT_UPGRADED:", token);

// Note: This snippet is for reference only
// To actually join a room, use this code in your React component:
/*
import { Client } from "colyseus.js";

const client = new Client("${location.origin.replace(/^http/, "ws")}");
try {
  const room = await client.joinOrCreate("demo", { token });
  console.log("Joined room:", room);
} catch (err) {
  console.error("Join failed:", err);
}
*/

console.log("Copy the import statement above to use in your React app");`;
};

  const dockContent = (
    <>
      {isExpanded && (
        <div
          className="dock-backdrop"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setIsExpanded(false);
          }}
        />
      )}

      <div
        className={`dock-container ${
          isExpanded ? "dock-expanded" : "dock-collapsed"
        }`}
      >
        <div className="dock-panel devdock" onClick={(e) => e.stopPropagation()}>
          <div className="dock-header">
            <span>WEAVE DEV DOCK</span>
          </div>

          <div className="dock-content">
            <div className="dock-sections">
              <CollapsibleBlock
                title="D3 — Identity Token"
                defaultOpen={false}
                consoleSnippet={d3Snippet}
              >
                <D3Jwt />
              </CollapsibleBlock>

              <CollapsibleBlock
                title="D5 — Membership & Upgraded Token"
                defaultOpen={false}
                consoleSnippet={d5Snippet}
              >
                <D5Membership />
              </CollapsibleBlock>
            </div>
          </div>
        </div>
      </div>

      <div
        className={`dock-handle ${
          isExpanded ? "handle-expanded" : "handle-collapsed"
        }`}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsExpanded(!isExpanded);
        }}
      >
        <div className="handle-inner">
          <div className="handle-icon">
            <div className="hamburger">
              <span></span>
              <span></span>
              <span></span>
            </div>
          </div>
        </div>
      </div>

      <style jsx>{`
        /* ---------- width: one source of truth ---------- */
        :root {
          --dockw: clamp(360px, 40vw, 600px); /* min 360px, target 40%, max 600px */
        }
        @media (max-width: 768px) {
          :root { --dockw: 100vw; }
        }

        .dock-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.6);
          backdrop-filter: blur(4px);
          z-index: 40;
        }

        .dock-container {
          position: fixed;
          top: 0;
          right: 0;
          height: 100vh;
          width: var(--dockw);
          z-index: 50;
          transition: transform 0.3s ease-in-out;
        }

        .dock-collapsed { transform: translateX(100%); }
        .dock-expanded  { transform: translateX(0); }

        .dock-panel {
          height: 100%;
          width: 100%;
          background: rgba(26, 26, 26, 0.85);
          backdrop-filter: blur(20px);
          border-left: 1px solid rgba(68, 199, 177, 0.2);
          box-shadow: -5px 0 30px rgba(0, 0, 0, 0.5);
          display: flex;
          flex-direction: column;
          color: rgba(255, 255, 255, 0.85);
        }

        .dock-header {
          padding: 24px;
          border-bottom: 1px solid rgba(68, 199, 177, 0.2);
          background: rgba(68, 199, 177, 0.1);
          font-weight: 600;
          font-family: 'Montserrat', sans-serif;
          font-size: 12px;
          letter-spacing: 2px;
          text-transform: uppercase;
          display: flex;
          justify-content: center;
          align-items: center;
          position: sticky;
          top: 0;
          z-index: 10;
          color: #44C7B1;
        }

        .dock-content { flex: 1; overflow-y: auto; padding: 0; }
        .dock-content::-webkit-scrollbar { width: 6px; }
        .dock-content::-webkit-scrollbar-track { background: rgba(255,255,255,0.05); border-radius: 3px; }
        .dock-content::-webkit-scrollbar-thumb { background: rgba(68,199,177,0.6); border-radius: 3px; }
        .dock-content::-webkit-scrollbar-thumb:hover { background: rgba(68,199,177,0.8); }

        .dock-sections {
          padding: 24px;
          display: flex;
          flex-direction: column;
          gap: 20px;
        }

        .dock-handle {
          position: fixed;
          top: 50%;
          transform: translateY(-50%);
          z-index: 50;
          transition: all 0.3s ease-in-out;
          cursor: pointer;
        }
        .handle-collapsed { right: 0; }
        .handle-expanded  { right: var(--dockw); }

        .handle-inner {
          background: linear-gradient(135deg, #44C7B1, #3AB19B);
          color: white;
          padding: 16px 12px;
          border-radius: 12px 0 0 12px;
          box-shadow: -4px 0 20px rgba(68,199,177,0.4);
          transition: transform 0.3s ease;
          backdrop-filter: blur(10px);
          border: 1px solid rgba(255,255,255,0.1);
          border-right: none;
        }
        .handle-inner:hover { transform: translateX(-2px); }
        .handle-icon { display: flex; align-items: center; justify-content: center; }
        .hamburger { display: flex; flex-direction: column; gap: 3px; width: 16px; }
        .hamburger span { display: block; height: 2px; width: 100%; background: white; border-radius: 1px; }

        /* Collapsible block styles (rounded, contrasting pill header) */
        .collapsible {
          border: 1px solid rgba(34,211,238,0.25);
          border-radius: 14px;
          padding: 10px;
          background: rgba(255,255,255,0.03);
        }
        .collapsible + .collapsible { margin-top: 10px; }

        .collapsible-head {
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: rgba(167,139,250,0.18);
          border: 1px solid rgba(167,139,250,0.40);
          border-radius: 12px;
          padding: 10px 12px;
          color: rgba(255,255,255,0.85);
          font-weight: 700;
          cursor: pointer;
          transition: background .15s ease, border-color .15s ease, transform .05s ease;
        }
        .collapsible-head:hover {
          background: rgba(167,139,250,0.28);
          border-color: rgba(167,139,250,0.55);
        }
        .collapsible-title { pointer-events: none; }
        .collapsible-icon  { font-size: 1rem; opacity: .9; transition: transform .18s ease; }
        .collapsible-icon.rot { transform: rotate(180deg); }

        .collapsible-body { padding: 14px 4px 4px; color: rgba(255,255,255,0.85); }

        /* Console row inside block */
        .console-row {
          display: flex;
          justify-content: flex-end;
          margin-top: 14px;
        }
        .btn-orange {
          background: #f59e0b; /* orange-500 */
          border: 1px solid rgba(0,0,0,0.15);
          color: #111;
          padding: 8px 12px;
          border-radius: 10px;
          font-weight: 700;
          transition: transform .05s ease, box-shadow .15s ease, background .15s ease;
        }
        .btn-orange:hover { background: #fbbf24; /* orange-400 */ box-shadow: 0 0 12px rgba(251,191,36,0.25); }
        .btn-orange:active { transform: translateY(1px); }
        .btn-orange.copied { background: #34d399; color: #063; } /* green feedback */
      `}</style>
    </>
  );

  return createPortal(dockContent, document.body);
}
// END REPLACE
