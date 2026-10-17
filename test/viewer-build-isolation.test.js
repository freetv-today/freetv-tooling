import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import fsExtra from 'fs-extra';
import { runViewerBuild } from '../scripts/build-viewer.js';
import {
  inspectViewerDevelopmentData,
  installViewerDevelopmentData,
  isolateViewerDevelopmentDataFromBuild,
} from '../scripts/lib/viewer-development-data.js';
import { validateViewerDist, VIEWER_SPA_HTACCESS } from '../scripts/lib/production-assembly.js';

const DEVELOPMENT_ENTRIES = [
  'config.json',
  'playlists',
  'thumbs',
  '.freetv-tooling-development-data.json',
];

function write(target, contents) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
}

function createFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'freetv-viewer-build-isolation-'));
  const toolingRoot = path.join(root, 'freetv-tooling');
  const viewerRoot = path.join(root, 'freetv-viewer');
  const dataRoot = path.join(root, 'freetv-data');
  const publicRoot = path.join(viewerRoot, 'public');
  const distRoot = path.join(viewerRoot, 'dist');
  const config = { repos: { viewer: '../freetv-viewer', data: '../freetv-data' } };

  fs.mkdirSync(toolingRoot);
  fs.mkdirSync(publicRoot, { recursive: true });
  write(path.join(dataRoot, 'config.json'), '{"source":"development"}\n');
  write(path.join(dataRoot, 'playlists/index.json'), '{"playlists":["fixture"]}\n');
  write(path.join(dataRoot, 'playlists/fixture.json'), '{"name":"Fixture"}\n');
  write(path.join(dataRoot, 'thumbs/fixture/poster.jpg'), 'development thumbnail');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, toolingRoot, viewerRoot, dataRoot, publicRoot, distRoot, config };
}

function createApplicationBuild(distRoot) {
  fs.rmSync(distRoot, { recursive: true, force: true });
  write(path.join(distRoot, '.htaccess'), VIEWER_SPA_HTACCESS);
  write(path.join(distRoot, 'index.html'), '<!doctype html>');
  write(path.join(distRoot, 'assets/viewer.js'), 'export {};');
  write(path.join(distRoot, 'assets/viewer.css'), 'body {}');
  write(path.join(distRoot, 'freetv-small.png'), 'small logo');
  write(path.join(distRoot, 'freetv.png'), 'logo');
  write(path.join(distRoot, 'whitelabel.config.json'), '{}');
  write(path.join(distRoot, 'service-worker.js'), '/* service worker */');
}

function simulateVitePublicCopy({ publicRoot, distRoot }) {
  for (const name of fs.readdirSync(publicRoot)) {
    fs.cpSync(path.join(publicRoot, name), path.join(distRoot, name), { recursive: true });
  }
}

function snapshot(root) {
  const entries = [];
  function visit(current, relative = '') {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const childRelative = path.join(relative, entry.name);
      const child = path.join(current, entry.name);
      entries.push(entry.isDirectory()
        ? `directory:${childRelative}`
        : `file:${childRelative}:${fs.readFileSync(child, 'utf8')}`);
      if (entry.isDirectory()) visit(child, childRelative);
    }
  }
  visit(root);
  return entries;
}

test('Viewer build without installed development data is unchanged and assembly-valid', (t) => {
  const fixture = createFixture(t);
  createApplicationBuild(fixture.distRoot);
  const before = snapshot(fixture.distRoot);

  const result = isolateViewerDevelopmentDataFromBuild(fixture);

  assert.equal(result.isolated, false);
  assert.deepEqual(snapshot(fixture.distRoot), before);
  assert.doesNotThrow(() => validateViewerDist(fixture.distRoot));
});

