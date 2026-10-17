import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  assembleProduction,
  OwnershipRegistry,
  VIEWER_SPA_HTACCESS,
  validateProductionOutput,
} from '../scripts/lib/production-assembly.js';
const SPA_HTACCESS = VIEWER_SPA_HTACCESS;

function sha256(contents) {
  return crypto.createHash('sha256').update(contents).digest('hex');
}

function writeFile(root, relativePath, contents = 'fixture') {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
  return target;
}

function manifestEntry(root, relativePath) {
  const contents = fs.readFileSync(path.join(root, relativePath));
  return { path: relativePath, sha256: sha256(contents), bytes: contents.length };
}

function writeDataStaging(root) {
  writeFile(root, 'config.json', '{"name":"fixture"}\n');
  writeFile(root, 'playlists/index.json', '{"playlists":[]}\n');
  writeFile(root, 'playlists/example.json', '{"shows":[]}\n');
  const manifest = {
    contract_version: 1,
    server_revision: 'a'.repeat(40),
    dataset: { playlist_count: 1, show_count: 0 },
    files: [
      manifestEntry(root, 'config.json'),
      manifestEntry(root, 'playlists/index.json'),
      manifestEntry(root, 'playlists/example.json'),
    ],
  };
  writeFile(root, 'manifest.json', JSON.stringify(manifest));
  return manifest;
}

function writeThumbnailStaging(root) {
  writeFile(root, 'thumbs/tt0000001.jpg', 'jpeg fixture');
  const entry = manifestEntry(root, 'thumbs/tt0000001.jpg');
  const manifest = {
    contract_version: 1,
    server_revision: 'a'.repeat(40),
    dataset: { thumbnail_count: 1, total_bytes: entry.bytes },
    files: [entry],
  };
  writeFile(root, 'manifest.json', JSON.stringify(manifest));
  return manifest;
}

function createWorkspace(t) {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'freetv-assembly-test-'));
  t.after(() => fs.rmSync(workspaceRoot, { recursive: true, force: true }));
  const toolingRoot = path.join(workspaceRoot, 'freetv-tooling');
  const viewerRoot = path.join(workspaceRoot, 'freetv-viewer');
  const adminRoot = path.join(workspaceRoot, 'freetv-admin');
  fs.mkdirSync(toolingRoot);

  writeFile(viewerRoot, 'dist/.htaccess', SPA_HTACCESS);
  writeFile(viewerRoot, 'dist/index.html', '<!doctype html>');
  writeFile(viewerRoot, 'dist/assets/viewer.js', 'export {};');
  writeFile(viewerRoot, 'dist/assets/viewer.css', 'body {}');
  writeFile(viewerRoot, 'dist/freetv-small.png', 'small logo');
  writeFile(viewerRoot, 'dist/freetv.png', 'logo');
  writeFile(viewerRoot, 'dist/whitelabel.config.json', '{"smallLogo":"/freetv-small.png"}');
  writeFile(viewerRoot, 'dist/service-worker.js', '/* service worker */');

  writeFile(adminRoot, 'dist/index.html', '<!doctype html>');
  writeFile(adminRoot, 'dist/assets/admin.js', 'export {};');
  writeFile(adminRoot, 'dist/assets/admin.css', 'body {}');
  writeFile(adminRoot, 'public/api/index.php', '<?php');
  writeFile(adminRoot, 'public/api/admin/status.php', '<?php');
  writeFile(adminRoot, 'public/api/beacon.php', '<?php');
  writeFile(adminRoot, 'public/api/.env', 'API_SECRET=fixture');
  writeFile(adminRoot, 'public/api/tests/test.php', '<?php');
  writeFile(adminRoot, 'public/api/backup.sql', 'fixture');
  writeFile(adminRoot, 'composer.json', '{}\n');
  writeFile(adminRoot, 'composer.lock', '{}\n');
  writeFile(adminRoot, 'resources/bootstrap/fresh.json', '{"fresh":true}\n');
  writeFile(adminRoot, 'resources/freetv-baseline-sample-data.zip', 'baseline ZIP fixture');
  writeFile(adminRoot, 'sql/freetv_mariadb_schema-tables-only.sql', 'CREATE TABLE fixture;\n');
  writeFile(adminRoot, 'vendor/autoload.php', '<?php');
  writeFile(adminRoot, 'vendor/package/src/Dependency.php', '<?php');
  writeFile(adminRoot, 'vendor/package/.git/config', 'fixture');
  writeFile(adminRoot, 'vendor/package/tests/DependencyTest.php', '<?php');
  writeFile(adminRoot, 'vendor/package/tools/generate.php', '<?php');
  writeFile(adminRoot, '.env', 'DB_PASSWORD=fixture');
  writeFile(adminRoot, 'temp/publication-undo/operation.json', '{}');
  writeFile(adminRoot, 'temp/thumbnail-undo/backup.jpg', 'fixture');

  const dataRoot = path.join(toolingRoot, 'staging/data');
  const thumbnailRoot = path.join(toolingRoot, 'staging/thumbnails');
  const dataManifest = writeDataStaging(dataRoot);
  const thumbnailManifest = writeThumbnailStaging(thumbnailRoot);
  const config = {
    repos: { viewer: '../freetv-viewer', admin: '../freetv-admin' },
    staging: { root: 'staging', data: 'data', thumbnails: 'thumbnails' },
    output: { root: '../production' },
  };
  return {
    workspaceRoot,
    toolingRoot,
    viewerRoot,
    adminRoot,
    outputRoot: path.join(workspaceRoot, 'production'),
    dataRoot,
    thumbnailRoot,
    dataManifest,
    thumbnailManifest,
    config,
  };
}

