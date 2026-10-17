import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  assertDevelopmentPortAvailable,
  DEVELOPMENT_PRODUCTS,
  resolveAdminApiProxyTarget,
} from '../scripts/lib/development.js';
import { spawnAdminVite } from '../scripts/dev-admin.js';
import { prepareStandaloneViewerDevelopment, spawnViewerVite } from '../scripts/dev-viewer.js';
import { spawnPhpServer } from '../scripts/dev-php.js';
import {
  createDevelopmentServices,
  runDevelopmentEnvironment,
  runDevelopmentEnvironmentCli,
} from '../scripts/dev-all.js';

const toolingRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(toolingRoot, 'package.json'), 'utf8'));
const config = JSON.parse(fs.readFileSync(path.join(toolingRoot, 'config/paths.json'), 'utf8'));

function read(relativePath) {
  return fs.readFileSync(path.join(toolingRoot, relativePath), 'utf8');
}

test('public development and build commands use explicit product names', () => {
  assert.equal(packageJson.scripts['dev:install-viewer-data'], 'node scripts/dev-install-viewer-data.js');
  assert.equal(packageJson.scripts['dev:clean-viewer-data'], 'node scripts/dev-clean-viewer-data.js');
  assert.equal(packageJson.scripts['dev:viewer'], 'node scripts/dev-viewer.js');
  assert.equal(packageJson.scripts['dev:admin'], 'node scripts/dev-admin.js');
  assert.equal(packageJson.scripts['dev:php'], 'node scripts/dev-php.js');
  assert.equal(packageJson.scripts['build:viewer'], 'node scripts/build-viewer.js');
  assert.equal(packageJson.scripts['build:admin'], 'node scripts/build-admin.js');

  for (const retired of ['dev:view', 'dev:server', 'dev:php-server', 'build:view', 'build:server']) {
    assert.equal(retired in packageJson.scripts, false);
  }

  assert.doesNotMatch(read('scripts/dev-admin.js'), /viewer-development-data/u);
  assert.doesNotMatch(read('scripts/dev-php.js'), /viewer-development-data/u);
});

test('renamed launcher and build files replace the retired filenames', () => {
  for (const current of [
    'scripts/dev-viewer.js',
    'scripts/dev-admin.js',
    'scripts/dev-php.js',
    'scripts/build-viewer.js',
    'scripts/build-admin.js',
  ]) assert.equal(fs.existsSync(path.join(toolingRoot, current)), true);

  for (const retired of [
    'scripts/dev-view.js',
    'scripts/dev-server.js',
    'scripts/dev-php-server.js',
    'scripts/build-view.js',
    'scripts/build-server.js',
  ]) assert.equal(fs.existsSync(path.join(toolingRoot, retired)), false);
});

test('development ports and Vite strict-port behavior are explicit', () => {
  assert.deepEqual(
    [config.dev.viewerPort, config.dev.adminPort, config.dev.phpPort],
    [5173, 5174, 8081],
  );
  assert.match(read('scripts/dev-viewer.js'), /'--strictPort'/u);
  assert.match(read('scripts/dev-admin.js'), /'--strictPort'/u);
  assert.match(read('scripts/dev-admin.js'), /process\.env\.ADMIN_PORT/u);
  assert.doesNotMatch(read('scripts/dev-php.js'), /strictPort/u);
});

test('Admin API proxy target follows the configured PHP development port', () => {
  assert.equal(
    resolveAdminApiProxyTarget({ environment: {}, configuredPhpPort: config.dev.phpPort }),
    'http://localhost:8081',
  );
  assert.equal(
    resolveAdminApiProxyTarget({ environment: {}, configuredPhpPort: 9123 }),
    'http://localhost:9123',
  );
  assert.equal(
    resolveAdminApiProxyTarget({ environment: { PHP_PORT: '8123' }, configuredPhpPort: 9123 }),
    'http://localhost:8123',
  );
});

test('explicit Admin API proxy targets are preserved and blank targets are generated', () => {
  const explicitTarget = '  https://api.example.test/custom  ';
  assert.equal(
    resolveAdminApiProxyTarget({
      environment: { PHP_PORT: '8123', VITE_API_PROXY_TARGET: explicitTarget },
      configuredPhpPort: 9123,
    }),
    explicitTarget,
  );
  assert.equal(
    resolveAdminApiProxyTarget({
      environment: { VITE_API_PROXY_TARGET: '  \t' },
      configuredPhpPort: 9123,
    }),
    'http://localhost:9123',
  );
  assert.equal(
    resolveAdminApiProxyTarget({
      environment: { VITE_API_PROXY_TARGET: '' },
      configuredPhpPort: 9123,
    }),
    'http://localhost:9123',
  );
});

