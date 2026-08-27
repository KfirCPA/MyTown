/**
 * parse-xbrl.mjs — קורא כל קבצי ה-XBRL מ-data/xbrl/ ומייצר data/financials.json
 *
 * כל תקופה עוברת שער ולידציה לפני שהיא נכנסת לפלט.
 * מה שנופל בבדיקה מסומן ומוצג בדשבורד כחריגה — לא נבלע בשקט.
 *
 * שימוש:  node scripts/parse-xbrl.mjs
 */

import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const XBRL_DIR = 'data/xbrl';
const OUT = 'data/financials.json';
const TOL = 1000; // סובלנות בשקלים לבדיקות זהות (עיגולים בדוח)

/* ---------- פרסור ---------- */
function parseXbrl(xml) {
  // הקשרים: id -> תקופה
  const contexts = {};
  for (const m of xml.matchAll(/<context id="([^"]+)">([\s\S]*?)<\/context>/g)) {
    const [, id, body] = m;
    const instant = body.match(/<instant>([^<]+)<\/instant>/)?.[1];
    const start = body.match(/<startDate>([^<]+)<\/startDate>/)?.[1];
    const end = body.match(/<endDate>([^<]+)<\/endDate>/)?.[1];
    // הקשרים ממדיים (חתימות, חברות מוחזקות) — לא רלוונטיים לנתונים הכספיים
    const dimensional = /<scenario>|<segment>/.test(body);
    contexts[id] = { instant, start, end, dimensional };
  }

  // עובדות
  const facts = {};
  const meta = {};
  const re = /<((?:ifrs-full|ifrs-il):[A-Za-z0-9_]+)\s+([^>]*?)>([\s\S]*?)<\/\1>/g;
  for (const [, tag, attrs, raw] of xml.matchAll(re)) {
    const name = tag.split(':')[1];
    const ctxId = attrs.match(/contextRef="([^"]+)"/)?.[1];
    const ctx = contexts[ctxId];
    if (!ctx || ctx.dimensional) continue;          // מדלגים על עובדות ממדיות
    const val = raw.trim();
    if (/unitRef="U-(Monetary|PerShare|Pure)"/.test(attrs)) {
      const n = Number(val);
      if (Number.isFinite(n)) facts[name] = n;
    } else {
      meta[name] = val;
    }
  }
  return { facts, meta, contexts };
}

/* ---------- ולידציה (סעיף "שער הביקורת") ---------- */
function validate(f) {
  const checks = [];
  const eq = (label, a, b) => {
    if (a == null || b == null) return;                       // בדיקה לא ישימה
    checks.push({ label, ok: Math.abs(a - b) <= TOL, a, b });
  };
  eq('נכסים = שוטפים + לא שוטפים', f.Assets, add(f.CurrentAssets, f.NoncurrentAssets));
  eq('התחייבויות = שוטפות + לא שוטפות', f.Liabilities, add(f.CurrentLiabilities, f.NoncurrentLiabilities));
  eq('הון + התחייבויות = סך מאזן', f.EquityAndLiabilities, add(f.Equity, f.Liabilities));
  eq('הון = בעלים + זכויות מיעוט', f.Equity, add(f.EquityAttributableToOwnersOfParent, f.NoncontrollingInterests));
  eq('רווח = בעלים + מיעוט', f.ProfitLoss, add(f.ProfitLossAttributableToOwnersOfParent, f.ProfitLossAttributableToNoncontrollingInterests));
  return { checks, passed: checks.every((c) => c.ok) };
}
const add = (...xs) => (xs.every((x) => x == null) ? null : xs.reduce((s, x) => s + (x ?? 0), 0));

/* ---------- יחסים נגזרים ---------- */
function ratios(f) {
  const safe = (a, b) => (Number.isFinite(a) && Number.isFinite(b) && b !== 0 ? a / b : null);
  return {
    grossMargin: safe(f.GrossProfit, f.Revenue),
    financeCost: Number.isFinite(f.ProfitLossFromOperatingActivities) && Number.isFinite(f.ProfitLossBeforeTax)
      ? f.ProfitLossFromOperatingActivities - f.ProfitLossBeforeTax : null,
    currentRatio: safe(f.CurrentAssets, f.CurrentLiabilities),
    equityRatio: safe(f.Equity, f.Assets),
    leverage: safe(f.Liabilities, f.Equity),
    netMargin: safe(f.ProfitLoss, f.Revenue),
  };
}

/* ---------- הרצה ---------- */
if (!existsSync(XBRL_DIR)) {
  await mkdir(XBRL_DIR, { recursive: true });
  console.log(`נוצרה התיקייה ${XBRL_DIR}. הנח בה קבצי .xbrl והרץ שוב.`);
  process.exit(0);
}

