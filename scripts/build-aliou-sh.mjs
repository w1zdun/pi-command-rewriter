#!/usr/bin/env node
/**
 * Builds @aliou/sh after npm install.
 *
 * When npm installs `github:aliou/sh`, it clones the repo source but the
 * `dist/` directory is not committed. The package's own `prepare` script
 * would build it, but it also runs `husky install` which fails in non-git
 * environments. We use `ignore-scripts=true` in .npmrc to avoid that, then
 * build @aliou/sh ourselves here.
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

// Check both the normal location and npm's .ignored location
const normalPath = resolve(root, "node_modules/@aliou/sh");
const ignoredPath = resolve(root, "node_modules/.ignored/@aliou/sh");

let pkgDir = null;
if (existsSync(resolve(normalPath, "package.json"))) {
  pkgDir = normalPath;
} else if (existsSync(resolve(ignoredPath, "package.json"))) {
  pkgDir = ignoredPath;
}

if (!pkgDir) {
  console.error("build-aliou-sh: could not find @aliou/sh package directory");
  process.exit(1);
}

const distDir = resolve(pkgDir, "dist");
if (existsSync(resolve(distDir, "index.js"))) {
  console.log("build-aliou-sh: dist/ already exists, skipping build");
  process.exit(0);
}

const srcDir = resolve(pkgDir, "src");
if (!existsSync(srcDir)) {
  console.error("build-aliou-sh: no src/ directory found in @aliou/sh — cannot build");
  process.exit(1);
}

console.log(`build-aliou-sh: building @aliou/sh in ${pkgDir}...`);

try {
  // Install devDependencies needed for the build (rolldown, typescript)
  execSync("npm install --ignore-scripts", {
    cwd: pkgDir,
    stdio: "inherit",
  });

  // Run the build scripts
  execSync("npx --yes rolldown -c", {
    cwd: pkgDir,
    stdio: "inherit",
  });
  execSync("npx tsc -p tsconfig.build.json", {
    cwd: pkgDir,
    stdio: "inherit",
  });

  console.log("build-aliou-sh: build complete");
} catch (err) {
  console.error("build-aliou-sh: build failed:", err.message);
  process.exit(1);
}
