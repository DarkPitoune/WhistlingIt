/**
 * Let node resolve the extensionless imports the app is written with.
 *
 * `src/` is bundler-resolved — Vite and tsconfig's "bundler" mode both turn
 * `../api/day` into `../api/day.ts` — and node does not, so a check script that
 * imports anything from `src/` dies on the first such specifier. This adds the
 * extension back for relative paths that have no extension of their own.
 *
 * Only the check scripts load this. Nothing in the bundle sees it.
 *
 *   node --import ./scripts/ts-resolve.mjs scripts/whatever.mjs
 */

import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) {
      for (const ext of [".ts", ".tsx"]) {
        const url = new URL(specifier + ext, context.parentURL);
        if (existsSync(fileURLToPath(url))) return next(specifier + ext, context);
      }
    }
    return next(specifier, context);
  },
});
