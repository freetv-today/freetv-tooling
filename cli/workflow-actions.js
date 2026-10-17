import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAssembleCli } from '../scripts/assemble.js';
import { runStageExportsCli } from '../scripts/build-data.js';
import { runContentCompareCli } from '../scripts/content-compare.js';
import { runDataPublishCli } from '../scripts/data-publish.js';
import { runDataValidationCli } from '../scripts/data-validate.js';
import { runCommand } from '../scripts/lib/command-runner.js';
import { runReleaseBuildCli } from '../scripts/release-build.js';
import { runVerifyCli } from '../scripts/verify.js';

const defaultToolingRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function fileExists(target, fileSystem) {
  try {
    return fileSystem.statSync(target).isFile();
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

export function resolveNpmCliPath({
  environment = process.env,
  nodeExecutable = process.execPath,
  platform = process.platform,
  fileSystem = fs,
} = {}) {
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  const candidates = [];
  if (typeof environment.npm_execpath === 'string' && environment.npm_execpath.trim() !== '') {
    candidates.push(pathApi.resolve(environment.npm_execpath));
  }

  const nodeDirectory = pathApi.dirname(nodeExecutable);
  if (platform === 'win32') {
    candidates.push(pathApi.join(nodeDirectory, 'node_modules', 'npm', 'bin', 'npm-cli.js'));
  } else {
    candidates.push(pathApi.resolve(nodeDirectory, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'));
    candidates.push(pathApi.join(nodeDirectory, 'node_modules', 'npm', 'bin', 'npm-cli.js'));
  }

  const npmCliPath = [...new Set(candidates)].find((candidate) => fileExists(candidate, fileSystem));
  if (!npmCliPath) {
    throw new Error(`Could not resolve npm's JavaScript CLI entry point; checked: ${candidates.join(', ')}`);
  }
  return npmCliPath;
}

export async function runCompleteProductionBuild({
  toolingRoot = defaultToolingRoot,
  environment = process.env,
  nodeExecutable = process.execPath,
  platform = process.platform,
  fileSystem = fs,
  commandRunner = runCommand,
} = {}) {
  const npmCliPath = resolveNpmCliPath({ environment, nodeExecutable, platform, fileSystem });
  await commandRunner({
    executable: nodeExecutable,
    args: [npmCliPath, 'run', 'build:all'],
    cwd: toolingRoot,
    env: environment,
    stdio: 'inherit',
  });
  return 0;
}

const defaultOperations = Object.freeze({
  runCompleteProductionBuild,
  runStageExportsCli,
  runAssembleCli,
  runVerifyCli,
  runDataValidationCli,
  runContentCompareCli,
  runDataPublishCli,
  runReleaseBuildCli,
});

const PRODUCTION_ACTIONS = Object.freeze({
  complete: { label: 'Complete Production Build', operation: 'runCompleteProductionBuild' },
  stage: { label: 'Stage Admin Exports', operation: 'runStageExportsCli' },
  assemble: { label: 'Assemble Production Output', operation: 'runAssembleCli' },
  verify: { label: 'Verify Production Output', operation: 'runVerifyCli' },
});

const DATASET_ACTIONS = Object.freeze({
  validate: { label: 'Validate Dataset', operation: 'runDataValidationCli', args: () => [] },
  compare: {
    label: 'Compare Snapshot', operation: 'runContentCompareCli',
    args: (snapshotPath) => [{ args: [snapshotPath] }],
  },
  publish: {
    label: 'Publish Snapshot', operation: 'runDataPublishCli',
    args: (snapshotPath) => [{ args: [`--snapshot=${snapshotPath}`] }],
  },
  release: { label: 'Build Release Packages', operation: 'runReleaseBuildCli', args: () => [] },
});

async function dispatch(action, args, operations, presentation) {
  try {
    const status = await operations[action.operation](...args);
    if (status !== 0) {
      presentation.error?.(`${action.label} failed; review the operation diagnostics above.`);
      return 1;
    }
  } catch (error) {
    presentation.error?.(`${action.label} failed: ${error.message}`);
    return 1;
  }
  presentation.success?.(`${action.label} completed successfully.`);
  return 0;
}

export function runProductionAction(actionName, {
  operations = defaultOperations,
  presentation = {},
} = {}) {
  const action = PRODUCTION_ACTIONS[actionName];
  if (!action) throw new Error(`Unknown production action: ${actionName}`);
  return dispatch(action, [], operations, presentation);
}

export function runDatasetAction(actionName, {
  snapshotPath,
  operations = defaultOperations,
  presentation = {},
} = {}) {
  const action = DATASET_ACTIONS[actionName];
  if (!action) throw new Error(`Unknown dataset action: ${actionName}`);
  return dispatch(action, action.args(snapshotPath), operations, presentation);
}
