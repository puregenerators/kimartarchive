import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Sharp must run as a native Node module, not bundled into the edge/client graph.
  serverExternalPackages: [
    "sharp",
    "@img/sharp-linux-x64",
    "@img/sharp-libvips-linux-x64",
  ],
};

export default nextConfig;