function transactionPaths(fixture, id) {
  const prefix = `.freetv-tooling-${path.basename(fixture.outputRoot)}-assembly-`;
  const stem = `${prefix}${id}`;
  const parent = path.dirname(fixture.outputRoot);
  return {
    claimPath: path.join(parent, `${prefix}claim`),
    candidatePath: path.join(parent, `${stem}.candidate`),
    backupPath: path.join(parent, `${stem}.backup`),
    markerPath: path.join(parent, `${stem}.transaction.json`),
  };
}

function transactionArtifacts(fixture) {
  const prefix = `.freetv-tooling-${path.basename(fixture.outputRoot)}-assembly-`;
  return fs.readdirSync(path.dirname(fixture.outputRoot)).filter((entry) => entry.startsWith(prefix)).sort();
}

function treeSnapshot(root) {
  if (!fs.existsSync(root)) return null;
  const snapshot = [];
  function visit(current, relative = '.') {
    const stats = fs.lstatSync(current);
    if (stats.isSymbolicLink()) {
      snapshot.push(['symlink', relative, fs.readlinkSync(current)]);
      return;
    }
    if (stats.isFile()) {
      snapshot.push(['file', relative, sha256(fs.readFileSync(current))]);
      return;
    }
    snapshot.push(['directory', relative]);
    for (const entry of fs.readdirSync(current).sort()) visit(path.join(current, entry), path.join(relative, entry));
  }
  visit(root);
  return snapshot;
}

function fileSystemFailingRename(predicate, message) {
  return new Proxy(fs, {
    get(target, property) {
      if (property !== 'renameSync') return target[property];
      return (source, destination) => {
        if (predicate(source, destination)) throw new Error(message);
        return target.renameSync(source, destination);
      };
    },
  });
}

function fileSystemFailingRemoval(predicate, removeBeforeFailure, message) {
  return new Proxy(fs, {
    get(target, property) {
      if (property !== 'rmSync') return target[property];
      return (removedPath, options) => {
        if (predicate(removedPath)) {
          removeBeforeFailure(removedPath);
          throw new Error(message);
        }
        return target.rmSync(removedPath, options);
      };
    },
  });
}

test('valid production assembly succeeds', (t) => {
  const fixture = createWorkspace(t);
  const result = assembleProduction(fixture);
  assert.ok(result.validation.fileCount > 0);
  assert.match(SPA_HTACCESS, /RewriteRule \^api\(\?:\/\|\$\) - \[L\]/);
  assert.equal(fs.readFileSync(path.join(fixture.outputRoot, 'public/.htaccess'), 'utf8'), SPA_HTACCESS);
  assert.equal(fs.existsSync(path.join(fixture.outputRoot, 'public/index.html')), true);
  assert.equal(fs.existsSync(path.join(fixture.outputRoot, 'public/admin/index.html')), true);
  assert.equal(fs.existsSync(path.join(fixture.outputRoot, 'public/api/index.php')), true);
  assert.equal(fs.existsSync(path.join(fixture.outputRoot, 'vendor/autoload.php')), true);
  for (const relativePath of [
    'resources/bootstrap/fresh.json',
    'resources/freetv-baseline-sample-data.zip',
    'sql/freetv_mariadb_schema-tables-only.sql',
  ]) {
    assert.deepEqual(
      fs.readFileSync(path.join(fixture.outputRoot, relativePath)),
      fs.readFileSync(path.join(fixture.adminRoot, relativePath)),
    );
  }
  assert.equal(result.paths.outputRoot, fixture.outputRoot);
  assert.deepEqual(transactionArtifacts(fixture), []);
});

