# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2025-02-17

### Added

- Core plugin: file-level overrides by basename convention
- Namespaced overrides for multi-target support (`overrides/@scope/pkg/`)
- Patch system: transform target files via config files
- HMR support: native React Fast Refresh for content edits, full reload for structural changes
- Content-based HMR boundary injection (`hmrBoundaries` option)
- Medusa preset (`@unlockable/vite-plugin-unlock/medusa`):
  - Zero-config for `@medusajs/dashboard`
  - Entry redirect (unbundles dashboard source)
  - CSS redirect (avoids Tailwind reprocessing)
  - Menu patching via `menu.config.ts`
- Multi-target mode with conflict detection (`onConflict` option)
- Import aliases auto-generated per target (`~dashboard`, `~ui`, etc.)
- Skip marker: files/dirs starting with `_` are ignored
- Debug logging (`debug: true`)
