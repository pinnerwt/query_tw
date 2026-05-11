import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiTarget = env.API_TARGET || 'http://localhost:8080';
  return {
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: '脆找工作',
        short_name: '脆找工作',
        description: '從 Threads 抓取的台灣徵才資訊',
        lang: 'zh-TW',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        runtimeCaching: [
          {
            urlPattern: /\/api\/jobs/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-jobs',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 30, maxAgeSeconds: 60 },
            },
          },
          {
            urlPattern: /\/api\/(skills|roles|cities)/,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'api-dicts' },
          },
        ],
      },
    }),
  ],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true, secure: true },
      '/healthz': { target: apiTarget, changeOrigin: true, secure: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  };
});
