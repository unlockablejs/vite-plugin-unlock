import { PLUGIN_NAME } from "./constants"

const PREFIX = `[${PLUGIN_NAME}]`

/**
 * Logger that only outputs when debug is enabled.
 */
export function createLogger(debug: boolean) {
  return {
    info(msg: string) {
      if (debug) console.log(`${PREFIX} ${msg}`)
    },
    warn(msg: string) {
      console.warn(`${PREFIX} ${msg}`)
    },
    error(msg: string) {
      console.error(`${PREFIX} ${msg}`)
    },
  }
}

export type Logger = ReturnType<typeof createLogger>

/**
 * Normalize a file path to forward slashes.
 */
export function normalizePath(p: string): string {
  return p.replace(/\\/g, "/")
}

/**
 * Strip extension from a filename.
 */
export function stripExtension(filename: string): string {
  return filename.replace(/\.(tsx?|jsx?|mts|mjs|vue|svelte)$/, "")
}

/**
 * Generate an alias from a package name.
 * "@acme/dashboard" -> "~dashboard"
 * "@acme/ui" -> "~ui"
 * "my-lib" -> "~my-lib"
 */
export function generateAlias(packageName: string): string {
  const parts = packageName.split("/")
  const lastPart = parts[parts.length - 1]
  return `~${lastPart}`
}
