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

const adminRoot = path.resolve(toolingRoot, config.repos.server);
const label = DEVELOPMENT_PRODUCTS.admin;
const port = resolveDevelopmentPort(process.env.ADMIN_PORT || config.dev.serverPort, label);

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
  const dev = spawn(
    'npm',
    ['run', 'dev', '--', '--host', '0.0.0.0', '--port', String(port), '--strictPort'],
    { cwd: adminRoot, stdio: 'inherit' },
  );

  dev.on('error', (error) => {
    console.error(`${label} could not start.\n\n${error.message}`);
    process.exitCode = 1;
  });
  dev.on('exit', (code) => {
    process.exitCode = code ?? 1;
  });
}
