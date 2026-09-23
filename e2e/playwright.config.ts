import { defineConfig, devices } from '@playwright/test'
import path from 'node:path'

const repositoryRoot = path.resolve(__dirname, '..')
process.env.EVIDENCE_VERSION = process.env.EVIDENCE_VERSION || 'v0.2.0'
const browserChannel =
  process.env.PLAYWRIGHT_BROWSER_CHANNEL ||
  (process.platform === 'win32' ? 'msedge' : undefined)

export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  reporter: [
    ['list'],
    ['./reporters/deliveryguard-reporter.ts'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],
  use: {
    baseURL: 'http://127.0.0.1:3130',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(browserChannel ? { channel: browserChannel } : {}),
      },
    },
  ],
  webServer: [
    {
      command: 'npm run start',
      cwd: path.join(repositoryRoot, 'agent'),
      url: 'http://127.0.0.1:3140/health',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        AGENT_ALLOW_MOCK: '1',
        DEEPSEEK_API_KEY: '',
        PORT: '3140',
      },
    },
    {
      command: 'npm run serve -- --host 127.0.0.1 --port 3130',
      cwd: path.join(repositoryRoot, 'v-form'),
      url: 'http://127.0.0.1:3130/index.html',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        VITE_AGENT_PROXY_TARGET: 'http://127.0.0.1:3140',
      },
    },
  ],
})
