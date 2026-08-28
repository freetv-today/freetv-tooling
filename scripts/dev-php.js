import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertDevelopmentPortAvailable,
  DEVELOPMENT_PRODUCTS,
  resolveDevelopmentPort,
} from './lib/development.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const toolingRoot = path.resolve(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.resolve(toolingRoot, 'config/paths.json'), 'utf8'));

const phpRoot = path.resolve(toolingRoot, config.repos.server, 'public');
const label = DEVELOPMENT_PRODUCTS.php;
const port = resolveDevelopmentPort(process.env.PHP_PORT || config.dev.phpPort, label);

try {
  if (process.env.FREETV_SKIP_PORT_PREFLIGHT !== '1') {
    await assertDevelopmentPortAvailable({ label, port });
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

if (process.exitCode !== 1) {
  console.log(`${label} starting on port ${port}.`);
  const php = spawn('php', ['-S', `0.0.0.0:${port}`, '-t', phpRoot], {
    cwd: phpRoot,
    stdio: 'inherit',
    env: { ...process.env, PHP_CLI_SERVER_WORKERS: '4' },
  });

  php.on('error', (error) => {
    console.error(`${label} could not start.\n\n${error.message}`);
    process.exitCode = 1;
  });
  php.on('exit', (code) => {
    process.exitCode = code ?? 1;
  });
}
