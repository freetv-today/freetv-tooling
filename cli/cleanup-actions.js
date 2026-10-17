import { runThumbnailCleanup } from '../scripts/clean-thumbs.js';
import { runViewerDataCleanCli } from '../scripts/dev-clean-viewer-data.js';
import { runViewerDataInstallCli } from '../scripts/dev-install-viewer-data.js';

const CLEANUP_ACTIONS = Object.freeze({
  'thumbs-dry-run': {
    label: 'Find Unused Thumbnails', operation: 'runThumbnailCleanup', args: [{ args: [] }],
  },
  'thumbs-apply': {
    label: 'Remove Unused Thumbnails', operation: 'runThumbnailCleanup', args: [{ args: ['--apply'] }],
  },
  'viewer-install': {
    label: 'Install Viewer Development Data', operation: 'runViewerDataInstallCli', args: [],
  },
  'viewer-remove': {
    label: 'Remove Viewer Development Data', operation: 'runViewerDataCleanCli', args: [],
  },
});

const defaultOperations = Object.freeze({
  runThumbnailCleanup,
  runViewerDataInstallCli,
  runViewerDataCleanCli,
});

export async function runCleanupAction(actionName, {
  operations = defaultOperations,
  presentation = {},
} = {}) {
  const action = CLEANUP_ACTIONS[actionName];
  if (!action) throw new Error(`Unknown cleanup action: ${actionName}`);

  try {
    const status = await operations[action.operation](...action.args);
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
