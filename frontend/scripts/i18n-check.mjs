#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const messagesDir = join(here, '..', 'src', 'i18n', 'messages');

function collectKeys(obj, prefix = '') {
  const keys = new Set();
  for (const [key, value] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const nested of collectKeys(value, full)) keys.add(nested);
    } else {
      keys.add(full);
    }
  }
  return keys;
}

function diff(a, b) {
  const missing = new Set();
  for (const key of a) {
    if (!b.has(key)) missing.add(key);
  }
  return [...missing].sort();
}

async function main() {
  const [enRaw, ptBrRaw] = await Promise.all([
    readFile(join(messagesDir, 'en.json'), 'utf8'),
    readFile(join(messagesDir, 'pt-BR.json'), 'utf8'),
  ]);
  const en = collectKeys(JSON.parse(enRaw));
  const ptBr = collectKeys(JSON.parse(ptBrRaw));

  const missingInPtBr = diff(en, ptBr);
  const missingInEn = diff(ptBr, en);

  if (missingInPtBr.length === 0 && missingInEn.length === 0) {
    console.log(`i18n:check ok (${en.size} keys)`);
    return;
  }

  if (missingInPtBr.length > 0) {
    console.error(`Missing in pt-BR (${missingInPtBr.length}):`);
    for (const key of missingInPtBr) console.error(`  - ${key}`);
  }
  if (missingInEn.length > 0) {
    console.error(`Missing in en (${missingInEn.length}):`);
    for (const key of missingInEn) console.error(`  - ${key}`);
  }
  process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
