import type { UnlockOptions } from "../types"
import { patchMenuLayout } from "./menu-patch"

export interface MedusaPresetOptions {
  /**
   * Directory (or directories) containing override files.
   * @default "./src/admin/overrides"
   */
  overrides?: string | string[]

  /**
   * Enable debug logging.
   * @default false
   */
  debug?: boolean
}

/**
 * Medusa dashboard preset for vite-plugin-unlock.
 *
 * Pre-configured to target `@medusajs/dashboard` with sensible defaults:
 * - Entry redirect (unbundles dashboard source)
 * - CSS redirect (avoids Tailwind reprocessing)
 * - HMR boundaries for admin extensions
 * - Menu patching via `menu.config.ts`
 *
 * @example
 * ```ts
 * import { unlock } from "@unlockable/vite-plugin-unlock"
 * import { medusa } from "@unlockable/vite-plugin-unlock/medusa"
 *
 * export default defineConfig({
 *   plugins: [unlock(medusa())],
 * })
 * ```
 */
export function medusa(options?: MedusaPresetOptions): UnlockOptions {
  const {
    overrides = "./src/admin/overrides",
    debug = false,
  } = options ?? {}

  return {
    targets: [
      {
        package: "@medusajs/dashboard",
        alias: "~dashboard",
        entryRedirect: { from: "dist/app.mjs", to: "src/app.tsx" },
        hmr: {
          cssRedirect: { from: "./index.css", to: "../dist/app.css" },
          entryBoundary: true,
        },
      },
    ],
    overrides,
    debug,
    hmrBoundaries: [
      "defineRouteConfig",
      "defineWidgetConfig",
    ],
    patches: [
      {
        target: /main-layout\.tsx$/,
        configFile: "menu.config",
        apply: patchMenuLayout,
      },
    ],
  }
}
