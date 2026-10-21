import { defineConfig } from 'vite';

// https://vite.dev/config/
export default defineConfig({
  server: {
    proxy: {
      '/api/local-llm': {
        target: 'http://localhost:1235',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/local-llm/, '')
      }
    }
  }
});
