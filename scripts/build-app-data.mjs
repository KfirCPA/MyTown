/**
 * build-app-data.mjs — מחבר את פייפליין ה-XBRL לנתוני האפליקציה
 *
 * ה-XBRL של מגנא נותן כ-50 סעיפים מצרפיים. הוא לא יכול להזין את 40 שורות
 * המאזן ולא את נתוני הפרויקטים — אבל הוא כן נותן את עמוד השדרה:
 * יתרות הבסיס, סכומי הביניים, מגמת ההון וההון החוזר.
 *
 * הסקריפט עושה שני דברים, ובסדר הזה:
 *   1. מתאם — משווה כל ערך ידני מול ה-XBRL ומדווח על כל סטייה.
 *   2. גוזר — כותב את מה שה-XBRL מכסה, ורק אותו.
 *
 * ההתאמה חשובה מהגזירה. טעות הקלדה בשורה ידנית היא בדיוק מה שהכלי הזה
 * אמור לתפוס, ולכן סטייה נחשבת כישלון ולא כאזהרה.
 *
 * שימוש:
 *   node scripts/build-app-data.mjs            בדיקה בלבד, לא כותב
 *   node scripts/build-app-data.mjs --write    כותב את הנגזר ל-data/app/
 *   node scripts/build-app-data.mjs --strict   יוצא בקוד שגיאה על סטייה (ל-CI)
 */

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const FIN = 'data/financials.json';
const APP = 'data/app';
const REPORT = 'data/reconcile.json';
const TOL = 1; // אלפי ש״ח · עיגול בין המקורות

const WRITE = process.argv.includes('--write');
const STRICT = process.argv.includes('--strict');

const k = (n) => (Number.isFinite(n) ? Math.round(n / 1000) : null); // ש״ח → אלפי ש״ח
const fmt = (n) => (Number.isFinite(n) ? Math.round(n).toLocaleString('he-IL') : '—');
const dmy = (iso) => (iso ? iso.split('-').reverse().join('.') : '—');
const short = (iso) => (iso ? `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}.${iso.slice(2, 4)}` : '—');

/* ═══════════ טעינה ═══════════ */
if (!existsSync(FIN)) {
  console.error(`חסר ${FIN}. הרץ קודם: node scripts/parse-xbrl.mjs`);
  process.exit(1);
}
const fin = JSON.parse(await readFile(FIN, 'utf8'));
const meta = JSON.parse(await readFile(`${APP}/meta.json`, 'utf8'));
const stmt = JSON.parse(await readFile(`${APP}/statements.json`, 'utf8'));

const quarters = fin.periods.filter((p) => p.months === 3).sort((a, b) => a.balanceDate.localeCompare(b.balanceDate));
const annuals = fin.periods.filter((p) => p.isAnnual);
const byDate = Object.fromEntries(fin.periods.map((p) => [p.balanceDate, p]));

const asOf = meta.source.asOf;
const current = byDate[asOf];

const findings = [];
const add = (level, area, label, detail, xbrl = null, manual = null) =>
  findings.push({ level, area, label, detail, xbrl, manual });

/* ═══════════ 1 · התאמה · יתרות הבסיס ═══════════ */
if (!current) {
  add('warn', 'בסיס', 'אין XBRL לתאריך המאזן',
    `meta.source.asOf = ${dmy(asOf)} · קיימים: ${fin.periods.map((p) => dmy(p.balanceDate)).join(', ')}`);
} else {
  const f = current.facts;
  const pairs = [
    ['סך נכסים', 'base.totalAssets', k(f.Assets), meta.base.totalAssets],
    ['הון מאוחד', 'base.equityConsolidated', k(f.Equity), meta.base.equityConsolidated],
    ['הון המיוחס לבעלים', 'base.ownersEquity', k(f.EquityAttributableToOwnersOfParent), meta.base.ownersEquity],
    ['זכויות מיעוט', 'base.nci', k(f.NoncontrollingInterests), meta.base.nci],
    ['הון חוזר', 'base.workingCapital', k(f.CurrentAssets) - k(f.CurrentLiabilities), meta.base.workingCapital],
  ];
  for (const [label, path, xbrl, manual] of pairs) {
    if (xbrl == null) { add('skip', 'בסיס', label, `${path} · אין תג ב-XBRL`); continue; }
    const ok = Math.abs(xbrl - manual) <= TOL;
    add(ok ? 'ok' : 'fail', 'בסיס', label,
      ok ? `${path} · ${fmt(xbrl)}` : `${path} · XBRL ${fmt(xbrl)} מול ידני ${fmt(manual)}`, xbrl, manual);
  }
}

