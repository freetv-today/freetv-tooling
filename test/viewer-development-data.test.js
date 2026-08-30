import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  cleanViewerDevelopmentData,
  installViewerDevelopmentData,
} from '../scripts/lib/viewer-development-data.js';

function write(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'freetv-viewer-data-'));
  const toolingRoot = path.join(root, 'tooling');
  const dataRoot = path.join(root, 'data-repository');
  const viewerRoot = path.join(root, 'viewer-repository');
  const publicRoot = path.join(viewerRoot, 'public');

  fs.mkdirSync(path.join(toolingRoot, 'config'), { recursive: true });
  fs.mkdirSync(publicRoot, { recursive: true });
  fs.writeFileSync(path.join(toolingRoot, 'config/paths.json'), JSON.stringify({
    repos: {
      data: '../data-repository',
      viewer: '../viewer-repository',
    },
  }));

  write(path.join(dataRoot, 'config.json'), '{"snapshot":"current"}\n');
  write(path.join(dataRoot, 'playlists/index.json'), '{"playlists":["featured"]}\n');
  write(path.join(dataRoot, 'playlists/featured.json'), '{"name":"Featured"}\n');
  write(path.join(dataRoot, 'thumbs/featured/poster.jpg'), 'thumbnail');

  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  return { dataRoot, publicRoot, toolingRoot, viewerRoot };
}

function treeSnapshot(root) {
  const entries = [];
  function visit(current, relativeRoot = '') {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const relativePath = path.join(relativeRoot, entry.name);
      const absolutePath = path.join(current, entry.name);
      entries.push(entry.isDirectory()
        ? `directory:${relativePath}`
        : `file:${relativePath}:${fs.readFileSync(absolutePath, 'utf8')}`);
      if (entry.isDirectory()) visit(absolutePath, relativePath);
    }
  }
  visit(root);
  return entries;
}

test('install copies all three configured Data artifacts into Viewer public', async (t) => {
  const expected = fixture(t);

  await installViewerDevelopmentData({ toolingRoot: expected.toolingRoot });

  assert.equal(
    fs.readFileSync(path.join(expected.publicRoot, 'config.json'), 'utf8'),
    fs.readFileSync(path.join(expected.dataRoot, 'config.json'), 'utf8'),
  );
  assert.deepEqual(
    treeSnapshot(path.join(expected.publicRoot, 'playlists')),
    treeSnapshot(path.join(expected.dataRoot, 'playlists')),
  );
  assert.deepEqual(
    treeSnapshot(path.join(expected.publicRoot, 'thumbs')),
    treeSnapshot(path.join(expected.dataRoot, 'thumbs')),
  );
});

test('a second install replaces corrupt, missing, and stale destination content', async (t) => {
  const expected = fixture(t);
  await installViewerDevelopmentData({ toolingRoot: expected.toolingRoot });

  write(path.join(expected.publicRoot, 'config.json'), 'corrupt');
  fs.rmSync(path.join(expected.publicRoot, 'playlists/featured.json'));
  write(path.join(expected.publicRoot, 'playlists/stale.json'), 'stale');
  write(path.join(expected.publicRoot, 'thumbs/stale/extra.jpg'), 'stale');

  await installViewerDevelopmentData({ toolingRoot: expected.toolingRoot });

  assert.equal(
    fs.readFileSync(path.join(expected.publicRoot, 'config.json'), 'utf8'),
    fs.readFileSync(path.join(expected.dataRoot, 'config.json'), 'utf8'),
  );
  assert.deepEqual(
    treeSnapshot(path.join(expected.publicRoot, 'playlists')),
    treeSnapshot(path.join(expected.dataRoot, 'playlists')),
  );
  assert.deepEqual(
    treeSnapshot(path.join(expected.publicRoot, 'thumbs')),
    treeSnapshot(path.join(expected.dataRoot, 'thumbs')),
  );
});

test('clean removes only the three managed Viewer destinations and is repeatable', async (t) => {
  const expected = fixture(t);
  write(path.join(expected.publicRoot, 'index.html'), '<main>keep</main>');
  write(path.join(expected.publicRoot, 'assets/app.js'), 'keep');
  await installViewerDevelopmentData({ toolingRoot: expected.toolingRoot });

  await cleanViewerDevelopmentData({ toolingRoot: expected.toolingRoot });
  await cleanViewerDevelopmentData({ toolingRoot: expected.toolingRoot });

  for (const name of ['config.json', 'playlists', 'thumbs']) {
    assert.equal(fs.existsSync(path.join(expected.publicRoot, name)), false);
  }
  assert.equal(fs.readFileSync(path.join(expected.publicRoot, 'index.html'), 'utf8'), '<main>keep</main>');
  assert.equal(fs.readFileSync(path.join(expected.publicRoot, 'assets/app.js'), 'utf8'), 'keep');
  assert.equal(fs.existsSync(expected.publicRoot), true);
});

test('missing required source data fails before existing Viewer data is altered', async (t) => {
  const expected = fixture(t);
  write(path.join(expected.publicRoot, 'config.json'), 'existing-config');
  write(path.join(expected.publicRoot, 'playlists/existing.json'), 'existing-playlist');
  write(path.join(expected.publicRoot, 'thumbs/existing.jpg'), 'existing-thumbnail');
  const before = treeSnapshot(expected.publicRoot);
  fs.rmSync(path.join(expected.dataRoot, 'thumbs'), { recursive: true });

  await assert.rejects(
    installViewerDevelopmentData({ toolingRoot: expected.toolingRoot }),
    /FreeTV Data thumbs is missing/u,
  );
  assert.deepEqual(treeSnapshot(expected.publicRoot), before);
});

test('unsafe configured Viewer destination is rejected without deletion', async (t) => {
  const expected = fixture(t);
  const toolingPublic = path.join(expected.toolingRoot, 'public');
  write(path.join(toolingPublic, 'config.json'), 'must-stay');
  fs.writeFileSync(path.join(expected.toolingRoot, 'config/paths.json'), JSON.stringify({
    repos: { data: '../data-repository', viewer: '.' },
  }));

  await assert.rejects(
    cleanViewerDevelopmentData({ toolingRoot: expected.toolingRoot }),
    /config\.repos\.viewer must not resolve to the Tooling root/u,
  );
  assert.equal(fs.readFileSync(path.join(toolingPublic, 'config.json'), 'utf8'), 'must-stay');
});

