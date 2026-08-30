import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  assertDevelopmentPortAvailable,
  DEVELOPMENT_PRODUCTS,
} from '../scripts/lib/development.js';

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
