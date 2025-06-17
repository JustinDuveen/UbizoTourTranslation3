/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false, // Disabled for WebRTC testing
  // Development optimizations
  experimental: {
    optimizeCss: false,
    optimizePackageImports: ['@radix-ui/react-icons', 'lucide-react'],
  },
  // Webpack optimizations for development
  webpack: (config, { dev, isServer }) => {
    if (dev) {
      // Optimize development builds
      config.optimization = {
        ...config.optimization,
        removeAvailableModules: false,
        removeEmptyChunks: false,
        splitChunks: false,
      };

      // Reduce file watching overhead for WebRTC stability
      config.watchOptions = {
        poll: false,
        aggregateTimeout: 2000, // Increased delay for less frequent rebuilds
        ignored: ['**/node_modules', '**/.git', '**/.next'],
      };
      
      // Reduce hot reload frequency
      if (config.devServer) {
        config.devServer.watchOptions = {
          aggregateTimeout: 2000,
          poll: false,
        };
      }
    }
    return config;
  },
  env: {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    REDIS_HOST: process.env.REDIS_HOST,
    REDIS_PORT: process.env.REDIS_PORT,
    REDIS_PASSWORD: process.env.REDIS_PASSWORD,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    JWT_SECRET: process.env.JWT_SECRET,
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
    // Xirsys Configuration (server-side only for security)
    XIRSYS_CHANNEL: process.env.XIRSYS_CHANNEL,
    XIRSYS_USERNAME: process.env.XIRSYS_USERNAME,
    XIRSYS_API_KEY: process.env.XIRSYS_API_KEY,
    XIRSYS_ENDPOINT: process.env.XIRSYS_ENDPOINT,
    XIRSYS_CACHE_DURATION: process.env.XIRSYS_CACHE_DURATION,
    XIRSYS_API_TIMEOUT: process.env.XIRSYS_API_TIMEOUT,
    // Client-side endpoint only (no credentials exposed)
    NEXT_PUBLIC_XIRSYS_ENDPOINT: process.env.XIRSYS_ENDPOINT,
  },
}

module.exports = nextConfig

