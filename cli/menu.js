import { runBuildAction, runDiagnosticAction } from './actions.js';
import { runDevelopmentSession } from './development-session.js';

export const MAIN_MENU_OPTIONS = Object.freeze([
  { value: 'dev', label: 'Run Apps Locally (Dev)' },
  { value: 'build-local', label: 'Build Apps Locally' },
  { value: 'build-production', label: 'Build for Production — Coming later' },
  { value: 'dataset', label: 'Dataset Operations — Coming later' },
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

const FUTURE_CATEGORIES = new Set(['build-production', 'dataset', 'cleanup']);

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
