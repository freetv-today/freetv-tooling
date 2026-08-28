import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const toolingRoot = path.resolve(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.resolve(toolingRoot, 'config/paths.json'), 'utf8'));

const viewerRoot = path.resolve(toolingRoot, config.repos.viewer);

console.log('Building FreeTV Viewer...');
const build = spawn('npm', ['run', 'build'], { cwd: viewerRoot, stdio: 'inherit' });

build.on('exit', (code) => {
  if (code !== 0) {
    process.exit(code ?? 1);
  }
  console.log('FreeTV Viewer build complete.');
});
