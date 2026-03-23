import { defineConfig, devices } from '@playwright/test';
import 'dotenv/config';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['allure-playwright', { outputFolder: 'allure-results' }],
    ['list'],
  ],
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    extraHTTPHeaders: {
      'x-test-suite': 'digital-journey-tests',
      'x-test-run-id': process.env.GITHUB_RUN_ID ?? 'local',
    },
  },
  projects: [
    {
      name: 'journeys',
      testDir: './tests/journeys',
      timeout: 30_000,
      retries: 1,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'strategy',
      testDir: './tests/strategy',
      timeout: 30_000,
      retries: 1,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'chaos',
      testDir: './tests/chaos',
      timeout: 60_000,
      retries: 0,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'observability',
      testDir: './tests/observability',
      timeout: 45_000,
      retries: 1,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'ai-agent',
      testDir: './tests/ai-agent',
      use: {
        baseURL: 'http://localhost:8000',
        headless: false,
      },
    },
  ],
  webServer: {
    command: 'npx ts-node server.ts',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 120_000,
  },
});