test('existing production output is replaced transactionally and leaves no artifacts', (t) => {
  const fixture = createWorkspace(t);
  assembleProduction({ ...fixture, transactionId: '111111111111111111111111' });
  writeFile(fixture.outputRoot, 'old-release-sentinel.txt', 'old release');
  writeFile(fixture.viewerRoot, 'dist/index.html', '<!doctype html><title>new release</title>');

  const result = assembleProduction({ ...fixture, transactionId: '222222222222222222222222' });

  assert.equal(fs.existsSync(path.join(fixture.outputRoot, 'old-release-sentinel.txt')), false);
  assert.match(fs.readFileSync(path.join(fixture.outputRoot, 'public/index.html'), 'utf8'), /new release/);
  assert.equal(result.paths.outputRoot, fixture.outputRoot);
  assert.deepEqual(transactionArtifacts(fixture), []);
});

test('an exclusive claim deterministically rejects a concurrent assembly for the same output', (t) => {
  const fixture = createWorkspace(t);
  writeFile(fixture.outputRoot, 'keep.txt', 'previous output');
  const before = treeSnapshot(fixture.outputRoot);
  let concurrentError;
  let attempted = false;

  const result = assembleProduction({
    ...fixture,
    transactionId: '010101010101010101010101',
    transactionHooks: {
      afterCandidateCopy() {
        if (attempted) return;
        attempted = true;
        try {
          assembleProduction({ ...fixture, transactionId: '020202020202020202020202' });
        } catch (error) {
          concurrentError = error;
        }
        assert.deepEqual(treeSnapshot(fixture.outputRoot), before);
      },
    },
  });

  assert.match(concurrentError?.message ?? '', /already claimed or requires manual recovery/);
  assert.equal(result.paths.outputRoot, fixture.outputRoot);
  assert.equal(fs.existsSync(path.join(fixture.outputRoot, 'public/index.html')), true);
  assert.deepEqual(transactionArtifacts(fixture), []);
});

test('mid-copy failure preserves the previous output byte-for-byte and cleans its transaction', (t) => {
  const fixture = createWorkspace(t);
  writeFile(fixture.outputRoot, 'keep.txt', 'previous output');
  const before = treeSnapshot(fixture.outputRoot);
  let copies = 0;

  assert.throws(
    () => assembleProduction({
      ...fixture,
      transactionId: '333333333333333333333333',
      transactionHooks: {
        afterCandidateCopy() {
          copies += 1;
          if (copies === 3) throw new Error('injected copy failure');
        },
      },
    }),
    /candidate failed.*previous production output is intact.*injected copy failure/,
  );
  assert.deepEqual(treeSnapshot(fixture.outputRoot), before);
  assert.deepEqual(transactionArtifacts(fixture), []);
});

test('candidate validation failure occurs before promotion and preserves the previous output', (t) => {
  const fixture = createWorkspace(t);
  writeFile(fixture.outputRoot, 'keep.txt', 'previous output');
  const before = treeSnapshot(fixture.outputRoot);

  assert.throws(
    () => assembleProduction({
      ...fixture,
      transactionId: '444444444444444444444444',
      transactionHooks: {
        beforeCandidateValidation({ paths }) {
          writeFile(paths.outputRoot, 'unexpected.txt', 'invalid candidate');
        },
      },
    }),
    /candidate failed.*unexpected root entries: unexpected\.txt/,
  );
  assert.deepEqual(treeSnapshot(fixture.outputRoot), before);
  assert.deepEqual(transactionArtifacts(fixture), []);
});

