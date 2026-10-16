import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEVELOPMENT_PRODUCTS,
  preflightDevelopmentPorts,
  resolveAdminApiProxyTarget,
  resolveDevelopmentPort,
} from './lib/development.js';
import { startDevelopmentSupervisor } from './lib/development-supervisor.js';

const scriptPath = fileURLToPath(import.meta.url);
const defaultToolingRoot = path.resolve(path.dirname(scriptPath), '..');

export function createDevelopmentServices({ toolingRoot, config, environment = process.env }) {
  const viewerPort = resolveDevelopmentPort(environment.VIEWER_PORT || config.dev.viewerPort, DEVELOPMENT_PRODUCTS.viewer);
  const adminPort = resolveDevelopmentPort(environment.ADMIN_PORT || config.dev.adminPort, DEVELOPMENT_PRODUCTS.admin);
  const phpPort = resolveDevelopmentPort(environment.PHP_PORT || config.dev.phpPort, DEVELOPMENT_PRODUCTS.php);
  const common = { detached: process.platform !== 'win32', stdio: 'inherit' };
  return [
    {
      label: DEVELOPMENT_PRODUCTS.viewer, port: viewerPort, executable: 'npm',
      args: ['run', 'dev', '--', '--host', '0.0.0.0', '--port', String(viewerPort), '--strictPort'],
      options: { ...common, cwd: path.resolve(toolingRoot, config.repos.viewer), env: environment },
    },
    {
      label: DEVELOPMENT_PRODUCTS.admin, port: adminPort, executable: 'npm',
      args: ['run', 'dev', '--', '--host', '0.0.0.0', '--port', String(adminPort), '--strictPort'],
      options: {
        ...common,
        cwd: path.resolve(toolingRoot, config.repos.admin),
        env: {
          ...environment,
          VITE_API_PROXY_TARGET: resolveAdminApiProxyTarget({ environment, configuredPhpPort: phpPort }),
        },
      },
    },
    {
      label: DEVELOPMENT_PRODUCTS.php, port: phpPort, executable: 'php',
      args: ['-S', `0.0.0.0:${phpPort}`, '-t', path.resolve(toolingRoot, config.repos.admin, 'public')],
      options: {
        ...common,
        cwd: path.resolve(toolingRoot, config.repos.admin, 'public'),
        env: { ...environment, PHP_CLI_SERVER_WORKERS: '4' },
      },
    },
  ];
}

export async function runDevelopmentEnvironment({
  toolingRoot = defaultToolingRoot,
  config = JSON.parse(fs.readFileSync(path.join(toolingRoot, 'config/paths.json'), 'utf8')),
  environment = process.env,
  logger = console,
  supervisor = startDevelopmentSupervisor,
  preflight = preflightDevelopmentPorts,
  spawnProcess,
  signalTree,
  waitForTimeout,
} = {}) {
  const services = createDevelopmentServices({ toolingRoot, config, environment });
  logger.log('Starting FreeTV development environment:');
  services.forEach(({ label, port }) => logger.log(`  ${label}: port ${port}`));
  return supervisor({ services, preflight, spawnProcess, signalTree, waitForTimeout });
}

export async function runDevelopmentEnvironmentCli(options = {}) {
  let session;
  const onSigint = () => { void session?.stop({ kind: 'cancelled', signal: 'SIGINT', exitCode: 130 }); };
  const onSigterm = () => { void session?.stop({ kind: 'cancelled', signal: 'SIGTERM', exitCode: 143 }); };
  try {
    session = await runDevelopmentEnvironment(options);
    process.once('SIGINT', onSigint);
    process.once('SIGTERM', onSigterm);
    const result = await session.completion;
    if (!result.stopped) (options.logger ?? console).error(`Development shutdown incomplete: ${result.unresolved.join(', ')}`);
    return result.exitCode ?? 1;
  } catch (error) {
    (options.logger ?? console).error(error.message);
    return 1;
  } finally {
    process.removeListener('SIGINT', onSigint);
    process.removeListener('SIGTERM', onSigterm);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  process.exitCode = await runDevelopmentEnvironmentCli();
}
