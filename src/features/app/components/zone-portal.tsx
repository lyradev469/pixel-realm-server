"use client";

/**
 * ZonePortal — overlay prompt shown when player is near a portal.
 * Displays zone name, difficulty badge, and enter button.
 */

import { useEffect, useState } from "react";
import type { ZoneDefinition, PortalDefinition } from "../zones";
import { ZONES } from "../zones";

interface ZonePortalProps {
  portal:    PortalDefinition & { worldX: number; worldY: number };
  currentZone: string;
  onEnter:   (targetZoneId: string) => void;
  onDismiss: () => void;
  isLoading: boolean;
}

const DIFFICULTY_COLORS: Record<string, string> = {
  easy:   "#4ade80",
  medium: "#fbbf24",
  hard:   "#f87171",
  safe:   "#60a5fa",
};

const DIFFICULTY_LABELS: Record<string, string> = {
  easy:   "Easy",
  medium: "Medium",
  hard:   "Hard",
  safe:   "Safe",
};

export function ZonePortalPrompt({ portal, onEnter, onDismiss, isLoading }: ZonePortalProps) {
  const [visible, setVisible] = useState(false);
  const targetZone: ZoneDefinition | undefined = ZONES[portal.targetZone];

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 30);
    return () => clearTimeout(t);
  }, []);

  if (!targetZone) return null;

  const diffColor = DIFFICULTY_COLORS[targetZone.difficulty] ?? "#aaa";
  const diffLabel = DIFFICULTY_LABELS[targetZone.difficulty] ?? targetZone.difficulty;

  return (
    <div
      style={{
        position: "absolute",
        bottom: 130,
        left: "50%",
        transform: `translateX(-50%) translateY(${visible ? "0" : "20px"})`,
        opacity: visible ? 1 : 0,
        transition: "all 0.25s ease",
        zIndex: 400,
        pointerEvents: "all",
        width: "min(320px, 90vw)",
      }}
    >
      <div
        style={{
          background: "rgba(10,6,24,0.96)",
          border: `1.5px solid ${targetZone.ambientColor}50`,
          borderRadius: 12,
          padding: "14px 16px",
          boxShadow: `0 0 24px ${targetZone.ambientColor}20, 0 8px 32px rgba(0,0,0,0.8)`,
          backdropFilter: "blur(8px)",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
          <div style={{
            fontSize: 28,
            lineHeight: 1,
            filter: `drop-shadow(0 0 8px ${targetZone.ambientColor})`,
          }}>
            {targetZone.icon}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{
              color: "#fff",
              fontSize: 14,
              fontWeight: "bold",
              fontFamily: "monospace",
              letterSpacing: 1,
            }}>
              {targetZone.name}
            </div>
            <div style={{
              color: "#888",
              fontSize: 10,
              fontFamily: "monospace",
              marginTop: 2,
            }}>
              {targetZone.subtitle}
            </div>
          </div>
          {/* Difficulty badge */}
          <div style={{
            background: `${diffColor}20`,
            border: `1px solid ${diffColor}60`,
            borderRadius: 4,
            padding: "2px 8px",
            color: diffColor,
            fontSize: 9,
            fontFamily: "monospace",
            letterSpacing: 1,
            whiteSpace: "nowrap",
          }}>
            {diffLabel}
          </div>
        </div>

        {/* Monster pool preview */}
        <div style={{
          display: "flex",
          gap: 6,
          marginBottom: 12,
          flexWrap: "wrap",
        }}>
          {targetZone.monsterPool.map(kind => (
            <div key={kind} style={{
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 4,
              padding: "2px 8px",
              color: "#ccc",
              fontSize: 9,
              fontFamily: "monospace",
            }}>
              {kind.charAt(0).toUpperCase() + kind.slice(1)}
            </div>
          ))}
        </div>

        {/* Buttons */}
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => onEnter(portal.targetZone)}
            disabled={isLoading}
            style={{
              flex: 1,
              background: isLoading
                ? "rgba(124,58,237,0.3)"
                : `linear-gradient(135deg, ${targetZone.ambientColor}40, ${targetZone.ambientColor}20)`,
              border: `1.5px solid ${targetZone.ambientColor}80`,
              borderRadius: 6,
              color: isLoading ? "#666" : "#fff",
              fontSize: 12,
              fontFamily: "monospace",
              fontWeight: "bold",
              letterSpacing: 1,
              padding: "9px 16px",
              cursor: isLoading ? "default" : "pointer",
              transition: "all 0.15s ease",
            }}
          >
            {isLoading ? "Traveling..." : `${portal.icon} Enter Zone`}
          </button>
          <button
            onClick={onDismiss}
            style={{
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.15)",
              borderRadius: 6,
              color: "#888",
              fontSize: 11,
              fontFamily: "monospace",
              padding: "9px 14px",
              cursor: "pointer",
            }}
          >
            ✕
          </button>
        </div>
      </div>

      {/* Portal glow indicator on the map */}
      <div style={{
        position: "absolute",
        top: -8,
        left: "50%",
        transform: "translateX(-50%)",
        width: 6,
        height: 6,
        borderRadius: "50%",
        background: targetZone.ambientColor,
        boxShadow: `0 0 12px ${targetZone.ambientColor}`,
        animation: "portalPulse 1s ease-in-out infinite alternate",
      }} />
      <style>{`
        @keyframes portalPulse {
          from { opacity: 0.5; transform: translateX(-50%) scale(1); }
          to   { opacity: 1;   transform: translateX(-50%) scale(1.5); }
        }
      `}</style>
    </div>
  );
}

