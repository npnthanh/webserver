import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const rootDir = process.cwd();

function fixPermissions(dir) {
  try {
    fs.chmodSync(dir, 0o755);
  } catch {}
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      fixPermissions(fullPath);
    } else {
      try {
        fs.chmodSync(fullPath, 0o644);
      } catch {}
    }
  }
}

function fixParentDomainDirs(dir) {
  // Ensure parent domain directories (e.g. domains/webserver.kivon.tech and public_html) have 0755
  const parent1 = path.resolve(dir, '..');
  const parent2 = path.resolve(dir, '..', '..');
  const publicHtml = path.join(parent2, 'public_html');
  for (const p of [parent2, parent1, dir, publicHtml]) {
    try {
      if (fs.existsSync(p)) {
        fs.chmodSync(p, 0o755);
      }
    } catch {}
  }
}

fixParentDomainDirs(rootDir);
fixPermissions(rootDir);

const globalsCssPath = path.join(rootDir, 'app', 'globals.css');
const compiledCssPath = path.join(rootDir, 'app', 'globals.compiled.css');
const postcssConfigPath = path.join(rootDir, 'postcss.config.mjs');
const postcssBackupPath = path.join(rootDir, 'postcss.config.mjs.bak');

let canUseNativeTailwind = false;
if (process.env.FORCE_PRECOMPILED_CSS !== '1') {
  try {
    require('@tailwindcss/oxide');
    require('lightningcss');
    require('@tailwindcss/postcss');
    canUseNativeTailwind = true;
  } catch (err) {
    console.warn(
      '[build] Native Tailwind/LightningCSS bindings unavailable on this host (likely older GLIBC). Falling back to pre-compiled app/globals.compiled.css:',
      err?.message || err
    );
  }
}

let originalGlobalsCss = null;
let movedPostcssConfig = false;

try {
  if (!canUseNativeTailwind && fs.existsSync(compiledCssPath)) {
    originalGlobalsCss = fs.readFileSync(globalsCssPath, 'utf8');
    fs.copyFileSync(compiledCssPath, globalsCssPath);
    if (fs.existsSync(postcssConfigPath)) {
      fs.renameSync(postcssConfigPath, postcssBackupPath);
      movedPostcssConfig = true;
    }
  }

  const nextBin = require.resolve('next/dist/bin/next');
  const result = spawnSync(process.execPath, [nextBin, 'build', '--webpack'], {
    cwd: rootDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      CIRCLE_NODE_TOTAL: '2',
      UV_THREADPOOL_SIZE: '2',
      NEXT_TELEMETRY_DISABLED: '1',
    },
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  fixPermissions(path.join(rootDir, '.next'));
  fixParentDomainDirs(rootDir);
} finally {
  if (originalGlobalsCss !== null) {
    fs.writeFileSync(globalsCssPath, originalGlobalsCss, 'utf8');
  }
  if (movedPostcssConfig && fs.existsSync(postcssBackupPath)) {
    fs.renameSync(postcssBackupPath, postcssConfigPath);
  }
}
