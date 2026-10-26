import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Dev: `npm run dev` proxies /api to a running fleet web server
// (FLEET_WEB_URL, default http://127.0.0.1:7777).
const target = process.env.FLEET_WEB_URL || 'http://127.0.0.1:7777'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  server: {
    proxy: { '/api': { target, changeOrigin: true } },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rolldownOptions: {
      output: {
        // React in a chunk of its own: an app-only change keeps its name, so after a deploy it
        // still comes from the cache (hashed assets are immutable, web/lib/app.mjs). Screens and
        // on-demand dialogs are split with dynamic imports (src/lib/lazy.ts).
        codeSplitting: {
          groups: [{ name: 'react', test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/ }],
        },
      },
    },
  },
})
