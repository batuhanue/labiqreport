import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Excel şablonu sunucu fonksiyonlarına dahil edilsin
  outputFileTracingIncludes: {
    "/api/export": ["./templates/**"],
  },
};

export default nextConfig;
