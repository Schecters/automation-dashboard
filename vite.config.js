import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [
    react(),
    basicSsl(),
    tailwindcss(),
  ],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    https: true,
    watch: {
      ignored: ['**/node_modules/**', '**/.git/**'],
    },
    hmr: {
      protocol: 'wss',
    },
    proxy: {
      // ทุก API (รวม Microsoft Graph ที่เคยอยู่ Port 3000) วิ่งไปพอร์ต 5000
      '/api': {
        target: 'http://127.0.0.1:5000',
        changeOrigin: true,
        secure: false,
        xfwd: true,
      },
      '/socket.io': {
        target: 'http://127.0.0.1:5000',
        ws: true,
        changeOrigin: true,
        xfwd: true,
      },
      '/uploads': {
        target: 'http://127.0.0.1:5000',
        changeOrigin: true,
        xfwd: true,
      },
      // /publics/* ส่งไป 5000 ตรงๆ (routes/excelGraph.js รับ path /publics/... ไว้แล้ว)
      '/publics': {
        target: 'http://127.0.0.1:5000',
        changeOrigin: true,
        secure: false,
        xfwd: true,
      },
    },
  },
});