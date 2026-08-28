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

const viewerRoot = path.resolve(toolingRoot, config.repos.viewer);
const label = DEVELOPMENT_PRODUCTS.viewer;
const port = resolveDevelopmentPort(process.env.VIEWER_PORT || config.dev.viewerPort, label);

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
    { cwd: viewerRoot, stdio: 'inherit' },
  );

  dev.on('error', (error) => {
    console.error(`${label} could not start.\n\n${error.message}`);
    process.exitCode = 1;
  });
  dev.on('exit', (code) => {
    process.exitCode = code ?? 1;
  });
}
