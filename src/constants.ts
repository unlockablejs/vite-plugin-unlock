/** Default file extensions to scan for overridable modules. */
export const DEFAULT_EXTENSIONS = [
  ".tsx",
  ".ts",
  ".jsx",
  ".js",
  ".vue",
  ".svelte",
  ".mts",
  ".mjs",
]

/** Default directory for override files. */
export const DEFAULT_OVERRIDE_DIR = "./src/overrides"

/** Default subdirectory within a package that contains source files. */
export const DEFAULT_SRC_DIR = "src"

/** Maximum recursion depth when scanning directories. */
export const MAX_SCAN_DEPTH = 20

/** Plugin name used in Vite. */
export const PLUGIN_NAME = "vite-plugin-unlock"
