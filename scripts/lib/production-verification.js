import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { validateDataManifest, validateThumbnailManifest } from './export-staging.js';
import { resolveAssemblyPaths, validateProductionOutput } from './production-assembly.js';

const NON_VENDOR_FORBIDDEN_DIRECTORIES = new Set([
  '.git', 'logs', 'node_modules', 'sql', 'src', 'support', 'test', 'tests', 'tools',
]);
const VENDOR_FORBIDDEN_DIRECTORIES = new Set(['.git', 'node_modules', 'test', 'tests', 'tools']);
const FORBIDDEN_FILE_EXTENSIONS = new Set([
  '.bak', '.backup', '.dump', '.key', '.old', '.orig', '.p12', '.pem', '.pfx', '.sql', '.swp', '.tmp',
]);
const FORBIDDEN_FILENAMES = new Set(['.ds_store']);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isWithin(candidate, parent, allowEqual = false) {
  const relative = path.relative(parent, candidate);
  return (allowEqual && relative === '')
    || (relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function walk(root, relativeRoot = '') {
  const entries = [];
  for (const entry of fs.readdirSync(path.join(root, relativeRoot), { withFileTypes: true })) {
    const relativePath = path.join(relativeRoot, entry.name);
    entries.push({ entry, relativePath, absolutePath: path.join(root, relativePath) });
    if (entry.isDirectory()) entries.push(...walk(root, relativePath));
  }
  return entries;
}

function requireFile(filePath, label) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error(`${label} is missing or is not a file: ${filePath}`);
  }
}

function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`${label} is invalid JSON: ${error.message}`);
  }
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function validateSecurityDebris(outputRoot) {
  for (const { entry, relativePath } of walk(outputRoot)) {
    const segments = relativePath.split(path.sep);
    const lowerSegments = segments.map((segment) => segment.toLowerCase());
    const inVendor = lowerSegments[0] === 'vendor';
    const basename = lowerSegments.at(-1);

    if (entry.isDirectory()) {
      const forbidden = inVendor ? VENDOR_FORBIDDEN_DIRECTORIES : NON_VENDOR_FORBIDDEN_DIRECTORIES;
      if (forbidden.has(basename)) {
        throw new Error(`Production contains forbidden development directory: ${relativePath}`);
      }
      continue;
    }
    if (!entry.isFile()) continue;
    if (basename === '.env' || basename.startsWith('.env.') || basename.endsWith('~')
      || FORBIDDEN_FILENAMES.has(basename) || FORBIDDEN_FILE_EXTENSIONS.has(path.extname(basename))) {
      throw new Error(`Production contains forbidden secret/development artifact: ${relativePath}`);
    }
  }
}

function normalizeManifestPath(relativePath) {
  return relativePath.split('/').join(path.sep);
}

function verifyManifestSnapshot(manifest, destinationRoot, prefix, label) {
  const expected = new Set();
  let totalBytes = 0;
  for (const entry of manifest.files) {
    if (!entry.path.startsWith(prefix)) continue;
    const relativePath = entry.path.slice(prefix.length);
    const destination = path.join(destinationRoot, normalizeManifestPath(relativePath));
    requireFile(destination, `${label} manifest file`);
    const bytes = fs.statSync(destination).size;
    if (bytes !== entry.bytes) {
      throw new Error(`${label} byte size mismatch for ${entry.path}: expected ${entry.bytes}, got ${bytes}`);
    }
    if (sha256(destination) !== entry.sha256) throw new Error(`${label} SHA-256 mismatch for ${entry.path}`);
    expected.add(relativePath.split('/').join(path.sep));
    totalBytes += bytes;
  }

  const actual = new Set();
  for (const { entry, relativePath } of walk(destinationRoot)) {
    if (entry.isDirectory()) throw new Error(`${label} contains an unexpected directory: ${relativePath}`);
    if (entry.isFile()) actual.add(relativePath);
  }
  const missing = [...expected].filter((file) => !actual.has(file));
  const extra = [...actual].filter((file) => !expected.has(file));
  if (missing.length > 0) throw new Error(`${label} is missing manifest files: ${missing.join(', ')}`);
  if (extra.length > 0) throw new Error(`${label} contains files outside its manifest: ${extra.join(', ')}`);
  return { fileCount: actual.size, totalBytes };
}

