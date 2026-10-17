import { runBuildAction, runDiagnosticAction } from './actions.js';
import { runDevelopmentSession } from './development-session.js';
import { runDatasetAction, runProductionAction } from './workflow-actions.js';

export const MAIN_MENU_OPTIONS = Object.freeze([
  { value: 'dev', label: 'Run Apps Locally (Dev)' },
  { value: 'build-local', label: 'Build Apps Locally' },
  { value: 'build-production', label: 'Build for Production' },
  { value: 'dataset', label: 'Dataset Operations' },
  { value: 'cleanup', label: 'Cleanup Tools — Coming later' },
  { value: 'diagnostics', label: 'Tests & Diagnostics' },
  { value: 'exit', label: 'Exit' },
]);

export const DIAGNOSTICS_MENU_OPTIONS = Object.freeze([
  { value: 'status', label: 'Tooling Status' },
  { value: 'verify', label: 'Verify Production Assembly' },
  { value: 'validate', label: 'Validate Dataset' },
  { value: 'back', label: 'Back to Main Menu' },
]);

export const DEVELOPMENT_MENU_OPTIONS = Object.freeze([
  { value: 'start', label: 'Start Development Environment (Viewer + Admin + PHP)' },
  { value: 'back', label: 'Back to Main Menu' },
]);

export const BUILD_MENU_OPTIONS = Object.freeze([
  { value: 'viewer', label: 'Build Viewer' },
  { value: 'admin', label: 'Build Admin' },
  { value: 'both', label: 'Build Both' },
  { value: 'back', label: 'Back to Main Menu' },
]);

export const PRODUCTION_MENU_OPTIONS = Object.freeze([
  { value: 'complete', label: 'Complete Production Build' },
  { value: 'stage', label: 'Stage Admin Exports' },
  { value: 'assemble', label: 'Assemble Production Output' },
  { value: 'verify', label: 'Verify Production Output' },
  { value: 'back', label: 'Back to Main Menu' },
]);

export const DATASET_MENU_OPTIONS = Object.freeze([
  { value: 'validate', label: 'Validate Dataset' },
  { value: 'compare', label: 'Compare Snapshot' },
  { value: 'publish', label: 'Publish Snapshot to Local Data Repository' },
  { value: 'release', label: 'Build Release Packages' },
  { value: 'back', label: 'Back to Main Menu' },
]);

const FUTURE_CATEGORIES = new Set(['cleanup']);
const PRODUCTION_CONFIRMATIONS = Object.freeze({
  complete: 'Build Viewer and Admin, stage exports, assemble, and verify the local production output?',
  stage: 'Replace the disposable Admin export staging contents?',
  assemble: 'Assemble and potentially replace the configured local production output?',
});

function presentation(prompts) {
  return { success: prompts.log.success, error: prompts.log.error };
}

