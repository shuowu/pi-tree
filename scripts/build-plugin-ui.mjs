#!/usr/bin/env node
/**
 * Build plugin UI bundles for runtime loading.
 * Each plugin with piTree.ui in its package.json gets bundled to an IIFE.
 * Shared dependencies (React, lucide-react, @pi-tree/ui) are externalized
 * via a global shim — the host app exposes them on window.__piTreeDeps.
 */
import { build } from 'esbuild';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const packagesDir = join(__dirname, '..', 'packages');

// Shared deps → window globals mapping
// Plugins must NOT bundle these — the host app provides them
const SHARED_DEPS = {
  'react': '__piTreeDeps.react',
  'react/jsx-runtime': '__piTreeDeps["react/jsx-runtime"]',
  'react/jsx-dev-runtime': '__piTreeDeps["react/jsx-dev-runtime"]',
  'react-dom': '__piTreeDeps["react-dom"]',
  'lucide-react': '__piTreeDeps["lucide-react"]',
  '@pi-tree/ui': '__piTreeDeps["@pi-tree/ui"]',
};

/**
 * esbuild plugin that replaces bare module imports with window global lookups.
 * This lets plugin bundles share React etc. with the host app instead of
 * bundling their own copies (which would cause duplicate React errors).
 */
const globalExternalsPlugin = {
  name: 'global-externals',
  setup(build) {
    const moduleNames = Object.keys(SHARED_DEPS);
    const filter = new RegExp(`^(${moduleNames.map(n => n.replace('/', '\\/')).join('|')})$`);

    build.onResolve({ filter }, args => ({
      path: args.path,
      namespace: 'global-external',
    }));

    build.onLoad({ filter: /.*/, namespace: 'global-external' }, args => ({
      contents: `module.exports = ${SHARED_DEPS[args.path]};`,
      loader: 'js',
    }));
  },
};

async function main() {
  const pluginDirs = readdirSync(packagesDir).filter(n => n.startsWith('plugin-'));
  let built = 0;

  for (const name of pluginDirs) {
    const pluginDir = join(packagesDir, name);
    const pkgPath = join(pluginDir, 'package.json');
    if (!existsSync(pkgPath)) continue;

    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    if (!pkg.piTree?.ui) continue;

    // Find the UI entry point — look for ui/plugin.tsx or ui/plugin.ts
    const entryTsx = join(pluginDir, 'ui', 'plugin.tsx');
    const entryTs = join(pluginDir, 'ui', 'plugin.ts');
    const entry = existsSync(entryTsx) ? entryTsx : existsSync(entryTs) ? entryTs : null;
    if (!entry) {
      console.warn(`[build-plugin-ui] Plugin "${name}" has piTree.ui but no ui/plugin.ts(x) — skipping`);
      continue;
    }

    const outfile = join(pluginDir, 'ui', 'dist', 'plugin.js');
    console.log(`[build-plugin-ui] Building ${name}/ui/plugin → ${name}/ui/dist/plugin.js`);

    await build({
      entryPoints: [entry],
      bundle: true,
      format: 'iife',
      globalName: `__piTreePlugins["${name}"]`,
      outfile,
      plugins: [globalExternalsPlugin],
      jsx: 'automatic',
      minify: false, // Keep readable for POC
      sourcemap: true,
      logLevel: 'warning',
      // CSS is bundled inline via esbuild's CSS support
      loader: { '.css': 'css' },
    });

    built++;
  }

  console.log(`[build-plugin-ui] Built ${built} plugin UI bundle(s)`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
