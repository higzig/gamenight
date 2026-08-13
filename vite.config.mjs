import { resolve } from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        admin: resolve(import.meta.dirname, 'index.html'),
        audience: resolve(import.meta.dirname, 'audience.html'),
        team: resolve(import.meta.dirname, 'team.html'),
      },
    },
  },
})
