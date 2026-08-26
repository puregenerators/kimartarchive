import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Sharp must run as a native Node module, not bundled into the edge/client graph.
  serverExternalPackages: [
    "sharp",
    "@img/sharp-linux-x64",
    "@img/sharp-libvips-linux-x64",
  ],
  // Next 16.2 + sharp 0.35 does not trace libvips into the Vercel function.
  // Without this, production intake fails with ERR_DLOPEN_FAILED.
  outputFileTracingIncludes: {
    "/*": [
      "./node_modules/@img/sharp-linux-x64/**/*",
      "./node_modules/@img/sharp-libvips-linux-x64/**/*",
    ],
  },
};

export default nextConfig;
