/**
 * HMR configuration for an unbundled target.
 *
 * When a package is excluded from pre-bundling (optimizeDeps.exclude),
 * Vite loses the pre-bundled HMR boundary and processes raw source.
 * These options restore fast HMR behaviour.
 */
export interface TargetHmrConfig {
  /**
   * Rewrite a CSS import in the entry file.
   * Useful when the source CSS contains `@tailwind` directives that would
   * cause Vite to re-run PostCSS on every HMR update.
   *
   * @example { from: './index.css', to: '../dist/app.css' }
   */
  cssRedirect?: { from: string; to: string }

  /**
   * Inject `import.meta.hot.accept()` in the entry file.
   * Prevents HMR propagation to the root when the entry re-exports
   * mixed values (components + config objects).
   */
  entryBoundary?: boolean
}

/**
 * Full unlock target configuration.
 */
export interface UnlockTarget {
  /** npm package name to unlock (e.g. "@acme/dashboard") */
  package: string
  /** Import alias for the package source (e.g. "~dashboard") -- auto-generated if omitted */
  alias?: string
  /** Subdirectory within the package that contains source files (default: "src") */
  srcDir?: string
  /**
   * Entry redirect: remap dist entry to source entry.
   * e.g. { from: "dist/app.mjs", to: "src/app.tsx" }
   */
  entryRedirect?: { from: string; to: string }
  /** HMR optimizations for the unbundled target */
  hmr?: TargetHmrConfig
}

/**
 * Shorthand: a string is expanded to `{ package: theString }`.
 */
export type UnlockTargetInput = string | UnlockTarget

/**
 * Match strategy for resolving overrides.
 * - "basename": match by filename only (default)
 * - "path": match by relative path
 */
export type MatchStrategy = "basename" | "path"

/**
 * Conflict resolution strategy when multiple targets have the same filename.
 * - "error": throw an error (default)
 * - "warn": log a warning and use first match
 * - "first": silently use first match
 */
export type ConflictStrategy = "error" | "warn" | "first"

/**
 * Patch configuration: modify a target file using a config file.
 */
export interface PatchConfig {
  /** Pattern to match target file paths */
  target: RegExp
  /** Config file basename to search in override dirs (without extension) */
  configFile: string
  /** Transform function: receives original code + absolute config path, returns patched code */
  apply(code: string, configPath: string): string
}

/**
 * Internal resolved patch (with discovered config path).
 */
export interface ResolvedPatch {
  target: RegExp
  configFile: string
  apply(code: string, configPath: string): string
  /** Absolute path to the discovered config file, or null if not found */
  configPath: string | null
}

/**
 * Plugin options.
 */
export interface UnlockOptions {
  /** Packages to unlock */
  targets: UnlockTargetInput[]
  /** Directory containing override files (default: "./src/overrides") */
  overrides?: string | string[]
  /** Match strategy (default: "basename") */
  match?: MatchStrategy
  /** Conflict handling when basename collides across targets (default: "error") */
  onConflict?: ConflictStrategy
  /** Enable debug logging (default: false) */
  debug?: boolean
  /** File extensions to consider (default: standard web extensions) */
  extensions?: string[]
  /** Patches: modify target files using config files from override dirs */
  patches?: PatchConfig[]
  /**
   * Content patterns that trigger HMR boundary injection.
   * If a file's code contains any of these strings, `import.meta.hot.accept()`
   * is appended. Useful for mixed-export modules (component + config) that
   * React Fast Refresh can't self-accept.
   *
   * @example ["defineRouteConfig", "defineWidgetConfig"]
   */
  hmrBoundaries?: string[]
}

/**
 * Internal normalized target.
 */
export interface ResolvedTarget {
  package: string
  alias: string
  srcDir: string
  srcPath: string
  entryRedirect?: { from: string; to: string }
  hmr?: TargetHmrConfig
  /** Pre-computed absolute path to the entry file (when entryRedirect is set) */
  entryFilePath?: string
}

/**
 * Internal normalized options.
 */
export interface ResolvedOptions {
  targets: ResolvedTarget[]
  overrideDirs: string[]
  match: MatchStrategy
  onConflict: ConflictStrategy
  debug: boolean
  extensions: string[]
  extensionSet: Set<string>
  patches: ResolvedPatch[]
  hmrBoundaries: string[]
}

/**
 * An override mapping: component name -> absolute file path.
 */
export type OverrideMap = Map<string, string>

/**
 * Namespaced override map: package name -> OverrideMap.
 */
export type NamespacedOverrideMap = Map<string, OverrideMap>
