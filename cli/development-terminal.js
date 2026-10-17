import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const toolingRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const developmentEntry = path.join(toolingRoot, 'cli', 'development-entry.js');
const SUPPORTED_SELECTIONS = new Set(['all', 'viewer', 'admin']);

const LINUX_TERMINALS = Object.freeze({
  'gnome-terminal': (command) => ['--window', '--wait', '--', ...command],
  'gnome-terminal.wrapper': (command) => ['-e', ...command],
  'x-terminal-emulator': (command) => ['-e', ...command],
  'xfce4-terminal': (command) => ['--disable-server', '--hold', '--execute', ...command],
  'mate-terminal': (command) => ['--disable-factory', '--execute', ...command],
  konsole: (command) => ['--hold', '-e', ...command],
  xterm: (command) => ['-hold', '-e', ...command],
  kitty: (command) => ['--hold', ...command],
  alacritty: (command) => ['-e', ...command],
});

const DEFAULT_LINUX_TERMINALS = Object.freeze([
  'x-terminal-emulator', 'gnome-terminal', 'xfce4-terminal', 'mate-terminal',
  'konsole', 'kitty', 'alacritty', 'xterm',
]);

function executableName(executable, platform = process.platform) {
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  return pathApi.basename(executable).toLowerCase().replace(/\.exe$/u, '');
}

function findOnPath(executable, { environment, fileSystem, platform }) {
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  const hasDirectory = pathApi.dirname(executable) !== '.';
  const candidates = hasDirectory
    ? [pathApi.resolve(executable)]
    : String(environment.PATH ?? '').split(pathApi.delimiter).filter(Boolean)
      .map((directory) => pathApi.join(directory, executable));
  return candidates.find((candidate) => {
    try {
      fileSystem.accessSync(candidate, fileSystem.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

function quotePosix(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

function quoteAppleScript(value) {
  return String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

function quotePowerShell(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function quoteWindowsArgument(value) {
  return `"${String(value).replace(/(\\*)"/gu, '$1$1\\"').replace(/(\\*)$/u, '$1$1')}"`;
}

export function resolveDevelopmentTerminalInvocation({
  selection,
  platform = process.platform,
  environment = process.env,
  nodeExecutable = process.execPath,
  entryPath = developmentEntry,
  cwd = toolingRoot,
  fileSystem = fs,
} = {}) {
  if (!SUPPORTED_SELECTIONS.has(selection)) {
    throw new Error(`Unsupported development terminal selection: ${selection}`);
  }
  const command = [nodeExecutable, entryPath, `--selection=${selection}`];

  if (platform === 'linux') {
    if (!environment.DISPLAY && !environment.WAYLAND_DISPLAY) {
      throw new Error('No graphical Linux environment is available (DISPLAY and WAYLAND_DISPLAY are unset)');
    }
    const configured = environment.FREETV_TERMINAL?.trim();
    const choices = configured ? [configured] : DEFAULT_LINUX_TERMINALS;
    for (const choice of choices) {
      const name = executableName(choice, platform);
      const buildArgs = LINUX_TERMINALS[name];
      if (!buildArgs) {
        if (configured) throw new Error(`Unsupported FREETV_TERMINAL executable: ${choice}`);
        continue;
      }
      const executable = findOnPath(choice, { environment, fileSystem, platform });
      if (executable) return { executable, args: buildArgs(command), cwd, environment };
    }
    throw new Error(`No supported graphical terminal executable was found${configured ? `: ${configured}` : ''}`);
  }

  if (platform === 'win32') {
    const executable = environment.ComSpec || 'powershell.exe';
    const commandArguments = command.slice(1)
      .map((value) => quotePowerShell(quoteWindowsArgument(value))).join(', ');
    const script = `Start-Process -FilePath ${quotePowerShell(command[0])} -ArgumentList @(${commandArguments}) -WorkingDirectory ${quotePowerShell(cwd)} -Wait`;
    return {
      executable: executableName(executable, platform) === 'cmd'
        ? 'powershell.exe' : executable,
      args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
      cwd,
      environment,
    };
  }

  if (platform === 'darwin') {
    const shellCommand = `cd -- ${quotePosix(cwd)} && exec ${command.map(quotePosix).join(' ')}`;
    const appleScript = `tell application "Terminal" to do script "${quoteAppleScript(shellCommand)}"`;
    return {
      executable: '/usr/bin/osascript', args: ['-e', appleScript], cwd, environment,
    };
  }

  throw new Error(`Separate development terminals are not supported on platform: ${platform}`);
}

export function launchDevelopmentTerminal({
  selection,
  platform = process.platform,
  environment = process.env,
  nodeExecutable = process.execPath,
  entryPath = developmentEntry,
  cwd = toolingRoot,
  fileSystem = fs,
  spawnProcess = spawn,
} = {}) {
  const invocation = resolveDevelopmentTerminalInvocation({
    selection, platform, environment, nodeExecutable, entryPath, cwd, fileSystem,
  });
  return new Promise((resolve, reject) => {
    let child;
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(new Error(`Could not open the development terminal: ${error.message}`, { cause: error }));
    };
    try {
      child = spawnProcess(invocation.executable, invocation.args, {
        cwd: invocation.cwd,
        env: invocation.environment,
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
      });
    } catch (error) {
      fail(error);
      return;
    }
    child.once('error', fail);
    child.once('spawn', () => {
      if (settled) return;
      settled = true;
      child.unref();
      resolve({ invocation, pid: child.pid });
    });
  });
}
