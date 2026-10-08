import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { webBuildHash } from '../../scripts/release-layout.mjs';

export default defineConfig(async ({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    base: './',
    build: { target: 'es2020' },
    plugins: [react()],
    define: { 'process.env.NEXT_PUBLIC_API_URL': JSON.stringify(env.NEXT_PUBLIC_API_URL || ''), '__JISHI_WEB_BUILD__': JSON.stringify(await webBuildHash()) },
    server: { proxy: { '/api': { target: env.API_UPSTREAM || 'http://127.0.0.1:8787', changeOrigin: false } } },
  };
});
