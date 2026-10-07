// Gets the helper ready for the app: bundles helper/ into helper/dist and copies this
// Node into src-tauri/binaries, named the way Tauri expects a bundled program to be.
import { execSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const helper = join(root, '..', 'helper');

execSync('npm run bundle', { cwd: helper, stdio: 'inherit' });

const triple = execSync('rustc -vV').toString().match(/^host: (\S+)$/m)[1];
const ext = process.platform === 'win32' ? '.exe' : '';
const bin = join(root, 'src-tauri', 'binaries');
mkdirSync(bin, { recursive: true });
copyFileSync(process.execPath, join(bin, `nightstint-helper-${triple}${ext}`));
console.log(`Node ${process.version} copied for ${triple}`);
