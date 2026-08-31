/**
 * build-standalone.mjs — בונה קובץ HTML יחיד שרץ בלי שרת
 *
 * מזריק את כל קבצי הנתונים לתוך הדף עצמו. שימושי לשליחה במייל,
 * לפתיחה מהנייד, ולארכוב של תמונת מצב לתקופה מסוימת.
 * מקור האמת נשאר index.html — הקובץ הזה נגזר ממנו ואינו נערך ידנית.
 *
 * שימוש:  node scripts/build-standalone.mjs
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const APP = ['meta', 'bond', 'statements', 'projects', 'related', 'events', 'followups.seed'];
const OPTIONAL = ['data/sources.json', 'data/sources-status.json', 'data/reconcile.json'];
const ARTIFACT = process.argv.includes('--artifact');
const OUT = ARTIFACT ? 'dist/mytown-artifact.html' : 'dist/mytown-standalone.html';

const data = {};
for (const name of APP) data[name] = JSON.parse(await readFile(`data/app/${name}.json`, 'utf8'));
for (const path of OPTIONAL) if (existsSync(path)) data[path] = JSON.parse(await readFile(path, 'utf8'));

const html = await readFile('index.html', 'utf8');
const asOf = data.meta.source.asOf;

/* JSON.stringify בלבד אינו בטוח בתוך <script> — רצף כמו </script> בתוך
   מחרוזת היה סוגר את התג. הבריחה למטה מנטרלת את זה. */
const payload = JSON.stringify(data)
  .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/\u2028|\u2029/g, (c) => '\\u' + c.charCodeAt(0).toString(16));

const banner = `<script>window.__MYTOWN_DATA__=JSON.parse(${JSON.stringify(payload)});` +
  `window.__MYTOWN_BUILT__=${JSON.stringify(new Date().toISOString())};` +
  (ARTIFACT ? 'window.__MYTOWN_SANDBOX__=true;document.documentElement.lang="he";document.documentElement.dir="rtl";' : '') +
  `</script>\n`;

const marker = '<script type="module">';
if (!html.includes(marker)) { console.error('לא נמצא תג הסקריפט הראשי'); process.exit(1); }
let out = html.replace(marker, banner + marker);

/* מצב ארטיפקט · המארח מספק בעצמו doctype, head ו-body, ומזריק לתוכם.
   הכיווניות שיושבת על תג html מועברת לסקריפט, כי אין לנו גישה לתג. */
if (ARTIFACT) {
  const head = out.match(/<head>([\s\S]*?)<\/head>/i);
  const body = out.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (!head || !body) { console.error('לא נמצאו head או body לחילוץ'); process.exit(1); }
  const keep = head[1]
    .replace(/<meta[^>]*charset[^>]*>/gi, '')
    .replace(/<meta[^>]*viewport[^>]*>/gi, '')
    .trim();
  out = keep + '\n' + body[1].trim() + '\n';
}

await mkdir('dist', { recursive: true });
await writeFile(OUT, out, 'utf8');

const kb = (s) => (Buffer.byteLength(s, 'utf8') / 1024).toFixed(0) + ' KB';
console.log(`נבנה ${OUT} — ${kb(out)} · תקופה ${asOf} · ${Object.keys(data).length} קבצי נתונים מוטמעים`);
console.log('נפתח בדאבל־קליק, בלי שרת.');
