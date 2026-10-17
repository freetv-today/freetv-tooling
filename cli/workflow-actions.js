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

export async function runCompleteProductionBuild({
  toolingRoot = defaultToolingRoot,
  platform = process.platform,
  commandRunner = runCommand,
} = {}) {
  await commandRunner({
    executable: platform === 'win32' ? 'npm.cmd' : 'npm',
    args: ['run', 'build:all'],
    cwd: toolingRoot,
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
