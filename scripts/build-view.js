import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const toolingRoot = path.resolve(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.resolve(toolingRoot, 'config/paths.json'), 'utf8'));

const viewerRoot = path.resolve(toolingRoot, config.repos.viewer);

console.log('Building viewer...');
const build = spawn('npm', ['run', 'build'], { cwd: viewerRoot, stdio: 'inherit' });

build.on('exit', (code) => {
  if (code !== 0) {
    process.exit(code ?? 1);
  }
  console.log('Viewer build complete.');
});
