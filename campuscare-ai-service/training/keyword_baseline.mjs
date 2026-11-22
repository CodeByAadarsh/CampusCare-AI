// Runs the backend's built-in keyword engine on a CSV of complaints, so evaluate.py can compare it with the trained model.
// Usage: node training/keyword_baseline.mjs [backendDir] [csv] [out.json]
//        node training/keyword_baseline.mjs ../campuscare-backend data/handwritten_test.csv reports/keyword_baseline.json
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [backendDir = '../campuscare-backend', csvPath = 'data/handwritten_test.csv', outPath = 'reports/keyword_baseline.json'] = process.argv.slice(2);
const triage = await import(pathToFileURL(path.resolve(backendDir, 'src/ai/triage.js')).href);

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows;
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

const rows = parseCsv(fs.readFileSync(csvPath, 'utf8'));
const preds = rows.map((r) => {
  const a = triage.analyze(r.text);
  return { category: a.category, severity: a.severity, urgency: a.urgency, safetyImpact: a.safetyImpact, model: a.model };
});
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(preds, null, 2));
console.log(`Keyword engine predictions for ${preds.length} rows → ${outPath}`);
