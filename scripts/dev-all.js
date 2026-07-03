import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const toolingRoot = path.resolve(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.resolve(toolingRoot, 'config/paths.json'), 'utf8'));

const phpScript = path.resolve(__dirname, 'dev-php-server.js');
const viewScript = path.resolve(__dirname, 'dev-view.js');
const serverScript = path.resolve(__dirname, 'dev-server.js');

const php = spawn(process.execPath, [phpScript], { stdio: 'inherit' });
const view = spawn(process.execPath, [viewScript], { stdio: 'inherit' });
const server = spawn(process.execPath, [serverScript], { stdio: 'inherit' });

for (const child of [php, view, server]) {
  child.on('exit', (code) => {
    if (code !== 0) {
      process.exit(code ?? 1);
    }
  });
}
