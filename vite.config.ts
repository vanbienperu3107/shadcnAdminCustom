/// <reference types="vitest/config" />
import path from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import { playwright } from '@vitest/browser-playwright'
import { configDefaults } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  // Prod (Docker) đặt VITE_BASE=/app/ để serve dưới vpn2.hangocthanh.io.vn/app.
  // Dev để '/'.
  base: process.env.VITE_BASE || '/',
  plugins: [
    tanstackRouter({
      target: 'react',
      autoCodeSplitting: true,
    }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Tách vendor nặng thành chunk riêng, ổn định giữa các lần deploy để
        // trình duyệt cache lâu dài (đổi feature không làm mất cache thư viện).
        // recharts chỉ nạp khi vào trang có biểu đồ (dashboard/analytics).
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('/recharts/') || id.includes('/d3-')) return 'charts'
          if (id.includes('/@tanstack/')) return 'tanstack'
          if (
            id.includes('/react/') ||
            id.includes('/react-dom/') ||
            id.includes('/scheduler/')
          )
            return 'react'
        },
      },
    },
  },
  server: {
    // Dev: chuyển tiếp API + derpmap sang backend Fastify (server/) chạy ở :8787
    proxy: {
      '/api': { target: 'http://localhost:8787', changeOrigin: true },
      '/derpmap.json': { target: 'http://localhost:8787', changeOrigin: true },
    },
  },
  test: {
    silent: 'passed-only',
    unstubEnvs: true,
    // Giữ default include nhưng LOẠI server/** khỏi vitest root. Server deps
    // (Fastify) nằm ở server/node_modules, root không resolve được -> vitest
    // fail dep-scan + reload test giữa chừng khiến cả suite flaky/đỏ. Backend
    // có job CI riêng ("DERP backend") chạy trong server/.
    exclude: [...configDefaults.exclude, 'server/**'],
    browser: {
      enabled: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }],
    },
    coverage: {
      // include: ['src/**/*.{js,jsx,ts,tsx}'], // Uncomment to expand the report to all src/**/* so untested modules appear as 0% coverage.
      exclude: [
        'src/components/ui/**',
        'src/assets/**',
        'src/tanstack-table.d.ts',
        'src/routeTree.gen.ts',
        'src/test-utils/**',
        'src/routes/**',
      ],
    },
  },
})