// ── Zone transition loading screen ───────────────────────────────────────────

export function ZoneTransitionScreen({ targetZone }: { targetZone: string }) {
  const zone = ZONES[targetZone as keyof typeof ZONES];
  if (!zone) return null;

  return (
    <div style={{
      position: "absolute",
      inset: 0,
      background: zone.bgColor,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: 16,
      zIndex: 600,
      fontFamily: "monospace",
    }}>
      <div style={{
        fontSize: 52,
        filter: `drop-shadow(0 0 20px ${zone.ambientColor})`,
        animation: "zoneIconBob 1s ease-in-out infinite alternate",
      }}>
        {zone.icon}
      </div>
      <div style={{
        color: zone.ambientColor,
        fontSize: 18,
        fontWeight: "bold",
        letterSpacing: 3,
        textShadow: `0 0 20px ${zone.ambientColor}`,
      }}>
        {zone.name.toUpperCase()}
      </div>
      <div style={{ color: "#666", fontSize: 10, letterSpacing: 2 }}>
        {zone.subtitle}
      </div>
      <div style={{
        width: 120,
        height: 4,
        background: "rgba(255,255,255,0.1)",
        borderRadius: 2,
        overflow: "hidden",
        marginTop: 8,
      }}>
        <div style={{
          height: "100%",
          background: zone.ambientColor,
          borderRadius: 2,
          animation: "zoneLoadBar 1.2s ease-in-out infinite",
        }} />
      </div>
      <style>{`
        @keyframes zoneIconBob {
          from { transform: translateY(0); }
          to   { transform: translateY(-8px); }
        }
        @keyframes zoneLoadBar {
          0%   { width: 0%;    margin-left: 0%; }
          50%  { width: 80%;   margin-left: 10%; }
          100% { width: 0%;    margin-left: 100%; }
        }
      `}</style>
    </div>
  );
}

// ── Zone HUD badge ────────────────────────────────────────────────────────────

export function ZoneBadge({ zoneId }: { zoneId: string }) {
  const zone = ZONES[zoneId as keyof typeof ZONES];
  if (!zone) return (
    <span style={{ color: "#888", fontSize: 10, fontFamily: "monospace" }}>
      {zoneId}
    </span>
  );

  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 4,
      background: `${zone.ambientColor}15`,
      border: `1px solid ${zone.ambientColor}40`,
      borderRadius: 4,
      padding: "1px 6px",
      color: zone.ambientColor,
      fontSize: 9,
      fontFamily: "monospace",
      letterSpacing: 0.5,
    }}>
      {zone.icon} {zone.name}
    </span>
  );
}
