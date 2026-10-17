import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import fsExtra from 'fs-extra';
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
  return { root, dataRoot, publicRoot, toolingRoot, viewerRoot };
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

function installedSnapshot(publicRoot) {
  return {
    config: fs.readFileSync(path.join(publicRoot, 'config.json'), 'utf8'),
    playlists: treeSnapshot(path.join(publicRoot, 'playlists')),
    thumbs: treeSnapshot(path.join(publicRoot, 'thumbs')),
    marker: fs.readFileSync(path.join(publicRoot, '.freetv-tooling-development-data.json'), 'utf8'),
  };
}

function withTransactionCleanupFailure(transactionRoot) {
  return new Proxy(fsExtra, {
    get(target, property) {
      if (property === 'removeSync') {
        return (removedPath) => {
          if (removedPath === transactionRoot) {
            const [firstEntry] = target.readdirSync(transactionRoot);
            if (firstEntry) target.removeSync(path.join(transactionRoot, firstEntry));
            throw new Error('injected transaction cleanup failure');
          }
          return target.removeSync(removedPath);
        };
      }
      const value = target[property];
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
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
  assert.equal(fs.existsSync(path.join(expected.publicRoot, '.freetv-tooling-development-data.json')), true);
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
  assert.equal(fs.existsSync(path.join(expected.publicRoot, '.freetv-tooling-development-data.json')), false);
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

test('mid-copy preparation failure preserves an owned previous installation', async (t) => {
  const expected = fixture(t);
  await installViewerDevelopmentData({ toolingRoot: expected.toolingRoot, runId: '111111111111' });
  const before = treeSnapshot(expected.publicRoot);
  let copied = 0;
  await assert.rejects(installViewerDevelopmentData({
    toolingRoot: expected.toolingRoot,
    runId: '222222222222',
    transactionHooks: { afterCandidateCopy() { if (++copied === 2) throw new Error('copy fixture'); } },
  }), /Could not prepare.*previous installation is intact.*copy fixture/su);
  assert.deepEqual(treeSnapshot(expected.publicRoot), before);
});

test('promotion failure restores the previous owned installation', async (t) => {
  const expected = fixture(t);
  await installViewerDevelopmentData({ toolingRoot: expected.toolingRoot, runId: '333333333333' });
  const before = treeSnapshot(expected.publicRoot);
  await assert.rejects(installViewerDevelopmentData({
    toolingRoot: expected.toolingRoot,
    runId: '444444444444',
    transactionHooks: { beforePromotion({ name }) { if (name === 'playlists') throw new Error('promotion fixture'); } },
  }), /promotion failed and previous installation was restored.*promotion fixture/su);
  assert.deepEqual(treeSnapshot(expected.publicRoot), before);
});

test('rollback failure retains exact Viewer recovery state and blocks later installation', async (t) => {
  const expected = fixture(t);
  await installViewerDevelopmentData({ toolingRoot: expected.toolingRoot, runId: '555555555555' });
  const transactionRoot = path.join(expected.publicRoot, '.freetv-tooling-development-data-666666666666');
  await assert.rejects(installViewerDevelopmentData({
    toolingRoot: expected.toolingRoot,
    runId: '666666666666',
    transactionHooks: {
      beforePromotion({ name }) { if (name === 'playlists') throw new Error('promotion fixture'); },
      beforeRollback({ name }) { if (name === 'playlists') throw new Error('rollback fixture'); },
    },
  }), (error) => error.message.includes('rollback was incomplete') && error.message.includes(transactionRoot));
  assert.equal(fs.existsSync(transactionRoot), true);
  await assert.rejects(
    installViewerDevelopmentData({ toolingRoot: expected.toolingRoot, runId: '777777777777' }),
    /Interrupted Viewer development-data transaction requires manual inspection/,
  );
});

test('unmarked existing content is preserved by install and cleanup', async (t) => {
  const expected = fixture(t);
  write(path.join(expected.publicRoot, 'config.json'), 'legacy');
  const before = treeSnapshot(expected.publicRoot);
  await assert.rejects(
    installViewerDevelopmentData({ toolingRoot: expected.toolingRoot }),
    /unmarked.*manual inspection/,
  );
  await assert.rejects(
    cleanViewerDevelopmentData({ toolingRoot: expected.toolingRoot }),
    /unmarked.*manual inspection/,
  );
  assert.deepEqual(treeSnapshot(expected.publicRoot), before);
});

test('symlinked managed destination is refused without affecting its target', { skip: process.platform === 'win32' }, async (t) => {
  const expected = fixture(t);
  const outside = path.join(expected.root, 'outside');
  write(path.join(outside, 'keep.txt'), 'keep');
  fs.symlinkSync(outside, path.join(expected.publicRoot, 'playlists'), 'dir');
  await assert.rejects(
    installViewerDevelopmentData({ toolingRoot: expected.toolingRoot }),
    /destination is unsafe or ambiguous/,
  );
  assert.equal(fs.readFileSync(path.join(outside, 'keep.txt'), 'utf8'), 'keep');
});

test('dangling managed destination is refused by install and cleanup without affecting protected content', { skip: process.platform === 'win32' }, async (t) => {
  const expected = fixture(t);
  const missingTarget = path.join(expected.root, 'missing-playlists-target');
  const destination = path.join(expected.publicRoot, 'playlists');
  write(path.join(expected.publicRoot, 'index.html'), '<main>protected</main>');
  fs.symlinkSync(missingTarget, destination, 'dir');

  await assert.rejects(
    installViewerDevelopmentData({ toolingRoot: expected.toolingRoot }),
    /destination is unsafe or ambiguous/u,
  );
  await assert.rejects(
    cleanViewerDevelopmentData({ toolingRoot: expected.toolingRoot }),
    /destination is unsafe or ambiguous/u,
  );

  assert.equal(fs.lstatSync(destination).isSymbolicLink(), true);
  assert.equal(fs.existsSync(missingTarget), false);
  assert.equal(fs.readFileSync(path.join(expected.publicRoot, 'index.html'), 'utf8'), '<main>protected</main>');
});

test('dangling ownership marker is refused by install and cleanup without changing managed content', { skip: process.platform === 'win32' }, async (t) => {
  const expected = fixture(t);
  await installViewerDevelopmentData({ toolingRoot: expected.toolingRoot, runId: '888888888888' });
  const before = installedSnapshot(expected.publicRoot);
  const marker = path.join(expected.publicRoot, '.freetv-tooling-development-data.json');
  const missingTarget = path.join(expected.root, 'missing-ownership-marker');
  fs.unlinkSync(marker);
  fs.symlinkSync(missingTarget, marker, 'file');

  await assert.rejects(
    installViewerDevelopmentData({ toolingRoot: expected.toolingRoot }),
    /ownership marker must not be a symbolic link/u,
  );
  await assert.rejects(
    cleanViewerDevelopmentData({ toolingRoot: expected.toolingRoot }),
    /ownership marker must not be a symbolic link/u,
  );

  assert.equal(fs.lstatSync(marker).isSymbolicLink(), true);
  assert.equal(fs.existsSync(missingTarget), false);
  assert.deepEqual(treeSnapshot(path.join(expected.publicRoot, 'playlists')), before.playlists);
  assert.deepEqual(treeSnapshot(path.join(expected.publicRoot, 'thumbs')), before.thumbs);
  assert.equal(fs.readFileSync(path.join(expected.publicRoot, 'config.json'), 'utf8'), before.config);
});

test('candidate preparation preserves its original error when transaction cleanup fails', async (t) => {
  const expected = fixture(t);
  await installViewerDevelopmentData({ toolingRoot: expected.toolingRoot, runId: '999999999999' });
  const before = installedSnapshot(expected.publicRoot);
  const transactionRoot = path.join(expected.publicRoot, '.freetv-tooling-development-data-aaaaaaaaaaaa');

  await assert.rejects(installViewerDevelopmentData({
    toolingRoot: expected.toolingRoot,
    runId: 'aaaaaaaaaaaa',
    fileSystem: withTransactionCleanupFailure(transactionRoot),
    transactionHooks: { afterCandidateCopy() { throw new Error('injected candidate preparation failure'); } },
  }), (error) => error.message.includes('injected candidate preparation failure')
    && error.message.includes('injected transaction cleanup failure')
    && error.message.includes('may have partially removed contents')
    && error.message.includes(transactionRoot));

  assert.deepEqual(installedSnapshot(expected.publicRoot), before);
  assert.equal(fs.existsSync(transactionRoot), true);
});

test('post-rollback cleanup preserves the promotion error and ownership marker when cleanup fails', async (t) => {
  const expected = fixture(t);
  await installViewerDevelopmentData({ toolingRoot: expected.toolingRoot, runId: 'bbbbbbbbbbbb' });
  const before = installedSnapshot(expected.publicRoot);
  const transactionRoot = path.join(expected.publicRoot, '.freetv-tooling-development-data-cccccccccccc');

  await assert.rejects(installViewerDevelopmentData({
    toolingRoot: expected.toolingRoot,
    runId: 'cccccccccccc',
    fileSystem: withTransactionCleanupFailure(transactionRoot),
    transactionHooks: {
      beforePromotion({ name }) {
        if (name === 'playlists') throw new Error('injected promotion failure');
      },
    },
  }), (error) => error.message.includes('injected promotion failure')
    && error.message.includes('previous installation was restored')
    && error.message.includes('injected transaction cleanup failure')
    && error.message.includes('may have partially removed contents')
    && error.message.includes(transactionRoot));

  assert.deepEqual(installedSnapshot(expected.publicRoot), before);
  assert.equal(fs.existsSync(transactionRoot), true);
});

