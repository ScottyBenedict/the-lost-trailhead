import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/rest/v1': {
        target: 'http://rest:3000',
        rewrite: (path) => path.replace(/^\/rest\/v1/, ''),
        changeOrigin: true,
      },
    },
  },
})