function verifyDataSemantics(publicRoot, manifest) {
  const config = readJson(path.join(publicRoot, 'config.json'), 'Assembled config.json');
  if (!isObject(config)) throw new Error('Assembled config.json must contain a JSON object');

  const playlistsRoot = path.join(publicRoot, 'playlists');
  const index = readJson(path.join(playlistsRoot, 'index.json'), 'Assembled playlists/index.json');
  if (!isObject(index) || !Array.isArray(index.playlists)) {
    throw new Error('Assembled playlists/index.json must contain a playlists array');
  }

  const filenames = [];
  for (const [position, playlist] of index.playlists.entries()) {
    if (!isObject(playlist) || typeof playlist.filename !== 'string' || playlist.filename === '') {
      throw new Error(`Assembled playlist index entry ${position} must contain a filename`);
    }
    if (playlist.filename.includes('/') || playlist.filename.includes('\\')) {
      throw new Error(`Assembled playlist index filename is unsafe: ${playlist.filename}`);
    }
    filenames.push(playlist.filename);
  }
  if (new Set(filenames).size !== filenames.length) throw new Error('Assembled playlist index contains duplicate filenames');
  if (typeof index.default !== 'string' || !filenames.includes(index.default)) {
    throw new Error('Assembled playlist index default does not identify an assembled playlist');
  }

  const manifestPlaylists = manifest.files
    .map((entry) => entry.path)
    .filter((entryPath) => /^playlists\/[^/]+\.json$/u.test(entryPath) && entryPath !== 'playlists/index.json')
    .map((entryPath) => entryPath.slice('playlists/'.length));
  const indexed = [...filenames].sort();
  const represented = [...manifestPlaylists].sort();
  if (JSON.stringify(indexed) !== JSON.stringify(represented)) {
    throw new Error('Assembled playlist index filenames do not match the Data staging manifest');
  }

  let showCount = 0;
  for (const filename of filenames) {
    const playlist = readJson(path.join(playlistsRoot, filename), `Assembled playlist ${filename}`);
    if (!isObject(playlist) || !Array.isArray(playlist.shows)) {
      throw new Error(`Assembled playlist ${filename} must contain a shows array`);
    }
    showCount += playlist.shows.length;
  }
  if (filenames.length !== manifest.dataset.playlist_count) {
    throw new Error(`Assembled playlist count mismatch: expected ${manifest.dataset.playlist_count}, got ${filenames.length}`);
  }
  if (showCount !== manifest.dataset.show_count) {
    throw new Error(`Assembled show count mismatch: expected ${manifest.dataset.show_count}, got ${showCount}`);
  }
  return { playlistCount: filenames.length, showCount };
}

function isIgnoredReference(reference) {
  return reference === '' || reference.startsWith('#') || reference.startsWith('//')
    || /^(?:https?:|data:|blob:)/iu.test(reference) || /[${}*]/u.test(reference);
}

