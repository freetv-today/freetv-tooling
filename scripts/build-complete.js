import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const toolingRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(fs.readFileSync(path.join(toolingRoot, 'config/paths.json'), 'utf8'));
const outputRoot = path.resolve(toolingRoot, config.output.root);

console.log('FreeTV production build completed successfully.');
console.log('');
console.log('Local package:');
console.log(`  ${outputRoot}`);
console.log('');
console.log('No deployment performed.');
