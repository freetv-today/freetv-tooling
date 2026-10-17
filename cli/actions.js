import { runDataValidationCli } from '../scripts/data-validate.js';
import { runStatusCli } from '../scripts/status.js';
import { runVerifyCli } from '../scripts/verify.js';

export const DIAGNOSTIC_ACTIONS = Object.freeze({
  status: { label: 'Tooling Status', operation: 'runStatusCli' },
  verify: { label: 'Verify Production Assembly', operation: 'runVerifyCli' },
  validate: { label: 'Validate Dataset', operation: 'runDataValidationCli' },
});

const defaultOperations = Object.freeze({ runStatusCli, runVerifyCli, runDataValidationCli });

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
