import { defineConfig } from 'vite'

export default defineConfig({
    server: {
        port: 5173,
        host: 'localhost'
    },
    base: './',
    build: {
        outDir: 'dist',
        assetsDir: 'assets'
    },
    esbuild: {
        jsx: 'automatic'
    }
})