# @unlockable/vite-plugin-unlock

A Vite plugin that lets you override files from any npm package without forking it.

Drop a file with the same name as a module from the target package in your overrides directory. The plugin intercepts Vite's module resolution and serves your file instead of the original. At build time and dev time, with full HMR.

Beyond simple file replacement, the plugin supports a **patch system** that can transform target files using config files, enabling deeper customizations like rewriting the navigation menu of a dashboard without touching the original source.

## Status

> **v0.1.0** - Early release. The plugin is functional and used in production, but the API may evolve.

This plugin was born from a concrete need: customizing the [Medusa](https://medusajs.com) admin dashboard for B2B clients without forking it.

Medusa's admin is a full React application: pages, components, hooks, layouts. When you need to rewrite an entire page, add columns to a table, change how sorting works, or customize the sidebar menu, the only option was to fork `@medusajs/dashboard` and maintain your own copy. That means losing the connection with upstream updates.

Instead of forking, this plugin intercepts Vite's module resolution to replace specific files at build time. The result: you keep the original package as a dependency, override only what you need, and stay on the upgrade path.

**What works today (Medusa):**
- Rewrite entire pages (orders list, product detail, any route)
- Rewrite individual files: components, hooks, or any `.ts`/`.tsx` file
- Rewrite the sidebar menu from a config file

**What's coming next:**

More override capabilities are landing in the next few days. Stay tuned.

The plugin is designed to work with any Vite-based project, but Medusa is the only ecosystem where it has been thoroughly tested so far. If you try it with another framework (Strapi, or even a utility library), feedback is very welcome.

## Table of Contents

- [Using with Medusa](#using-with-medusa)
- [Generic Usage](#generic-usage)
- [How It Works](#how-it-works)
- [Options Reference](#options-reference)
- [Contributing](#contributing)
- [License](#license)

---

## Using with Medusa

The Medusa preset provides zero-config setup for overriding `@medusajs/dashboard`. It handles entry point unbundling, CSS optimization, HMR boundaries, and menu patching out of the box.

### Install

```bash
npm install @unlockable/vite-plugin-unlock --save-dev
```

### Setup

Add the plugin to your `medusa-config.ts`:

```ts
// medusa-config.ts
import { unlock } from "@unlockable/vite-plugin-unlock"
import { medusa } from "@unlockable/vite-plugin-unlock/medusa"

module.exports = defineConfig({
  // ...
  admin: {
    vite: () => ({
      plugins: [unlock(medusa())],
    }),
  },
})
```

By default, the preset looks for override files in `./src/admin/overrides`. You can change this:

```ts
unlock(medusa({
  overrides: "./src/admin/my-custom-folder",
  debug: true, // logs which files are being overridden
}))
```

### Override a Page

To rewrite an entire page, create a file in your overrides directory with the **same filename** as the original page file from `@medusajs/dashboard`.

For example, to replace the orders list page:

```
src/admin/overrides/
  order-list.tsx      <- replaces the original order-list.tsx from @medusajs/dashboard
```

Page overrides must export `{ Component }` for React Router's lazy loading:

```tsx
// src/admin/overrides/order-list.tsx
import { Container, Heading } from "@medusajs/ui"

const OrderList = () => {
  return (
    <Container>
      <Heading level="h1">Custom Orders Page</Heading>
      {/* Your custom implementation */}
    </Container>
  )
}

export { OrderList as Component }
```

### Override a Component

Same principle, match the filename:

```
src/admin/overrides/
  order-customer-section.tsx    <- replaces order-customer-section.tsx
  avatar-box.tsx                <- replaces avatar-box.tsx
```

Component overrides are regular React components. No special export convention needed (unlike pages).

In your override files, you can import from the original dashboard source using the `~dashboard` alias:

```tsx
// src/admin/overrides/order-customer-section.tsx
import { useOrder } from "~dashboard/hooks/api/orders"
import { Container, Heading, Text } from "@medusajs/ui"

export const OrderCustomerSection = ({ order }: { order: any }) => {
  return (
    <Container>
      <Heading level="h2">Customer Info</Heading>
      <Text>{order.customer?.email}</Text>
      {/* Your custom layout */}
    </Container>
  )
}
```

### Override a Hook

Same approach. If the dashboard has `use-order-table-columns.tsx`, drop a file with the same name:

```
src/admin/overrides/
  use-order-table-columns.tsx   <- replaces the original hook
```

### Organizing Overrides

Override files are scanned recursively. You can organize them in subdirectories to keep things tidy:

```
src/admin/overrides/
  pages/
    order-list.tsx
    product-detail.tsx
  components/
    order-customer-section.tsx
    avatar-box.tsx
  hooks/
    use-order-table-columns.tsx
  menu.config.ts
```

The directory structure doesn't matter for matching. The plugin matches by **filename only**, regardless of how deep the file is nested.

### Customize the Sidebar Menu

Create a `menu.config.ts` file in your overrides directory to fully rewrite the sidebar navigation:

```ts
import type { MenuConfig } from "@unlockable/vite-plugin-unlock/medusa"
import { ShoppingCart, Buildings, Tag } from "@medusajs/icons"

const config: MenuConfig = {
  items: [
    { icon: ShoppingCart, label: "Orders", to: "/orders" },
    { icon: Buildings, label: "Companies", to: "/companies" },
    { icon: Tag, label: "Products", to: "/products" },
  ],
}
export default config
```

> Patch mode (add/remove individual items) and function mode (programmatic control) are being finalized and will be available in an upcoming release.

### How Matching Works

The plugin scans all source files in `@medusajs/dashboard/src/` and builds a filename index. When you add a file to your overrides directory, it matches by **basename** (filename without path). If `order-list.tsx` exists anywhere in the dashboard source, your `order-list.tsx` override replaces it.

This means you don't need to replicate the directory structure of the original package. Just the filename.

### What the Medusa Preset Does Under the Hood

- **Entry redirect**: Remaps `@medusajs/dashboard/dist/app.mjs` to `src/app.tsx` so Vite compiles from source instead of the bundled dist
- **CSS redirect**: Points CSS imports to the pre-built `dist/app.css` to avoid Tailwind reprocessing (~2-3s saved per HMR update)
- **HMR boundaries**: Injects `import.meta.hot.accept()` in files using `defineRouteConfig` or `defineWidgetConfig` to prevent full reloads
- **Menu patching**: Transforms `main-layout.tsx` at build time to inject your `menu.config.ts`

---

## Generic Usage

The plugin works with any npm package that ships source files (or has them accessible in `node_modules`).

### Install

```bash
npm install @unlockable/vite-plugin-unlock --save-dev
```

### Setup

```ts
// vite.config.ts
import { unlock } from "@unlockable/vite-plugin-unlock"

export default defineConfig({
  plugins: [
    unlock({
      targets: ["@acme/dashboard"],
      overrides: "./src/overrides",
    }),
  ],
})
```

### Create Override Files

```
src/overrides/
  Button.tsx      <- replaces Button.tsx from @acme/dashboard
  useTheme.ts     <- replaces useTheme.ts from @acme/dashboard
```

### Import Aliases

Each target gets an auto-generated alias so your override files can import from the original source:

| Package | Alias |
|---------|-------|
| `@acme/dashboard` | `~dashboard` |
| `@acme/ui` | `~ui` |
| `my-lib` | `~my-lib` |

```tsx
// In an override file:
import { cn } from "~dashboard/lib/utils"
```

### Multi-Target

Override files from multiple packages:

```ts
unlock({
  targets: ["@acme/dashboard", "@acme/ui"],
  overrides: "./src/overrides",
})
```

Use **namespaced overrides** to avoid filename conflicts:

```
src/overrides/
  @acme/dashboard/Button.tsx    <- only overrides @acme/dashboard
  @acme/ui/Button.tsx           <- only overrides @acme/ui
  Header.tsx                    <- overrides in any target
```

### Skip Marker

Files and directories starting with `_` are ignored:

```
src/overrides/
  Button.tsx            <- active override
  _archive/Old.tsx      <- ignored
```

---

## How It Works

1. **Scan**: On startup, scans the target package's `src/` directory and indexes all source files by basename.
2. **Match**: Scans your overrides directory (recursively). Any file whose basename matches a target file becomes an active override.
3. **Resolve**: During Vite's module resolution (`resolveId` and `load` hooks), imports pointing to overridden files are redirected to your override files.
4. **HMR**: Content edits in override files trigger Vite's native HMR (React Fast Refresh). Adding or removing override files triggers a full reload.

---

## Options Reference

```ts
unlock({
  // Required: packages to unlock
  targets: [
    "@acme/dashboard",
    // or with full config:
    {
      package: "@acme/dashboard",
      alias: "~dashboard",           // import alias (auto-generated if omitted)
      srcDir: "src",                  // source subdirectory (default: "src")
      entryRedirect: {                // remap dist entry -> source entry
        from: "dist/app.mjs",
        to: "src/app.tsx",
      },
      hmr: {
        cssRedirect: {                // rewrite CSS import in entry
          from: "./index.css",
          to: "../dist/app.css",
        },
        entryBoundary: true,          // inject HMR boundary at entry
      },
    },
  ],

  // Override directory (default: "./src/overrides")
  overrides: "./src/overrides",

  // Match strategy (default: "basename")
  match: "basename",  // or "path"

  // Multi-target conflict handling (default: "error")
  onConflict: "error",  // "warn" or "first"

  // Debug logging (default: false)
  debug: false,

  // Content patterns that trigger HMR boundary injection
  hmrBoundaries: ["defineRouteConfig"],

  // Patches: modify target files using config files
  patches: [{
    target: /layout\.tsx$/,
    configFile: "layout.config",
    apply(code, configPath) {
      return `import config from "${configPath}";\n` + code
    },
  }],
})
```

---

## Contributing

Contributions are welcome. If you find a bug or have a feature request, please [open an issue](https://github.com/unlockablejs/vite-plugin-unlock/issues).

## License

MIT - [Olivier Belaud](https://olivierbelaud.dev)
