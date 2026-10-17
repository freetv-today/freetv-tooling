import assert from 'node:assert/strict';
import test from 'node:test';
import { runBuildAction, runDiagnosticAction } from '../cli/actions.js';
import { runCli } from '../cli/index.js';
import {
  BUILD_MENU_OPTIONS,
  CLEANUP_MENU_OPTIONS,
  DATASET_MENU_OPTIONS,
  DEVELOPMENT_MENU_OPTIONS,
  DIAGNOSTICS_MENU_OPTIONS,
  MAIN_MENU_OPTIONS,
  PRODUCTION_MENU_OPTIONS,
  runInteractiveCli,
} from '../cli/menu.js';

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

function operations(calls, statuses = {}) {
  return {
    runStatusCli: async () => { calls.push('status'); return statuses.status ?? 0; },
    runVerifyCli: async () => { calls.push('verify'); return statuses.verify ?? 0; },
    runDataValidationCli: async () => { calls.push('validate'); return statuses.validate ?? 0; },
    runViewerBuild: async () => {
      calls.push('viewer-build');
      if (statuses.viewerBuild instanceof Error) throw statuses.viewerBuild;
    },
    runAdminBuild: async () => {
      calls.push('admin-build');
      if (statuses.adminBuild instanceof Error) throw statuses.adminBuild;
    },
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
  assert.deepEqual(DEVELOPMENT_MENU_OPTIONS.map(({ value }) => value), ['all', 'viewer', 'admin', 'back']);
  assert.deepEqual(BUILD_MENU_OPTIONS.map(({ value }) => value), ['viewer', 'admin', 'both', 'back']);
  assert.deepEqual(PRODUCTION_MENU_OPTIONS.map(({ value }) => value), [
    'complete', 'stage', 'assemble', 'verify', 'back',
  ]);
  assert.deepEqual(DATASET_MENU_OPTIONS.map(({ value }) => value), [
    'validate', 'compare', 'publish', 'release', 'back',
  ]);
  assert.deepEqual(CLEANUP_MENU_OPTIONS.map(({ value }) => value), [
    'thumbs-dry-run', 'thumbs-apply', 'viewer-install', 'viewer-remove', 'back',
  ]);
  assert.doesNotMatch(MAIN_MENU_OPTIONS.find(({ value }) => value === 'dev').label, /Coming later/u);
  assert.doesNotMatch(MAIN_MENU_OPTIONS.find(({ value }) => value === 'build-local').label, /Coming later/u);
  assert.doesNotMatch(MAIN_MENU_OPTIONS.find(({ value }) => value === 'build-production').label, /Coming later/u);
  assert.doesNotMatch(MAIN_MENU_OPTIONS.find(({ value }) => value === 'dataset').label, /Coming later/u);
  assert.doesNotMatch(MAIN_MENU_OPTIONS.find(({ value }) => value === 'cleanup').label, /Coming later/u);
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

test('cleanup back navigation performs no operation', async () => {
  const calls = [];
  const prompts = promptFixture(['cleanup', 'back', 'cleanup', 'back', 'exit']);
  assert.equal(await runInteractiveCli({
    applicationName: 'FreeTV Tooling', version: '1.0.0', prompts, operations: operations(calls),
  }), 0);
  assert.deepEqual(calls, []);
  assert.equal(prompts.events.filter(([kind]) => kind === 'note').length, 1);
});

test('cancellation exits immediately without dispatching a later selection', async () => {
  for (const selections of [
    [CANCEL, 'diagnostics'], ['diagnostics', CANCEL, 'status'],
    ['dev', CANCEL, 'all'], ['build-local', CANCEL, 'viewer'],
  ]) {
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

test('development and build back navigation remains iterative and does not duplicate actions', async () => {
  const calls = [];
  const prompts = promptFixture([
    'dev', 'back', 'build-local', 'back', 'diagnostics', 'status', 'back',
    'dev', 'back', 'exit',
  ]);
  assert.equal(await runInteractiveCli({
    applicationName: 'FreeTV Tooling', version: '1.0.0', prompts, operations: operations(calls),
  }), 0);
  assert.deepEqual(calls, ['status']);
});

test('build menus dispatch Viewer, Admin, and Build Both exactly and sequentially', async () => {
  const calls = [];
  const prompts = promptFixture([
    'build-local', 'viewer', true, 'admin', true, 'both', true, 'back', 'exit',
  ]);
  assert.equal(await runInteractiveCli({
    applicationName: 'FreeTV Tooling', version: '1.0.0', prompts, operations: operations(calls),
  }), 0);
  assert.deepEqual(calls, ['viewer-build', 'admin-build', 'viewer-build', 'admin-build']);
  assert.equal(prompts.events.filter(([kind]) => kind === 'success').length, 3);
});

test('declined or cancelled build confirmation launches nothing', async () => {
  for (const confirmation of [false, CANCEL]) {
    const calls = [];
    const prompts = promptFixture(confirmation === false
      ? ['build-local', 'viewer', confirmation, 'back', 'exit']
      : ['build-local', 'viewer', confirmation]);
    assert.equal(await runInteractiveCli({
      applicationName: 'FreeTV Tooling', version: '1.0.0', prompts, operations: operations(calls),
    }), 0);
    assert.deepEqual(calls, []);
  }
});

test('Build Both is fail-fast and any Viewer or Admin error marks the action failed', async () => {
  for (const [statuses, expectedCalls] of [
    [{ viewerBuild: new Error('Viewer fixture') }, ['viewer-build']],
    [{ adminBuild: new Error('Admin fixture') }, ['viewer-build', 'admin-build']],
  ]) {
    const calls = [];
    const errors = [];
    assert.equal(await runBuildAction('both', {
      operations: operations(calls, statuses), presentation: { error: (message) => errors.push(message) },
    }), 1);
    assert.deepEqual(calls, expectedCalls);
    assert.match(errors[0], /Build Both failed: (Viewer|Admin) fixture/u);
  }
});

test('build success is presented only after the existing operation completes', async () => {
  let finishBuild;
  const completion = new Promise((resolve) => { finishBuild = resolve; });
  const events = [];
  const action = runBuildAction('viewer', {
    operations: { runViewerBuild: () => completion },
    presentation: { success: (message) => events.push(message) },
  });
  await Promise.resolve();
  assert.deepEqual(events, []);
  finishBuild();
  assert.equal(await action, 0);
  assert.equal(events.length, 1);
});

test('a development terminal launch failure is reported and menu navigation continues', async () => {
  const calls = [];
  const prompts = promptFixture(['dev', 'all', 'back', 'exit']);
  assert.equal(await runInteractiveCli({
    applicationName: 'FreeTV Tooling', version: '1.0.0', prompts,
    operations: {
      launchDevelopmentTerminal: async ({ selection }) => {
        calls.push(selection);
        throw new Error('terminal fixture');
      },
    },
  }), 1);
  assert.deepEqual(calls, ['all']);
  assert.match(prompts.events.find(([kind]) => kind === 'error')[1], /launch failed.*terminal fixture/u);
});

test('successful development launch returns immediately to its submenu', async () => {
  const calls = [];
  const prompts = promptFixture(['dev', 'viewer', 'back', 'exit']);
  assert.equal(await runInteractiveCli({
    applicationName: 'FreeTV Tooling', version: '1.0.0', prompts,
    operations: {
      launchDevelopmentTerminal: async ({ selection }) => { calls.push(selection); },
    },
  }), 0);
  assert.deepEqual(calls, ['viewer']);
  assert.equal(prompts.events.some(([kind, message]) => kind === 'success'
    && /launch requested/u.test(message)), true);
});

test('all three development menu choices pass the explicit service selection', async () => {
  const selections = [];
  const prompts = promptFixture([
    'dev', 'all', 'viewer', 'admin', 'back', 'exit',
  ]);
  assert.equal(await runInteractiveCli({
    applicationName: 'FreeTV Tooling', version: '1.0.0', prompts,
    operations: {
      launchDevelopmentTerminal: async ({ selection }) => { selections.push(selection); },
    },
  }), 0);
  assert.deepEqual(selections, ['all', 'viewer', 'admin']);
});

test('later development-terminal termination does not block or change Clack navigation', async () => {
  let resolveTermination;
  const termination = new Promise((resolve) => { resolveTermination = resolve; });
  const prompts = promptFixture(['dev', 'viewer', 'admin', 'back', 'exit']);
  const launches = [];

  const status = await runInteractiveCli({
    applicationName: 'FreeTV Tooling', version: '1.0.0', prompts,
    operations: {
      launchDevelopmentTerminal: async ({ selection }) => {
        launches.push(selection);
        return { termination };
      },
    },
  });

  assert.equal(status, 0);
  assert.deepEqual(launches, ['viewer', 'admin']);
  resolveTermination({ exitCode: 1 });
  await termination;
  assert.equal(prompts.events.at(-1)[0], 'outro');
});
