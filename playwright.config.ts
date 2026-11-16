import { defineConfig } from '@playwright/test';
import path from 'node:path';

const dataDir = path.resolve('.local-data', 'browser-tests');
export default defineConfig({
  testDir: './tests', testMatch: 'browser.spec.ts', fullyParallel: false, workers: 1,
  use: { baseURL: 'http://127.0.0.1:4319', headless: true, screenshot: 'only-on-failure' },
  webServer: { command: 'node dist/server.js', url: 'http://127.0.0.1:4319', reuseExistingServer: false, env: { PORT: '4319', APP_ORIGIN: 'http://127.0.0.1:4319', APP_DATA_DIR: dataDir }, timeout: 30000 },
});
