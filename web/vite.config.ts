import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react(), viteSingleFile({ removeViteModuleLoader: true })],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  css: {
    modules: { localsConvention: 'camelCase' },
    preprocessorOptions: {
      scss: { additionalData: '@use "@/styles/variables.scss" as *;' },
    },
  },
  build: {
    target: 'es2020',
    assetsInlineLimit: Number.POSITIVE_INFINITY,
    cssCodeSplit: false,
    rolldownOptions: { output: { codeSplitting: false } },
  },
});
