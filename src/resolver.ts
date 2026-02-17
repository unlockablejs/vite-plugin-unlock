import path from "path"
import type {
  OverrideMap,
  NamespacedOverrideMap,
  ResolvedOptions,
  ResolvedTarget,
} from "./types"
import { normalizePath, type Logger } from "./utils"
import fs from "fs"

export interface ResolverState {
  /** component/hook name -> override file path (flat, applies to all targets) */
  flatOverrides: OverrideMap
  /** package name -> (component name -> override file path) */
  namespacedOverrides: NamespacedOverrideMap
  /** component name -> { target, filePath } for all target packages */
  targetFiles: Map<string, { target: ResolvedTarget; filePath: string }>
}

/**
 * Check if an importer belongs to a target package.
 */
export function findImporterTarget(
  importer: string,
  opts: ResolvedOptions
): ResolvedTarget | null {
  const norm = normalizePath(importer)
  for (const target of opts.targets) {
    const normSrc = normalizePath(target.srcPath)
    if (norm.startsWith(normSrc + "/") || norm === normSrc) {
      return target
    }
    // Also check parent package dir (for files outside srcDir)
    const pkgDir = normalizePath(path.dirname(target.srcPath))
    if (norm.startsWith(pkgDir + "/")) {
      return target
    }
  }
  return null
}

/**
 * Handle entry redirect: remap dist entry to source entry.
 * e.g. dist/app.mjs -> src/app.tsx
 */
export function resolveEntryRedirect(
  resolvedId: string,
  opts: ResolvedOptions,
  logger: Logger
): string | null {
  const norm = normalizePath(resolvedId).replace(/\?.*$/, "")

  for (const target of opts.targets) {
    if (target.entryRedirect) {
      const fromPattern = normalizePath(target.entryRedirect.from)
      if (norm.endsWith(`/${fromPattern}`) || norm.includes(`/${fromPattern}`)) {
        const pkgDir = path.dirname(target.srcPath)
        const srcEntry = path.join(pkgDir, target.entryRedirect.to)
        if (fs.existsSync(srcEntry)) {
          logger.info(
            `Entry redirect: ${path.basename(resolvedId)} -> ${target.entryRedirect.to}`
          )
          return srcEntry
        }
      }
    }

    // Default entry redirect: dist/app.{mjs,js} -> src/app.tsx
    if (!target.entryRedirect) {
      const parts = target.package.split("/")
      const lastPart = parts[parts.length - 1]
      if (norm.includes(`/${lastPart}/dist/app.`)) {
        const srcEntry = norm.replace(
          /\/dist\/app\.(mjs|js)$/,
          "/src/app.tsx"
        )
        if (fs.existsSync(srcEntry)) {
          logger.info(`Entry redirect (auto): dist/app -> src/app.tsx`)
          return srcEntry
        }
      }
    }
  }

  return null
}
