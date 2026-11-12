import type { NextConfig } from "next";

import textureLock from "./assets/textures.lock.json";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.1.3"],
  async headers() {
    return [textureLock.current, ...textureLock.retained].map(({ version }) => ({
      source: `/textures/${version}/:file*`,
      headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
    }));
  },
};

export default nextConfig;