const files = (await readdir(XBRL_DIR)).filter((n) => n.toLowerCase().endsWith('.xbrl'));
if (!files.length) {
  console.log(`לא נמצאו קבצי .xbrl ב-${XBRL_DIR}`);
  process.exit(0);
}

const periods = [];
for (const name of files) {
  const xml = await readFile(`${XBRL_DIR}/${name}`, 'utf8');
  const { facts, meta, contexts } = parseXbrl(xml.replace(/^\uFEFF/, ''));
  const v = validate(facts);

  // תאריך המאזן הוא המפתח האוניברסלי — קיים בכל דוח, רבעוני או שנתי
  const balanceDate = contexts['Current_AsOf']?.instant ?? null;
  // אורך תקופת התוצאה — קריטי: אסור להשוות רבעון לשנה
  const fp = contexts['Current_ForPeriod'];
  let months = null, periodStart = null, periodEnd = null;
  if (fp?.start && fp?.end) {
    periodStart = fp.start; periodEnd = fp.end;
    months = Math.round((new Date(fp.end) - new Date(fp.start)) / 86400000 / 30.44);
  }
  const periodLabel = months === 12
    ? `שנת ${meta.PeriodicFinancialStatementsForYear ?? periodEnd?.slice(0, 4)}`
    : months === 3 && periodEnd
      ? `רבעון ${Math.ceil(Number(periodEnd.slice(5, 7)) / 3)}/${periodEnd.slice(0, 4)}`
      : (meta.InterimFinancialStatementsForPeriod ?? periodEnd ?? balanceDate);

  periods.push({
    file: name,
    entity: meta.HebrewNameOfReportingEntity ?? null,
    corpId: meta.CorporateRegistrationNumberOfReportingEntity ?? null,
    formType: meta.FormShortName ?? null,
    reference: meta.ReportReferenceNumber ?? null,
    periodLabel,
    periodStart,
    periodEnd,
    balanceDate,
    months,                       // 3 = רבעון, 12 = שנתי
    isAnnual: months === 12,
    filedAt: meta.ReportDistributionTime ?? null,
    auditor: meta.NameOfAuditingFirm ?? null,
    unqualified: meta.UnqualifiedReview === 'true',
    facts,
    ratios: ratios(facts),
    validation: v,
  });

  const mark = v.passed ? '✓' : '✗';
  console.log(`${mark} ${name} — ${periodLabel} · מאזן ${balanceDate} · ${months} ח׳ (${v.checks.filter(c=>c.ok).length}/${v.checks.length})`);
  v.checks.filter((c) => !c.ok).forEach((c) =>
    console.error(`    חריגה: ${c.label} — ${c.a?.toLocaleString()} מול ${c.b?.toLocaleString()}`));
}

periods.sort((a, b) => (a.balanceDate ?? '').localeCompare(b.balanceDate ?? ''));

/* בדיקת רציפות — על סעיפי מאזן בלבד, בין תקופות עוקבות */
const continuity = [];
for (let i = 1; i < periods.length; i++) {
  const prev = periods[i - 1], cur = periods[i];
  // דוח שנתי חופף לרבעונים שבתוכו — הרווח שלו אינו תוספת על הרבעון הקודם
  if (cur.isAnnual || prev.isAnnual) continue;
  if (Number.isFinite(prev.facts.Equity) && Number.isFinite(cur.facts.Equity)) {
    const drift = cur.facts.Equity - prev.facts.Equity - (cur.facts.ProfitLoss ?? 0);
    continuity.push({
      from: prev.balanceDate, to: cur.balanceDate,
      label: 'שינוי בהון מוסבר ברווח',
      unexplained: drift,
      ok: Math.abs(drift) <= Math.abs(cur.facts.Equity) * 0.02,
    });
  }
}

const quarters = periods.filter((p) => p.months === 3);
const annuals = periods.filter((p) => p.isAnnual);

const out = {
  generatedAt: new Date().toISOString(),
  source: 'XBRL — רשות ניירות ערך (מגנא)',
  periodCount: periods.length,
  quarterCount: quarters.length,
  annualCount: annuals.length,
  allPassed: periods.every((p) => p.validation.passed),
  continuity,
  periods,
};

await writeFile(OUT, JSON.stringify(out, null, 2), 'utf8');
console.log(`\nנשמר ${OUT} — ${periods.length} תקופות, ולידציה ${out.allPassed ? 'עברה' : 'נכשלה'}`);