test('matching Tooling-managed copies are excluded while public data and normal assets remain intact', async (t) => {
  const fixture = createFixture(t);
  await installViewerDevelopmentData(fixture);
  const publicBefore = snapshot(fixture.publicRoot);

  await runViewerBuild({
    ...fixture,
    commandRunner: async () => {
      createApplicationBuild(fixture.distRoot);
      simulateVitePublicCopy(fixture);
      return { kind: 'success', exitCode: 0, signal: null };
    },
    logger: { log() {} },
  });

  for (const name of DEVELOPMENT_ENTRIES) {
    assert.equal(fs.existsSync(path.join(fixture.distRoot, name)), false);
    assert.equal(fs.existsSync(path.join(fixture.publicRoot, name)), true);
  }
  assert.deepEqual(snapshot(fixture.publicRoot), publicBefore);
  assert.equal(inspectViewerDevelopmentData(fixture).state, 'ready');
  assert.equal(fs.readFileSync(path.join(fixture.distRoot, 'assets/viewer.js'), 'utf8'), 'export {};');
  assert.doesNotThrow(() => validateViewerDist(fixture.distRoot));
});

test('partial and unmarked public installations are refused before build output changes', async (t) => {
  const partial = createFixture(t);
  await installViewerDevelopmentData(partial);
  fs.rmSync(path.join(partial.publicRoot, 'thumbs'), { recursive: true });
  createApplicationBuild(partial.distRoot);
  simulateVitePublicCopy(partial);
  const partialBefore = snapshot(partial.distRoot);

  assert.throws(
    () => isolateViewerDevelopmentDataFromBuild(partial),
    /Tooling-managed Viewer development data is incomplete/u,
  );
  assert.deepEqual(snapshot(partial.distRoot), partialBefore);

  const unmarked = createFixture(t);
  write(path.join(unmarked.publicRoot, 'config.json'), '{}');
  write(path.join(unmarked.publicRoot, 'playlists/index.json'), '{}');
  write(path.join(unmarked.publicRoot, 'thumbs/poster.jpg'), 'unmarked');
  createApplicationBuild(unmarked.distRoot);
  simulateVitePublicCopy(unmarked);
  const unmarkedBefore = snapshot(unmarked.distRoot);

  assert.throws(
    () => isolateViewerDevelopmentDataFromBuild(unmarked),
    /Existing Viewer development data is unmarked/u,
  );
  assert.deepEqual(snapshot(unmarked.distRoot), unmarkedBefore);
});

test('unsafe or mismatched generated entries are refused without touching protected content', async (t) => {
  const fixture = createFixture(t);
  await installViewerDevelopmentData(fixture);
  createApplicationBuild(fixture.distRoot);
  simulateVitePublicCopy(fixture);
  const protectedPath = path.join(fixture.root, 'protected-thumbs');
  write(path.join(protectedPath, 'keep.jpg'), 'protected');
  fs.rmSync(path.join(fixture.distRoot, 'thumbs'), { recursive: true });
  fs.symlinkSync(protectedPath, path.join(fixture.distRoot, 'thumbs'));

  assert.throws(
    () => isolateViewerDevelopmentDataFromBuild(fixture),
    /must not be a symbolic link/u,
  );
  assert.equal(fs.readFileSync(path.join(protectedPath, 'keep.jpg'), 'utf8'), 'protected');
  assert.equal(fs.existsSync(path.join(fixture.distRoot, 'config.json')), true);

  fs.unlinkSync(path.join(fixture.distRoot, 'thumbs'));
  fs.cpSync(path.join(fixture.publicRoot, 'thumbs'), path.join(fixture.distRoot, 'thumbs'), { recursive: true });
  write(path.join(fixture.distRoot, 'config.json'), '{"unknown":"content"}\n');
  assert.throws(
    () => isolateViewerDevelopmentDataFromBuild(fixture),
    /does not match its Tooling-managed source/u,
  );
  assert.equal(fs.existsSync(path.join(fixture.distRoot, 'playlists')), true);
});

test('unexpected empty generated directories fail validation before any artifact is removed', async (t) => {
  const fixture = createFixture(t);
  await installViewerDevelopmentData(fixture);
  const publicBefore = snapshot(fixture.publicRoot);
  createApplicationBuild(fixture.distRoot);
  simulateVitePublicCopy(fixture);
  fs.mkdirSync(path.join(fixture.distRoot, 'playlists/unexpected-empty-directory'));
  const distBefore = snapshot(fixture.distRoot);

  assert.throws(
    () => isolateViewerDevelopmentDataFromBuild(fixture),
    /does not match its Tooling-managed source/u,
  );
  assert.deepEqual(snapshot(fixture.distRoot), distBefore);
  assert.deepEqual(snapshot(fixture.publicRoot), publicBefore);
  for (const name of DEVELOPMENT_ENTRIES) {
    assert.equal(fs.existsSync(path.join(fixture.distRoot, name)), true);
  }
});