function cleanReference(reference) {
  return reference.trim().split(/[?#]/u)[0];
}

function verifyStaticReference({ reference, sourcePath, publicRoot, ownershipRoot, namespace, label }) {
  const cleaned = cleanReference(reference);
  if (isIgnoredReference(cleaned)) return 0;
  if (namespace === 'Admin' && cleaned.startsWith('/assets/')) {
    throw new Error(`Admin static reference uses Viewer-owned /assets namespace in ${label}: ${reference}`);
  }

  let resolved;
  if (cleaned === '/') {
    resolved = path.join(publicRoot, 'index.html');
  } else if (cleaned.startsWith('/')) {
    resolved = path.resolve(publicRoot, cleaned.slice(1));
  } else {
    resolved = path.resolve(path.dirname(sourcePath), cleaned);
  }
  if (!isWithin(resolved, ownershipRoot)) {
    throw new Error(`${namespace} static reference escapes its ownership root in ${label}: ${reference}`);
  }
  requireFile(resolved, `${namespace} static reference from ${label}`);
  return 1;
}

function htmlReferences(contents) {
  const references = [];
  const pattern = /<(?:audio|img|link|script|source|video)\b[^>]*?\b(?:href|src)\s*=\s*(["'])(.*?)\1/giu;
  for (const match of contents.matchAll(pattern)) references.push(match[2]);
  return references;
}

function cssReferences(contents) {
  const references = [];
  const pattern = /url\(\s*(["']?)(.*?)\1\s*\)/giu;
  for (const match of contents.matchAll(pattern)) references.push(match[2]);
  return references;
}

function quotedAssetReferences(contents) {
  const references = [];
  const pattern = /(["'`])(\/(?:admin\/)?assets\/[^"'`\s\\?#]+(?:[?#][^"'`\s\\]*)?)\1/gu;
  for (const match of contents.matchAll(pattern)) references.push(match[2]);
  return references;
}

function serviceWorkerStaticReferences(contents) {
  const block = contents.match(/\bSTATIC_ASSETS\s*=\s*\[([\s\S]*?)\]/u);
  if (!block) return [];
  const references = [];
  for (const match of block[1].matchAll(/(["'])(.*?)\1/gu)) references.push(match[2]);
  return references;
}

function verifyReferenceSet(references, context) {
  let checked = 0;
  for (const reference of references) checked += verifyStaticReference({ ...context, reference });
  return checked;
}

function verifyManifestReferences(publicRoot) {
  const manifestPath = path.join(publicRoot, 'manifest.json');
  const manifest = readJson(manifestPath, 'Production manifest.json');
  if (!Array.isArray(manifest.icons) || manifest.icons.length === 0) {
    throw new Error('Production manifest.json must contain an icons array');
  }
  let checked = 0;
  for (const icon of manifest.icons) {
    if (!isObject(icon) || typeof icon.src !== 'string' || icon.src === '') {
      throw new Error('Production manifest.json contains an icon without a source');
    }
    checked += verifyStaticReference({
      reference: icon.src,
      sourcePath: manifestPath,
      publicRoot,
      ownershipRoot: publicRoot,
      namespace: 'Viewer',
      label: 'manifest.json',
    });
  }
  return checked;
}

function verifyFrontendReferences(publicRoot) {
  const viewerIndex = path.join(publicRoot, 'index.html');
  const viewerAssets = path.join(publicRoot, 'assets');
  const adminRoot = path.join(publicRoot, 'admin');
  const adminIndex = path.join(adminRoot, 'index.html');
  const adminAssets = path.join(adminRoot, 'assets');
  let viewerReferences = 0;
  let adminReferences = 0;

  viewerReferences += verifyReferenceSet(htmlReferences(fs.readFileSync(viewerIndex, 'utf8')), {
    sourcePath: viewerIndex, publicRoot, ownershipRoot: publicRoot, namespace: 'Viewer', label: 'public/index.html',
  });
  viewerReferences += verifyManifestReferences(publicRoot);
  const serviceWorker = path.join(publicRoot, 'service-worker.js');
  viewerReferences += verifyReferenceSet(serviceWorkerStaticReferences(fs.readFileSync(serviceWorker, 'utf8')), {
    sourcePath: serviceWorker, publicRoot, ownershipRoot: publicRoot, namespace: 'Viewer', label: 'service-worker.js',
  });
  for (const { entry, absolutePath, relativePath } of walk(viewerAssets)) {
    if (!entry.isFile()) continue;
    const extension = path.extname(relativePath).toLowerCase();
    if (extension === '.css') {
      viewerReferences += verifyReferenceSet(cssReferences(fs.readFileSync(absolutePath, 'utf8')), {
        sourcePath: absolutePath, publicRoot, ownershipRoot: publicRoot, namespace: 'Viewer', label: `assets/${relativePath}`,
      });
    } else if (extension === '.js') {
      viewerReferences += verifyReferenceSet(quotedAssetReferences(fs.readFileSync(absolutePath, 'utf8')), {
        sourcePath: absolutePath, publicRoot, ownershipRoot: publicRoot, namespace: 'Viewer', label: `assets/${relativePath}`,
      });
    }
  }

  adminReferences += verifyReferenceSet(htmlReferences(fs.readFileSync(adminIndex, 'utf8')), {
    sourcePath: adminIndex, publicRoot, ownershipRoot: adminRoot, namespace: 'Admin', label: 'public/admin/index.html',
  });
  for (const { entry, absolutePath, relativePath } of walk(adminAssets)) {
    if (!entry.isFile()) continue;
    const extension = path.extname(relativePath).toLowerCase();
    const contents = extension === '.css' || extension === '.js' ? fs.readFileSync(absolutePath, 'utf8') : null;
    if (extension === '.css') {
      adminReferences += verifyReferenceSet(cssReferences(contents), {
        sourcePath: absolutePath, publicRoot, ownershipRoot: adminRoot, namespace: 'Admin', label: `admin/assets/${relativePath}`,
      });
    } else if (extension === '.js') {
      adminReferences += verifyReferenceSet(quotedAssetReferences(contents), {
        sourcePath: absolutePath, publicRoot, ownershipRoot: adminRoot, namespace: 'Admin', label: `admin/assets/${relativePath}`,
      });
    }
  }

  return {
    viewer: { assetCount: walk(viewerAssets).filter(({ entry }) => entry.isFile()).length, staticReferenceCount: viewerReferences },
    admin: { assetCount: walk(adminAssets).filter(({ entry }) => entry.isFile()).length, staticReferenceCount: adminReferences },
  };
}

function defaultPhpCommandRunner(args, label) {
  const result = spawnSync('php', args, { encoding: 'utf8' });
  if (result.error?.code === 'ENOENT') throw new Error(`${label} requires PHP CLI, but php was not found on PATH`);
  if (result.error) throw new Error(`${label} could not run: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim();
    throw new Error(`${label} failed${detail ? `: ${detail}` : ''}`);
  }
}

function verifyLiteralPhpIncludes(filePath, outputRoot) {
  const contents = fs.readFileSync(filePath, 'utf8');
  let checked = 0;
  const dirPattern = /\b(?:include|include_once|require|require_once)\s*\(?\s*__DIR__\s*\.\s*(["'])(.*?)\1/gu;
  for (const match of contents.matchAll(dirPattern)) {
    const relativeTarget = match[2].replace(/^[/\\]+/u, '');
    const target = path.resolve(path.dirname(filePath), relativeTarget);
    if (!isWithin(target, outputRoot)) throw new Error(`PHP include escapes production root in ${filePath}: ${match[2]}`);
    requireFile(target, `PHP include target from ${filePath}`);
    checked += 1;
  }
  const literalPattern = /\b(?:include|include_once|require|require_once)\s*\(?\s*(["'])(.*?)\1/gu;
  for (const match of contents.matchAll(literalPattern)) {
    const target = path.resolve(path.dirname(filePath), match[2]);
    if (!isWithin(target, outputRoot)) throw new Error(`PHP include escapes production root in ${filePath}: ${match[2]}`);
    requireFile(target, `PHP include target from ${filePath}`);
    checked += 1;
  }
  return checked;
}

function verifyPhpRuntime(outputRoot, phpCommandRunner) {
  const autoload = path.join(outputRoot, 'vendor/autoload.php');
  requireFile(path.join(outputRoot, 'composer.json'), 'Production composer.json');
  requireFile(path.join(outputRoot, 'composer.lock'), 'Production composer.lock');
  requireFile(autoload, 'Production vendor/autoload.php');
  phpCommandRunner(['-d', 'display_errors=1', '-r', 'require $argv[1];', autoload], 'Composer autoload smoke test');

  const phpFiles = walk(path.join(outputRoot, 'public/api'))
    .filter(({ entry, relativePath }) => entry.isFile() && path.extname(relativePath).toLowerCase() === '.php');
  let includeCount = 0;
  for (const { absolutePath, relativePath } of phpFiles) {
    phpCommandRunner(['-l', absolutePath], `PHP syntax check for public/api/${relativePath}`);
    includeCount += verifyLiteralPhpIncludes(absolutePath, outputRoot);
  }
  return { autoload: true, phpFileCount: phpFiles.length, syntaxChecked: phpFiles.length, literalIncludeCount: includeCount };
}

export function verifyProduction({ toolingRoot, config, phpCommandRunner = defaultPhpCommandRunner }) {
  const paths = resolveAssemblyPaths(toolingRoot, config);
  const dataManifest = validateDataManifest(paths.dataStagingRoot);
  const thumbnailManifest = validateThumbnailManifest(paths.thumbnailStagingRoot);
  const structural = validateProductionOutput({ paths, dataManifest, thumbnailManifest });
  validateSecurityDebris(paths.outputRoot);

  const frontend = verifyFrontendReferences(paths.publicRoot);
  const playlistSnapshot = verifyManifestSnapshot(
    dataManifest,
    path.join(paths.publicRoot, 'playlists'),
    'playlists/',
    'Assembled playlists',
  );
  const thumbnailSnapshot = verifyManifestSnapshot(
    thumbnailManifest,
    path.join(paths.publicRoot, 'thumbs'),
    'thumbs/',
    'Assembled thumbnails',
  );
  const data = verifyDataSemantics(paths.publicRoot, dataManifest);
  const application = verifyPhpRuntime(paths.outputRoot, phpCommandRunner);

  return {
    outputRoot: paths.outputRoot,
    application: {
      packageFileCount: structural.fileCount,
      composerAutoload: application.autoload,
      tempRuntimeClean: true,
    },
    viewer: { ...frontend.viewer, unresolvedStaticReferences: 0 },
    admin: { ...frontend.admin, unresolvedStaticReferences: 0 },
    api: {
      phpFileCount: application.phpFileCount,
      syntaxChecked: application.syntaxChecked,
      literalIncludeCount: application.literalIncludeCount,
    },
    data: {
      playlistCount: data.playlistCount,
      showCount: data.showCount,
      manifestFileCount: dataManifest.files.length,
      playlistSnapshotFileCount: playlistSnapshot.fileCount,
      manifestIntegrity: true,
    },
    thumbnails: {
      fileCount: thumbnailSnapshot.fileCount,
      totalBytes: thumbnailSnapshot.totalBytes,
      manifestIntegrity: true,
    },
    security: { secretsOrDevelopmentDebris: 0, symlinks: 0 },
  };
}
