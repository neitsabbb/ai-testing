import { defineConfig, devices } from "@playwright/test";
import dotenv from "dotenv";
import { resolve } from "node:path";

// Charge .env (OLLAMA_*, BASE_URL, ...) depuis le dossier de ce fichier, pas
// depuis le cwd — sinon lancer la suite depuis ~/Vertuoza ne trouve pas le .env
// et LLMClient retombe sur son modèle par défaut (→ 404 Ollama "model not found").
dotenv.config({ path: resolve(__dirname, ".env") });

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  reporter: "html",
  use: {
    baseURL: process.env.BASE_URL,
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
