/**
 * PIXEL REALM ONLINE — Zone List API
 * GET /api/game/zones
 *
 * Returns list of active zones and their player counts.
 */

import { NextRequest, NextResponse } from "next/server";

const GAME_SERVER = process.env.GAME_SERVER_URL || "http://localhost:8080";

export async function GET(_request: NextRequest) {
  try {
    const res = await fetch(`${GAME_SERVER}/zones`, {
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });

    if (!res.ok) {
      return NextResponse.json({ error: "Game server error" }, { status: 502 });
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({
      zones: [{ id: "zone_start", playerCount: 0, entityCount: 0 }],
      note: "Game server not running",
    });
  }
}
