import { runDiagnosticAction } from './actions.js';

export const MAIN_MENU_OPTIONS = Object.freeze([
  { value: 'dev', label: 'Run Apps Locally (Dev) — Coming later' },
  { value: 'build-local', label: 'Build Apps Locally — Coming later' },
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

const FUTURE_CATEGORIES = new Set(['dev', 'build-local', 'build-production', 'dataset', 'cleanup']);

export async function runInteractiveCli({ applicationName, version, prompts, operations } = {}) {
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
