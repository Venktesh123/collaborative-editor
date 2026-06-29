import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  eslint: {
    // Skip ESLint during builds — run separately
    ignoreDuringBuilds: true,
  },
  typescript: {
    // Fail build on type errors
    ignoreBuildErrors: false,
  },
};

export default nextConfig;