/* ═══════════ 2 · התאמה · סכומי הביניים במאזן ═══════════ */
const bsRows = stmt.balanceSheet.rows;
const bsGet = (label) => bsRows.find((r) => r.label === label);

if (current) {
  const f = current.facts;
  const subtotals = [
    ['סה״כ נכסים שוטפים', k(f.CurrentAssets)],
    ['סה״כ נכסים', k(f.Assets)],
    ['סה״כ התחייבויות שוטפות', k(f.CurrentLiabilities)],
    ['סה״כ התחייבויות לא שוטפות', k(f.NoncurrentLiabilities)],
    ['סה״כ הון', k(f.Equity)],
  ];
  for (const [label, xbrl] of subtotals) {
    const row = bsGet(label);
    if (!row) { add('fail', 'מאזן', label, 'השורה לא נמצאה ב-statements.json'); continue; }
    if (xbrl == null) { add('skip', 'מאזן', label, 'אין תג ב-XBRL'); continue; }
    const ok = Math.abs(xbrl - row.current) <= TOL;
    add(ok ? 'ok' : 'fail', 'מאזן', label,
      ok ? fmt(xbrl) : `XBRL ${fmt(xbrl)} מול ידני ${fmt(row.current)}`, xbrl, row.current);
  }
}

/* ═══════════ 3 · עקביות פנימית · שורות הפירוט מסתכמות לסכום הביניים ═══════════
   זו הבדיקה שתופסת טעות הקלדה בשורה בודדת, וה-XBRL לא יכול לתפוס אותה לבדו. */
const SECTIONS = [
  { total: 'סה״כ נכסים שוטפים', from: 'מזומנים ושווי מזומנים', to: 'מלאי בניינים למכירה' },
  { total: 'סה״כ התחייבויות שוטפות', from: 'אשראי מתאגידים בנקאיים', to: 'הלוואות בעלי מניות' },
  { total: 'סה״כ התחייבויות לא שוטפות', from: 'הלוואות בעלים · לא שוטף', to: 'מס נדחה' },
  { total: 'סה״כ הון', from: 'פרמיה', to: 'זכויות מיעוט' },
];
const COLS = ['current', 'priorYearSame', 'priorYearEnd'];
const colName = stmt.balanceSheet.columns;

for (const sec of SECTIONS) {
  const i = bsRows.findIndex((r) => r.label === sec.from);
  const j = bsRows.findIndex((r) => r.label === sec.to);
  const total = bsGet(sec.total);
  if (i < 0 || j < 0 || !total) { add('fail', 'סכימה', sec.total, 'לא נמצאו גבולות הקטע'); continue; }
  for (const col of COLS) {
    const slice = bsRows.slice(i, j + 1);
    if (slice.some((r) => r[col] == null) || total[col] == null) {
      add('skip', 'סכימה', `${sec.total} · ${colName[col]}`, 'שורה חסרה בעמודה — הקטע לא נבדק');
      continue;
    }
    const sum = slice.reduce((a, r) => a + r[col], 0);
    const ok = Math.abs(sum - total[col]) <= TOL;
    add(ok ? 'ok' : 'fail', 'סכימה', `${sec.total} · ${colName[col]}`,
      ok ? fmt(sum) : `סכום השורות ${fmt(sum)} מול המוצהר ${fmt(total[col])} · הפרש ${fmt(sum - total[col])}`,
      sum, total[col]);
  }
}
// סך נכסים = שוטפים + לא שוטפים
for (const col of COLS) {
  const ca = bsGet('סה״כ נכסים שוטפים')?.[col];
  const ta = bsGet('סה״כ נכסים')?.[col];
  const i = bsRows.findIndex((r) => r.label === 'מלאי מקרקעין לזמן ארוך');
  const j = bsRows.findIndex((r) => r.label === 'רכוש קבוע');
  if (ca == null || ta == null || i < 0 || j < 0) continue;
  const nca = bsRows.slice(i, j + 1);
  if (nca.some((r) => r[col] == null)) { add('skip', 'סכימה', `סה״כ נכסים · ${colName[col]}`, 'שורה חסרה'); continue; }
  const sum = ca + nca.reduce((a, r) => a + r[col], 0);
  const ok = Math.abs(sum - ta) <= TOL;
  add(ok ? 'ok' : 'fail', 'סכימה', `סה״כ נכסים · ${colName[col]}`,
    ok ? fmt(sum) : `שוטפים ועוד לא שוטפים ${fmt(sum)} מול המוצהר ${fmt(ta)}`, sum, ta);
}

