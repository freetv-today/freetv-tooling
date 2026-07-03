import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const toolingRoot = path.resolve(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.resolve(toolingRoot, 'config/paths.json'), 'utf8'));

const viewerRoot = path.resolve(toolingRoot, config.repos.viewer);
const port = process.env.VIEWER_PORT || config.dev.viewerPort;

console.log(`Starting viewer dev server on port ${port}...`);
const dev = spawn('npm', ['run', 'dev', '--', '--host', '0.0.0.0', '--port', String(port)], {
  cwd: viewerRoot,
  stdio: 'inherit'
});

dev.on('exit', (code) => {
  process.exit(code ?? 0);
});