export async function runInteractiveCli({
  applicationName,
  version,
  prompts,
  operations,
  signalSource = process,
} = {}) {
  prompts.intro(applicationName);
  prompts.note(version, 'Version');
  let finalStatus = 0;

  const cancelled = (selection) => {
    if (!prompts.isCancel(selection)) return false;
    prompts.cancel('Cancelled.');
    return true;
  };

  while (true) {
    const mainSelection = await prompts.select({
      message: 'What would you like to do?',
      options: MAIN_MENU_OPTIONS,
    });
    if (cancelled(mainSelection)) return finalStatus;
    if (mainSelection === 'exit') {
      prompts.outro('Goodbye!');
      return finalStatus;
    }
    if (FUTURE_CATEGORIES.has(mainSelection)) {
      const selected = MAIN_MENU_OPTIONS.find(({ value }) => value === mainSelection);
      prompts.note('This category will be available in a later CLI slice.', selected.label.replace(' — Coming later', ''));
      continue;
    }

    if (mainSelection === 'dev') {
      let showDevelopment = true;
      while (showDevelopment) {
        const developmentSelection = await prompts.select({
          message: 'Run Apps Locally (Dev)', options: DEVELOPMENT_MENU_OPTIONS,
        });
        if (cancelled(developmentSelection)) return finalStatus;
        if (developmentSelection === 'back') {
          showDevelopment = false;
          continue;
        }
        const outcome = await runDevelopmentSession({
          startEnvironment: operations?.runDevelopmentEnvironment,
          signalSource,
          presentation: {
            note: prompts.note, info: prompts.log.info,
            success: prompts.log.success, error: prompts.log.error,
          },
        });
        if (outcome.status !== 0) finalStatus = 1;
        if (!outcome.returnToMenu) {
          prompts.outro(outcome.status === 0
            ? 'Development environment stopped after SIGTERM. Exiting Tooling.'
            : 'Development process state is unresolved. Exiting Tooling.');
          return finalStatus;
        }
      }
      continue;
    }

    if (mainSelection === 'build-local') {
      let showBuilds = true;
      while (showBuilds) {
        const buildSelection = await prompts.select({
          message: 'Build Apps Locally', options: BUILD_MENU_OPTIONS,
        });
        if (cancelled(buildSelection)) return finalStatus;
        if (buildSelection === 'back') {
          showBuilds = false;
          continue;
        }
        const confirmed = await prompts.confirm({
          message: `${BUILD_MENU_OPTIONS.find(({ value }) => value === buildSelection).label} will update local build output. Continue?`,
        });
        if (cancelled(confirmed)) return finalStatus;
        if (!confirmed) {
          prompts.log.info('Build cancelled; no build was started.');
          continue;
        }
        const status = await runBuildAction(buildSelection, {
          operations,
          presentation: {
            note: prompts.note, success: prompts.log.success, error: prompts.log.error,
          },
        });
        if (status !== 0) finalStatus = 1;
      }
      continue;
    }

    if (mainSelection === 'build-production') {
      let showProduction = true;
      while (showProduction) {
        const productionSelection = await prompts.select({
          message: 'Build for Production', options: PRODUCTION_MENU_OPTIONS,
        });
        if (cancelled(productionSelection)) return finalStatus;
        if (productionSelection === 'back') {
          showProduction = false;
          continue;
        }
        if (productionSelection !== 'verify') {
          const confirmed = await prompts.confirm({
            message: PRODUCTION_CONFIRMATIONS[productionSelection], initialValue: false,
          });
          if (cancelled(confirmed)) return finalStatus;
          if (!confirmed) {
            prompts.log.info('Operation cancelled; nothing was started.');
            continue;
          }
        }
        const status = await runProductionAction(productionSelection, {
          operations, presentation: presentation(prompts),
        });
        if (status !== 0) finalStatus = 1;
      }
      continue;
    }

    if (mainSelection === 'dataset') {
      let showDatasets = true;
      while (showDatasets) {
        const datasetSelection = await prompts.select({
          message: 'Dataset Operations', options: DATASET_MENU_OPTIONS,
        });
        if (cancelled(datasetSelection)) return finalStatus;
        if (datasetSelection === 'back') {
          showDatasets = false;
          continue;
        }

        let snapshotPath;
        if (datasetSelection === 'compare' || datasetSelection === 'publish') {
          snapshotPath = await prompts.text({
            message: 'Snapshot directory or ZIP path:',
            validate: (value) => (typeof value !== 'string' || value.trim() === ''
              ? 'Enter a snapshot directory or ZIP path.' : undefined),
          });
          if (cancelled(snapshotPath)) return finalStatus;
          if (typeof snapshotPath !== 'string' || snapshotPath.trim() === '') {
            prompts.log.error('A snapshot directory or ZIP path is required.');
            continue;
          }
        }

        if (datasetSelection === 'publish') {
          prompts.note([
            `Snapshot: ${snapshotPath}`,
            'This changes the local freetv-data repository and synchronizes Admin SQL copies.',
            'It does not update the live website or create a GitHub release.',
          ].join('\n'), 'Publish Snapshot');
        } else if (datasetSelection === 'release') {
          prompts.note(
            'This rebuilds and replaces the local Sample and Official First Run release ZIPs. It does not upload them.',
            'Build Release Packages',
          );
        }

        if (datasetSelection === 'publish' || datasetSelection === 'release') {
          const confirmed = await prompts.confirm({
            message: `Continue with ${DATASET_MENU_OPTIONS.find(({ value }) => value === datasetSelection).label}?`,
            initialValue: false,
          });
          if (cancelled(confirmed)) return finalStatus;
          if (!confirmed) {
            prompts.log.info('Operation cancelled; nothing was started.');
            continue;
          }
        }

        const status = await runDatasetAction(datasetSelection, {
          snapshotPath, operations, presentation: presentation(prompts),
        });
        if (status !== 0) finalStatus = 1;
      }
      continue;
    }

    if (mainSelection !== 'diagnostics') continue;

    let showDiagnostics = true;
    while (showDiagnostics) {
      const diagnosticsSelection = await prompts.select({
        message: 'Tests & Diagnostics',
        options: DIAGNOSTICS_MENU_OPTIONS,
      });
      if (cancelled(diagnosticsSelection)) return finalStatus;
      if (diagnosticsSelection === 'back') {
        showDiagnostics = false;
        continue;
      }
      const status = await runDiagnosticAction(diagnosticsSelection, {
        operations,
        presentation: {
          note: prompts.note,
          success: prompts.log.success,
          error: prompts.log.error,
        },
      });
      if (status !== 0) finalStatus = 1;
    }
  }
}
