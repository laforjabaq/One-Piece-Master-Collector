import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  use: {
    baseURL: "http://localhost:3100",
    permissions: ["camera"],
    launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] },
  },
  webServer: { command: "npm run start -- -p 3100", url: "http://localhost:3100", reuseExistingServer: true, timeout: 120_000 },
});
