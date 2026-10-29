/** @type {import('next').NextConfig} */

const { version } = require("./package.json");

const remotePatterns = [
    {
        protocol: "https",
        hostname: "**",
    },
];

const nextConfig = {
    output: "standalone",
    env: {
        version,
    },
    reactStrictMode: false,
    typescript: {},
    images: {
        remotePatterns,
        // Opt-in for local development with a local media server: Next
        // refuses to optimize images served over http from a local IP.
        unoptimized: process.env.COURSELIT_IMAGES_UNOPTIMIZED === "true",
    },
    transpilePackages: [
        "@courselit/page-blocks",
        "@courselit/components-library",
    ],
    serverExternalPackages: [
        "pug",
        "liquidjs",
        "mongoose",
        "mongodb",
        "jsonwebtoken",
    ],
    experimental: {},
};

module.exports = nextConfig;
