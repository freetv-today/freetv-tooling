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
    [config.dev.viewerPort, config.dev.serverPort, config.dev.phpPort],
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

test('dev:all preflights before spawning and manages child termination', () => {
  const source = read('scripts/dev-all.js');
  assert.ok(source.indexOf('await preflightDevelopmentPorts(services)') < source.indexOf('services.map'));
  assert.match(source, /process\.on\('SIGINT'/u);
  assert.match(source, /process\.on\('SIGTERM'/u);
  assert.match(source, /process\.kill\(-child\.pid/u);
  assert.match(source, /taskkill/u);
  assert.match(source, /SIGKILL/u);
});