test('backup rename failure preserves the previous output and cleans the candidate', (t) => {
  const fixture = createWorkspace(t);
  writeFile(fixture.outputRoot, 'keep.txt', 'previous output');
  const before = treeSnapshot(fixture.outputRoot);
  const transaction = transactionPaths(fixture, '555555555555555555555555');
  const transactionFileSystem = fileSystemFailingRename(
    (source, destination) => source === fixture.outputRoot && destination === transaction.backupPath,
    'injected backup rename failure',
  );

  assert.throws(
    () => assembleProduction({
      ...fixture,
      transactionId: '555555555555555555555555',
      transactionFileSystem,
    }),
    /could not move the previous output to backup.*previous production output is intact.*injected backup rename failure/,
  );
  assert.deepEqual(treeSnapshot(fixture.outputRoot), before);
  assert.deepEqual(transactionArtifacts(fixture), []);
});

test('candidate promotion failure restores the previous output and cleans recovery artifacts', (t) => {
  const fixture = createWorkspace(t);
  writeFile(fixture.outputRoot, 'keep.txt', 'previous output');
  const before = treeSnapshot(fixture.outputRoot);
  const transaction = transactionPaths(fixture, '666666666666666666666666');
  const transactionFileSystem = fileSystemFailingRename(
    (source, destination) => source === transaction.candidatePath && destination === fixture.outputRoot,
    'injected promotion failure',
  );

  assert.throws(
    () => assembleProduction({
      ...fixture,
      transactionId: '666666666666666666666666',
      transactionFileSystem,
    }),
    /candidate promotion failed; previous production output was restored.*injected promotion failure/,
  );
  assert.deepEqual(treeSnapshot(fixture.outputRoot), before);
  assert.deepEqual(transactionArtifacts(fixture), []);
});

test('failed promotion and failed restore retain exact recovery paths', (t) => {
  const fixture = createWorkspace(t);
  writeFile(fixture.outputRoot, 'keep.txt', 'previous output');
  const before = treeSnapshot(fixture.outputRoot);
  const transaction = transactionPaths(fixture, '777777777777777777777777');
  const transactionFileSystem = fileSystemFailingRename(
    (source, destination) => (source === transaction.candidatePath && destination === fixture.outputRoot)
      || (source === transaction.backupPath && destination === fixture.outputRoot),
    'injected rename failure',
  );

  assert.throws(
    () => assembleProduction({
      ...fixture,
      transactionId: '777777777777777777777777',
      transactionFileSystem,
    }),
    (error) => error.message.includes('recovery is incomplete')
      && error.message.includes(transaction.backupPath)
      && error.message.includes(transaction.candidatePath)
      && error.message.includes(transaction.markerPath),
  );
  assert.equal(fs.existsSync(fixture.outputRoot), false);
  assert.deepEqual(treeSnapshot(transaction.backupPath), before);
  assert.equal(fs.existsSync(transaction.candidatePath), true);
  assert.equal(fs.existsSync(transaction.markerPath), true);
});

test('backup cleanup failure keeps the valid new output and retains the previous backup', (t) => {
  const fixture = createWorkspace(t);
  writeFile(fixture.outputRoot, 'keep.txt', 'previous output');
  const before = treeSnapshot(fixture.outputRoot);
  const transaction = transactionPaths(fixture, '888888888888888888888888');

  assert.throws(
    () => assembleProduction({
      ...fixture,
      transactionId: '888888888888888888888888',
      transactionHooks: {
        beforeBackupCleanup() { throw new Error('injected backup cleanup failure'); },
      },
    }),
    /new output is valid, but backup cleanup failed.*injected backup cleanup failure/,
  );
  assert.deepEqual(treeSnapshot(transaction.backupPath), before);
  assert.equal(fs.existsSync(transaction.markerPath), true);
  assert.equal(fs.existsSync(transaction.claimPath), true);
  assert.equal(fs.existsSync(transaction.candidatePath), false);
  assert.equal(fs.existsSync(path.join(fixture.outputRoot, 'public/index.html')), true);
  assert.equal(fs.existsSync(path.join(fixture.outputRoot, 'keep.txt')), false);
});

