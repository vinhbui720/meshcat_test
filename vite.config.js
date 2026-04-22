import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

const useTLS = process.env.NOTLS !== '1';

export default defineConfig({
  plugins: [
    useTLS ? basicSsl() : null
  ].filter(Boolean),
  server: {
    host: '0.0.0.0', // Allow access from local network (Quest 3)
    port: 5173,
    https: useTLS, // WebXR requires a secure context
    proxy: {
      '/ws': {
        target: 'ws://localhost:7000',
        ws: true,
      }
    }
  },
  resolve: {
    alias: {
      // Meshcat expects some three.js examples to be available
      'three/examples/jsm': 'three/examples/jsm'
    }
  },
  optimizeDeps: {
    include: ['dat.gui', 'ccapture.js', '@msgpack/msgpack']
  }
});
