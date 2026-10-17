import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { runInteractiveCli } from '../cli/menu.js';
import {
  runCompleteProductionBuild,
  runDatasetAction,
  runProductionAction,
  resolveNpmCliPath,
} from '../cli/workflow-actions.js';
import { runStageExportsCli } from '../scripts/build-data.js';

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

function workflowOperations(calls, statuses = {}) {
  const operation = (name) => async (options) => {
    calls.push([name, options]);
    if (statuses[name] instanceof Error) throw statuses[name];
    return statuses[name] ?? 0;
  };
  return {
    runCompleteProductionBuild: operation('complete'),
    runStageExportsCli: operation('stage'),
    runAssembleCli: operation('assemble'),
    runVerifyCli: operation('verify'),
    runDataValidationCli: operation('validate'),
    runContentCompareCli: operation('compare'),
    runDataPublishCli: operation('publish'),
    runReleaseBuildCli: operation('release'),
  };
}

function existingFiles(...files) {
  return {
    statSync(target) {
      if (files.includes(target)) return { isFile: () => true };
      const error = new Error(`missing: ${target}`);
      error.code = 'ENOENT';
      throw error;
    },
  };
}

test('complete production build invokes npm JavaScript through Node on every platform', async () => {
  for (const platform of ['linux', 'darwin', 'win32']) {
    const invocations = [];
    const npmCliPath = platform === 'win32'
      ? 'C:\\Program Files\\npm install\\npm-cli.js'
      : '/Program Files/npm install/npm-cli.js';
    const nodeExecutable = platform === 'win32'
      ? 'C:\\Program Files\\node\\node.exe'
      : '/Program Files/node/node';
    const environment = { npm_execpath: npmCliPath, FIXTURE: 'value' };
    assert.equal(await runCompleteProductionBuild({
      toolingRoot: '/tooling', platform, environment, nodeExecutable,
      fileSystem: existingFiles(npmCliPath),
      commandRunner: async (options) => { invocations.push(options); },
    }), 0);
    assert.deepEqual(invocations, [{
      executable: nodeExecutable,
      args: [npmCliPath, 'run', 'build:all'],
      cwd: '/tooling', env: environment, stdio: 'inherit',
    }]);
    assert.notEqual(invocations[0].executable, 'npm.cmd');
  }
});

test('direct invocation resolves portable Node-install-relative npm CLI candidates', () => {
  const windowsNode = 'C:\\Node Runtime\\node.exe';
  const windowsCandidate = path.win32.join(
    path.win32.dirname(windowsNode), 'node_modules', 'npm', 'bin', 'npm-cli.js',
  );
  assert.equal(resolveNpmCliPath({
    environment: {}, nodeExecutable: windowsNode, platform: 'win32',
    fileSystem: existingFiles(windowsCandidate),
  }), windowsCandidate);

  for (const platform of ['linux', 'darwin']) {
    const nodeExecutable = '/opt/node/bin/node';
    const candidate = '/opt/node/lib/node_modules/npm/bin/npm-cli.js';
    assert.equal(resolveNpmCliPath({
      environment: {}, nodeExecutable, platform, fileSystem: existingFiles(candidate),
    }), candidate);
  }
});

