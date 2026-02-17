import { defineConfig } from "tsup"

export default defineConfig({
  entry: {
    index: "src/index.ts",
    medusa: "src/medusa.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "node18",
  external: ["vite"],
})
