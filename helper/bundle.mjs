// Packs the helper into one file for the desktop app: dist/lib/esm/helper.mjs, plus the
// iRacing SDK's Windows module in dist/prebuilds. Run with `npm run bundle`.
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';

const out = 'dist';
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await build({
  entryPoints: ['src/main.ts'],
  outfile: `${out}/lib/esm/helper.mjs`,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  // Optional speed-ups that ws looks for and does without
  external: ['bufferutil', 'utf-8-validate'],
  // Bundled CommonJS code (ws, node-gyp-build) needs a real require
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'info',
});

// @irsdk-node/native looks for its compiled module two folders up from its code
// (dist/lib/esm -> dist), in prebuilds/<platform>-<arch>, next to a package.json.
cpSync('node_modules/@irsdk-node/native/prebuilds', `${out}/prebuilds`, { recursive: true });
writeFileSync(`${out}/package.json`, JSON.stringify({ name: '@irsdk-node/native', private: true, type: 'module' }) + '\n');
