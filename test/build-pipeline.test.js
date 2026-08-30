import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const toolingRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(toolingRoot, 'package.json'), 'utf8'));

test('data validation is an explicit standalone command', () => {
  assert.equal(packageJson.scripts['data:validate'], 'node scripts/data-validate.js');
  assert.doesNotMatch(packageJson.scripts['build:all'], /data:validate/u);
  assert.equal('data:publish' in packageJson.scripts, false);
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
