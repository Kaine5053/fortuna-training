import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // SSR app (auth needs it). Do NOT set output: 'export'.
  // Supabase Storage signed URLs are fetched server-side; no remote image config needed.
};

export default nextConfig;