test('Admin API proxy target retains PHP development port validation', () => {
  assert.throws(
    () => resolveAdminApiProxyTarget({
      environment: { PHP_PORT: 'invalid' },
      configuredPhpPort: config.dev.phpPort,
    }),
    { message: 'PHP API Server has an invalid configured port: invalid' },
  );
});

test('dev:admin passes the resolved API proxy target to the spawned Vite process', () => {
  let invocation;
  const child = {};
  const result = spawnAdminVite({
    environment: { PHP_PORT: '8123', EXISTING_VARIABLE: 'preserved' },
    configuredPhpPort: config.dev.phpPort,
    adminDirectory: '/admin',
    adminPort: 5174,
    spawnProcess(command, args, options) {
      invocation = { command, args, options };
      return child;
    },
  });

  assert.equal(result, child);
  assert.equal(invocation.command, 'npm');
  assert.deepEqual(
    invocation.args,
    ['run', 'dev', '--', '--host', '0.0.0.0', '--port', '5174', '--strictPort'],
  );
  assert.equal(invocation.options.env.EXISTING_VARIABLE, 'preserved');
  assert.equal(invocation.options.env.VITE_API_PROXY_TARGET, 'http://localhost:8123');
});

test('occupied ports produce the product-specific troubleshooting message', async (t) => {
  const blocker = net.createServer();
  t.after(() => blocker.close());
  await new Promise((resolve, reject) => {
    blocker.once('error', reject);
    blocker.listen({ host: '0.0.0.0', port: 0 }, resolve);
  });
  const { port } = blocker.address();

  await assert.rejects(
    assertDevelopmentPortAvailable({ label: DEVELOPMENT_PRODUCTS.admin, port }),
    (error) => {
      assert.equal(
        error.message,
        `FreeTV Admin Dashboard could not start.\n\nPort ${port} is already in use.\n`
        + 'See README.md > Troubleshooting for help.',
      );
      return true;
    },
  );
});

test('development service definitions preserve commands, ports, repositories, and environments', () => {
  const environment = { EXISTING: 'yes', PHP_PORT: '8123' };
  const services = createDevelopmentServices({ toolingRoot, config, environment });
  assert.deepEqual(services.map(({ port }) => port), [5173, 5174, 8123]);
  assert.deepEqual(services[0].args.slice(-3), ['--port', '5173', '--strictPort']);
  assert.equal(services[0].options.cwd, path.resolve(toolingRoot, config.repos.viewer));
  assert.equal(services[1].options.env.VITE_API_PROXY_TARGET, 'http://localhost:8123');
  assert.equal(services[2].options.env.PHP_CLI_SERVER_WORKERS, '4');
  for (const service of services) {
    assert.deepEqual(service.options.stdio, ['ignore', 'inherit', 'inherit']);
  }
});

test('development service selection is explicit and preserves service order', () => {
  assert.deepEqual(createDevelopmentServices({
    toolingRoot, config, environment: {}, selection: 'all',
  }).map(({ label }) => label), [
    DEVELOPMENT_PRODUCTS.viewer, DEVELOPMENT_PRODUCTS.admin, DEVELOPMENT_PRODUCTS.php,
  ]);
  assert.deepEqual(createDevelopmentServices({
    toolingRoot, config, environment: {}, selection: 'viewer',
  }).map(({ label }) => label), [DEVELOPMENT_PRODUCTS.viewer]);
  assert.deepEqual(createDevelopmentServices({
    toolingRoot, config, environment: {}, selection: 'admin',
  }).map(({ label }) => label), [DEVELOPMENT_PRODUCTS.admin, DEVELOPMENT_PRODUCTS.php]);
  assert.throws(() => createDevelopmentServices({
    toolingRoot, config, environment: {}, selection: 'unknown',
  }), /Unsupported development service selection: unknown/u);
});

test('every supervised service selection isolates stdin and preserves visible output', () => {
  for (const selection of ['viewer', 'admin', 'all']) {
    const services = createDevelopmentServices({
      toolingRoot, config, environment: {}, selection,
    });
    assert.equal(services.length > 0, true);
    for (const service of services) {
      assert.deepEqual(service.options.stdio, ['ignore', 'inherit', 'inherit']);
    }
  }
});