/* ═══════════ 4 · התאמה · רווח והפסד מול ה-XBRL ═══════════
   ה-XBRL מדווח רבעונים בדידים, ולכן Q1 קיים בו ישירות ואפשר לבדוק
   שהמצטבר החצי-שנתי הידני באמת שווה לסכום שני הרבעונים. */
const plRows = stmt.incomeStatement.rows;
const plGet = (label) => plRows.find((r) => r.label === label);
const PL_MAP = [
  ['סך הכנסות', 'Revenue'],
  ['רווח גולמי', 'GrossProfit'],
  ['רווח תפעולי', 'ProfitLossFromOperatingActivities'],
  ['הפסד נקי', 'ProfitLoss'],
];

const q2 = byDate[asOf];
const q1 = quarters[quarters.indexOf(q2) - 1];
const q2Prior = quarters.find((p) => p.balanceDate === shiftYear(asOf));
function shiftYear(iso) { return `${Number(iso.slice(0, 4)) - 1}${iso.slice(4)}`; }
const fy = annuals.find((p) => p.balanceDate.startsWith(String(Number(asOf.slice(0, 4)) - 1)));

for (const [label, tag] of PL_MAP) {
  const row = plGet(label);
  if (!row) { add('fail', 'רווה״ס', label, 'השורה לא נמצאה ב-statements.json'); continue; }
  const checks = [
    ['q2', q2, 'Q2 מדווח'],
    ['q2Prior', q2Prior, 'Q2 אשתקד'],
    ['fyPrior', fy, 'שנה קודמת'],
  ];
  for (const [field, period, what] of checks) {
    if (!period) { add('skip', 'רווה״ס', `${label} · ${what}`, 'אין תקופה תואמת ב-XBRL'); continue; }
    const xbrl = k(period.facts[tag]);
    if (xbrl == null) { add('skip', 'רווה״ס', `${label} · ${what}`, `אין תג ${tag}`); continue; }
    const manual = row[field];
    const ok = Math.abs(xbrl - manual) <= TOL;
    add(ok ? 'ok' : 'fail', 'רווה״ס', `${label} · ${what}`,
      ok ? fmt(xbrl) : `XBRL ${fmt(xbrl)} מול ידני ${fmt(manual)}`, xbrl, manual);
  }
  // המצטבר הידני מול שני הרבעונים הבדידים ב-XBRL
  if (q1 && q2) {
    const sum = k(q1.facts[tag]) + k(q2.facts[tag]);
    const ok = Math.abs(sum - row.h1) <= TOL;
    add(ok ? 'ok' : 'fail', 'רווה״ס', `${label} · מצטבר = Q1 + Q2`,
      ok ? `${fmt(sum)}` : `Q1 ${fmt(k(q1.facts[tag]))} ועוד Q2 ${fmt(k(q2.facts[tag]))} = ${fmt(sum)} מול מצטבר ידני ${fmt(row.h1)}`,
      sum, row.h1);
  }
}

/* ═══════════ 5 · גזירה · מה שה-XBRL מכסה במלואו ═══════════ */
const derived = {
  equityTrend: fin.periods
    .filter((p) => Number.isFinite(p.facts.Equity))
    .sort((a, b) => a.balanceDate.localeCompare(b.balanceDate))
    .map((p) => ({ label: short(p.balanceDate), value: k(p.facts.Equity) })),
  workingCapital: fin.periods
    .filter((p) => Number.isFinite(p.facts.CurrentAssets) && Number.isFinite(p.facts.CurrentLiabilities))
    .sort((a, b) => a.balanceDate.localeCompare(b.balanceDate))
    .map((p) => ({ label: short(p.balanceDate), value: k(p.facts.CurrentAssets) - k(p.facts.CurrentLiabilities) })),
};

/* הסדרה הידנית עשויה להחזיק נקודות שאין להן XBRL (למשל 31.3.25).
   שומרים אותן, ומחליפים רק את מה שה-XBRL באמת מכסה. */
function mergeSeries(manual, auto) {
  const map = new Map(manual.map((p) => [p.label, p]));
  for (const p of auto) map.set(p.label, p);
  return [...map.values()].sort((a, b) => dateKey(a.label) - dateKey(b.label));
}
function dateKey(label) {
  const [d, m, y] = label.split('.').map(Number);
  return new Date(2000 + y, m - 1, d).getTime();
}

