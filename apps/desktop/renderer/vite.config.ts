import { defineConfig } from 'vite'

// 增加 /files 静态资源代理到后台 7001，解决开发期缩略图加载 404 (请求错发到 5173)
export default defineConfig({
    server: {
        port: 5173,
        host: 'localhost',
        proxy: {
            // 前端代码中使用相对路径 /files/xxx.png 时，通过 dev server 代理到后端
            '/files': {
                target: 'http://localhost:7001',
                changeOrigin: true,
                // 不需要重写路径，直接透传
            },
            // 若后续还有 api 前缀，也可在此继续添加
        }
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