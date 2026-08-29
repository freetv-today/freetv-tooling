import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  resolveThumbnailCleanup,
  runThumbnailCleanup,
} from '../scripts/clean-thumbs.js';

function fixture(t, { includeCleanupScript = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'freetv-clean-thumbs-'));
  const toolingRoot = path.join(root, 'tooling');
  const serverRoot = path.join(root, 'configured-server');
  const cleanupScript = path.join(serverRoot, 'scripts/cleanup-orphan-thumbnails.php');
  fs.mkdirSync(path.join(toolingRoot, 'config'), { recursive: true });
  fs.mkdirSync(path.dirname(cleanupScript), { recursive: true });
  fs.writeFileSync(
    path.join(toolingRoot, 'config/paths.json'),
    JSON.stringify({ repos: { server: '../configured-server' } }),
  );
  if (includeCleanupScript) fs.writeFileSync(cleanupScript, '<?php');
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  return { cleanupScript, serverRoot, toolingRoot };
}

test('resolves the Server cleanup script through config repos.server', (t) => {
  const expected = fixture(t);
  assert.deepEqual(resolveThumbnailCleanup(expected.toolingRoot), {
    cleanupScript: expected.cleanupScript,
    serverRoot: expected.serverRoot,
  });
});

test('default invocation delegates to PHP without apply mode', (t) => {
  const expected = fixture(t);
  const calls = [];
  const status = runThumbnailCleanup({
    toolingRoot: expected.toolingRoot,
    commandRunner(command, args, options) {
      calls.push({ args, command, options });
      return { status: 0 };
    },
  });

  assert.equal(status, 0);
  assert.deepEqual(calls, [{
    command: 'php',
    args: [expected.cleanupScript],
    options: { cwd: expected.serverRoot, stdio: 'inherit' },
  }]);
});

test('apply mode is forwarded explicitly', (t) => {
  const expected = fixture(t);
  let invocation;
  const status = runThumbnailCleanup({
    args: ['--apply'],
    toolingRoot: expected.toolingRoot,
    commandRunner(command, args, options) {
      invocation = { args, command, options };
      return { status: 0 };
    },
  });

  assert.equal(status, 0);
  assert.deepEqual(invocation.args, [expected.cleanupScript, '--apply']);
});

test('unknown arguments fail without invoking cleanup', (t) => {
  const expected = fixture(t);
  let invoked = false;
  assert.throws(
    () => runThumbnailCleanup({
      args: ['--delete'],
      toolingRoot: expected.toolingRoot,
      commandRunner() {
        invoked = true;
        return { status: 0 };
      },
    }),
    /Unsupported thumbnail cleanup arguments.*Usage: npm run clean:thumbs \[-- --apply\]/su,
  );
  assert.equal(invoked, false);
});

test('a missing Server cleanup script fails without invoking PHP', (t) => {
  const expected = fixture(t, { includeCleanupScript: false });
  let invoked = false;
  assert.throws(
    () => runThumbnailCleanup({
      toolingRoot: expected.toolingRoot,
      commandRunner() {
        invoked = true;
        return { status: 0 };
      },
    }),
    /FreeTV Server thumbnail cleanup script was not found/u,
  );
  assert.equal(invoked, false);
});

test('the PHP cleanup exit status is preserved', (t) => {
  const expected = fixture(t);
  assert.equal(runThumbnailCleanup({
    toolingRoot: expected.toolingRoot,
    commandRunner: () => ({ status: 7 }),
  }), 7);
});
