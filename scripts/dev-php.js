import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertDevelopmentPortAvailable,
  DEVELOPMENT_PRODUCTS,
  resolveDevelopmentPort,
} from './lib/development.js';

const scriptPath = fileURLToPath(import.meta.url);
const toolingRoot = path.resolve(path.dirname(scriptPath), '..');
const config = JSON.parse(fs.readFileSync(path.resolve(toolingRoot, 'config/paths.json'), 'utf8'));

const phpRoot = path.resolve(toolingRoot, config.repos.admin, 'public');
const label = DEVELOPMENT_PRODUCTS.php;
const port = resolveDevelopmentPort(process.env.PHP_PORT || config.dev.phpPort, label);

export function spawnPhpServer({
  environment = process.env, phpDirectory = phpRoot, phpPort = port, spawnProcess = spawn,
} = {}) {
  return spawnProcess('php', ['-S', `0.0.0.0:${phpPort}`, '-t', phpDirectory], {
    cwd: phpDirectory,
    stdio: 'inherit',
    env: { ...environment, PHP_CLI_SERVER_WORKERS: '4' },
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try {
    if (process.env.FREETV_SKIP_PORT_PREFLIGHT !== '1') await assertDevelopmentPortAvailable({ label, port });
    console.log(`${label} starting on port ${port}.`);
    const php = spawnPhpServer();
    let finished = false;
    php.on('error', (error) => {
      if (finished) return;
      finished = true;
      console.error(`${label} could not start.\n\n${error.message}`);
      process.exitCode = 1;
    });
    php.on('exit', (code, signal) => {
      if (finished) return;
      finished = true;
      process.exitCode = signal ? 1 : (code ?? 1);
    });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
