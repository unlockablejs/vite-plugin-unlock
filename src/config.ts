import path from "path"
import fs from "fs"
import { createRequire } from "module"
import type {
  UnlockOptions,
  UnlockTargetInput,
  ResolvedOptions,
  ResolvedPatch,
  ResolvedTarget,
} from "./types"
import {
  DEFAULT_EXTENSIONS,
  DEFAULT_OVERRIDE_DIR,
  DEFAULT_SRC_DIR,
} from "./constants"
import { generateAlias } from "./utils"

/**
 * Find the source directory of an npm package.
 * Looks in node_modules and .yalc for the package, then checks for srcDir within it.
 */
function findPackageSrcPath(
  packageName: string,
  srcDir: string
): string | null {
  const cwd = process.cwd()

  // Try require.resolve to find the package.
  // Use fs.realpathSync to resolve symlinks — critical for pnpm where
  // packages are symlinked from .pnpm/. Vite resolves all paths to their
  // real locations (preserveSymlinks defaults to false), so our paths must
  // match for findImporterTarget comparisons to work.
  try {
    const req = createRequire(path.join(cwd, "package.json"))
    const pkgJsonPath = fs.realpathSync(
      req.resolve(`${packageName}/package.json`)
    )
    const pkgRoot = path.dirname(pkgJsonPath)
    const srcPath = path.join(pkgRoot, srcDir)
    if (fs.existsSync(srcPath)) return srcPath
    return pkgRoot
  } catch {
    // Fallback: manual lookup
  }

  // Manual lookup in common locations
  const parts = packageName.startsWith("@")
    ? packageName.split("/")
    : [packageName]
  const candidates = [
    path.join(cwd, "node_modules", ...parts, srcDir),
    path.join(cwd, ".yalc", ...parts, srcDir),
  ]

  for (const dir of candidates) {
    if (fs.existsSync(dir)) return fs.realpathSync(dir)
  }

  const rootCandidates = [
    path.join(cwd, "node_modules", ...parts),
    path.join(cwd, ".yalc", ...parts),
  ]

  for (const dir of rootCandidates) {
    if (fs.existsSync(dir)) return fs.realpathSync(dir)
  }

  return null
}

/**
 * Normalize a single target input into a ResolvedTarget.
 */
function resolveTarget(input: UnlockTargetInput): ResolvedTarget | null {
  const target: ResolvedTarget =
    typeof input === "string"
      ? {
          package: input,
          alias: generateAlias(input),
          srcDir: DEFAULT_SRC_DIR,
          srcPath: "",
        }
      : {
          package: input.package,
          alias: input.alias ?? generateAlias(input.package),
          srcDir: input.srcDir ?? DEFAULT_SRC_DIR,
          srcPath: "",
          entryRedirect: input.entryRedirect,
          hmr: input.hmr,
        }

  const srcPath = findPackageSrcPath(target.package, target.srcDir)
  if (!srcPath) return null

  target.srcPath = srcPath

  // Pre-compute entry file path for HMR transforms
  if (target.entryRedirect && target.hmr) {
    const pkgDir = path.dirname(srcPath)
    const entryFile = path.resolve(pkgDir, target.entryRedirect.to)
    if (fs.existsSync(entryFile)) {
      target.entryFilePath = entryFile
    }
  }

  return target
}

const CONFIG_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js"]

/**
 * Find a config file by basename in the override directories.
 * Searches for `basename.{tsx,ts,jsx,js}` in each dir.
 */
export function findConfigFile(
  basename: string,
  overrideDirs: string[]
): string | null {
  for (const dir of overrideDirs) {
    for (const ext of CONFIG_EXTENSIONS) {
      const p = path.resolve(dir, `${basename}${ext}`)
      if (fs.existsSync(p)) return p
    }
  }
  return null
}

/**
 * Resolve and normalize all plugin options.
 */
export function resolveOptions(options: UnlockOptions): ResolvedOptions {
  const extensions = options.extensions ?? DEFAULT_EXTENSIONS

  const overrideInput = options.overrides ?? DEFAULT_OVERRIDE_DIR
  const overrideDirs = (
    Array.isArray(overrideInput) ? overrideInput : [overrideInput]
  ).map((dir) => path.resolve(process.cwd(), dir))

  const targets: ResolvedTarget[] = []
  for (const input of options.targets) {
    const resolved = resolveTarget(input)
    if (resolved) {
      targets.push(resolved)
    }
  }

  const patches: ResolvedPatch[] = (options.patches ?? []).map((p) => ({
    target: p.target,
    configFile: p.configFile,
    apply: p.apply,
    configPath: findConfigFile(p.configFile, overrideDirs),
  }))

  return {
    targets,
    overrideDirs,
    match: options.match ?? "basename",
    onConflict: options.onConflict ?? "error",
    debug: options.debug ?? false,
    extensions,
    extensionSet: new Set(extensions),
    patches,
    hmrBoundaries: options.hmrBoundaries ?? [],
  }
}
