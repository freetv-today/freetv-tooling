import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const toolingRoot = path.resolve(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.resolve(toolingRoot, 'config/paths.json'), 'utf8'));

const repos = Object.entries(config.repos).map(([name, rel]) => ({ name, abs: path.resolve(toolingRoot, rel) }));
console.log('FreeTV tooling status');
console.log('=====================');
for (const repo of repos) {
  console.log(`${repo.name}: ${repo.abs} ${fs.existsSync(repo.abs) ? '✓' : '✗'}`);
}
console.log(`output: ${path.resolve(toolingRoot, config.output.root)}`);
