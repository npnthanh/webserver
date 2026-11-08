import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const rootDir = process.cwd();
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
    },
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
} finally {
  if (originalGlobalsCss !== null) {
    fs.writeFileSync(globalsCssPath, originalGlobalsCss, 'utf8');
  }
  if (movedPostcssConfig && fs.existsSync(postcssBackupPath)) {
    fs.renameSync(postcssBackupPath, postcssConfigPath);
  }
}
