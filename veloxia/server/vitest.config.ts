import { defineConfig } from "vitest/config";

export const TEST_ENV = {
  NODE_ENV: "test",
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://veloxia:veloxia@localhost:5432/veloxia_test",
  APP_URL: "https://app.test.local",
  APP_SECRET: "test-secret-test-secret-test-secret-123",
  INSTAGRAM_APP_ID: "test-app-id",
  INSTAGRAM_APP_SECRET: "test-app-secret",
  META_WEBHOOK_VERIFY_TOKEN: "test-verify-token",
  RUN_WORKER: "false",
  SERVE_WEB: "false",
  LOG_LEVEL: "silent",
};

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    globalSetup: ["test/global-setup.ts"],
    env: TEST_ENV,
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
