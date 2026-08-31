/**
 * probe-sources.mjs — גישוש · מה באמת חוזר מכל כתובת
 *
 * זמני. הסביבה המקומית חסומה לרשת, ולכן אי אפשר לנחש נקודות קצה מכאן.
 * הסקריפט רץ ב-Actions, מדפיס לכל מועמד את הסטטוס, סוג התוכן, הגודל,
 * ואילו סימנים מזהים מופיעים בגוף — וכך אפשר לכתוב פרסר מול המציאות
 * במקום מול ניחוש. נמחק ברגע שהאדפטרים מתייצבים.
 */
const COMPANY_ID = 2449, CORP_ID = '514444660', BOND_ID = 1214626;

const BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const MAYA = { 'X-Maya-With': 'allow', Referer: 'https://maya.tase.co.il/', Accept: 'application/json, text/plain, */*' };

const TARGETS = [
  { label: 'maya · api reports · UA דפדפן', url: `https://mayaapi.tase.co.il/api/company/reports?companyId=${COMPANY_ID}&lang=he`,
    init: { headers: { ...MAYA, 'User-Agent': BROWSER } } },
  { label: 'maya · api companydetails', url: `https://mayaapi.tase.co.il/api/company/companydetails?companyId=${COMPANY_ID}&lang=he`,
    init: { headers: { ...MAYA, 'User-Agent': BROWSER } } },
  { label: 'maya · דף החברה', url: `https://maya.tase.co.il/company/${COMPANY_ID}`,
    init: { headers: { 'User-Agent': BROWSER, Accept: 'text/html' } } },
  { label: 'magna · שורש', url: 'https://www.magna.isa.gov.il/', init: { headers: { 'User-Agent': BROWSER } } },
  { label: 'magna · default.aspx', url: 'https://www.magna.isa.gov.il/default.aspx', init: { headers: { 'User-Agent': BROWSER } } },
  { label: 'magna · RssFeed', url: 'https://www.magna.isa.gov.il/RssFeed.aspx?lang=he', init: { headers: { 'User-Agent': BROWSER } } },
  { label: 'magna · api חיפוש POST', url: 'https://www.magna.isa.gov.il/api/Search/Search',
    init: { method: 'POST', headers: { 'User-Agent': BROWSER, 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ freeText: CORP_ID, pageNumber: 1, pageSize: 20 }) } },
  { label: 'ביזפורטל · אג״ח generalview', url: `https://www.bizportal.co.il/bonds/quote/generalview/${BOND_ID}`,
    init: { headers: { 'User-Agent': BROWSER, Accept: 'text/html' } } },
  { label: 'ביזפורטל · אג״ח quote', url: `https://www.bizportal.co.il/bonds/quote/${BOND_ID}`,
    init: { headers: { 'User-Agent': BROWSER, Accept: 'text/html' } } },
];

const MARKERS = ['מיי טאון', 'מייטאון', CORP_ID, String(BOND_ID), 'שער אחרון', 'תשואה',
  '2026-01-078335', 'RptId', 'Reports', '__NEXT_DATA__', '<rss', 'application/json'];

const strip = (h) => h.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

for (const t of TARGETS) {
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), 20000);
  try {
    const res = await fetch(t.url, { signal: ctl.signal, redirect: 'follow', ...t.init });
    const body = await res.text();
    const hits = MARKERS.filter((m) => body.includes(m));
    console.log(`\n── ${t.label}`);
    console.log(`   ${res.status} · ${res.headers.get('content-type') || '—'} · ${body.length} תווים · סופי ${res.url}`);
    console.log(`   סימנים: ${hits.length ? hits.join(', ') : 'אין'}`);
    console.log(`   טקסט: ${strip(body).slice(0, 260)}`);
    if ((res.headers.get('content-type') || '').includes('json')) {
      try { console.log(`   מפתחות: ${Object.keys(JSON.parse(body)).slice(0, 20).join(', ')}`); } catch {}
    }
  } catch (e) {
    console.log(`\n── ${t.label}\n   נפל: ${e.message}`);
  } finally { clearTimeout(to); }
}
