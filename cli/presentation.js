import { styleText } from 'node:util';

function colorEnabled({ environment, stream }) {
  if (Object.hasOwn(environment, 'FORCE_COLOR')) {
    return environment.FORCE_COLOR !== '0' && environment.FORCE_COLOR !== 'false';
  }
  if (Object.hasOwn(environment, 'NO_COLOR')) return false;
  if (environment.TERM === 'dumb') return false;
  if (typeof stream?.hasColors === 'function') return stream.hasColors();
  return stream?.isTTY === true;
}

export function styleResultMessage(format, message, {
  environment = process.env,
  stream = process.stdout,
  styler = styleText,
} = {}) {
  if (!colorEnabled({ environment, stream })) return message;
  return styler(format, message, { validateStream: false });
}

export function createResultPresentation(prompts, options = {}) {
  return {
    success: (message) => prompts.log.success(styleResultMessage('green', message, options)),
    error: (message) => prompts.log.error(styleResultMessage('red', message, options)),
  };
}
