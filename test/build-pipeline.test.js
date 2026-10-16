import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runAdminBuild, runAdminBuildCli } from '../scripts/build-admin.js';
import { runViewerBuild, runViewerBuildCli } from '../scripts/build-viewer.js';
import { CommandExecutionError } from '../scripts/lib/command-runner.js';

const toolingRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(toolingRoot, 'package.json'), 'utf8'));

test('data validation and local publication are explicit standalone commands', () => {
  assert.equal(packageJson.scripts['data:validate'], 'node scripts/data-validate.js');
  assert.equal(packageJson.scripts['data:publish'], 'node scripts/data-publish.js');
  assert.doesNotMatch(packageJson.scripts['build:all'], /data:validate/u);
  assert.doesNotMatch(packageJson.scripts['build:all'], /data:publish/u);
});

test('build:all runs the accepted stages in exact order', () => {
  assert.equal(
    packageJson.scripts['build:all'],
    'npm run build:viewer && npm run build:admin && npm run stage:exports && npm run assemble && npm run verify',
  );
});

test('build:all is fail-fast and has no deployment stage', () => {
  const command = packageJson.scripts['build:all'];
  const stages = command.split(' && ');
  assert.deepEqual(stages, [
    'npm run build:viewer',
    'npm run build:admin',
    'npm run stage:exports',
    'npm run assemble',
    'npm run verify',
  ]);
  assert.doesNotMatch(command, /ftp|hostinger|scp|rsync|deploy|freetv-data/iu);
});

test('a failing early stage prevents later stages from running', () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'freetv-build-pipeline-'));
  const fakeBin = path.join(fixtureRoot, 'bin');
  const logPath = path.join(fixtureRoot, 'stages.log');
  const fakeNpm = path.join(fakeBin, 'npm');

  try {
    fs.mkdirSync(fakeBin);
    fs.writeFileSync(
      fakeNpm,
      '#!/bin/sh\nprintf \'%s\\n\' "$2" >> "$BUILD_PIPELINE_LOG"\n[ "$2" != "$BUILD_PIPELINE_FAIL" ]\n',
    );
    fs.chmodSync(fakeNpm, 0o755);

    const result = spawnSync(packageJson.scripts['build:all'], {
      cwd: fixtureRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        BUILD_PIPELINE_FAIL: 'build:admin',
        BUILD_PIPELINE_LOG: logPath,
        PATH: `${fakeBin}:${process.env.PATH}`,
      },
      shell: true,
    });

    assert.notEqual(result.status, 0);
    assert.deepEqual(fs.readFileSync(logPath, 'utf8').trim().split('\n'), [
      'build:viewer',
      'build:admin',
    ]);
  } finally {
    fs.rmSync(fixtureRoot, { force: true, recursive: true });
  }
});

test('successful build:all uses the local completion message', () => {
  assert.equal(packageJson.scripts['postbuild:all'], 'node scripts/build-complete.js');
  const completionScript = fs.readFileSync(path.join(toolingRoot, 'scripts/build-complete.js'), 'utf8');
  assert.match(completionScript, /config\.output\.root/u);
  assert.match(completionScript, /No deployment performed\./u);
  assert.doesNotMatch(completionScript, /\/home\//u);
});

test('Viewer and Admin build operations use exact commands, repositories, environment, and inherited output', async () => {
  const calls = [];
  const environment = { BUILD_FIXTURE: 'preserved' };
  const config = { repos: { viewer: '../viewer-fixture', admin: '../admin-fixture' } };
  const commandRunner = async (options) => {
    calls.push(options);
    return { kind: 'success', exitCode: 0, signal: null };
  };
  const logger = { log() {}, error() {} };

  const viewer = await runViewerBuild({
    toolingRoot: '/workspace/tooling', config, environment, commandRunner, logger,
  });
  const admin = await runAdminBuild({
    toolingRoot: '/workspace/tooling', config, environment, commandRunner, logger,
  });

  assert.deepEqual(calls, [
    {
      executable: 'npm', args: ['run', 'build'], cwd: '/workspace/viewer-fixture',
      env: environment, stdio: 'inherit', signal: undefined,
    },
    {
      executable: 'npm', args: ['run', 'build'], cwd: '/workspace/admin-fixture',
      env: environment, stdio: 'inherit', signal: undefined,
    },
  ]);
  assert.equal(viewer.repositoryRoot, '/workspace/viewer-fixture');
  assert.equal(admin.repositoryRoot, '/workspace/admin-fixture');
});

test('importing build wrappers does not run either build', () => {
  assert.equal(typeof runViewerBuild, 'function');
  assert.equal(typeof runAdminBuild, 'function');
});

test('standalone build wrappers preserve child exit status and distinguish launch failure', async () => {
  const logger = { log() {}, error() {} };
  const config = { repos: { viewer: '../viewer', admin: '../admin' } };
  const failed = new CommandExecutionError('build failed', {
    kind: 'exit', exitCode: 9, signal: null,
  });
  const launch = new CommandExecutionError('launch failed', {
    kind: 'spawn', exitCode: null, signal: null,
  });
  assert.equal(await runViewerBuildCli({
    toolingRoot: '/workspace/tooling', config, logger,
    commandRunner: async () => { throw failed; },
  }), 9);
  assert.equal(await runAdminBuildCli({
    toolingRoot: '/workspace/tooling', config, logger,
    commandRunner: async () => { throw launch; },
  }), 1);
});
