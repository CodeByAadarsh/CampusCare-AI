// Checks the backend extractor against the cases shared with the Python AI service.
// Usage: node scripts/test-extract.mjs [path/to/extraction_cases.json]
import fs from 'node:fs';
import { extractDetails } from '../src/ai/extract.js';

const file = process.argv[2] || new URL('../../../campuscare-ai-service/tests/extraction_cases.json', import.meta.url);
const { now, cases } = JSON.parse(fs.readFileSync(file, 'utf8'));
const at = new Date(now);
let fail = 0;
for (const c of cases) {
  const r = extractDetails(c.text, at);
  const mins = r.occurredAt == null ? null : Math.round((at - new Date(r.occurredAt)) / 60000);
  const problems = [];
  if (r.location !== c.location) problems.push(`location ${JSON.stringify(r.location)} != ${JSON.stringify(c.location)}`);
  if (mins !== c.minutesAgo) problems.push(`minutesAgo ${mins} != ${c.minutesAgo}`);
  if ('recurring' in c && r.recurring !== c.recurring) problems.push(`recurring ${r.recurring}`);
  if ('peopleCount' in c && r.peopleCount !== c.peopleCount) problems.push(`peopleCount ${r.peopleCount}`);
  if ('manyAffected' in c && r.manyAffected !== c.manyAffected) problems.push(`manyAffected ${r.manyAffected}`);
  if (problems.length) { fail++; console.log(`FAIL "${c.text}"\n     ${problems.join('; ')}`); }
}
console.log(`${cases.length - fail}/${cases.length} extraction cases pass`);
process.exit(fail ? 1 : 0);