test('npm CLI resolution and command execution failures remain explicit failures', async () => {
  assert.throws(() => resolveNpmCliPath({
    environment: {}, nodeExecutable: '/missing/node', platform: 'linux', fileSystem: existingFiles(),
  }), /Could not resolve npm's JavaScript CLI entry point.*npm-cli\.js/u);

  const npmCliPath = '/npm/npm-cli.js';
  for (const error of [new Error('exit fixture'), new Error('launch fixture')]) {
    await assert.rejects(runCompleteProductionBuild({
      environment: { npm_execpath: npmCliPath }, nodeExecutable: '/node',
      fileSystem: existingFiles(npmCliPath), commandRunner: async () => { throw error; },
    }), (actual) => actual === error);
  }
});

test('canonical complete build retains build:all and its postbuild lifecycle script', () => {
  const packageMetadata = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(packageMetadata.scripts['postbuild:all'], 'node scripts/build-complete.js');
  assert.match(packageMetadata.scripts['build:all'], /build:viewer.*build:admin.*stage:exports.*assemble.*verify/u);
});

test('staging entry point is import-safe, delegates once, and reports failure status', async () => {
  const calls = [];
  const logger = { log() {}, error: (message) => calls.push(['error', message]) };
  assert.equal(await runStageExportsCli({
    toolingRoot: '/tooling', configLoader: () => ({ staging: {} }), logger,
    stager: async (options) => { calls.push(['stage', options.toolingRoot, options.config]); },
  }), 0);
  assert.deepEqual(calls, [['stage', '/tooling', { staging: {} }]]);

  assert.equal(await runStageExportsCli({
    logger, configLoader: () => ({}), stager: async () => { throw new Error('stage fixture'); },
  }), 1);
  assert.match(calls.at(-1)[1], /Admin export staging failed: stage fixture/u);
});

test('production submenu confirms mutations, runs verification directly, and accumulates failure', async () => {
  const calls = [];
  const prompts = promptFixture([
    'build-production', 'complete', true, 'stage', true, 'assemble', true,
    'verify', 'back', 'exit',
  ]);
  const status = await runInteractiveCli({
    applicationName: 'FreeTV Tooling', version: '1.0.0', prompts,
    operations: workflowOperations(calls, { assemble: 1 }),
  });
  assert.equal(status, 1);
  assert.deepEqual(calls.map(([name]) => name), ['complete', 'stage', 'assemble', 'verify']);
  assert.equal(prompts.events.filter(([kind]) => kind === 'confirm').length, 3);
  assert.equal(prompts.events.filter(([kind]) => kind === 'success').length, 3);
  assert.match(prompts.events.find(([kind]) => kind === 'error')[1], /Assemble Production Output failed/u);
});

test('declined and cancelled production confirmations launch nothing', async () => {
  for (const confirmation of [false, CANCEL]) {
    const calls = [];
    const prompts = promptFixture(confirmation === false
      ? ['build-production', 'complete', false, 'back', 'exit']
      : ['build-production', 'complete', CANCEL]);
    assert.equal(await runInteractiveCli({
      applicationName: 'FreeTV Tooling', version: '1.0.0', prompts,
      operations: workflowOperations(calls),
    }), 0);
    assert.deepEqual(calls, []);
  }
});

test('dataset validation and comparison preserve an exact snapshot path including spaces', async () => {
  const calls = [];
  const snapshotPath = '/tmp/My Snapshot.zip';
  const prompts = promptFixture(['dataset', 'validate', 'compare', snapshotPath, 'back', 'exit']);
  assert.equal(await runInteractiveCli({
    applicationName: 'FreeTV Tooling', version: '1.0.0', prompts,
    operations: workflowOperations(calls),
  }), 0);
  assert.deepEqual(calls, [
    ['validate', undefined],
    ['compare', { args: [snapshotPath] }],
  ]);
  assert.equal(prompts.events.some(([kind]) => kind === 'confirm'), false);
});

test('publication receives one explicit snapshot argument after a default-No confirmation', async () => {
  const calls = [];
  const snapshotPath = 'C:\\Data Sets\\snapshot.zip';
  const prompts = promptFixture(['dataset', 'publish', snapshotPath, true, 'back', 'exit']);
  assert.equal(await runInteractiveCli({
    applicationName: 'FreeTV Tooling', version: '1.0.0', prompts,
    operations: workflowOperations(calls),
  }), 0);
  assert.deepEqual(calls, [['publish', { args: [`--snapshot=${snapshotPath}`] }]]);
  const confirmation = prompts.events.find(([kind]) => kind === 'confirm');
  assert.equal(confirmation[1].initialValue, false);
  assert.match(prompts.events.find(([kind, title]) => kind === 'note' && title === 'Publish Snapshot')[2],
    /local freetv-data.*does not update the live website/su);
});

test('missing or cancelled snapshot input and declined publication invoke nothing', async () => {
  for (const selections of [
    ['dataset', 'compare', '', 'back', 'exit'],
    ['dataset', 'compare', CANCEL],
    ['dataset', 'publish', '/snapshot.zip', false, 'back', 'exit'],
  ]) {
    const calls = [];
    assert.equal(await runInteractiveCli({
      applicationName: 'FreeTV Tooling', version: '1.0.0',
      prompts: promptFixture([...selections]), operations: workflowOperations(calls),
    }), 0);
    assert.deepEqual(calls, []);
  }
});

test('release confirmation is default-No and failures never report success', async () => {
  const calls = [];
  const prompts = promptFixture(['dataset', 'release', true, 'back', 'exit']);
  assert.equal(await runInteractiveCli({
    applicationName: 'FreeTV Tooling', version: '1.0.0', prompts,
    operations: workflowOperations(calls, { release: 1 }),
  }), 1);
  assert.deepEqual(calls.map(([name]) => name), ['release']);
  assert.equal(prompts.events.find(([kind]) => kind === 'confirm')[1].initialValue, false);
  assert.equal(prompts.events.some(([kind]) => kind === 'success'), false);
  assert.match(prompts.events.find(([kind]) => kind === 'error')[1], /Build Release Packages failed/u);
});

test('operation dispatch remains sequential and does not resume prompts before completion', async () => {
  let finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  const calls = [];
  const prompts = promptFixture(['build-production', 'verify', 'back', 'exit']);
  const running = runInteractiveCli({
    applicationName: 'FreeTV Tooling', version: '1.0.0', prompts,
    operations: { runVerifyCli: async () => { calls.push('verify-start'); await pending; calls.push('verify-end'); return 0; } },
  });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(prompts.events.filter(([kind]) => kind === 'select').length, 2);
  finish();
  assert.equal(await running, 0);
  assert.deepEqual(calls, ['verify-start', 'verify-end']);
});

test('action adapters preserve thrown errors and numeric partial-failure statuses', async () => {
  const errors = [];
  const successes = [];
  assert.equal(await runProductionAction('complete', {
    operations: { runCompleteProductionBuild: async () => { throw new Error('launch fixture'); } },
    presentation: { error: (message) => errors.push(message), success: (message) => successes.push(message) },
  }), 1);
  assert.equal(await runDatasetAction('publish', {
    snapshotPath: '/snapshot', operations: { runDataPublishCli: async () => 1 },
    presentation: { error: (message) => errors.push(message), success: (message) => successes.push(message) },
  }), 1);
  assert.match(errors.join('\n'), /launch fixture.*review the operation diagnostics/su);
  assert.deepEqual(successes, []);
});