test('partial backup deletion is reported without claiming the previous backup is intact', (t) => {
  const fixture = createWorkspace(t);
  writeFile(fixture.outputRoot, 'removed-during-cleanup.txt', 'old file one');
  writeFile(fixture.outputRoot, 'still-recoverable.txt', 'old file two');
  const transaction = transactionPaths(fixture, '030303030303030303030303');
  const transactionFileSystem = fileSystemFailingRemoval(
    (removedPath) => removedPath === transaction.backupPath,
    (backupPath) => fs.rmSync(path.join(backupPath, 'removed-during-cleanup.txt')),
    'injected partial backup deletion failure',
  );

  assert.throws(
    () => assembleProduction({
      ...fixture,
      transactionId: '030303030303030303030303',
      transactionFileSystem,
    }),
    (error) => error.message.includes('new output is valid')
      && error.message.includes('may have partially removed the previous backup')
      && error.message.includes(transaction.backupPath)
      && error.message.includes(transaction.markerPath)
      && error.message.includes(transaction.claimPath),
  );
  assert.equal(fs.existsSync(path.join(fixture.outputRoot, 'public/index.html')), true);
  assert.equal(fs.existsSync(path.join(transaction.backupPath, 'removed-during-cleanup.txt')), false);
  assert.equal(fs.readFileSync(path.join(transaction.backupPath, 'still-recoverable.txt'), 'utf8'), 'old file two');
  assert.equal(fs.existsSync(transaction.markerPath), true);
  assert.equal(fs.existsSync(transaction.claimPath), true);
});

test('an existing candidate-name collision is refused without modification or automatic cleanup', (t) => {
  const fixture = createWorkspace(t);
  writeFile(fixture.outputRoot, 'keep.txt', 'previous output');
  const before = treeSnapshot(fixture.outputRoot);
  const stale = transactionPaths(fixture, '999999999999999999999999');
  writeFile(stale.candidatePath, 'unrelated.txt', 'retain me');
  const staleBefore = treeSnapshot(stale.candidatePath);

  assert.throws(
    () => assembleProduction({ ...fixture, transactionId: 'aaaaaaaaaaaaaaaaaaaaaaaa' }),
    /Existing production assembly transaction requires manual inspection/,
  );
  assert.deepEqual(treeSnapshot(fixture.outputRoot), before);
  assert.deepEqual(treeSnapshot(stale.candidatePath), staleBefore);
});

test('an existing backup-name collision is refused without modification or automatic cleanup', (t) => {
  const fixture = createWorkspace(t);
  writeFile(fixture.outputRoot, 'keep.txt', 'previous output');
  const before = treeSnapshot(fixture.outputRoot);
  const stale = transactionPaths(fixture, 'eeeeeeeeeeeeeeeeeeeeeeee');
  writeFile(stale.backupPath, 'recoverable.txt', 'retain me');
  const staleBefore = treeSnapshot(stale.backupPath);

  assert.throws(
    () => assembleProduction({ ...fixture, transactionId: 'ffffffffffffffffffffffff' }),
    /Existing production assembly transaction requires manual inspection/,
  );
  assert.deepEqual(treeSnapshot(fixture.outputRoot), before);
  assert.deepEqual(treeSnapshot(stale.backupPath), staleBefore);
});

test('reserved transaction symlinks are refused and left untouched', (t) => {
  const fixture = createWorkspace(t);
  const protectedRoot = path.join(fixture.workspaceRoot, 'protected');
  writeFile(protectedRoot, 'keep.txt', 'do not touch');
  const protectedBefore = treeSnapshot(protectedRoot);
  const stale = transactionPaths(fixture, 'bbbbbbbbbbbbbbbbbbbbbbbb');
  fs.symlinkSync(protectedRoot, stale.backupPath, 'dir');

  assert.throws(
    () => assembleProduction({ ...fixture, transactionId: 'cccccccccccccccccccccccc' }),
    /Existing production assembly transaction requires manual inspection/,
  );
  assert.equal(fs.lstatSync(stale.backupPath).isSymbolicLink(), true);
  assert.deepEqual(treeSnapshot(protectedRoot), protectedBefore);
});

test('cleanup requires an exact valid ownership marker and never deletes on prefix alone', (t) => {
  const fixture = createWorkspace(t);
  writeFile(fixture.outputRoot, 'keep.txt', 'previous output');
  const before = treeSnapshot(fixture.outputRoot);
  const transaction = transactionPaths(fixture, 'dddddddddddddddddddddddd');
  let injected = false;

  assert.throws(
    () => assembleProduction({
      ...fixture,
      transactionId: 'dddddddddddddddddddddddd',
      transactionHooks: {
        afterCandidateCopy() {
          if (injected) return;
          injected = true;
          fs.writeFileSync(transaction.markerPath, '{"unowned":true}\n');
          throw new Error('injected marker corruption');
        },
      },
    }),
    /candidate or transaction cleanup failed.*ownership marker does not match this operation/,
  );
  assert.deepEqual(treeSnapshot(fixture.outputRoot), before);
  assert.equal(fs.existsSync(transaction.candidatePath), true);
  assert.equal(fs.existsSync(transaction.markerPath), true);
});

