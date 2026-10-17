import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  launchDevelopmentTerminal,
  resolveDevelopmentTerminalInvocation,
} from '../cli/development-terminal.js';
import {
  parseDevelopmentSelection,
  runDevelopmentTerminalEntry,
  waitForDevelopmentTerminal,
} from '../cli/development-entry.js';

const toolingRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function executableFixture(available) {
  return {
    constants: fs.constants,
    accessSync(target) {
      if (!available.includes(target)) {
        const error = new Error(`missing ${target}`);
        error.code = 'ENOENT';
        throw error;
      }
    },
  };
}

test('Linux terminal adapters preserve direct Node arguments and explicit terminal preference', () => {
  const environment = {
    DISPLAY: ':1', PATH: '/usr/bin:/opt/Terminal Apps/bin', FREETV_TERMINAL: 'gnome-terminal',
  };
  const invocation = resolveDevelopmentTerminalInvocation({
    selection: 'viewer', platform: 'linux', environment,
    nodeExecutable: '/Node Runtime/bin/node', entryPath: '/Tooling Path/cli/development-entry.js',
    cwd: '/Tooling Path', fileSystem: executableFixture(['/usr/bin/gnome-terminal']),
  });
  assert.equal(invocation.executable, '/usr/bin/gnome-terminal');
  assert.deepEqual(invocation.args, [
    '--window', '--wait', '--', '/Node Runtime/bin/node',
    '/Tooling Path/cli/development-entry.js', '--selection=viewer',
  ]);
});

test('Linux adapters use emulator-specific argument contracts', () => {
  const cases = [
    ['x-terminal-emulator', ['-e']],
    ['gnome-terminal.wrapper', ['-e']],
    ['xfce4-terminal', ['--disable-server', '--hold', '--execute']],
    ['mate-terminal', ['--disable-factory', '--execute']],
    ['konsole', ['--hold', '-e']],
    ['xterm', ['-hold', '-e']],
    ['kitty', ['--hold']],
    ['alacritty', ['-e']],
  ];
  for (const [terminal, prefix] of cases) {
    const executable = `/terminals/${terminal}`;
    const invocation = resolveDevelopmentTerminalInvocation({
      selection: 'all', platform: 'linux',
      environment: { WAYLAND_DISPLAY: 'wayland-0', PATH: '/terminals', FREETV_TERMINAL: terminal },
      nodeExecutable: '/node', entryPath: '/entry', cwd: '/tooling',
      fileSystem: executableFixture([executable]),
    });
    assert.deepEqual(invocation.args, [...prefix, '/node', '/entry', '--selection=all']);
  }
});

test('Linux launch refuses missing graphical support and unsupported or absent terminals', () => {
  assert.throws(() => resolveDevelopmentTerminalInvocation({
    selection: 'all', platform: 'linux', environment: { PATH: '/bin' },
    fileSystem: executableFixture([]),
  }), /No graphical Linux environment/u);
  assert.throws(() => resolveDevelopmentTerminalInvocation({
    selection: 'all', platform: 'linux',
    environment: { DISPLAY: ':1', PATH: '/bin', FREETV_TERMINAL: 'unknown-terminal' },
    fileSystem: executableFixture([]),
  }), /Unsupported FREETV_TERMINAL/u);
  assert.throws(() => resolveDevelopmentTerminalInvocation({
    selection: 'all', platform: 'linux', environment: { DISPLAY: ':1', PATH: '/empty' },
    fileSystem: executableFixture([]),
  }), /No supported graphical terminal executable was found/u);
});

