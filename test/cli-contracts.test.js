import assert from 'node:assert/strict';
import test from 'node:test';
import { runAssembleCli } from '../scripts/assemble.js';
import { runContentCompareCli } from '../scripts/content-compare.js';
import { runViewerDataCleanCli } from '../scripts/dev-clean-viewer-data.js';
import { runViewerDataInstallCli } from '../scripts/dev-install-viewer-data.js';
import { runStatusCli } from '../scripts/status.js';
import { runVerifyCli } from '../scripts/verify.js';

function logger() {
  const lines = [];
  return { lines, log: (line) => lines.push(String(line)), error: (line) => lines.push(String(line)) };
}

test('remaining command modules are import-safe and expose callable contracts', () => {
  for (const command of [
    runAssembleCli, runContentCompareCli, runViewerDataCleanCli,
    runViewerDataInstallCli, runStatusCli, runVerifyCli,
  ]) assert.equal(typeof command, 'function');
});

test('content comparison requires exactly one snapshot and reports operation failures', () => {
  const output = logger();
  assert.equal(runContentCompareCli({ args: [], logger: output }), 1);
  assert.match(output.lines.join('\n'), /Usage:/);
  assert.equal(runContentCompareCli({
    args: ['/snapshot'], toolingRoot: '/tooling', logger: output,
    configLoader: () => ({ repos: { data: '../data' } }),
    comparator: () => { throw new Error('comparison fixture'); },
  }), 1);
  assert.match(output.lines.join('\n'), /comparison fixture/);
});

test('status is read-only and returns explicit success and failure codes', () => {
  const output = logger();
  assert.equal(runStatusCli({
    toolingRoot: '/tooling', logger: output,
    configLoader: () => ({ repos: { viewer: '../viewer' }, output: { root: '../production' } }),
    fileSystem: { existsSync: () => true },
  }), 0);
  assert.equal(runStatusCli({ logger: output, configLoader: () => { throw new Error('status fixture'); } }), 1);
});

test('verify and assemble report success only after their operation succeeds', () => {
  const output = logger();
  const configLoader = () => ({});
  assert.equal(runVerifyCli({
    configLoader, logger: output,
    verifier: () => ({
      application: { packageFileCount: 1 }, api: { phpFileCount: 2 },
      viewer: { assetCount: 3, staticReferenceCount: 4 },
      admin: { assetCount: 5, staticReferenceCount: 6 },
      data: { playlistCount: 7, showCount: 8 }, thumbnails: { fileCount: 9, totalBytes: 10 },
    }),
  }), 0);
  assert.equal(runAssembleCli({
    configLoader, logger: output, assembler: () => { throw new Error('assembly fixture'); },
  }), 1);
  assert.doesNotMatch(output.lines.at(-1), /complete/);
});

test('Viewer development-data standalone contracts return status without running on import', async () => {
  const output = logger();
  assert.equal(await runViewerDataInstallCli({
    logger: output, installer: async () => ({ dataRoot: '/data', publicRoot: '/viewer/public' }),
  }), 0);
  assert.equal(await runViewerDataCleanCli({
    logger: output, cleaner: async () => { throw new Error('cleanup fixture'); },
  }), 1);
});
