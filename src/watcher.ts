import path from "path"
import type { ViteDevServer } from "vite"
import type { ResolvedOptions, ResolvedPatch } from "./types"
import { scanOverrides } from "./scanner"
import { findConfigFile } from "./config"
import type { ResolverState } from "./resolver"
import { normalizePath, stripExtension, type Logger } from "./utils"

/**
 * Set up HMR watchers for override directories.
 *
 * Only reacts to structural changes (file add/delete).
 * Content edits to override files are handled by Vite's native HMR
 * (React Fast Refresh) — the plugin does NOT intercept them.
 */
export function setupWatcher(
  server: ViteDevServer,
  state: ResolverState,
  opts: ResolvedOptions,
  logger: Logger
): void {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  const handleStructuralChange = (filePath: string) => {
    const ext = path.extname(filePath)
    if (!opts.extensionSet.has(ext)) return

    const normFile = normalizePath(filePath)
    const isOverrideFile = opts.overrideDirs.some((dir) =>
      normFile.startsWith(normalizePath(dir) + "/")
    )
    if (!isOverrideFile) return

    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      const oldFlat = new Map(state.flatOverrides)
      const oldNamespaced = new Map(
        [...state.namespacedOverrides].map(
          ([k, v]) => [k, new Map(v)] as const
        )
      )

      const { flat, namespaced } = scanOverrides(opts, logger)

      // Filter flat overrides to only those matching target files
      const fileOverrides = new Map<string, string>()
      for (const [key, overridePath] of flat) {
        if (state.targetFiles.has(key)) {
          fileOverrides.set(key, overridePath)
        }
      }

      // Atomic swap: update both maps in a single synchronous block
      // so that async resolveId calls always see a consistent pair.
      Object.assign(state, {
        flatOverrides: fileOverrides,
        namespacedOverrides: namespaced,
      })

      let hasChanges = false

      // Diff file-level overrides
      const allKeys = new Set([...oldFlat.keys(), ...fileOverrides.keys()])

      for (const key of allKeys) {
        const wasOverride = oldFlat.has(key)
        const isOverride = fileOverrides.has(key)
        if (
          wasOverride === isOverride &&
          oldFlat.get(key) === fileOverrides.get(key)
        )
          continue

        const action = isOverride
          ? wasOverride
            ? "changed"
            : "created"
          : "deleted"
        logger.info(`Override "${key}" ${action}`)

        invalidateForKey(key, isOverride, oldFlat, state, server, logger)
        hasChanges = true
      }

      // Diff namespaced overrides
      const allNs = new Set([
        ...oldNamespaced.keys(),
        ...namespaced.keys(),
      ])
      for (const ns of allNs) {
        const oldMap = oldNamespaced.get(ns) ?? new Map()
        const newMap = namespaced.get(ns) ?? new Map()
        const nsKeys = new Set([...oldMap.keys(), ...newMap.keys()])

        for (const key of nsKeys) {
          const was = oldMap.has(key)
          const is = newMap.has(key)
          if (was === is && oldMap.get(key) === newMap.get(key)) continue

          const action = is ? (was ? "changed" : "created") : "deleted"
          logger.info(`Override [${ns}] "${key}" ${action}`)

          invalidateForKey(key, is, oldMap, state, server, logger)
          hasChanges = true
        }
      }

      // Single full-reload for all structural changes.
      // Structural changes alter module resolution — Vite's HMR cannot
      // handle this because invalidated modules reuse cached resolved ids.
      if (hasChanges) {
        logger.info("Structural change detected -> full reload")
        const ws = server.hot ?? server.ws
        ws.send({ type: "full-reload" })
      }
    }, 50) // Short debounce — batch rapid add/delete
  }

  // Structural changes (add/delete)
  server.watcher.on("add", handleStructuralChange)
  server.watcher.on("unlink", handleStructuralChange)

  // Content edits to override files.
  // When Vite tracks the override file (resolveId path), its native HMR
  // handles content edits via React Fast Refresh. But when the load hook
  // served override content at the original URL, Vite doesn't associate
  // the override file with any module — edits go undetected.
  server.watcher.on("change", (filePath) => {
    const ext = path.extname(filePath)
    if (!opts.extensionSet.has(ext)) return

    const normFile = normalizePath(filePath)
    const isOverrideFile = opts.overrideDirs.some((dir) =>
      normFile.startsWith(normalizePath(dir) + "/")
    )
    if (!isOverrideFile) return

    const basename = stripExtension(path.basename(filePath))
    if (!basename) return
    const isTrackedOverride =
      state.flatOverrides.has(basename) ||
      [...state.namespacedOverrides.values()].some((m) => m.has(basename))
    if (!isTrackedOverride) return

    // If Vite already tracks this file, let native HMR handle it
    const trackedMods = server.moduleGraph.getModulesByFile(normFile)
    if (trackedMods && trackedMods.size > 0) return

    // Load hook case: invalidate the original module and reload
    const targetInfo = state.targetFiles.get(basename)
    if (!targetInfo) return

    const origMods = server.moduleGraph.getModulesByFile(
      normalizePath(targetInfo.filePath)
    )
    if (origMods) {
      for (const mod of origMods) {
        server.moduleGraph.invalidateModule(mod)
      }
      logger.info(`Override content changed: ${basename} -> reload`)
      const ws = (server as any).hot ?? (server as any).ws
      ws.send({ type: "full-reload" })
    }
  })

  // Watch for patch config file creation / deletion / content edit
  if (opts.patches.length > 0) {
    const handlePatchConfigStructural = (filePath: string) => {
      const basename = stripExtension(path.basename(filePath))
      if (!basename) return

      const normFile = normalizePath(filePath)
      const isOverrideFile = opts.overrideDirs.some((dir) =>
        normFile.startsWith(normalizePath(dir) + "/")
      )
      if (!isOverrideFile) return

      for (const patch of opts.patches) {
        if (basename !== patch.configFile) continue

        const newPath = findConfigFile(patch.configFile, opts.overrideDirs)
        if (newPath === patch.configPath) continue

        patch.configPath = newPath
        logger.info(
          `Patch config ${newPath ? "detected" : "removed"}: ${patch.configFile}`
        )

        invalidatePatchTarget(patch, server, logger)
        const ws = (server as any).hot ?? (server as any).ws
        ws.send({ type: "full-reload" })
      }
    }

    const handlePatchConfigContentEdit = (filePath: string) => {
      const normFile = normalizePath(filePath)
      for (const patch of opts.patches) {
        if (!patch.configPath) continue
        if (normalizePath(patch.configPath) !== normFile) continue

        logger.info(`Patch config content changed: ${patch.configFile}`)
        invalidatePatchTarget(patch, server, logger)
        const ws = (server as any).hot ?? (server as any).ws
        ws.send({ type: "full-reload" })
        return
      }
    }

    server.watcher.on("add", handlePatchConfigStructural)
    server.watcher.on("unlink", handlePatchConfigStructural)
    server.watcher.on("change", handlePatchConfigContentEdit)
  }

  // Ensure override directories are watched
  for (const dir of opts.overrideDirs) {
    server.watcher.add(dir)
  }
}

