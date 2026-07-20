#!/usr/bin/env node

import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const projectRoot = resolve(process.cwd());
const envPath = resolve(projectRoot, '.env');
const examplePath = resolve(projectRoot, '.env.example');
const force = process.argv.includes('--force');

if (!existsSync(examplePath)) {
  console.error('Missing .env.example');
  process.exit(1);
}

if (existsSync(envPath) && !force) {
  console.log('.env already exists. Use --force to regenerate from .env.example.');
  process.exit(0);
}

const makeSecret = () => randomBytes(48).toString('base64url');
const template = readFileSync(examplePath, 'utf8');

const output = template
  .replace(/^JWT_SECRET=.*$/m, `JWT_SECRET=${makeSecret()}`)
  .replace(/^JWT_REFRESH_SECRET=.*$/m, `JWT_REFRESH_SECRET=${makeSecret()}`);

writeFileSync(envPath, output, { encoding: 'utf8', mode: 0o600 });
console.log('.env created from .env.example with fresh JWT secrets.');
