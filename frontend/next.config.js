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
  webpack: (config, { isServer, dev, webpack }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        os: false,
        // Builtins de Node que libs client-side (pptxgenjs, mammoth, xlsx)
        // referencian para su ruta de Node pero nunca ejecutan en el browser.
        https: false,
        http: false,
        zlib: false,
        stream: false,
        url: false,
        crypto: false,
        util: false,
      };

      // pptxgenjs (y otras) importan builtins con prefijo `node:` (ej.
      // `node:fs`, `node:https`). Webpack 5 no resuelve el scheme `node:` por sí
      // solo y lanza UnhandledSchemeError. Lo reescribimos a bare para que tome
      // el fallback de arriba (false → módulo vacío en el bundle del browser).
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(/^node:/, (resource) => {
          resource.request = resource.request.replace(/^node:/, '');
        }),
      );
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
