import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const toolingRoot = path.resolve(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.resolve(toolingRoot, 'config/paths.json'), 'utf8'));

const serverRoot = path.resolve(toolingRoot, config.repos.server, 'public');
const port = process.env.PHP_PORT || config.dev.phpPort;

console.log(`Starting PHP dev server from ${serverRoot} on port ${port}...`);

const php = spawn('php', ['-S', `0.0.0.0:${port}`, '-t', serverRoot], {
  cwd: serverRoot,
  stdio: 'inherit',
  env: { ...process.env, PHP_CLI_SERVER_WORKERS: '4' }
});

php.on('exit', (code) => {
  console.log(`PHP dev server exited with code ${code}`);
  process.exit(code ?? 0);
});
