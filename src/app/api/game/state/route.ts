/**
 * PIXEL REALM ONLINE — AI Agent State API
 * GET /api/game/state?zone=zone_start
 *
 * Returns current world state for external AI agents.
 * This is a Next.js serverless function that proxies to the game server.
 */

import { NextRequest, NextResponse } from "next/server";

const GAME_SERVER = process.env.GAME_SERVER_URL || "http://localhost:8080";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const zone = searchParams.get("zone") || "zone_start";

  try {
    const res = await fetch(`${GAME_SERVER}/state?zone=${zone}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });

    if (!res.ok) {
      return NextResponse.json({ error: "Game server error" }, { status: 502 });
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    // If no game server running, return mock state
    return NextResponse.json({
      zoneId: zone,
      tick: 0,
      entities: [],
      droppedItems: [],
      note: "Game server not running — start with: node server/server.js",
    });
  }
}
