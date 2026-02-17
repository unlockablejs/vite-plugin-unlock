/**
 * A menu item configuration.
 * Matches the shape of @medusajs/dashboard's internal nav items.
 */
export interface NavItemConfig {
  /** Icon — pass a component directly (e.g. ShoppingCart from @medusajs/icons) or a React element */
  icon?: unknown
  /** Display label */
  label: string
  /** Route path (e.g. "/orders") */
  to: string
  /** Nested sub-items */
  items?: Array<{ label: string; to: string }>
}

/**
 * Declarative menu configuration.
 *
 * - `items` -> full replace (ignores remove/add/order)
 * - `remove` + `add` + `order` -> patch mode (applied in that order)
 */
export interface MenuConfig {
  /** Full replace: provide all menu items */
  items?: NavItemConfig[]
  /** Remove items by path */
  remove?: string[]
  /** Add new items */
  add?: NavItemConfig[]
  /** Reorder: array of paths. Unlisted items appear at the end in original order. */
  order?: string[]
}

/**
 * Function-based menu configuration.
 * Receives the default core routes and returns the modified list.
 */
export type MenuConfigFn = (routes: NavItemConfig[]) => NavItemConfig[]
