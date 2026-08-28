import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEVELOPMENT_PRODUCTS,
  preflightDevelopmentPorts,
  resolveDevelopmentPort,
} from './lib/development.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const toolingRoot = path.resolve(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.resolve(toolingRoot, 'config/paths.json'), 'utf8'));

const services = [
  {
    label: DEVELOPMENT_PRODUCTS.viewer,
    port: resolveDevelopmentPort(process.env.VIEWER_PORT || config.dev.viewerPort, DEVELOPMENT_PRODUCTS.viewer),
    script: path.resolve(__dirname, 'dev-viewer.js'),
  },
  {
    label: DEVELOPMENT_PRODUCTS.admin,
    port: resolveDevelopmentPort(process.env.ADMIN_PORT || config.dev.serverPort, DEVELOPMENT_PRODUCTS.admin),
    script: path.resolve(__dirname, 'dev-admin.js'),
  },
  {
    label: DEVELOPMENT_PRODUCTS.php,
    port: resolveDevelopmentPort(process.env.PHP_PORT || config.dev.phpPort, DEVELOPMENT_PRODUCTS.php),
    script: path.resolve(__dirname, 'dev-php.js'),
  },
];

function signalProcessTree(child, signal, force = false) {
  if (!child.pid) return;

  try {
    if (process.platform === 'win32') {
      const args = ['/PID', String(child.pid), '/T'];
      if (force) args.push('/F');
      spawnSync('taskkill', args, { stdio: 'ignore' });
    } else {
      process.kill(-child.pid, signal);
    }
  } catch (error) {
    if (error.code !== 'ESRCH') child.kill(signal);
  }
}

function waitForChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => child.once('exit', resolve));
}

let children = [];
let shuttingDown = false;

async function shutdown(exitCode) {
  if (shuttingDown) return;
  shuttingDown = true;

  children.forEach((child) => signalProcessTree(child, 'SIGTERM'));
  const allExited = Promise.all(children.map(waitForChild));
  const graceful = await Promise.race([
    allExited.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 3000)),
  ]);

  if (!graceful) {
    children.forEach((child) => signalProcessTree(child, 'SIGKILL', true));
    await Promise.race([
      allExited,
      new Promise((resolve) => setTimeout(resolve, 1000)),
    ]);
  }

  process.exit(exitCode);
}

try {
  await preflightDevelopmentPorts(services);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

if (process.exitCode !== 1) {
  console.log('Starting FreeTV development environment:');
  services.forEach(({ label, port }) => console.log(`  ${label}: port ${port}`));

  children = services.map(({ label, script }) => {
    const child = spawn(process.execPath, [script], {
      detached: process.platform !== 'win32',
      env: { ...process.env, FREETV_SKIP_PORT_PREFLIGHT: '1' },
      stdio: 'inherit',
    });

    child.on('error', (error) => {
      console.error(`${label} could not start.\n\n${error.message}`);
      void shutdown(1);
    });
    child.on('exit', (code, signal) => {
      if (shuttingDown) return;
      const detail = signal ? `signal ${signal}` : `code ${code ?? 1}`;
      console.error(`${label} exited with ${detail}. Stopping the FreeTV development environment.`);
      void shutdown(code ?? 1);
    });
    return child;
  });

  process.on('SIGINT', () => void shutdown(130));
  process.on('SIGTERM', () => void shutdown(143));
}