/**
 * Invalidate modules matching a patch target pattern,
 * plus all ancestor modules (BFS) so that import URLs
 * are updated and the browser re-fetches fresh content.
 */
function invalidatePatchTarget(
  patch: ResolvedPatch,
  server: ViteDevServer,
  logger: Logger
): void {
  const { moduleGraph } = server
  const roots = new Set<any>()
  const timestamp = Date.now()

  for (const mod of moduleGraph.idToModuleMap.values()) {
    if (mod.file && patch.target.test(normalizePath(mod.file))) {
      moduleGraph.invalidateModule(mod, new Set(), timestamp, true)
      roots.add(mod)
      logger.info(`Invalidated patch target: ${path.basename(mod.file)}`)
    }
  }

  // BFS invalidate all ancestors so import URLs are cache-busted
  const seen = new Set<any>()
  const queue: any[] = []
  for (const mod of roots) {
    for (const parent of mod.importers) {
      queue.push(parent)
    }
  }
  while (queue.length > 0) {
    const mod = queue.shift()!
    if (seen.has(mod)) continue
    seen.add(mod)
    moduleGraph.invalidateModule(mod, seen, timestamp, true)
    for (const parent of mod.importers) {
      queue.push(parent)
    }
  }

  if (roots.size > 0 && seen.size > 0) {
    logger.info(`Invalidated ${seen.size} ancestor modules`)
  }
}

/**
 * Invalidate modules in the graph for a given override key change.
 */
function invalidateForKey(
  key: string,
  isNowOverride: boolean,
  oldOverrides: Map<string, string>,
  state: ResolverState,
  server: ViteDevServer,
  logger: Logger
): void {
  const { moduleGraph } = server

  const roots = new Set<any>()

  // Original target file's module
  const targetInfo = state.targetFiles.get(key)
  if (targetInfo) {
    const mods = moduleGraph.getModulesByFile(
      normalizePath(targetInfo.filePath)
    )
    if (mods) for (const mod of mods) roots.add(mod)
  }

  // Override file's module (old for DELETE, new for CREATE)
  const overridePath = isNowOverride
    ? state.flatOverrides.get(key)
    : oldOverrides.get(key)
  if (overridePath) {
    const mods = moduleGraph.getModulesByFile(normalizePath(overridePath))
    if (mods) for (const mod of mods) roots.add(mod)
  }

  if (roots.size > 0) {
    for (const mod of roots) {
      moduleGraph.invalidateModule(mod)
    }

    // BFS invalidate all ancestors
    const seen = new Set<any>()
    const queue: any[] = []
    for (const mod of roots) {
      for (const parent of mod.importers) {
        queue.push(parent)
      }
    }
    while (queue.length > 0) {
      const mod = queue.shift()!
      if (seen.has(mod)) continue
      seen.add(mod)
      moduleGraph.invalidateModule(mod)
      for (const parent of mod.importers) {
        queue.push(parent)
      }
    }

    logger.info(`Invalidated "${key}" + ${seen.size} ancestor modules`)
  } else {
    logger.info(`Override map updated for "${key}" (module not in graph yet)`)
  }
}
