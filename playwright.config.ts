import { defineConfig, devices } from '@playwright/test'
import { existsSync } from 'node:fs'

const preinstalled = process.env.PLAYWRIGHT_BROWSERS_PATH ? `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium` : undefined
const executablePath = process.env.CHROMIUM_PATH || (preinstalled && existsSync(preinstalled) ? preinstalled : undefined)

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: executablePath ? { executablePath } : {},
  },
  projects: [
    {
      name: 'iphone',
      use: { ...devices['iPhone 14'], defaultBrowserType: 'chromium', browserName: 'chromium', launchOptions: executablePath ? { executablePath } : {} },
    },
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], launchOptions: executablePath ? { executablePath } : {} },
    },
  ],
  webServer: {
    command: 'npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
