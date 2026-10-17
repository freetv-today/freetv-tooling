import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runCleanupAction } from '../cli/cleanup-actions.js';
import { runInteractiveCli } from '../cli/menu.js';

const CANCEL = Symbol('cancel');

function promptFixture(selections) {
  const events = [];
  return {
    events,
    intro: (message) => events.push(['intro', message]),
    note: (message, title) => events.push(['note', title, message]),
    select: async (options) => { events.push(['select', options]); return selections.shift(); },
    confirm: async (options) => { events.push(['confirm', options]); return selections.shift(); },
    text: async (options) => { events.push(['text', options]); return selections.shift(); },
    isCancel: (value) => value === CANCEL,
    cancel: (message) => events.push(['cancel', message]),
    outro: (message) => events.push(['outro', message]),
    log: {
      info: (message) => events.push(['info', message]),
      success: (message) => events.push(['success', message]),
      error: (message) => events.push(['error', message]),
    },
  };
}

function cleanupOperations(calls, statuses = {}) {
  return {
    runThumbnailCleanup(options) {
      calls.push(['thumbs', options]);
      if (statuses.thumbs instanceof Error) throw statuses.thumbs;
      return statuses.thumbs ?? 0;
    },
    async runViewerDataInstallCli() {
      calls.push(['install']);
      if (statuses.install instanceof Error) throw statuses.install;
      return statuses.install ?? 0;
    },
    async runViewerDataCleanCli() {
      calls.push(['remove']);
      if (statuses.remove instanceof Error) throw statuses.remove;
      return statuses.remove ?? 0;
    },
  };
}

test('cleanup submenu wires exact thumbnail and Viewer-data operations', async () => {
  const calls = [];
  const prompts = promptFixture([
    'cleanup', 'thumbs-dry-run', 'thumbs-apply', true,
    'viewer-install', true, 'viewer-remove', true, 'back', 'exit',
  ]);
  assert.equal(await runInteractiveCli({
    applicationName: 'FreeTV Tooling', version: '1.0.0', prompts,
    operations: cleanupOperations(calls),
  }), 0);
  assert.deepEqual(calls, [
    ['thumbs', { args: [] }],
    ['thumbs', { args: ['--apply'] }],
    ['install'],
    ['remove'],
  ]);
  const confirmations = prompts.events.filter(([kind]) => kind === 'confirm');
  assert.equal(confirmations.length, 3);
  assert.equal(confirmations.every(([, options]) => options.initialValue === false), true);
  assert.match(prompts.events.find(([kind, title]) => kind === 'note'
    && title === 'Find Unused Thumbnails')[2], /Dry run only/u);
});

test('thumbnail dry run does not confirm or authorize a later Apply operation', async () => {
  const calls = [];
  const prompts = promptFixture(['cleanup', 'thumbs-dry-run', 'thumbs-apply', false, 'back', 'exit']);
  assert.equal(await runInteractiveCli({
    applicationName: 'FreeTV Tooling', version: '1.0.0', prompts,
    operations: cleanupOperations(calls),
  }), 0);
  assert.deepEqual(calls, [['thumbs', { args: [] }]]);
  assert.equal(prompts.events.filter(([kind]) => kind === 'confirm').length, 1);
});

test('declined and cancelled destructive cleanup prompts execute nothing', async () => {
  for (const action of ['thumbs-apply', 'viewer-install', 'viewer-remove']) {
    for (const confirmation of [false, CANCEL]) {
      const calls = [];
      const selections = confirmation === false
        ? ['cleanup', action, false, 'back', 'exit']
        : ['cleanup', action, CANCEL];
      assert.equal(await runInteractiveCli({
        applicationName: 'FreeTV Tooling', version: '1.0.0',
        prompts: promptFixture(selections), operations: cleanupOperations(calls),
      }), 0);
      assert.deepEqual(calls, []);
    }
  }
});

test('cancelling the cleanup submenu executes nothing', async () => {
  const calls = [];
  const prompts = promptFixture(['cleanup', CANCEL]);
  assert.equal(await runInteractiveCli({
    applicationName: 'FreeTV Tooling', version: '1.0.0', prompts,
    operations: cleanupOperations(calls),
  }), 0);
  assert.deepEqual(calls, []);
  assert.equal(prompts.events.filter(([kind]) => kind === 'cancel').length, 1);
});

test('numeric failures and thrown launch errors report failure without success', async () => {
  for (const status of [7, new Error('PHP launch fixture')]) {
    const errors = [];
    const successes = [];
    assert.equal(await runCleanupAction('thumbs-dry-run', {
      operations: cleanupOperations([], { thumbs: status }),
      presentation: { error: (message) => errors.push(message), success: (message) => successes.push(message) },
    }), 1);
    assert.equal(successes.length, 0);
    assert.match(errors[0], status instanceof Error ? /PHP launch fixture/u : /failed/u);
  }
});

test('Viewer ownership, interrupted-transaction, and partial-recovery refusals remain visible failures', async () => {
  for (const diagnostic of [
    'unmarked Viewer content requires manual inspection',
    'interrupted transaction requires manual inspection',
    'cleanup failed and recovery state may be partial',
  ]) {
    const messages = [];
    assert.equal(await runCleanupAction('viewer-remove', {
      operations: {
        runViewerDataCleanCli: async () => { messages.push(diagnostic); return 1; },
      },
      presentation: { error: (message) => messages.push(message) },
    }), 1);
    assert.match(messages.join('\n'), new RegExp(diagnostic.replaceAll(' ', '\\s+'), 'u'));
    assert.doesNotMatch(messages.at(-1), /completed successfully/u);
  }
});

test('cleanup failure contributes to final status and later success does not erase it', async () => {
  const calls = [];
  const prompts = promptFixture([
    'cleanup', 'thumbs-dry-run', 'viewer-install', true, 'back', 'exit',
  ]);
  assert.equal(await runInteractiveCli({
    applicationName: 'FreeTV Tooling', version: '1.0.0', prompts,
    operations: cleanupOperations(calls, { thumbs: 1, install: 0 }),
  }), 1);
  assert.deepEqual(calls, [['thumbs', { args: [] }], ['install']]);
});

test('cleanup operations are awaited before menu prompting resumes', async () => {
  let finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  const prompts = promptFixture(['cleanup', 'thumbs-dry-run', 'back', 'exit']);
  const running = runInteractiveCli({
    applicationName: 'FreeTV Tooling', version: '1.0.0', prompts,
    operations: { runThumbnailCleanup: () => pending.then(() => 0) },
  });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(prompts.events.filter(([kind]) => kind === 'select').length, 2);
  finish();
  assert.equal(await running, 0);
});

test('standalone cleanup npm scripts remain unchanged', () => {
  const packageMetadata = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(packageMetadata.scripts['clean:thumbs'], 'node scripts/clean-thumbs.js');
  assert.equal(packageMetadata.scripts['dev:install-viewer-data'], 'node scripts/dev-install-viewer-data.js');
  assert.equal(packageMetadata.scripts['dev:clean-viewer-data'], 'node scripts/dev-clean-viewer-data.js');
});
