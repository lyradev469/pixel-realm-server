import { NextRequest } from "next/server";
import { publicConfig } from "@/config/public-config";
import {
  getShareImageResponse,
  parseNextRequestSearchParams,
} from "@/neynar-farcaster-sdk/nextjs";

// Cache for 1 hour - query strings create separate cache entries
export const revalidate = 3600;

const { appEnv, heroImageUrl, imageUrl } = publicConfig;

const showDevWarning = appEnv !== "production";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ type: string }> },
) {
  const { type } = await params;

  const searchParams = parseNextRequestSearchParams(request);
  const username = searchParams.username ?? null;

  return getShareImageResponse(
    { type, heroImageUrl, imageUrl, showDevWarning },
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        justifyContent: "flex-end",
        width: "100%",
        height: "100%",
        padding: 44,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
          backgroundColor: "rgba(15, 8, 32, 0.82)",
          border: "2px solid rgba(240, 180, 41, 0.5)",
          borderRadius: 16,
          padding: "28px 36px",
          boxShadow: "0 0 40px rgba(124, 58, 237, 0.35), 0 8px 32px rgba(0,0,0,0.6)",
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: 13,
            color: "rgba(196, 181, 253, 0.85)",
            letterSpacing: 4,
            textTransform: "uppercase",
            fontWeight: "bold",
          }}
        >
          Browser MMORPG
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 44,
            fontWeight: "bold",
            color: "#f0b429",
            letterSpacing: 3,
            textShadow: "0 0 24px rgba(240, 180, 41, 0.6)",
            lineHeight: 1,
          }}
        >
          PIXEL REALM ONLINE
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 18,
            color: "rgba(255, 255, 255, 0.65)",
            letterSpacing: 1,
          }}
        >
          {username ? `${username} invites you to` : ""} Enter the Realm
        </div>
      </div>
    </div>,
  );
}
