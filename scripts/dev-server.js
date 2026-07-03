import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const toolingRoot = path.resolve(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.resolve(toolingRoot, 'config/paths.json'), 'utf8'));

const serverRoot = path.resolve(toolingRoot, config.repos.server);
const port = process.env.SERVER_PORT || config.dev.serverPort;

console.log(`Starting admin dev server on port ${port}...`);
const dev = spawn('npm', ['run', 'dev', '--', '--host', '0.0.0.0', '--port', String(port)], {
  cwd: serverRoot,
  stdio: 'inherit'
});

dev.on('exit', (code) => {
  process.exit(code ?? 0);
});
