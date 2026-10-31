// คัดลอกกฎกลาง (assets/js/rules.js) ไปไว้ท้าย backend/Code.gs ระหว่างบรรทัด RULES BEGIN / RULES END
// ใช้หลังแก้ rules.js:   node tools/sync-rules.mjs
// ตรวจว่าตรงกันหรือไม่:  node tools/sync-rules.mjs --check
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rulesPath = join(root, 'assets/js/rules.js');
const gsPath = join(root, 'backend/Code.gs');
const rules = readFileSync(rulesPath, 'utf8').trimEnd();
const gs = readFileSync(gsPath, 'utf8');
const begin = gs.search(/^\/\/ =+ RULES BEGIN.*$/m);
const endMatch = /^\/\/ =+ RULES END =+$/m.exec(gs);
if (begin < 0 || !endMatch) { console.error('ไม่พบบรรทัด RULES BEGIN / RULES END ใน Code.gs'); process.exit(1); }
const beginLineEnd = gs.indexOf('\n', begin) + 1;
const current = gs.slice(beginLineEnd, endMatch.index).trimEnd();
if (process.argv.includes('--check')) {
  if (current === rules) { console.log('Code.gs มีกฎตรงกับ rules.js'); process.exit(0); }
  console.error('Code.gs ยังไม่ตรงกับ rules.js — รัน node tools/sync-rules.mjs'); process.exit(1);
}
const out = `${gs.slice(0, beginLineEnd)}${rules}\n${gs.slice(endMatch.index)}`;
writeFileSync(gsPath, out);
console.log('คัดลอก rules.js ไปที่ Code.gs แล้ว');