test('missing First Run source fails before replacing existing output', (t) => {
  const fixture = createWorkspace(t);
  writeFile(fixture.outputRoot, 'keep.txt', 'keep');
  fs.rmSync(path.join(fixture.adminRoot, 'resources/bootstrap/fresh.json'));
  assert.throws(() => assembleProduction(fixture), /Server First Run runtime input.*fresh\.json.*is missing/);
  assert.equal(fs.readFileSync(path.join(fixture.outputRoot, 'keep.txt'), 'utf8'), 'keep');
  assert.deepEqual(transactionArtifacts(fixture), []);
});

test('missing assembled First Run input fails validation', (t) => {
  const fixture = createWorkspace(t);
  const result = assembleProduction(fixture);
  fs.rmSync(path.join(fixture.outputRoot, 'sql/freetv_mariadb_schema-tables-only.sql'));
  assert.throws(
    () => validateProductionOutput({
      paths: result.paths,
      dataManifest: fixture.dataManifest,
      thumbnailManifest: fixture.thumbnailManifest,
    }),
    /Production First Run SQL is missing required root entries: freetv_mariadb_schema-tables-only\.sql/,
  );
});

test('missing Viewer dist fails before replacing existing output', (t) => {
  const fixture = createWorkspace(t);
  writeFile(fixture.outputRoot, 'keep.txt', 'keep');
  fs.rmSync(path.join(fixture.viewerRoot, 'dist'), { recursive: true });
  assert.throws(() => assembleProduction(fixture), /Viewer dist is missing/);
  assert.equal(fs.readFileSync(path.join(fixture.outputRoot, 'keep.txt'), 'utf8'), 'keep');
  assert.deepEqual(transactionArtifacts(fixture), []);
});

test('invalid Viewer dist fails', (t) => {
  const fixture = createWorkspace(t);
  writeFile(fixture.viewerRoot, 'dist/config.json', '{}');
  assert.throws(() => assembleProduction(fixture), /Viewer dist contains unexpected root entries/);
});

test('retired Viewer manifest.webmanifest fails', (t) => {
  const fixture = createWorkspace(t);
  writeFile(fixture.viewerRoot, 'dist/manifest.webmanifest', '{}');
  assert.throws(() => assembleProduction(fixture), /Viewer dist contains unexpected root entries: manifest.webmanifest/);
});

test('missing Viewer .htaccess fails', (t) => {
  const fixture = createWorkspace(t);
  fs.rmSync(path.join(fixture.viewerRoot, 'dist/.htaccess'));
  assert.throws(() => assembleProduction(fixture), /Viewer dist is missing required root entries: .htaccess/);
});

test('invalid Viewer .htaccess fails', (t) => {
  const fixture = createWorkspace(t);
  writeFile(fixture.viewerRoot, 'dist/.htaccess', 'RewriteEngine Off\n');
  assert.throws(() => assembleProduction(fixture), /Viewer .htaccess does not match the Viewer SPA fallback contract/);
});

test('outdated Viewer .htaccess without the API exclusion fails', (t) => {
  const fixture = createWorkspace(t);
  const outdatedHtaccess = SPA_HTACCESS.replace(
    '# Never route API requests through the Viewer SPA fallback\nRewriteRule ^api(?:/|$) - [L]\n\n',
    '',
  );
  writeFile(fixture.viewerRoot, 'dist/.htaccess', outdatedHtaccess);
  assert.throws(() => assembleProduction(fixture), /Viewer .htaccess does not match the Viewer SPA fallback contract/);
});

test('missing Admin dist fails', (t) => {
  const fixture = createWorkspace(t);
  fs.rmSync(path.join(fixture.adminRoot, 'dist'), { recursive: true });
  assert.throws(() => assembleProduction(fixture), /Server Admin dist is missing/);
});

