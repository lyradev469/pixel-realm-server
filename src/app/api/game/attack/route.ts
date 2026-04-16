/**
 * PIXEL REALM ONLINE — AI Agent Attack API
 * POST /api/game/attack
 * Body: { agentId, targetId, zoneId }
 *
 * Allows external AI agents to trigger attacks via HTTP.
 */

import { NextRequest, NextResponse } from "next/server";

const GAME_SERVER = process.env.GAME_SERVER_URL || "http://localhost:8080";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { agentId, targetId, zoneId } = body;

    if (!agentId || !targetId) {
      return NextResponse.json({ error: "agentId and targetId required" }, { status: 400 });
    }

    const res = await fetch(`${GAME_SERVER}/attack`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId, targetId, zoneId }),
      signal: AbortSignal.timeout(3000),
    });

    if (!res.ok) {
      return NextResponse.json({ error: "Game server error" }, { status: 502 });
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: "Game server not available" }, { status: 503 });
  }
}
