import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Excel şablonu sunucu fonksiyonlarına dahil edilsin
  outputFileTracingIncludes: {
    "/api/export": ["./templates/**"],
    "/api/assistant": ["./knowledge/**"],
    "/api/assistant/knowledge": ["./knowledge/**"],
  },
};

export default nextConfig;
