import type { NextConfig } from "next";

const isGitHubPages = process.env.GITHUB_PAGES === "true";

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  basePath: isGitHubPages ? "/first-megasaver-ptg" : undefined,
  images: { unoptimized: true },
  poweredByHeader: false,
};

export default nextConfig;
