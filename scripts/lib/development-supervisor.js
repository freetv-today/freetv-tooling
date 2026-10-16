import { spawn, spawnSync } from 'node:child_process';

function childStopped(child, state) {
  return state.exited || child.exitCode !== null || child.signalCode !== null;
}

export function signalProcessTree(child, signal, {
  platform = process.platform,
  killProcessGroup = process.kill,
  taskkill = spawnSync,
  force = false,
} = {}) {
  if (!child.pid) return { requested: false, error: 'child PID is unavailable' };
  try {
    if (platform === 'win32') {
      const args = ['/PID', String(child.pid), '/T'];
      if (force) args.push('/F');
      const result = taskkill('taskkill', args, { stdio: 'ignore' });
      if (result.error || result.status !== 0) {
        return { requested: false, error: result.error?.message ?? `taskkill exited ${result.status}` };
      }
    } else {
      killProcessGroup(-child.pid, signal);
    }
    return { requested: true };
  } catch (error) {
    if (error.code === 'ESRCH') return { requested: true };
    try {
      if (child.kill(signal)) return { requested: true, fallback: true };
    } catch (fallbackError) {
      return { requested: false, error: `${error.message}; fallback failed: ${fallbackError.message}` };
    }
    return { requested: false, error: error.message };
  }
}

export async function startDevelopmentSupervisor({
  services,
  preflight,
  spawnProcess = spawn,
  signalTree = signalProcessTree,
  waitForTimeout = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  graceMilliseconds = 3000,
  forceMilliseconds = 1000,
} = {}) {
  await preflight(services);

  const records = [];
  let stopping;
  let shutdownStarted = false;
  let resolveCompletion;
  const completion = new Promise((resolve) => { resolveCompletion = resolve; });

  const allStopped = () => records.every(({ child, state }) => childStopped(child, state));
  const waitUntilStopped = async (milliseconds) => {
    if (allStopped()) return true;
    await Promise.race([
      Promise.all(records.map(({ state }) => state.done)),
      waitForTimeout(milliseconds),
    ]);
    return allStopped();
  };

  const stop = (reason = { kind: 'cancelled', exitCode: 1 }) => {
    if (stopping) return stopping;
    shutdownStarted = true;
    stopping = (async () => {
      const signalErrors = [];
      for (const record of records) {
        if (childStopped(record.child, record.state)) continue;
        const outcome = signalTree(record.child, 'SIGTERM', { force: false, service: record.service });
        if (!outcome?.requested) signalErrors.push(`${record.service.label}: ${outcome?.error ?? 'SIGTERM failed'}`);
      }
      let stopped = await waitUntilStopped(graceMilliseconds);
      if (!stopped) {
        for (const record of records) {
          if (childStopped(record.child, record.state)) continue;
          const outcome = signalTree(record.child, 'SIGKILL', { force: true, service: record.service });
          if (!outcome?.requested) signalErrors.push(`${record.service.label}: ${outcome?.error ?? 'forced termination failed'}`);
        }
        stopped = await waitUntilStopped(forceMilliseconds);
      }
      const unresolved = records.filter(({ child, state }) => !childStopped(child, state))
        .map(({ service }) => service.label);
      const result = { ...reason, stopped, unresolved, signalErrors };
      resolveCompletion(result);
      return result;
    })();
    return stopping;
  };

  for (const service of services) {
    let child;
    try {
      child = spawnProcess(service.executable, service.args, service.options);
    } catch (error) {
      await stop({ kind: 'spawn', service: service.label, error, exitCode: 1 });
      break;
    }
    let resolveDone;
    const state = { exited: false, done: new Promise((resolve) => { resolveDone = resolve; }) };
    records.push({ service, child, state });
    const fail = (reason) => { void stop(reason); };
    child.on('error', (error) => fail({
      kind: 'spawn', service: service.label, error, exitCode: 1,
    }));
    child.once('exit', (code, signal) => {
      state.exited = true;
      resolveDone();
      if (!shutdownStarted) fail({
        kind: 'unexpected-exit', service: service.label, code, signal,
        exitCode: code && code !== 0 ? code : 1,
      });
    });
  }

  return { services, records, completion, stop };
}
