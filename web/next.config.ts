import type { NextConfig } from "next";

// Production default so Vercel builds work even when NEXT_PUBLIC_API_URL is not
// injected (claimable/preview deploys strip .env*). Local `next dev` still uses
// web/.env.local → http://localhost:8000 via src/lib/api.ts.
if (
  !process.env.NEXT_PUBLIC_API_URL &&
  (process.env.VERCEL || process.env.NODE_ENV === "production")
) {
  process.env.NEXT_PUBLIC_API_URL =
    "https://heatcast-api-production.up.railway.app";
}

const nextConfig: NextConfig = {};

export default nextConfig;
