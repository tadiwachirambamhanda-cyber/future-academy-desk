import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // The handbook is read at request time, so it must be shipped with the webhook function.
  outputFileTracingIncludes: { "/api/whatsapp": ["./data/school-handbook.md"] },
};

export default nextConfig;
