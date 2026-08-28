/**
 * מיי טאון — שולף נתונים ממקורות פתוחים ושומר data/latest.json
 * רץ ב-GitHub Actions פעם ביום. אין תלות חיצונית (Node 20+ בלבד).
 *
 * כל מקור הוא "אדפטר" עצמאי. אם אחד נופל, השאר ממשיכים
 * והנתון הקודם נשמר. ככה יום אחד של שינוי ב-HTML לא שובר הכל.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const COMPANY_ID = 2449;          // מספר מנפיק במאיה
const BOND_ID = 1214626;          // מיי טאון אגח א
const OUT = 'data/latest.json';

const UA = 'Mozilla/5.0 (compatible; MytownDashboard/1.0)';

async function get(url, opts = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'he-IL,he;q=0.9', ...(opts.headers || {}) },
    ...opts,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${url}`);
  return opts.json ? res.json() : res.text();
}

/* ---------------------------------------------------------------
   אדפטר 1 — דיווחי מאיה
   מאיה מגישה JSON לאתר שלה עצמו. אם המבנה משתנה, נופלים לפרסור HTML.
---------------------------------------------------------------- */
async function fetchMayaReports() {
  const url = `https://mayaapi.tase.co.il/api/company/reports?companyId=${COMPANY_ID}&lang=he`;
  const raw = await get(url, {
    json: true,
    headers: { 'X-Maya-With': 'allow', Referer: 'https://maya.tase.co.il/' },
  });
  const rows = raw.Reports || raw.reports || raw.Items || [];
  return rows.slice(0, 15).map((r) => ({
    title: r.Title || r.title,
    date: r.PubDate || r.pubDate || r.Date,
    url: r.RptId ? `https://maya.tase.co.il/reports/details/${r.RptId}` : null,
  }));
}

/* ---------------------------------------------------------------
   אדפטר 2 — נתוני האג"ח (מקור פתוח, ביזפורטל)
---------------------------------------------------------------- */
async function fetchBond() {
  const html = await get(`https://www.bizportal.co.il/bonds/quote/generalview/${BOND_ID}`);
  const pick = (label) => {
    const re = new RegExp(label + '[^0-9\\-]{0,80}([\\-0-9.,]+)');
    const m = html.replace(/<[^>]+>/g, ' ').match(re);
    return m ? m[1].trim() : null;
  };
  return {
    lastPrice: pick('שער אחרון'),
    changePct: pick('שינוי'),
    seriesMarketCap: pick('שווי שוק סדרה'),
    yield: pick('תשואה'),
  };
}

/* ---------------------------------------------------------------
   אדפטר 3 — עסקאות נדל"ן (רשות המסים, API פתוח)
   מחזיר עסקאות באזור שרלוונטי לפרויקטים של החברה.
---------------------------------------------------------------- */
async function fetchDeals(query = 'רמת גן') {
  const url = 'https://www.nadlan.gov.il/Nadlan.REST/Main/GetAssestAndDeals';
  const body = { MoreAssestsType: 0, FillterRoomNum: 0, Ordering: null, CurrentLavelCode: 'level1', PageNo: 1, Address: query };
  const raw = await get(url, {
    json: true,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const deals = raw.AllResults || raw.Results || [];
  return deals.slice(0, 25).map((d) => ({
    address: d.FULLADRESS || d.Address,
    date: d.DEALDATETIME || d.DealDate,
    price: Number(d.DEALAMOUNT?.toString().replace(/,/g, '')) || null,
    rooms: d.ASSETROOMNUM || null,
    sqm: Number(d.DEALNATURE) || null,
    year: d.BUILDINGYEAR || null,
  }));
}

/* ---------------------------------------------------------------
   הרצה — כל אדפטר עוטף ב-try כדי שכישלון בודד לא יפיל הכל
---------------------------------------------------------------- */
async function safe(name, fn) {
  try {
    const value = await fn();
    console.log(`✓ ${name}`);
    return { ok: true, value, error: null };
  } catch (e) {
    console.error(`✗ ${name}: ${e.message}`);
    return { ok: false, value: null, error: e.message };
  }
}

const previous = existsSync(OUT) ? JSON.parse(await readFile(OUT, 'utf8')) : {};

const [reports, bond, deals] = await Promise.all([
  safe('maya-reports', fetchMayaReports),
  safe('bond-quote', fetchBond),
  safe('nadlan-deals', () => fetchDeals('רמת גן')),
]);

// אם מקור נפל — משאירים את הערך הקודם ומסמנים כמיושן
const merge = (res, key) =>
  res.ok
    ? { data: res.value, fetchedAt: new Date().toISOString(), stale: false, error: null }
    : { ...(previous[key] || { data: null, fetchedAt: null }), stale: true, error: res.error };

const out = {
  company: { name: 'קבוצת מיי טאון בע"מ', tase: COMPANY_ID, corpId: '514444660' },
  updatedAt: new Date().toISOString(),
  reports: merge(reports, 'reports'),
  bond: merge(bond, 'bond'),
  deals: merge(deals, 'deals'),
};

await mkdir('data', { recursive: true });
await writeFile(OUT, JSON.stringify(out, null, 2), 'utf8');
console.log('נשמר ל-' + OUT);
