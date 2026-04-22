import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

const useTLS = process.env.NOTLS !== '1';

export default defineConfig({
  plugins: [
    useTLS ? basicSsl() : null
  ].filter(Boolean),
  server: {
    host: '0.0.0.0',   // reachable from Quest 3 over ADB tunnel
    port: 5173,
    https: useTLS,      // WebXR requires a secure context (HTTPS)

    // Proxy: browser sends wss://localhost:5173/ws  (secure, same origin)
    //        Vite forwards to  ws://localhost:7000   (plain, server→Drake)
    // This solves the mixed-content block when serving over HTTPS.
    proxy: {
      '/ws': {
        target: 'ws://localhost:7000',
        ws: true,
        changeOrigin: true,
        rewriteWsOrigin: true,
      }
    }
  },
  resolve: {
    alias: {
      'three/examples/jsm': 'three/examples/jsm'
    }
  },
  optimizeDeps: {
    include: ['dat.gui', 'ccapture.js', '@msgpack/msgpack']
  }
});
