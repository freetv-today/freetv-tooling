import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  resetStaging,
  resolveStagingPaths,
  stageServerExports,
} from './export-staging.js';

const CANDIDATE_MARKER = '.freetv-sql-candidate';
const CANDIDATE_MARKER_CONTENT = 'freetv-tooling data:validate\n';

function isWithin(candidate, parent, allowEqual = false) {
  const relative = path.relative(parent, candidate);
  return (allowEqual && relative === '')
    || (relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function pathsOverlap(left, right) {
  return isWithin(left, right, true) || isWithin(right, left, true);
}

function configuredRepository(toolingRoot, config, name) {
  const configured = config?.repos?.[name];
  if (typeof configured !== 'string' || configured.trim() === '') {
    throw new Error(`config.repos.${name} must be a non-empty path`);
  }
  return path.resolve(toolingRoot, configured);
}

function requireDirectory(directory, label) {
  if (!fs.existsSync(directory) || !fs.lstatSync(directory).isDirectory()) {
    throw new Error(`${label} is missing or is not a directory: ${directory}`);
  }
  if (fs.lstatSync(directory).isSymbolicLink()) {
    throw new Error(`${label} must not be a symbolic link: ${directory}`);
  }
}

function requireFile(filePath, label) {
  if (!fs.existsSync(filePath) || !fs.lstatSync(filePath).isFile() || fs.lstatSync(filePath).isSymbolicLink()) {
    throw new Error(`${label} is missing or unsafe: ${filePath}`);
  }
}

export function resolveDatasetValidationPaths(toolingRoot, config, runId) {
  if (!/^[a-f0-9]{12}$/u.test(runId)) throw new Error('Dataset validation run ID is unsafe');

  const resolvedToolingRoot = path.resolve(toolingRoot);
  requireDirectory(resolvedToolingRoot, 'FreeTV Tooling repository');
  const serverRoot = configuredRepository(resolvedToolingRoot, config, 'server');
  const dataRoot = configuredRepository(resolvedToolingRoot, config, 'data');
  requireDirectory(serverRoot, 'FreeTV Server repository');
  requireDirectory(dataRoot, 'FreeTV Data repository');

  for (const [label, repository] of [['Server', serverRoot], ['Data', dataRoot]]) {
    if (repository === path.parse(repository).root || repository === resolvedToolingRoot) {
      throw new Error(`FreeTV ${label} repository resolves to an unsafe path`);
    }
  }
  if (pathsOverlap(serverRoot, dataRoot)) {
    throw new Error('FreeTV Server and Data repository paths must not overlap');
  }

  const staging = resolveStagingPaths(resolvedToolingRoot, config);
  for (const repository of [serverRoot, dataRoot]) {
    if (pathsOverlap(repository, staging.ownedRoot)) {
      throw new Error(`Tooling-owned staging must not overlap a repository: ${repository}`);
    }
  }

  for (const relativePath of [
    'tools/export-viewer-data.php',
    'tools/export-thumbnails.php',
    'tools/generate-sql-packages.php',
    'tools/validate-sql-packages.php',
  ]) requireFile(path.join(serverRoot, relativePath), `Required Server tool ${relativePath}`);
  requireDirectory(path.join(serverRoot, 'sql'), 'Canonical Server SQL directory');

  const validationRoot = path.join(staging.stagingRoot, `data-validation-${runId}`);
  if (!isWithin(validationRoot, staging.stagingRoot)) {
    throw new Error('Dataset validation staging path escapes configured Tooling staging');
  }
  const sqlRoot = path.join(validationRoot, 'sql');
  const canonicalSqlRoot = path.join(serverRoot, 'sql');
  if (pathsOverlap(sqlRoot, canonicalSqlRoot)) {
    throw new Error('Temporary SQL candidate must not overlap canonical Server SQL');
  }

  return {
    toolingRoot: resolvedToolingRoot,
    serverRoot,
    dataRoot,
    stagingOwnedRoot: staging.ownedRoot,
    validationRoot,
    dataExportRoot: path.join(validationRoot, 'viewer-data'),
    thumbnailExportRoot: path.join(validationRoot, 'thumbnails'),
    sqlRoot,
    canonicalSqlRoot,
    markerPath: path.join(validationRoot, CANDIDATE_MARKER),
    stagingConfig: {
      ...config,
      staging: {
        root: validationRoot,
        data: 'viewer-data',
        thumbnails: 'thumbnails',
      },
    },
  };
}

export function runValidationCommand({ executable, args, cwd, label }) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      process.stdout.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      process.stderr.write(chunk);
    });
    child.once('error', (error) => {
      const message = error.code === 'ENOENT' && executable === 'php'
        ? `${label} requires PHP CLI, but 'php' was not found on PATH`
        : `${label} could not start: ${error.message}`;
      reject(new Error(message));
    });
    child.once('exit', (code, signal) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${label} failed${signal ? ` with signal ${signal}` : ` with exit code ${code}`}`));
    });
  });
}

export function parseSqlPackageSummary(stdout) {
  const line = stdout.split(/\r?\n/u).find((entry) => entry.startsWith('SQL_PACKAGE_SUMMARY '));
  if (!line) throw new Error('SQL generator did not report its package counts');
  let summary;
  try {
    summary = JSON.parse(line.slice('SQL_PACKAGE_SUMMARY '.length));
  } catch (error) {
    throw new Error(`SQL generator reported invalid package counts: ${error.message}`);
  }
  for (const key of ['playlist_count', 'show_count', 'sample_count']) {
    if (!Number.isInteger(summary[key]) || summary[key] < 1) {
      throw new Error(`SQL generator reported an invalid ${key}`);
    }
  }
  return summary;
}

export async function generateValidatedDatasetArtifacts({
  paths,
  commandRunner = runValidationCommand,
  logger = console,
}) {
  let stage = 'Viewer/data export';
  try {
    const staged = await stageServerExports({
      toolingRoot: paths.toolingRoot,
      config: paths.stagingConfig,
      commandRunner,
      logger,
    });
    const playlistCount = staged.dataManifest.dataset.playlist_count;
    const showCount = staged.dataManifest.dataset.show_count;

    fs.writeFileSync(paths.markerPath, CANDIDATE_MARKER_CONTENT, { flag: 'wx' });
    fs.mkdirSync(paths.sqlRoot);

    stage = 'SQL generation';
    const generation = await commandRunner({
      executable: 'php',
      args: [
        'tools/generate-sql-packages.php',
        `--expect-playlists=${playlistCount}`,
        `--expect-shows=${showCount}`,
        `--output-dir=${paths.sqlRoot}`,
      ],
      cwd: paths.serverRoot,
      label: 'SQL package generator',
    });
    const sqlSummary = parseSqlPackageSummary(generation?.stdout ?? '');

    stage = 'Viewer/SQL cross-check';
    if (sqlSummary.playlist_count !== playlistCount || sqlSummary.show_count !== showCount) {
      throw new Error(
        `artifact counts disagree: Viewer=${playlistCount}/${showCount}, SQL=${sqlSummary.playlist_count}/${sqlSummary.show_count}`,
      );
    }

    stage = 'SQL restore validation';
    await commandRunner({
      executable: 'php',
      args: [
        'tools/validate-sql-packages.php',
        '--run',
        `--expect-playlists=${playlistCount}`,
        `--expect-shows=${showCount}`,
        `--expect-sample-shows=${sqlSummary.sample_count}`,
        `--package-dir=${paths.sqlRoot}`,
      ],
      cwd: paths.serverRoot,
      label: 'SQL package restore validator',
    });

    return { ...staged, sqlSummary };
  } catch (error) {
    throw new Error(`Dataset publication validation failed during ${stage}: ${error.message}`, { cause: error });
  }
}

function formatReport(result) {
  return [
    'GO — Dataset is safe to publish',
    '',
    'Dataset publication validation passed',
    '',
    `  Playlists:        ${result.playlistCount}`,
    `  Shows:            ${result.showCount}`,
    `  Sample shows:     ${result.sampleShowCount}`,
    `  Thumbnails:       ${result.thumbnailCount}`,
    `  Thumbnail bytes:  ${result.thumbnailBytes}`,
    '',
    '  Viewer exports:   passed',
    '  SQL generation:   passed',
    '  SQL restores:     passed',
    '  Pair equivalence: passed',
    '  Cross-checks:     passed',
    '',
    'No dataset was published.',
  ].join('\n');
}

export async function validateDatasetPublication({
  toolingRoot,
  config,
  commandRunner = runValidationCommand,
  logger = console,
  runId = crypto.randomBytes(6).toString('hex'),
} = {}) {
  const paths = resolveDatasetValidationPaths(toolingRoot, config, runId);
  let failure;
  let result;

  try {
    const staged = await generateValidatedDatasetArtifacts({
      paths,
      commandRunner,
      logger,
    });
    const playlistCount = staged.dataManifest.dataset.playlist_count;
    const showCount = staged.dataManifest.dataset.show_count;

    result = {
      playlistCount,
      showCount,
      sampleShowCount: staged.sqlSummary.sample_count,
      thumbnailCount: staged.thumbnailManifest.dataset.thumbnail_count,
      thumbnailBytes: staged.thumbnailManifest.dataset.total_bytes,
    };
  } catch (error) {
    failure = error;
  }

  try {
    resetStaging(paths.validationRoot, paths.stagingOwnedRoot);
  } catch (error) {
    failure = new Error(
      failure
        ? `${failure.message}; cleanup also failed: ${error.message}`
        : `Dataset publication validation cleanup failed: ${error.message}`,
      { cause: error },
    );
  }

  if (failure) throw failure;
  logger.log(formatReport(result));
  return result;
}
