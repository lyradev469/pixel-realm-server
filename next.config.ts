import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    // SDK has a viem version conflict deep in neynar-web-sdk/nft.ts — not our code
    ignoreBuildErrors: true,
  },
  // Expose VERCEL_PROJECT_PRODUCTION_URL to client-side code
  // NOTE: Only inject NEXT_PUBLIC_GAME_WS_URL if it's explicitly set in the
  // environment. DO NOT fall back to ws://localhost:8080 here — that would bake
  // an insecure ws:// URL into the production bundle (mixed-content crash on HTTPS).
  // The fallback to wss://game-serb-production.up.railway.app lives in mini-app.tsx.
  env: {
    NEXT_PUBLIC_VERCEL_PRODUCTION_URL:
      process.env.VERCEL_PROJECT_PRODUCTION_URL,
    ...(process.env.NEXT_PUBLIC_GAME_WS_URL
      ? { NEXT_PUBLIC_GAME_WS_URL: process.env.NEXT_PUBLIC_GAME_WS_URL }
      : {}),
  },
  allowedDevOrigins: [
    "*.ngrok.app",
    "*.neynar.com",
    "*.neynar.app",
    "*.studio.neynar.com",
    "*.dev-studio.neynar.com",
    "*.nip.io",
  ],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "i.imgur.com",
      },
      {
        protocol: "https",
        hostname: "neynar-public.s3.us-east-1.amazonaws.com",
      },
      {
        protocol: "https",
        hostname: "cdn.neynar.com",
      },
    ],
  },
  devIndicators: false,
  reactCompiler: true,
};

export default nextConfig;
