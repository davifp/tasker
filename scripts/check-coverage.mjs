#!/usr/bin/env node
/**
 * Aggregates coverage-summary.json from each workspace and fails
 * when any metric falls below the configured threshold.
 *
 * Thresholds reflect the Phase 0 baseline; raise them as coverage grows.
 */
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const THRESHOLDS = {
  lines: 50,
  branches: 50,
  functions: 60,
  statements: 50,
};

const WORKSPACES = ['backend', 'frontend'];

const totals = {
  lines: { total: 0, covered: 0 },
  branches: { total: 0, covered: 0 },
  functions: { total: 0, covered: 0 },
  statements: { total: 0, covered: 0 },
};

let summariesFound = 0;

for (const ws of WORKSPACES) {
  const summaryPath = join(process.cwd(), ws, 'coverage', 'coverage-summary.json');
  if (!existsSync(summaryPath)) {
    console.warn(`⚠  No coverage summary for ${ws} — skipping`);
    continue;
  }
  summariesFound++;
  const { total } = JSON.parse(readFileSync(summaryPath, 'utf8'));
  for (const metric of Object.keys(totals)) {
    totals[metric].total += total[metric].total;
    totals[metric].covered += total[metric].covered;
  }
  console.log(
    `  ${ws}: ${total.lines.pct.toFixed(1)}% lines, ${total.branches.pct.toFixed(1)}% branches`,
  );
}

if (summariesFound === 0) {
  console.error('\n❌ No coverage summaries found. Run: pnpm test:cov\n');
  process.exit(1);
}

const pct = (covered, total) => (total === 0 ? 100 : (covered / total) * 100);

console.log('\nCoverage (aggregated):');
let failed = false;
for (const [metric, threshold] of Object.entries(THRESHOLDS)) {
  const actual = pct(totals[metric].covered, totals[metric].total);
  const pass = actual >= threshold;
  const icon = pass ? '✓' : '✗';
  const flag = pass ? '' : ' ← BELOW THRESHOLD';
  console.log(
    `  ${icon} ${metric.padEnd(12)} ${actual.toFixed(1).padStart(6)}%  (min ${threshold}%)${flag}`,
  );
  if (!pass) failed = true;
}

if (failed) {
  console.error('\n❌ Coverage thresholds not met.\n');
  process.exit(1);
}
console.log('\n✅ All coverage thresholds met.\n');