/* ═══════════ 5ב · שלב הפרויקט ═══════════
   הרשימה "בביצוע" נגזרה פעם מביטוי סינון, ולכן פרויקט אחד הוחרג בשקט
   ואחר נשאר ברשימה רק בגלל ש-rem שלו היה null. עכשיו השלב מוצהר בנתון,
   והבדיקות כאן מוודאות שההצהרה נשארת עקבית. */
const proj = JSON.parse(await readFile(`${APP}/projects.json`, 'utf8'));
const STAGES = proj._stages?.values || ['בביצוע', 'הושלם'];
{
  const noStage = proj.inExecution.filter((x) => !STAGES.includes(x.stage));
  if (noStage.length)
    add('fail', 'פרויקטים', 'שלב חסר או לא חוקי', noStage.map((x) => x.name).join(', '));
  else add('ok', 'פרויקטים', 'לכל פרויקט שלב מוצהר', proj.inExecution.length + ' פרויקטים');

  const inExec = proj.inExecution.filter((x) => x.stage === 'בביצוע').length;
  const declared = meta.scope?.inExec;
  if (Number.isFinite(declared)) {
    const ok = inExec === declared;
    add(ok ? 'ok' : 'fail', 'פרויקטים', 'ספירת הפרויקטים בביצוע',
      ok ? String(inExec) : `בנתון ${inExec} מול scope.inExec ${declared}`, inExec, declared);
  } else add('skip', 'פרויקטים', 'ספירת הפרויקטים בביצוע', 'אין scope.inExec');

  /* עלות שנותרה אפס פירושה שאין מה להשלים — כזה אינו "בביצוע" */
  const done = proj.inExecution.filter((x) => x.rem === 0 && x.stage !== 'הושלם');
  if (done.length)
    add('fail', 'פרויקטים', 'עלות להשלמה אפס אך אינו מסווג כהושלם', done.map((x) => x.name).join(', '));
  else add('ok', 'פרויקטים', 'סיווג מול העלות שנותרה', 'עקבי');
}

/* ═══════════ 6 · שעון הדיווח ═══════════
   הפער האחרון באוטומציה: מגנא חוסמת את הראנר, ולכן קובץ XBRL חדש נטען
   ידנית. מה שכן אפשר לעשות אוטומטית הוא לדעת מתי מצפים לו ולהתריע.
   הפיגור נגזר מהיסטוריית ההגשות של החברה עצמה ולא מציטוט תקנה — כך
   הוא נשאר נכון גם אם החברה מגישה מוקדם או מאחרת בעקביות. */
function quarterEnd(d){
  const y=d.getUTCFullYear(), q=Math.floor(d.getUTCMonth()/3);
  return new Date(Date.UTC(y,q*3+3,0));
}
function nextReport(){
  const withDates=fin.periods.filter((p)=>p.filedAt&&p.balanceDate);
  if(!withDates.length)return null;
  const lag=(p)=>Math.round((new Date(p.filedAt)-new Date(p.balanceDate))/86400000);
  const qLags=withDates.filter((p)=>p.months===3).map(lag).sort((a,b)=>a-b);
  const aLags=withDates.filter((p)=>p.isAnnual).map(lag).sort((a,b)=>a-b);
  const latest=withDates.map((p)=>p.balanceDate).sort().pop();

  /* התקופה הבאה אחרי האחרונה שנטענה */
  const after=new Date(latest+"T00:00:00Z");
  after.setUTCDate(after.getUTCDate()+1);
  const nextEnd=quarterEnd(after);
  const isAnnual=nextEnd.getUTCMonth()===11;
  const lags=isAnnual?(aLags.length?aLags:qLags):qLags;
  if(!lags.length)return null;
  const typical=lags[Math.floor(lags.length/2)], worst=lags[lags.length-1];
  const iso=(d)=>d.toISOString().slice(0,10);
  const plus=(d,n)=>{const x=new Date(d);x.setUTCDate(x.getUTCDate()+n);return x;};
  const today=new Date();
  const dueBy=plus(nextEnd,worst);

  return {
    latestLoaded:latest,
    period:(isAnnual?"שנת ":"רבעון "+(Math.floor(nextEnd.getUTCMonth()/3)+1)+"/")+nextEnd.getUTCFullYear(),
    balanceDate:iso(nextEnd),
    expectedFiling:iso(plus(nextEnd,typical)),
    overdueAfter:iso(dueBy),
    lagHistory:{quarterly:qLags,annual:aLags,typical,worst},
    status:today<nextEnd?"התקופה טרם הסתיימה"
          :today<=dueBy?"בתוך חלון ההגשה"
          :"מאחר · הדוח היה אמור להיות מוגש",
    daysLate:today>dueBy?Math.round((today-dueBy)/86400000):0,
    _note:"הפיגור נגזר מהיסטוריית ההגשות של החברה: "+
      qLags.join(", ")+" ימים ברבעוניים"+(aLags.length?" ו-"+aLags.join(", ")+" בשנתי":"")+"."
  };
}
const NEXT=nextReport();
if(NEXT){
  console.log("\n── שעון הדיווח ──");
  console.log("  אחרון שנטען  "+dmy(NEXT.latestLoaded));
  console.log("  הבא בתור     "+NEXT.period+" · מאזן "+dmy(NEXT.balanceDate));
  console.log("  צפי הגשה     "+dmy(NEXT.expectedFiling)+" · מאחר אחרי "+dmy(NEXT.overdueAfter));
  console.log("  מצב          "+NEXT.status+(NEXT.daysLate?" · "+NEXT.daysLate+" ימים":""));
}

