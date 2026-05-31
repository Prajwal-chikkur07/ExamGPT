const path = require("path");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  ...(process.env.VERCEL
    ? {}
    : {
        output: "standalone",
        outputFileTracingRoot: path.join(__dirname, "../"),
      }),
};

module.exports = nextConfig;
