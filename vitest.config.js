import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    env: { DB_PATH: ':memory:', NODE_ENV: 'test', IPAYMU_VA: '', IPAYMU_API_KEY: '', IPAYMU_IS_PRODUCTION: '' },
    testTimeout: 15000,
  },
});
