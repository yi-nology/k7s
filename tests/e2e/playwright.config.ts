import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E 测试配置
 * 
 * 支持两种模式：
 * 1. Vite 模式（默认）：测试 Web 版本，使用 Mock 数据
 * 2. WebDriver 模式：测试 Tauri 桌面版本，需要真实 K8s 集群
 */

const E2E_MODE = process.env.E2E_MODE || 'vite';
const CI = !!process.env.CI;

export default defineConfig({
  testDir: './specs',
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 2 : 0,
  workers: CI ? 1 : undefined,
  reporter: [
    ['html', { outputFolder: 'test-results/html-report' }],
    ['json', { outputFile: 'test-results/test-results.json' }],
    ['list'],
  ],
  
  use: {
    // 根据模式设置 baseURL
    baseURL: E2E_MODE === 'webdriver' 
      ? `http://localhost:9515`  // WebDriver 端口
      : `http://localhost:1420`, // Vite 开发服务器端口
    
    // 测试配置
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    
    // 超时配置
    actionTimeout: 10000,
    navigationTimeout: 15000,
    
    // 忽略 HTTPS 错误（用于本地开发）
    ignoreHTTPSErrors: true,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Vite 模式下启动开发服务器
  webServer: E2E_MODE === 'vite' ? {
    command: 'pnpm dev:web',
    url: 'http://localhost:1420',
    reuseExistingServer: !CI,
    timeout: 120000,
    cwd: '../../', // 项目根目录
  } : undefined,
  
  // 测试结果输出目录
  outputDir: 'test-results',
  
  // 只测试 E2E 测试文件，忽略 Vitest 测试文件
  testMatch: '**/*.e2e.spec.ts',
  
  // 忽略 Vitest 测试文件和源代码中的测试文件
  testIgnore: [
    '**/node_modules/**',
    '**/src/**/*.test.ts',
    '**/src/**/*.test.tsx',
    '**/src/**/*.spec.ts',
    '**/src/**/*.spec.tsx',
  ],
  
  // 根目录设置为 tests/e2e 目录
  rootDir: '.',
});
