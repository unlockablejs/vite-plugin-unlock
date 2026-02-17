import path from "path"
import fs from "fs"
import type {
  OverrideMap,
  NamespacedOverrideMap,
  ResolvedOptions,
  ResolvedTarget,
} from "./types"
import { MAX_SCAN_DEPTH } from "./constants"
import { normalizePath, stripExtension, type Logger } from "./utils"

/**
 * Recursively collect files with matching extensions from a directory.
 */
export function collectFiles(
  dir: string,
  extensionSet: Set<string>,
  depth = 0
): string[] {
  if (depth > MAX_SCAN_DEPTH) return []
  const results: string[] = []
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return results
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue
    const fullPath = path.resolve(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...collectFiles(fullPath, extensionSet, depth + 1))
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name)
      if (extensionSet.has(ext)) {
        results.push(fullPath)
      }
    }
  }
  return results
}

/**
 * Extract the override key from a file path based on match strategy.
 *
 * For "basename" strategy: returns the filename without extension.
 * For "path" strategy: returns the relative path from the override dir without extension.
 */
export function getOverrideKey(
  filePath: string,
  baseDir: string,
  match: "basename" | "path"
): string | null {
  const normalized = normalizePath(filePath)
  const parts = normalized.split("/").filter(Boolean)
  if (parts.length === 0) return null

  const fileName = parts[parts.length - 1]
  const baseName = stripExtension(fileName)
  if (!baseName) return null

  if (match === "path") {
    const normalizedBase = normalizePath(baseDir)
    const relative = normalizePath(
      path.relative(normalizedBase, normalized)
    )
    return stripExtension(relative)
  }

  // basename strategy
  if (baseName === "index") {
    return parts.length >= 2 ? parts[parts.length - 2] || null : null
  }
  return baseName
}

/**
 * Scan a target package and build a map of component name -> file path.
 */
export function scanTarget(
  target: ResolvedTarget,
  opts: ResolvedOptions
): OverrideMap {
  const map: OverrideMap = new Map()
  for (const f of collectFiles(target.srcPath, opts.extensionSet)) {
    const key = getOverrideKey(f, target.srcPath, opts.match)
    if (key) map.set(key, f)
  }
  return map
}

/**
 * Scan all target packages and build a combined map of all component files.
 */
export function scanAllTargets(
  opts: ResolvedOptions,
  logger: Logger
): Map<string, { target: ResolvedTarget; filePath: string }> {
  const combined = new Map<
    string,
    { target: ResolvedTarget; filePath: string }
  >()

  for (const target of opts.targets) {
    const targetMap = scanTarget(target, opts)
    logger.info(
      `Scanned ${targetMap.size} files in ${target.package} (${target.srcPath})`
    )
    for (const [key, filePath] of targetMap) {
      combined.set(key, { target, filePath })
    }
  }

  return combined
}

/**
 * Detect if a directory path represents a namespaced override
 * (e.g. overrides/@acme/ui/ -> package "@acme/ui").
 */
function detectNamespace(
  filePath: string,
  overrideDir: string
): string | null {
  const relative = normalizePath(path.relative(overrideDir, filePath))
  const scopedMatch = relative.match(/^(@[^/]+\/[^/]+)\//)
  if (scopedMatch) return scopedMatch[1]
  return null
}

/**
 * Scan override directories and build override maps.
 *
 * Returns both a flat override map (for single-target or basename matching)
 * and a namespaced map (for multi-target with namespace directories).
 */
export function scanOverrides(
  opts: ResolvedOptions,
  logger: Logger
): { flat: OverrideMap; namespaced: NamespacedOverrideMap } {
  const flat: OverrideMap = new Map()
  const namespaced: NamespacedOverrideMap = new Map()

  const targetPackages = new Set(opts.targets.map((t) => t.package))

  for (const dir of opts.overrideDirs) {
    if (!fs.existsSync(dir)) continue
    for (const fullPath of collectFiles(dir, opts.extensionSet).sort()) {
      // Skip files in directories starting with _
      const relative = normalizePath(path.relative(dir, fullPath))
      if (relative.split("/").some((part) => part.startsWith("_"))) continue

      const ns = detectNamespace(fullPath, dir)

      if (ns && targetPackages.has(ns)) {
        const nsDir = path.join(dir, ns)
        const key = getOverrideKey(fullPath, nsDir, opts.match)
        if (key && key !== "index") {
          if (!namespaced.has(ns)) namespaced.set(ns, new Map())
          namespaced.get(ns)!.set(key, fullPath)
          logger.info(`Override [${ns}]: ${key} -> ${fullPath}`)
        }
      } else {
        const key = getOverrideKey(fullPath, dir, opts.match)
        if (key && key !== "index") {
          flat.set(key, fullPath)
          logger.info(`Override: ${key} -> ${fullPath}`)
        }
      }
    }
  }

  return { flat, namespaced }
}
