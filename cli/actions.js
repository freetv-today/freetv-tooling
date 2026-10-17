import { runDataValidationCli } from '../scripts/data-validate.js';
import { runAdminBuild } from '../scripts/build-admin.js';
import { runViewerBuild } from '../scripts/build-viewer.js';
import { runStatusCli } from '../scripts/status.js';
import { runVerifyCli } from '../scripts/verify.js';

export const DIAGNOSTIC_ACTIONS = Object.freeze({
  status: { label: 'Tooling Status', operation: 'runStatusCli' },
  verify: { label: 'Verify Production Assembly', operation: 'runVerifyCli' },
  validate: { label: 'Validate Dataset', operation: 'runDataValidationCli' },
});

const defaultOperations = Object.freeze({ runStatusCli, runVerifyCli, runDataValidationCli });

export const BUILD_ACTIONS = Object.freeze({
  viewer: { label: 'Build Viewer', operations: ['runViewerBuild'] },
  admin: { label: 'Build Admin', operations: ['runAdminBuild'] },
  both: { label: 'Build Both', operations: ['runViewerBuild', 'runAdminBuild'] },
});

const defaultBuildOperations = Object.freeze({ runViewerBuild, runAdminBuild });

export async function runDiagnosticAction(actionName, {
  operations = defaultOperations,
  presentation = {},
} = {}) {
  const action = DIAGNOSTIC_ACTIONS[actionName];
  if (!action) throw new Error(`Unknown diagnostics action: ${actionName}`);

  presentation.note?.(action.label, 'Running');
  let status;
  try {
    status = await operations[action.operation]();
  } catch (error) {
    presentation.error?.(`${action.label} failed: ${error.message}`);
    return 1;
  }

  if (status === 0) {
    presentation.success?.(`${action.label} completed successfully.`);
    return 0;
  }
  presentation.error?.(`${action.label} failed (exit status ${status}).`);
  return 1;
}

export async function runBuildAction(actionName, {
  operations = defaultBuildOperations,
  presentation = {},
} = {}) {
  const action = BUILD_ACTIONS[actionName];
  if (!action) throw new Error(`Unknown build action: ${actionName}`);

  presentation.note?.('Local build output will be updated.', action.label);
  try {
    for (const operation of action.operations) await operations[operation]();
  } catch (error) {
    presentation.error?.(`${action.label} failed: ${error.message}`);
    return 1;
  }
  presentation.success?.(`${action.label} completed successfully.`);
  return 0;
}
