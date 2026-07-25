import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Needed for the standalone Docker image
  output: "standalone",

  // Strict React mode catches side-effect bugs early
  reactStrictMode: true,

  // Allow images from GitHub avatars and Cloudinary
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "avatars.githubusercontent.com" },
      { protocol: "https", hostname: "res.cloudinary.com" },
    ],
  },

  // Proxy /api/* to the FastAPI backend during local dev
  async rewrites() {
    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
    return [
      {
        source: "/api/:path*",
        destination: `${apiBase}/api/:path*`,
      },
    ];
  },

  // Security headers
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options",          value: "DENY" },
          { key: "X-Content-Type-Options",   value: "nosniff" },
          { key: "Referrer-Policy",          value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy",       value: "camera=(), microphone=(), geolocation=()" },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-eval' 'unsafe-inline'",  // unsafe-eval needed by Three.js
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https://avatars.githubusercontent.com https://res.cloudinary.com",
              "media-src 'self' https://res.cloudinary.com",
              "connect-src 'self' " + (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"),
              "worker-src blob:",
              "frame-ancestors 'none'",
            ].join("; "),
          },
        ],
      },
    ];
  },

  // Webpack tweaks: alias to ensure single React instance with react-force-graph-3d
  webpack(config) {
    config.resolve.alias = {
      ...config.resolve.alias,
    };
    // Treat canvas as external (not available in Node, used by Three.js tests)
    config.externals = [
      ...(config.externals ?? []),
      ({ request }: { request: string }, callback: Function) => {
        if (request === "canvas") return callback(null, "commonjs canvas");
        callback();
      },
    ];
    return config;
  },
};

export default nextConfig;