test('Windows uses PowerShell Start-Process with escaped Node arguments', () => {
  const invocation = resolveDevelopmentTerminalInvocation({
    selection: 'admin', platform: 'win32',
    environment: { ComSpec: 'C:\\Windows\\System32\\cmd.exe' },
    nodeExecutable: "C:\\Program Files\\Node's Runtime\\node.exe",
    entryPath: 'C:\\FreeTV & Tools\\cli\\development-entry.js',
    cwd: "C:\\Ken's FreeTV & Tools",
  });
  assert.equal(invocation.executable, 'powershell.exe');
  assert.deepEqual(invocation.args.slice(0, 4), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command']);
  assert.match(invocation.args[4], /Start-Process -FilePath 'C:\\Program Files\\Node''s Runtime\\node\.exe'/u);
  assert.match(invocation.args[4], /'"--selection=admin"'/u);
  assert.match(invocation.args[4], /'"C:\\FreeTV & Tools\\cli\\development-entry\.js"'/u);
  assert.match(invocation.args[4], /-WorkingDirectory 'C:\\Ken''s FreeTV & Tools'/u);
});

test('macOS Terminal.app command safely quotes spaces, quotes, and shell characters', () => {
  const invocation = resolveDevelopmentTerminalInvocation({
    selection: 'viewer', platform: 'darwin',
    environment: {}, nodeExecutable: "/Node's $ Runtime/node",
    entryPath: '/FreeTV & Tools/development-entry.js', cwd: "/Ken's Tools",
  });
  assert.equal(invocation.executable, '/usr/bin/osascript');
  assert.equal(invocation.args[0], '-e');
  assert.match(invocation.args[1], /tell application "Terminal" to do script/u);
  assert.match(invocation.args[1], /--selection=viewer/u);
  assert.equal(invocation.args[1].includes(`'\\"'\\"'`), true);
  assert.match(invocation.args[1], /\$ Runtime/u);
});

test('invalid development selections and unsupported platforms fail before launch', () => {
  assert.throws(() => resolveDevelopmentTerminalInvocation({ selection: 'php', platform: 'linux' }), /Unsupported development terminal selection/u);
  assert.throws(() => resolveDevelopmentTerminalInvocation({ selection: 'all', platform: 'aix' }), /not supported on platform/u);
});

test('terminal launch resolves on spawn, detaches, and does not await later termination', async () => {
  const child = new EventEmitter();
  child.pid = 42;
  let unref = 0;
  child.unref = () => { unref += 1; };
  let spawned;
  const launched = launchDevelopmentTerminal({
    selection: 'viewer', platform: 'linux',
    environment: { DISPLAY: ':1', PATH: '/usr/bin', FREETV_TERMINAL: 'xterm' },
    nodeExecutable: '/node', entryPath: '/entry', cwd: '/tooling',
    fileSystem: executableFixture(['/usr/bin/xterm']),
    spawnProcess(executable, args, options) {
      spawned = { executable, args, options };
      return child;
    },
  });
  child.emit('spawn');
  assert.equal((await launched).pid, 42);
  assert.equal(unref, 1);
  assert.equal(spawned.options.detached, true);
  assert.equal(spawned.options.stdio, 'ignore');
  child.emit('close', 1);
  child.emit('error', new Error('late terminal error'));
});

test('synchronous and asynchronous terminal launch failures remain visible', async () => {
  const common = {
    selection: 'viewer', platform: 'linux',
    environment: { DISPLAY: ':1', PATH: '/usr/bin', FREETV_TERMINAL: 'xterm' },
    fileSystem: executableFixture(['/usr/bin/xterm']),
  };
  await assert.rejects(launchDevelopmentTerminal({
    ...common, spawnProcess() { throw new Error('sync fixture'); },
  }), /Could not open.*sync fixture/u);

  const child = new EventEmitter();
  child.unref = () => {};
  const launched = launchDevelopmentTerminal({ ...common, spawnProcess: () => child });
  child.emit('error', new Error('async fixture'));
  await assert.rejects(launched, /Could not open.*async fixture/u);
});

test('development entry maps exact selections to the existing supervisor workflow', async () => {
  for (const selection of ['all', 'viewer', 'admin']) {
    const calls = [];
    assert.equal(await runDevelopmentTerminalEntry({
      args: [`--selection=${selection}`],
      runDevelopment: async (options) => { calls.push(options); return 0; },
      waitForClose: async () => { calls.push('wait'); },
    }), 0);
    assert.deepEqual(calls, [{ selection }, 'wait']);
  }
  assert.throws(() => parseDevelopmentSelection(['--selection=php']), /Unsupported development service selection/u);
  assert.throws(() => parseDevelopmentSelection([]), /requires exactly one/u);
});

test('development terminal remains readable after success or startup failure', async () => {
  for (const [status, error] of [[0, null], [1, new Error('startup fixture')]]) {
    const calls = [];
    const logger = { error: (message) => calls.push(['error', message]) };
    assert.equal(await runDevelopmentTerminalEntry({
      args: ['--selection=viewer'], logger,
      runDevelopment: error ? async () => { throw error; } : async () => status,
      waitForClose: async () => { calls.push(['wait']); },
    }), status);
    assert.equal(calls.at(-1)[0], 'wait');
  }
});

test('non-TTY terminal hold returns immediately and TTY hold closes its reader', async () => {
  await waitForDevelopmentTerminal({ input: { isTTY: false } });
  let closed = 0;
  await waitForDevelopmentTerminal({
    input: { isTTY: true }, output: {},
    readlineFactory: () => ({ question: async () => '', close: () => { closed += 1; } }),
  });
  assert.equal(closed, 1);
});

test('Clack terminal-launch modules contain no raw-mode or stdin listener manipulation', () => {
  for (const relativePath of ['cli/menu.js', 'cli/development-terminal.js']) {
    const source = fs.readFileSync(path.join(toolingRoot, relativePath), 'utf8');
    assert.doesNotMatch(source, /setRawMode|stdin\.(?:on|once)|inputSource/u);
  }
});
