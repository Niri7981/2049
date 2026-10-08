import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  output: "standalone",
  // The signed application bundle is immutable; this local management service
  // has no disk-backed ISR or image optimization workload.
  experimental: { isrFlushToDisk: false },
  images: { unoptimized: true },
  // Dynamic private-data paths are resolved at runtime. They must not cause
  // file tracing to copy the development checkout into a distributable app.
  outputFileTracingExcludes: {
    "/*": ["./build.noindex/**", "./apps/**", "./docs/**", "./tests/**", "./src/**", "./scripts/**", "./*.md", "./tsconfig.tsbuildinfo"],
  },
};

export default nextConfig;
