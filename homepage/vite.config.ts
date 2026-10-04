import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Relative assets work at both /fitting-html/homepage/ and the site root.
  base: "./",
});
