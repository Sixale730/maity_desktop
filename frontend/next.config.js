/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false, // Disabled for BlockNote compatibility
  output: 'export',
  images: {
    unoptimized: true,
  },
  // Add basePath configuration
  basePath: '',
  assetPrefix: '/',

  // Add webpack configuration for Tauri
  webpack: (config, { isServer, dev }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        os: false,
      };
    }

    // Increase chunk loading timeout in development to prevent ChunkLoadError
    // when Tauri webview opens before Next.js finishes compiling
    if (dev && !isServer) {
      config.output = {
        ...config.output,
        chunkLoadTimeout: 60000, // 60 seconds (default is ~120s but can timeout earlier)
      };
    }

    return config;
  },
}

module.exports = nextConfig
