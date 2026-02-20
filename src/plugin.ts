import path from "path"
import fs from "fs"
import type { Plugin, ResolvedConfig } from "vite"
import type { UnlockOptions, ResolvedTarget } from "./types"
import type { ResolverState } from "./resolver"
import { resolveOptions } from "./config"
import { scanAllTargets, scanTarget, scanOverrides } from "./scanner"
import {
  resolveEntryRedirect,
  findImporterTarget,
} from "./resolver"
import { setupWatcher } from "./watcher"
import { createLogger, normalizePath, stripExtension } from "./utils"
import { PLUGIN_NAME } from "./constants"

/**
 * Create the vite-plugin-unlock plugin.
 *
 * Unlocks modules from target npm packages by filename convention.
 * Place a file with the same name in your overrides directory and it
 * will replace the original module — with full HMR support.
 *
 * @example
 * ```ts
 * // vite.config.ts
 * import { unlock } from '@unlockable/vite-plugin-unlock'
 *
 * export default defineConfig({
 *   plugins: [
 *     unlock({
 *       targets: ['@acme/dashboard'],
 *       overrides: './src/overrides',
 *     })
 *   ]
 * })
 * ```
 */
export function unlock(userOptions: UnlockOptions): Plugin {
  const opts = resolveOptions(userOptions)
  const logger = createLogger(opts.debug)

  if (opts.targets.length === 0) {
    logger.warn("No target packages found. Plugin will be inactive.")
    return { name: PLUGIN_NAME }
  }

  // Scan target packages for all component/hook files
  const targetFiles = scanAllTargets(opts, logger)

  // Scan override directories
  const { flat, namespaced } = scanOverrides(opts, logger)

  // Filter flat overrides to only those matching target files
  const fileOverrides = new Map<string, string>()
  for (const [key, overridePath] of flat) {
    if (targetFiles.has(key)) {
      fileOverrides.set(key, overridePath)
    } else {
      logger.warn(
        `Override "${key}" does not match any file in target packages — skipped`
      )
    }
  }

  // Detect conflicts in multi-target mode
  if (opts.targets.length > 1 && fileOverrides.size > 0) {
    detectConflicts(fileOverrides, targetFiles, opts, logger, scanTarget)
  }

  const state: ResolverState = {
    flatOverrides: fileOverrides,
    namespacedOverrides: namespaced,
    targetFiles,
  }

  // Log active overrides
  const totalFileOverrides =
    fileOverrides.size +
    [...namespaced.values()].reduce((sum, m) => sum + m.size, 0)

  if (totalFileOverrides > 0) {
    logger.info(`Active overrides: ${totalFileOverrides}`)
    if (fileOverrides.size > 0) {
      logger.info(`  File-level: ${[...fileOverrides.keys()].join(", ")}`)
    }
    for (const [ns, map] of namespaced) {
      logger.info(`  [${ns}]: ${[...map.keys()].join(", ")}`)
    }
  }

  // Log active patches
  for (const patch of opts.patches) {
    if (patch.configPath) {
      logger.info(`Patch: ${patch.configFile} -> ${patch.configPath}`)
    } else {
      logger.info(`Patch: ${patch.configFile} (no config file found)`)
    }
  }

  // Flag set in configResolved: when a React plugin is present,
  // we hand over ALL HMR responsibility (Fast Refresh handles it).
  // The plugin keeps only module resolution, overrides, and CSS redirect.
  let hasExternalReactPlugin = false

  return {
    name: PLUGIN_NAME,
    enforce: "pre",

    config(config) {
      // Allow override directories in Vite's FS access (needed for HMR)
      config.server = config.server || {}
      config.server.fs = config.server.fs || {}
      config.server.fs.allow = config.server.fs.allow || []
      for (const dir of opts.overrideDirs) {
        config.server.fs.allow.push(path.resolve(dir))
      }

      // Exclude targets from pre-bundling
      config.optimizeDeps = config.optimizeDeps || {}
      config.optimizeDeps.exclude = config.optimizeDeps.exclude || []

      for (const target of opts.targets) {
        config.optimizeDeps.exclude!.push(target.package)

        // Remove from include (include beats exclude in Vite)
        if (config.optimizeDeps.include) {
          config.optimizeDeps.include = config.optimizeDeps.include.filter(
            (dep) => dep !== target.package
          )
        }
      }

      // Set up aliases for each target
      config.resolve = config.resolve || {}
      config.resolve.alias = config.resolve.alias || {}

      for (const target of opts.targets) {
        if (Array.isArray(config.resolve.alias)) {
          config.resolve.alias.push({
            find: target.alias,
            replacement: target.srcPath,
          })
        } else {
          ;(config.resolve.alias as Record<string, string>)[target.alias] =
            target.srcPath
        }
      }

      // Add target source entries for Vite to discover CJS deps
      for (const target of opts.targets) {
        const entryFile = path.join(target.srcPath, "app.tsx")
        if (fs.existsSync(entryFile)) {
          const existing = config.optimizeDeps.entries
          if (Array.isArray(existing)) {
            existing.push(entryFile)
          } else if (typeof existing === "string") {
            config.optimizeDeps.entries = [existing, entryFile]
          } else {
            config.optimizeDeps.entries = [entryFile]
          }
        }
      }
    },

    configResolved(resolvedConfig: ResolvedConfig) {
      // Detect if a React HMR plugin is already registered.
      // When present, we skip our own HMR boundary injection and let
      // React Fast Refresh handle all HMR — avoiding the "double dose"
      // that causes "Identifier 'prevRefreshReg' has already been declared".
      hasExternalReactPlugin = resolvedConfig.plugins.some(
        (p) =>
          p.name === "vite:react-babel" ||
          p.name === "vite:react-swc" ||
          p.name === "vite:react-refresh"
      )

      if (hasExternalReactPlugin) {
        logger.info(
          "React plugin detected — handing over HMR to React Fast Refresh"
        )
      }
    },

    async resolveId(source, importer) {
      if (source.startsWith("\0") || !importer || importer.startsWith("\0"))
        return null

      const target = findImporterTarget(importer, opts)

      if (target) {
        // Importer is inside a target package

        // 1. File-level override
        const basename = stripExtension(path.basename(source))
        if (basename && basename !== "index") {
          const nsOverrides = state.namespacedOverrides.get(target.package)
          if (nsOverrides?.has(basename)) {
            const p = nsOverrides.get(basename)!
            logger.info(
              `Override [${target.package}]: ${basename} -> ${path.basename(p)}`
            )
            return p
          }
          if (state.flatOverrides.has(basename)) {
            const p = state.flatOverrides.get(basename)!
            logger.info(`Override: ${basename} -> ${path.basename(p)}`)
            return p
          }
        }

        // 2. Entry redirect — only for imports of the target package itself
        if (
          source === target.package ||
          source.startsWith(target.package + "/")
        ) {
          const resolved = await this.resolve(source, importer, {
            skipSelf: true,
          })
          if (resolved) {
            const redirect = resolveEntryRedirect(
              resolved.id,
              opts,
              logger
            )
            if (redirect) return redirect
          }
        }

        return null
      }

      // Importer is NOT in a target package — entry redirect only
      for (const target of opts.targets) {
        if (
          source !== target.package &&
          !source.startsWith(target.package + "/")
        )
          continue

        const resolved = await this.resolve(source, importer, {
          skipSelf: true,
        })
        if (resolved) {
          const redirect = resolveEntryRedirect(resolved.id, opts, logger)
          if (redirect) return redirect
        }
      }

      return null
    },

    load(id) {
      const target = findImporterTarget(id, opts)
      if (!target) return null

      const basename = stripExtension(path.basename(id))
      if (!basename || basename === "index") return null

      // 1. File-level override
      const nsOverrides = state.namespacedOverrides.get(target.package)
      const overridePath =
        nsOverrides?.get(basename) ?? state.flatOverrides.get(basename)
      if (overridePath && fs.existsSync(overridePath)) {
        this.addWatchFile(overridePath)

        const normalizedPath = normalizePath(overridePath).replace(/"/g, '\\"')
        logger.info(
          `Load override: ${basename} -> ${path.basename(overridePath)}`
        )
        return `export { default } from "${normalizedPath}"\nexport * from "${normalizedPath}"`
      }

      // 2. Patches: apply code transformation driven by a config file
      const normalizedId = normalizePath(id)
      for (const patch of opts.patches) {
        if (!patch.target.test(normalizedId)) continue
        if (!patch.configPath || !fs.existsSync(patch.configPath)) continue

        this.addWatchFile(patch.configPath)
        let original: string
        try {
          original = fs.readFileSync(id, "utf-8")
        } catch (err) {
          logger.error(`Failed to read file for patching: ${id}`)
          return null
        }
        const patched = patch.apply(original, patch.configPath)
        logger.info(
          `Patch applied: ${path.basename(id)} via ${patch.configFile}`
        )
        return { code: patched, map: null }
      }

      return null
    },

    transform(code, id) {
      // Target-level transforms: CSS redirect (always) + entry boundary (only without React plugin)
      for (const target of opts.targets) {
        if (!target.hmr || !target.entryFilePath) continue

        const normId = normalizePath(id)
        const normEntry = normalizePath(target.entryFilePath)
        if (normId !== normEntry) continue

        let modified = false

        // CSS redirect is always needed — it avoids Tailwind reprocessing,
        // independent of HMR strategy.
        if (target.hmr.cssRedirect) {
          const { from, to } = target.hmr.cssRedirect
          const importPattern = `import "${from}"`
          if (code.includes(importPattern)) {
            code = code.replace(importPattern, `import "${to}"`)
            logger.info(`CSS rewritten: ${from} -> ${to}`)
            modified = true
          }
        }

        // Entry boundary: ALWAYS inject. The entry file lives in node_modules,
        // which @vitejs/plugin-react excludes by default — so React Fast Refresh
        // never touches it. Without our boundary, HMR changes propagate to the
        // root and cause unnecessary full-page reloads.
        if (target.hmr.entryBoundary) {
          code += "\nif (import.meta.hot) { import.meta.hot.accept() }"
          logger.info(
            `HMR boundary injected: ${target.package} entry`
          )
          modified = true
        }

        if (modified) return { code, map: null }
      }

      // Content-based HMR boundaries: only inject when NO React plugin handles HMR.
      // React Fast Refresh already self-accepts React component modules.
      if (!hasExternalReactPlugin && opts.hmrBoundaries.length > 0) {
        const normId = normalizePath(id)
        if (!normId.includes("/node_modules/")) {
          const needsBoundary = opts.hmrBoundaries.some((p) =>
            code.includes(p)
          )
          if (needsBoundary) {
            logger.info(
              `HMR boundary injected: ${path.basename(id)}`
            )
            return {
              code:
                code +
                "\nif (import.meta.hot) { import.meta.hot.accept() }",
              map: null,
            }
          }
        }
      }

      return null
    },

    configureServer(server) {
      const fsConfig = server.config.server?.fs
      if (fsConfig && Array.isArray(fsConfig.allow)) {
        for (const dir of opts.overrideDirs) {
          const resolved = path.resolve(dir)
          if (!fsConfig.allow.includes(resolved)) {
            fsConfig.allow.push(resolved)
          }
        }
      }

      setupWatcher(server, state, opts, logger)
    },
  }
}

/**
 * Detect conflicting overrides across multiple targets.
 * For each flat override key, check how many targets actually contain a file with that basename.
 */
function detectConflicts(
  flat: Map<string, string>,
  _targetFiles: Map<string, { target: ResolvedTarget; filePath: string }>,
  opts: ReturnType<typeof resolveOptions>,
  logger: ReturnType<typeof createLogger>,
  scan: typeof scanTarget
): void {
  // Build per-target file maps to check which targets contain each key
  const perTargetMaps = opts.targets.map((t) => ({
    target: t,
    files: scan(t, opts),
  }))

  for (const [key] of flat) {
    const matchingTargets = perTargetMaps.filter(({ files }) => files.has(key))

    if (matchingTargets.length > 1) {
      const names = matchingTargets.map(({ target }) => target.package).join(", ")
      if (opts.onConflict === "error") {
        throw new Error(
          `[${PLUGIN_NAME}] Override "${key}" matches files in multiple targets: ${names}. ` +
            `Use namespaced overrides (overrides/@scope/pkg/${key}.tsx) or set onConflict: "warn".`
        )
      } else if (opts.onConflict === "warn") {
        logger.warn(
          `Override "${key}" matches files in multiple targets: ${names}. Using first match.`
        )
      }
    }
  }
}
