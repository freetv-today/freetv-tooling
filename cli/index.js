import { readFileSync } from 'node:fs';
import { cancel, intro, isCancel, note, outro, select } from '@clack/prompts';

const packageMetadata = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const applicationName = packageMetadata.name
  .split('-')
  .map((part, index) => (index === 0 && part === 'freetv'
    ? 'FreeTV'
    : `${part[0].toUpperCase()}${part.slice(1)}`))
  .join(' ');

intro(applicationName);
note(packageMetadata.version, 'Version');

const selection = await select({
  message: 'Welcome! What would you like to do?',
  options: [{ value: 'exit', label: 'Exit' }],
});

if (isCancel(selection)) {
  cancel('Cancelled.');
} else {
  outro('Goodbye!');
}