test('missing staging fails', (t) => {
  const fixture = createWorkspace(t);
  fs.rmSync(fixture.dataRoot, { recursive: true });
  assert.throws(() => assembleProduction(fixture), /Data manifest is missing/);
});

test('missing vendor autoload fails', (t) => {
  const fixture = createWorkspace(t);
  fs.rmSync(path.join(fixture.adminRoot, 'vendor/autoload.php'));
  assert.throws(() => assembleProduction(fixture), /vendor\/autoload.php is missing/);
});

test('destination ownership collisions fail even for identical bytes', () => {
  const ownership = new OwnershipRegistry();
  ownership.claim('/tmp/assembly-collision', 'Viewer');
  assert.throws(
    () => ownership.claim('/tmp/assembly-collision', 'Admin'),
    /Destination collision.*Viewer and Admin/,
  );
});

test('no other owner may claim Viewer .htaccess', () => {
  const ownership = new OwnershipRegistry();
  ownership.claim('/tmp/production/public/.htaccess', 'Viewer');
  assert.throws(
    () => ownership.claim('/tmp/production/public/.htaccess', 'Data Export'),
    /Destination collision.*Viewer and Data Export/,
  );
});

test('unsafe production output root is rejected without deletion', (t) => {
  const fixture = createWorkspace(t);
  writeFile(fixture.toolingRoot, 'keep.txt', 'keep');
  fixture.config.output.root = '.';
  assert.throws(() => assembleProduction(fixture), /expected Tooling-owned boundary|overlap/);
  assert.equal(fs.readFileSync(path.join(fixture.toolingRoot, 'keep.txt'), 'utf8'), 'keep');
});

test('.env and denied API content are not copied', (t) => {
  const fixture = createWorkspace(t);
  const result = assembleProduction(fixture);
  assert.equal(fs.existsSync(path.join(fixture.outputRoot, '.env')), false);
  assert.equal(fs.existsSync(path.join(fixture.outputRoot, 'public/api/.env')), false);
  assert.equal(fs.existsSync(path.join(fixture.outputRoot, 'public/api/beacon.php')), false);
  assert.equal(fs.existsSync(path.join(fixture.outputRoot, 'public/api/tests')), false);
  assert.equal(fs.existsSync(path.join(fixture.outputRoot, 'public/api/backup.sql')), false);
  assert.equal(fs.existsSync(path.join(fixture.outputRoot, 'vendor/package/.git')), false);
  assert.equal(fs.existsSync(path.join(fixture.outputRoot, 'vendor/package/tests')), false);
  assert.equal(fs.existsSync(path.join(fixture.outputRoot, 'vendor/package/tools')), false);
  assert.equal(fs.existsSync(path.join(fixture.outputRoot, 'vendor/package/src/Dependency.php')), true);
  assert.ok(result.apiExclusions.includes('beacon.php'));
});

test('only exact Composer temporary downloads are excluded without changing vendor sources', (t) => {
  const fixture = createWorkspace(t);
  const firstTemporary = writeFile(
    fixture.adminRoot,
    'vendor/composer/tmp-1b31f7b6e47d87b96c35b925677afa0f.zip~',
    '',
  );
  const secondTemporary = writeFile(
    fixture.adminRoot,
    'vendor/composer/tmp-a0.zip~',
    '',
  );
  writeFile(fixture.adminRoot, 'vendor/composer/installed.php', '<?php return [];');
  writeFile(fixture.adminRoot, 'vendor/package/tmp-deadbeef.zip~', 'outside composer');
  writeFile(fixture.adminRoot, 'vendor/composer/tmp-NOT-HEX.zip~', 'nonmatching');

  const result = assembleProduction(fixture);

  for (const temporary of [firstTemporary, secondTemporary]) {
    assert.equal(fs.existsSync(temporary), true);
    assert.equal(
      fs.existsSync(path.join(fixture.outputRoot, 'vendor/composer', path.basename(temporary))),
      false,
    );
  }
  assert.equal(fs.readFileSync(path.join(fixture.outputRoot, 'vendor/autoload.php'), 'utf8'), '<?php');
  assert.equal(
    fs.readFileSync(path.join(fixture.outputRoot, 'vendor/composer/installed.php'), 'utf8'),
    '<?php return [];',
  );
  assert.equal(fs.existsSync(path.join(fixture.outputRoot, 'vendor/package/tmp-deadbeef.zip~')), true);
  assert.equal(fs.existsSync(path.join(fixture.outputRoot, 'vendor/composer/tmp-NOT-HEX.zip~')), true);
  assert.deepEqual(result.vendorExclusions.filter((entry) => entry.endsWith('.zip~')).sort(), [
    path.join('composer', 'tmp-1b31f7b6e47d87b96c35b925677afa0f.zip~'),
    path.join('composer', 'tmp-a0.zip~'),
  ]);
});

