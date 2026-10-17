import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertDevelopmentPortAvailable,
  DEVELOPMENT_PRODUCTS,
  resolveDevelopmentPort,
} from './lib/development.js';
import { prepareViewerDevelopmentData } from './lib/viewer-development-data.js';

const scriptPath = fileURLToPath(import.meta.url);
const toolingRoot = path.resolve(path.dirname(scriptPath), '..');
const config = JSON.parse(fs.readFileSync(path.resolve(toolingRoot, 'config/paths.json'), 'utf8'));

const viewerRoot = path.resolve(toolingRoot, config.repos.viewer);
const label = DEVELOPMENT_PRODUCTS.viewer;
const port = resolveDevelopmentPort(process.env.VIEWER_PORT || config.dev.viewerPort, label);

export function spawnViewerVite({
  environment = process.env, viewerDirectory = viewerRoot, viewerPort = port, spawnProcess = spawn,
} = {}) {
  return spawnProcess(
    'npm',
    ['run', 'dev', '--', '--host', '0.0.0.0', '--port', String(viewerPort), '--strictPort'],
    { cwd: viewerDirectory, stdio: 'inherit', env: environment },
  );
}

export async function prepareStandaloneViewerDevelopment({
  portPreflight = assertDevelopmentPortAvailable,
  viewerDataPreparer = prepareViewerDevelopmentData,
  logger = console,
} = {}) {
  await portPreflight({ label, port });
  await viewerDataPreparer({ toolingRoot, config, logger });
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try {
    if (process.env.FREETV_SKIP_PORT_PREFLIGHT !== '1') await prepareStandaloneViewerDevelopment();
    else await prepareViewerDevelopmentData({ toolingRoot, config });
    console.log(`${label} starting on port ${port}.`);
    const dev = spawnViewerVite();
    let finished = false;
    dev.on('error', (error) => {
      if (finished) return;
      finished = true;
      console.error(`${label} could not start.\n\n${error.message}`);
      process.exitCode = 1;
    });
    dev.on('exit', (code, signal) => {
      if (finished) return;
      finished = true;
      process.exitCode = signal ? 1 : (code ?? 1);
    });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
