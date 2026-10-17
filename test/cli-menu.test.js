import assert from 'node:assert/strict';
import test from 'node:test';
import { runDiagnosticAction } from '../cli/actions.js';
import { runCli } from '../cli/index.js';
import { DIAGNOSTICS_MENU_OPTIONS, MAIN_MENU_OPTIONS, runInteractiveCli } from '../cli/menu.js';

const CANCEL = Symbol('cancel');

function promptFixture(selections) {
  const events = [];
  return {
    events,
    intro: (message) => events.push(['intro', message]),
    note: (message, title) => events.push(['note', title, message]),
    select: async (options) => { events.push(['select', options]); return selections.shift(); },
    isCancel: (value) => value === CANCEL,
    cancel: (message) => events.push(['cancel', message]),
    outro: (message) => events.push(['outro', message]),
    log: {
      success: (message) => events.push(['success', message]),
      error: (message) => events.push(['error', message]),
    },
  };
}

function operations(calls, statuses = {}) {
  return {
    runStatusCli: async () => { calls.push('status'); return statuses.status ?? 0; },
    runVerifyCli: async () => { calls.push('verify'); return statuses.verify ?? 0; },
    runDataValidationCli: async () => { calls.push('validate'); return statuses.validate ?? 0; },
  };
}

test('CLI modules are import-safe and expose the planned v1 navigation', () => {
  assert.equal(typeof runCli, 'function');
  assert.equal(typeof runInteractiveCli, 'function');
  assert.deepEqual(MAIN_MENU_OPTIONS.map(({ value }) => value), [
    'dev', 'build-local', 'build-production', 'dataset', 'cleanup', 'diagnostics', 'exit',
  ]);
  assert.deepEqual(DIAGNOSTICS_MENU_OPTIONS.map(({ value }) => value), [
    'status', 'verify', 'validate', 'back',
  ]);
});

test('diagnostics dispatches existing operations and reports only confirmed success', async () => {
  const calls = [];
  const prompts = promptFixture(['diagnostics', 'status', 'verify', 'validate', 'back', 'exit']);
  const status = await runInteractiveCli({
    applicationName: 'FreeTV Tooling', version: 'fixture-version', prompts,
    operations: operations(calls, { verify: 1 }),
  });

  assert.equal(status, 1);
  assert.deepEqual(calls, ['status', 'verify', 'validate']);
  assert.equal(prompts.events.filter(([kind]) => kind === 'success').length, 2);
  assert.match(prompts.events.find(([kind]) => kind === 'error')[1], /Verify Production Assembly failed/u);
  assert.deepEqual(prompts.events.slice(0, 2), [
    ['intro', 'FreeTV Tooling'], ['note', 'Version', 'fixture-version'],
  ]);
  assert.deepEqual(prompts.events.at(-1), ['outro', 'Goodbye!']);
});

test('future categories give information and never dispatch an operation', async () => {
  const calls = [];
  const prompts = promptFixture(['dev', 'build-local', 'build-production', 'dataset', 'cleanup', 'exit']);
  assert.equal(await runInteractiveCli({
    applicationName: 'FreeTV Tooling', version: '1.0.0', prompts, operations: operations(calls),
  }), 0);
  assert.deepEqual(calls, []);
  assert.equal(prompts.events.filter(([kind, title]) => kind === 'note' && title !== 'Version').length, 5);
});

test('cancellation exits immediately without dispatching a later selection', async () => {
  for (const selections of [[CANCEL, 'diagnostics'], ['diagnostics', CANCEL, 'status']]) {
    const calls = [];
    const prompts = promptFixture([...selections]);
    assert.equal(await runInteractiveCli({
      applicationName: 'FreeTV Tooling', version: '1.0.0', prompts, operations: operations(calls),
    }), 0);
    assert.deepEqual(calls, []);
    assert.equal(prompts.events.filter(([kind]) => kind === 'cancel').length, 1);
    assert.equal(prompts.events.some(([kind]) => kind === 'outro'), false);
  }
});

test('dispatch catches an unexpected operation error and preserves menu control', async () => {
  const messages = [];
  assert.equal(await runDiagnosticAction('status', {
    operations: { runStatusCli: () => { throw new Error('operation fixture'); } },
    presentation: { error: (message) => messages.push(message) },
  }), 1);
  assert.match(messages[0], /Tooling Status failed: operation fixture/u);
});
