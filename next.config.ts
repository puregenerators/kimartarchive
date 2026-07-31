import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Sharp must run as a native Node module, not bundled into the edge/client graph.
  serverExternalPackages: ["sharp"],
};

export default nextConfig;