test('unselected development ports are neither resolved nor preflighted', async () => {
  const invalidOtherPorts = {
    ...config,
    dev: { viewerPort: 5173, adminPort: 'invalid', phpPort: 'invalid' },
  };
  const preflighted = [];
  const session = { completion: new Promise(() => {}), stop: async () => {} };
  assert.equal(await runDevelopmentEnvironment({
    toolingRoot, config: invalidOtherPorts, environment: {}, selection: 'viewer',
    logger: { log() {} }, viewerDataPreparer: async () => {},
    preflight: async (services) => preflighted.push(services.map(({ label }) => label)),
    supervisor: async ({ services }) => { assert.equal(services.length, 1); return session; },
  }), session);
  assert.deepEqual(preflighted, [[DEVELOPMENT_PRODUCTS.viewer]]);
});

test('development preflight prepares Viewer data before supervisor startup only when selected', async () => {
  for (const [selection, expectedPreparation] of [['all', 1], ['viewer', 1], ['admin', 0]]) {
    const events = [];
    await runDevelopmentEnvironment({
      toolingRoot, config, environment: {}, selection, logger: { log() {} },
      preflight: async (services) => events.push(['preflight', services.map(({ label }) => label)]),
      viewerDataPreparer: async () => events.push(['prepare']),
      supervisor: async () => {
        events.push(['supervisor']);
        return { completion: new Promise(() => {}), stop: async () => {} };
      },
    });
    assert.equal(events.filter(([event]) => event === 'prepare').length, expectedPreparation);
    assert.equal(events[0][0], 'preflight');
    assert.equal(events.at(-1)[0], 'supervisor');
  }
});

test('failed selected-port preflight or Viewer preparation prevents service startup', async () => {
  for (const failureStage of ['preflight', 'prepare']) {
    let preparations = 0;
    let supervisors = 0;
    await assert.rejects(runDevelopmentEnvironment({
      toolingRoot, config, environment: {}, selection: 'viewer', logger: { log() {} },
      preflight: async () => {
        if (failureStage === 'preflight') throw new Error('port fixture');
      },
      viewerDataPreparer: async () => {
        preparations += 1;
        if (failureStage === 'prepare') throw new Error('data fixture');
      },
      supervisor: async () => { supervisors += 1; },
    }), new RegExp(failureStage === 'preflight' ? 'port fixture' : 'data fixture', 'u'));
    assert.equal(preparations, failureStage === 'preflight' ? 0 : 1);
    assert.equal(supervisors, 0);
  }
});

test('prepared Viewer data is retained after every supervisor completion outcome', async () => {
  for (const result of [
    { kind: 'cancelled', exitCode: 0, stopped: true, unresolved: [] },
    { kind: 'unexpected-exit', exitCode: 1, stopped: true, unresolved: [] },
    { kind: 'spawn', exitCode: 1, stopped: true, unresolved: [] },
  ]) {
    let viewerDataPresent = false;
    const session = await runDevelopmentEnvironment({
      toolingRoot, config, environment: {}, selection: 'viewer', logger: { log() {} },
      preflight: async () => {},
      viewerDataPreparer: async () => { viewerDataPresent = true; },
      supervisor: async () => ({ completion: Promise.resolve(result), stop: async () => {} }),
    });

    assert.deepEqual(await session.completion, result);
    assert.equal(viewerDataPresent, true);
  }
});

test('standalone Viewer preflight checks its port before preparing data', async () => {
  const events = [];
  await prepareStandaloneViewerDevelopment({
    portPreflight: async () => events.push('port'),
    viewerDataPreparer: async () => events.push('data'),
  });
  assert.deepEqual(events, ['port', 'data']);

  await assert.rejects(prepareStandaloneViewerDevelopment({
    portPreflight: async () => { throw new Error('occupied'); },
    viewerDataPreparer: async () => events.push('unexpected'),
  }), /occupied/u);
  assert.doesNotMatch(events.join(','), /unexpected/u);
});

test('imported individual development launchers are inert and expose injectable spawn functions', () => {
  for (const launch of [spawnViewerVite, spawnAdminVite, spawnPhpServer]) assert.equal(typeof launch, 'function');
});

test('standalone development wrapper maps cancellation and startup failure exit statuses', async () => {
  const logger = { log() {}, error() {} };
  const common = {
    toolingRoot, config, logger, preflight: async () => {}, viewerDataPreparer: async () => {},
  };
  assert.equal(await runDevelopmentEnvironmentCli({
    ...common,
    supervisor: async () => ({
      completion: Promise.resolve({ kind: 'cancelled', exitCode: 130, stopped: true, unresolved: [] }),
      stop: async () => {},
    }),
  }), 130);
  assert.equal(await runDevelopmentEnvironmentCli({
    ...common,
    supervisor: async () => { throw new Error('startup fixture'); },
  }), 1);
});
