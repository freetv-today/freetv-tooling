import { spawn } from 'node:child_process';

export class CommandExecutionError extends Error {
  constructor(message, result, options = {}) {
    super(message, options);
    this.name = 'CommandExecutionError';
    this.result = result;
    this.kind = result.kind;
    this.exitCode = result.exitCode;
    this.signal = result.signal;
  }
}

export function runCommand({
  executable,
  args = [],
  cwd,
  env = process.env,
  stdio = 'inherit',
  signal,
  spawnProcess = spawn,
} = {}) {
  if (typeof executable !== 'string' || executable === '') {
    return Promise.reject(new TypeError('Command executable must be a non-empty string'));
  }
  if (signal?.aborted) {
    const result = { kind: 'cancelled', executable, args, cwd, exitCode: null, signal: null };
    return Promise.reject(new CommandExecutionError(`Command was cancelled before launch: ${executable}`, result));
  }

  return new Promise((resolve, reject) => {
    let child;
    let settled = false;
    let cancelled = false;

    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', abort);
      callback(value);
    };
    const fail = (kind, message, details = {}, cause) => {
      const result = {
        kind, executable, args, cwd, exitCode: null, signal: null, ...details,
      };
      settle(reject, new CommandExecutionError(message, result, cause ? { cause } : {}));
    };
    const abort = () => {
      if (settled) return;
      cancelled = true;
      try {
        child?.kill('SIGTERM');
      } catch (error) {
        fail('cancelled', `Command cancellation could not terminate ${executable}: ${error.message}`, {}, error);
      }
    };

    try {
      child = spawnProcess(executable, args, { cwd, env, stdio });
    } catch (error) {
      fail('spawn', `Command could not be launched: ${executable}: ${error.message}`, {}, error);
      return;
    }

    child.on('error', (error) => {
      if (cancelled) {
        fail('cancelled', `Command was cancelled; termination reported an error for ${executable}: ${error.message}`, {}, error);
      } else {
        fail('spawn', `Command could not be launched: ${executable}: ${error.message}`, {}, error);
      }
    });
    child.once('close', (exitCode, exitSignal) => {
      if (cancelled) {
        fail('cancelled', `Command was cancelled: ${executable}`, { exitCode, signal: exitSignal });
      } else if (exitSignal) {
        fail('signal', `Command terminated by signal ${exitSignal}: ${executable}`, {
          exitCode,
          signal: exitSignal,
        });
      } else if (exitCode !== 0) {
        fail('exit', `Command exited with code ${exitCode ?? 1}: ${executable}`, {
          exitCode: exitCode ?? 1,
        });
      } else {
        settle(resolve, {
          kind: 'success', executable, args, cwd, exitCode: 0, signal: null,
        });
      }
    });

    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
}
