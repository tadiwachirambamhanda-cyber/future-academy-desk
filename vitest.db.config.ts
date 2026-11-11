import { defineConfig } from "vitest/config";
import path from "node:path";

// Database tests: run only with SUPABASE_URL and SUPABASE_SECRET_KEY set (see .env.local).
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: { environment: "node", include: ["**/*.db.test.ts"], exclude: ["node_modules/**"] },
});
