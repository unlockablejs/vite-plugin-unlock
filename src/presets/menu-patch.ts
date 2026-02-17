/**
 * Pure patch function for the Medusa dashboard sidebar menu.
 *
 * Transforms main-layout.tsx to inject a menu config import and
 * wrap useCoreRoutes() with __applyMenuConfig().
 *
 * Used as a `patches[].apply` function by vite-plugin-unlock.
 */
export function patchMenuLayout(code: string, configPath: string): string {
  const coreMarker = "const coreRoutes = useCoreRoutes()"
  const extMarker =
    'const menuItems = getMenu("coreExtensions").filter((item) => !item.nested)'

  if (!code.includes(coreMarker)) {
    return code
  }

  const safePath = configPath.replace(/\\/g, "/").replace(/"/g, '\\"')
  const importLine = `import __menuConfig from "${safePath}";\nimport * as __React from "react";\nimport __i18n from "i18next";\n`

  let patched = code.replace(
    coreMarker,
    "const coreRoutes = __applyMenuConfig(useCoreRoutes(), __menuConfig)"
  )

  if (patched.includes(extMarker)) {
    patched = patched.replace(
      extMarker,
      'const menuItems = getMenu("coreExtensions").filter((item) => !item.nested).filter(function(item) { return !__getPromotedPaths(__menuConfig).includes(item.to) })'
    )
  }

  const helperFn = `
function __toNavItems(list) {
  return list.map(function(item) {
    var icon = typeof item.icon === "function" || (item.icon && item.icon.render) ? __React.createElement(item.icon) : item.icon;
    var label = __i18n.t(item.label);
    var kids = item.items;
    var translatedKids = kids && kids.length > 0 ? kids.map(function(k) { return { label: __i18n.t(k.label), to: k.to }; }) : undefined;
    return { icon: icon, label: label, to: item.to, items: translatedKids };
  });
}

function __applyMenuConfig(routes, config) {
  if (!config) return routes;
  if (typeof config === "function") return __toNavItems(config(routes));
  if (config.items) return __toNavItems(config.items);
  let result = [...routes];
  if (config.remove) {
    result = result.filter(function(r) { return !config.remove.includes(r.to) });
  }
  if (config.add) {
    result = result.concat(__toNavItems(config.add));
  }
  if (config.order) {
    var ordered = [];
    var rest = [].concat(result);
    for (var k = 0; k < config.order.length; k++) {
      var p = config.order[k];
      var i = rest.findIndex(function(r) { return r.to === p });
      if (i !== -1) ordered.push(rest.splice(i, 1)[0]);
    }
    result = ordered.concat(rest);
  }
  return result;
}

function __getPromotedPaths(config) {
  if (!config || typeof config === "function") return [];
  var paths = [];
  if (config.items) {
    config.items.forEach(function(item) { paths.push(item.to) });
  }
  if (config.add) {
    config.add.forEach(function(item) { paths.push(item.to) });
  }
  return paths;
}
`

  return importLine + patched + helperFn
}