/* ═══════════ דוח ═══════════ */
const counts = findings.reduce((a, f) => ((a[f.level] = (a[f.level] || 0) + 1), a), {});
const failures = findings.filter((f) => f.level === 'fail');

const ICON = { ok: '✓', fail: '✗', warn: '!', skip: '⊘' };
let area = null;
for (const f of findings) {
  if (f.area !== area) { area = f.area; console.log(`\n── ${area} ──`); }
  if (f.level === 'ok') console.log(`  ${ICON[f.level]} ${f.label}  ${f.detail}`);
  else console.log(`  ${ICON[f.level]} ${f.label} — ${f.detail}`);
}

console.log(`\n── סיכום ──`);
console.log(`  תואם ${counts.ok || 0} · סוטה ${counts.fail || 0} · לא ישים ${counts.skip || 0} · אזהרה ${counts.warn || 0}`);
console.log(`  סדרת הון · ${derived.equityTrend.length} נקודות מה-XBRL`);
console.log(`  סדרת הון חוזר · ${derived.workingCapital.length} נקודות מה-XBRL`);

const report = {
  generatedAt: new Date().toISOString(),
  asOf,
  xbrlPeriods: fin.periods.map((p) => ({
    file: p.file, label: p.periodLabel, balanceDate: p.balanceDate,
    months: p.months, reference: p.reference, filedAt: p.filedAt,
    validationPassed: p.validation.passed,
  })),
  counts: { ok: counts.ok || 0, fail: counts.fail || 0, skip: counts.skip || 0, warn: counts.warn || 0 },
  nextReport: NEXT,
  findings,
};
await writeFile(REPORT, JSON.stringify(report, null, 2) + '\n', 'utf8');
console.log(`  דוח ההתאמה נשמר ל-${REPORT}`);

if (WRITE) {
  if (failures.length) {
    console.error(`\nלא נכתב: ${failures.length} סטיות פתוחות. תקן אותן, או הרץ בלי --write כדי רק לראות.`);
    process.exit(1);
  }
  meta.equityTrend = mergeSeries(meta.equityTrend, derived.equityTrend);
  meta.workingCapital = mergeSeries(meta.workingCapital, derived.workingCapital);
  if (current) {
    const f = current.facts;
    meta.base.totalAssets = k(f.Assets);
    meta.base.equityConsolidated = k(f.Equity);
    meta.base.ownersEquity = k(f.EquityAttributableToOwnersOfParent);
    meta.base.nci = k(f.NoncontrollingInterests);
    meta.base.workingCapital = k(f.CurrentAssets) - k(f.CurrentLiabilities);
  }
  meta.derivedFrom = {
    source: 'data/financials.json · XBRL מגנא',
    at: new Date().toISOString(),
    fields: ['base.totalAssets', 'base.equityConsolidated', 'base.ownersEquity', 'base.nci',
      'base.workingCapital', 'equityTrend', 'workingCapital'],
    note: 'שאר השדות ידניים. ה-XBRL מכיל כ-50 סעיפים מצרפיים בלבד ואינו מכסה אותם.',
  };
  await writeFile(`${APP}/meta.json`, JSON.stringify(meta, null, 2) + '\n', 'utf8');
  console.log(`  נכתב ${APP}/meta.json`);
}

if (STRICT && failures.length) {
  console.error(`\n${failures.length} סטיות. הריצה נכשלת.`);
  process.exit(1);
}
