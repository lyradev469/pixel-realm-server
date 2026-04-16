/**
 * PIXEL REALM ONLINE — AI Agent Move API
 * POST /api/game/move
 * Body: { agentId, direction, zoneId }
 *
 * Allows external AI agents to move entities via HTTP.
 */

import { NextRequest, NextResponse } from "next/server";

const GAME_SERVER = process.env.GAME_SERVER_URL || "http://localhost:8080";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { agentId, direction, zoneId } = body;

    if (!agentId || !direction) {
      return NextResponse.json({ error: "agentId and direction required" }, { status: 400 });
    }

    const validDirections = ["up", "down", "left", "right"];
    if (!validDirections.includes(direction)) {
      return NextResponse.json({ error: "direction must be: up|down|left|right" }, { status: 400 });
    }

    const res = await fetch(`${GAME_SERVER}/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId, direction, zoneId }),
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