test('existing Server temp and Undo state are not copied', (t) => {
  const fixture = createWorkspace(t);
  assembleProduction(fixture);
  assert.deepEqual(fs.readdirSync(path.join(fixture.outputRoot, 'temp/publication-undo')), []);
  assert.deepEqual(fs.readdirSync(path.join(fixture.outputRoot, 'temp/thumbnail-undo')), []);
});

test('assembled Data remains covered by staging hashes and sizes', (t) => {
  const fixture = createWorkspace(t);
  const result = assembleProduction(fixture);
  fs.appendFileSync(path.join(fixture.outputRoot, 'public/config.json'), 'tamper');
  assert.throws(
    () => validateProductionOutput({
      paths: result.paths,
      dataManifest: fixture.dataManifest,
      thumbnailManifest: fixture.thumbnailManifest,
    }),
    /Data assembled byte size mismatch/,
  );
});

test('assembled Thumbnails remain covered by staging hashes and sizes', (t) => {
  const fixture = createWorkspace(t);
  const result = assembleProduction(fixture);
  fs.appendFileSync(path.join(fixture.outputRoot, 'public/thumbs/tt0000001.jpg'), 'tamper');
  assert.throws(
    () => validateProductionOutput({
      paths: result.paths,
      dataManifest: fixture.dataManifest,
      thumbnailManifest: fixture.thumbnailManifest,
    }),
    /Thumbnail assembled byte size mismatch/,
  );
});

test('Viewer white-label assets are assembled and Admin runtime paths are absent', (t) => {
  const fixture = createWorkspace(t);
  assembleProduction(fixture);
  const whiteLabel = JSON.parse(fs.readFileSync(path.join(fixture.outputRoot, 'public/whitelabel.config.json'), 'utf8'));
  assert.equal(whiteLabel.smallLogo, '/freetv-small.png');
  assert.equal(fs.existsSync(path.join(fixture.outputRoot, 'public/freetv-small.png')), true);
  assert.equal(fs.existsSync(path.join(fixture.outputRoot, 'public/freetv.png')), true);
  assert.equal(fs.existsSync(path.join(fixture.outputRoot, 'public/manifest.json')), false);
  for (const entry of ['api', 'config.json', 'playlists', 'thumbs']) {
    assert.equal(fs.existsSync(path.join(fixture.outputRoot, 'public/admin', entry)), false);
  }
});

test('only declared ownership roots appear in production', (t) => {
  const fixture = createWorkspace(t);
  assembleProduction(fixture);
  assert.deepEqual(fs.readdirSync(fixture.outputRoot).sort(), [
    'composer.json', 'composer.lock', 'public', 'resources', 'sql', 'temp', 'vendor',
  ]);
  assert.deepEqual(fs.readdirSync(path.join(fixture.outputRoot, 'resources')).sort(), [
    'bootstrap', 'freetv-baseline-sample-data.zip',
  ]);
  assert.deepEqual(fs.readdirSync(path.join(fixture.outputRoot, 'resources/bootstrap')), ['fresh.json']);
  assert.deepEqual(fs.readdirSync(path.join(fixture.outputRoot, 'sql')), [
    'freetv_mariadb_schema-tables-only.sql',
  ]);
  assert.deepEqual(fs.readdirSync(path.join(fixture.outputRoot, 'public')).sort(), [
    '.htaccess', 'admin', 'api', 'assets', 'config.json', 'freetv-small.png', 'freetv.png', 'index.html',
    'playlists', 'service-worker.js', 'thumbs', 'whitelabel.config.json',
  ]);
});

test('forbidden nested Admin runtime content is rejected before assembly', (t) => {
  const fixture = createWorkspace(t);
  writeFile(fixture.adminRoot, 'dist/api/index.php', '<?php');
  assert.throws(() => assembleProduction(fixture), /Server Admin dist contains unexpected root entries/);
});
