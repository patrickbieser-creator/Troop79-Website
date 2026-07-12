import type { NextConfig } from "next";

// Only registered when set, so local dev with no Bunny account configured
// yet doesn't break — same "only wire up cloud storage if the env var is
// present" pattern the original spec used for S3.
const bunnyHostname = process.env.BUNNY_PULL_ZONE_HOSTNAME;

const nextConfig: NextConfig = {
  images: {
    remotePatterns: bunnyHostname
      ? [{ protocol: 'https', hostname: bunnyHostname }]
      : []
  },
  async redirects() {
    return [
      // The public plan page was superseded by /meetings (the curated
      // agenda); launch-week bookmarks land on the new page. Plan detail
      // remains available in the admin workspace. Not permanent, in case
      // the page ever comes back.
      { source: '/meeting-plan', destination: '/meetings', permanent: false }
    ];
  },
  experimental: {
    serverActions: {
      // Default is too small for photo uploads through the media picker.
      bodySizeLimit: '15mb'
    }
  }
};

export default nextConfig;
