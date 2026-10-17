import { runDevelopmentEnvironment } from '../scripts/dev-all.js';

function describeFailure(result) {
  const details = [];
  if (result.service) details.push(`service: ${result.service}`);
  if (result.error?.message) details.push(result.error.message);
  if (result.code !== undefined && result.code !== null) details.push(`exit code: ${result.code}`);
  if (result.signal) details.push(`signal: ${result.signal}`);
  return details.length > 0 ? ` (${details.join(', ')})` : '';
}

export async function runDevelopmentSession({
  startEnvironment = runDevelopmentEnvironment,
  signalSource = process,
  presentation = {},
} = {}) {
  let session;
  let requestedReason;
  let stopRequested = false;

  const requestStop = (signal) => {
    if (stopRequested) return;
    stopRequested = true;
    requestedReason = { kind: 'cancelled', signal, exitCode: signal === 'SIGINT' ? 130 : 143 };
    if (session) void session.stop(requestedReason);
  };
  const onSigint = () => requestStop('SIGINT');
  const onSigterm = () => requestStop('SIGTERM');

  signalSource.on('SIGINT', onSigint);
  signalSource.on('SIGTERM', onSigterm);
  presentation.note?.(
    'Viewer, Admin, and PHP will run under the existing development supervisor.',
    'Start Development Environment',
  );
  presentation.info?.('Press Ctrl+C to stop the development environment and return to the menu.');

  try {
    session = await startEnvironment();
    if (requestedReason) void session.stop(requestedReason);
    const result = await session.completion;
    const unresolved = result.unresolved ?? [];
    const signalErrors = result.signalErrors ?? [];
    const confirmedStopped = result.stopped === true && unresolved.length === 0;

    if (!confirmedStopped) {
      presentation.error?.(`Development shutdown is incomplete. Unresolved services: ${unresolved.join(', ') || 'unknown'}.`);
      for (const error of signalErrors) presentation.error?.(`Shutdown signaling error: ${error}`);
      return { status: 1, returnToMenu: false, result };
    }
    for (const error of signalErrors) presentation.error?.(`Shutdown signaling error: ${error}`);
    if (result.kind !== 'cancelled') {
      const summary = result.kind === 'spawn'
        ? 'Development environment startup failed'
        : 'Development environment stopped unexpectedly';
      presentation.error?.(`${summary}${describeFailure(result)}.`);
      return { status: 1, returnToMenu: true, result };
    }

    presentation.success?.('Development environment stopped.');
    return { status: 0, returnToMenu: result.signal !== 'SIGTERM', result };
  } catch (error) {
    presentation.error?.(`Development environment failed to start: ${error.message}`);
    return { status: 1, returnToMenu: true, error };
  } finally {
    signalSource.removeListener('SIGINT', onSigint);
    signalSource.removeListener('SIGTERM', onSigterm);
  }
}
