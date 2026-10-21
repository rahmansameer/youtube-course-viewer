import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    // The sign-in page used to live at /login; keep old links working
    // (the query string, e.g. ?next=, carries over).
    return [{ source: "/login", destination: "/signin", permanent: true }];
  },
  async headers() {
    return [
      {
        // Repeat visits show the tab icon from cache without a request.
        source: "/favicon.ico",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=604800, stale-while-revalidate=2592000",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