test('matching legitimate empty directories survive installation and compare successfully', async (t) => {
  const fixture = createFixture(t);
  fs.mkdirSync(path.join(fixture.dataRoot, 'playlists/intentionally-empty'));

  await installViewerDevelopmentData(fixture);
  assert.equal(fs.statSync(path.join(fixture.publicRoot, 'playlists/intentionally-empty')).isDirectory(), true);
  createApplicationBuild(fixture.distRoot);
  simulateVitePublicCopy(fixture);

  assert.equal(isolateViewerDevelopmentDataFromBuild(fixture).isolated, true);
  assert.equal(fs.existsSync(path.join(fixture.distRoot, 'playlists')), false);
  assert.equal(fs.statSync(path.join(fixture.publicRoot, 'playlists/intentionally-empty')).isDirectory(), true);
  assert.equal(inspectViewerDevelopmentData(fixture).state, 'ready');
});

test('unrelated unexpected Viewer output remains subject to strict assembly rejection', async (t) => {
  const fixture = createFixture(t);
  await installViewerDevelopmentData(fixture);
  createApplicationBuild(fixture.distRoot);
  simulateVitePublicCopy(fixture);
  write(path.join(fixture.distRoot, 'unexpected.txt'), 'must be rejected');

  isolateViewerDevelopmentDataFromBuild(fixture);

  assert.throws(
    () => validateViewerDist(fixture.distRoot),
    /unexpected root entries: unexpected\.txt/u,
  );
});

test('failed Viewer build propagates without attempting development-data isolation', async () => {
  const failure = new Error('injected Vite failure');
  let isolationCalls = 0;

  await assert.rejects(
    runViewerBuild({
      toolingRoot: '/synthetic/tooling',
      config: { repos: { viewer: '../viewer' } },
      commandRunner: async () => { throw failure; },
      developmentDataIsolator: () => { isolationCalls += 1; },
      logger: { log() {} },
    }),
    (error) => error === failure,
  );
  assert.equal(isolationCalls, 0);
});

test('consecutive builds isolate generated copies without changing installed development data', async (t) => {
  const fixture = createFixture(t);
  await installViewerDevelopmentData(fixture);
  const publicBefore = snapshot(fixture.publicRoot);

  for (let build = 0; build < 2; build += 1) {
    createApplicationBuild(fixture.distRoot);
    simulateVitePublicCopy(fixture);
    assert.equal(isolateViewerDevelopmentDataFromBuild(fixture).isolated, true);
    assert.doesNotThrow(() => validateViewerDist(fixture.distRoot));
    assert.deepEqual(snapshot(fixture.publicRoot), publicBefore);
  }
});

test('cleanup failure reports potentially partial generated output and never alters public data', async (t) => {
  const fixture = createFixture(t);
  await installViewerDevelopmentData(fixture);
  const publicBefore = snapshot(fixture.publicRoot);
  createApplicationBuild(fixture.distRoot);
  simulateVitePublicCopy(fixture);
  const failingFileSystem = new Proxy(fsExtra, {
    get(target, property) {
      if (property === 'removeSync') {
        return (removedPath) => {
          if (removedPath === path.join(fixture.distRoot, 'playlists')) {
            throw new Error('injected generated cleanup failure');
          }
          return target.removeSync(removedPath);
        };
      }
      const value = target[property];
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });

  assert.throws(
    () => isolateViewerDevelopmentDataFromBuild({ ...fixture, fileSystem: failingFileSystem }),
    /generated output may be partially cleaned and must not be assembled.*injected generated cleanup failure/u,
  );
  assert.deepEqual(snapshot(fixture.publicRoot), publicBefore);
  assert.equal(fs.existsSync(path.join(fixture.publicRoot, '.freetv-tooling-development-data.json')), true);
});
