/**
 * fetch-sources.mjs — שולף מהמקורות הציבוריים: מאיה, מגנא, בורסה ועיתונות
 *
 * הסביבה שבה נכתב הקובץ חסומה לרשת, ולכן אי אפשר היה לאמת מולה נקודת קצה
 * אחת. במקום לנחש נקודה אחת ולקוות, כל מקור מחזיק **שרשרת מועמדים**:
 * הסקריפט מנסה אותם לפי הסדר, בודק שהמבנה שחזר באמת נראה כמו הנתון המבוקש,
 * ורושם ביומן מה עבד ומה נפל ולמה.
 *
 * הריצה הראשונה ב-GitHub Actions היא הבדיקה. אחריה אפשר למחוק מועמדים.
 *
 * שלושה כללים שלא נשברים:
 *   1. נתון שלא עבר ולידציית מבנה לא נכנס. עדיף חסר מאשר שגוי.
 *   2. כישלון לא מוחק נתון קודם — הוא מסמן אותו כמיושן.
 *   3. כישלון של מקור אחד לא מפיל את השאר.
 *
 * שימוש:
 *   node scripts/fetch-sources.mjs              שליפה מלאה
 *   node scripts/fetch-sources.mjs --selftest   בודק את הפרסרים מול פיקסטורות, בלי רשת
 *   node scripts/fetch-sources.mjs --only=news  מקור אחד בלבד
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const COMPANY_ID = 2449;            // מספר תאגיד במאיה
const CORP_ID = '514444660';        // ח.פ. · המפתח במגנא
const BOND_ID = 1214626;            // מיי טאון אג״ח א׳
const NAME = 'קבוצת מיי טאון';

const OUT = 'data/sources.json';
const STATUS = 'data/sources-status.json';
const XBRL_DIR = 'data/xbrl';
const TIMEOUT = 25000;

/* כותרות HTTP הן ByteString — תו לא-ASCII זורק שגיאה לפני שהבקשה יוצאת.
   ה-UA חייב להישאר באנגלית בלבד. */
const UA = 'MytownDashboard/2.0 (+https://github.com/RealEstateIL/MyTown; public-filings analysis; contact via repo issues)';
const BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').split('=')[1];
const SELFTEST = process.argv.includes('--selftest');

/* ═══════════ תשתית ═══════════ */
async function http(url, init = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': UA,
        'Accept-Language': 'he-IL,he;q=0.9,en;q=0.8',
        ...(init.headers || {}),
      },
      ...init,
    });
    const body = await res.text();
    return { status: res.status, ok: res.ok, body, bytes: body.length,
             contentType: res.headers.get('content-type') || '' };
  } finally { clearTimeout(t); }
}

const json = (body) => { try { return JSON.parse(body); } catch { return null; } };
const strip = (html) => html.replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

/** מוציא פריטים מכל פיד RSS או Atom, בלי תלות בספרייה */
function parseFeed(xml) {
  const items = [];
  const grab = (block, tag) => {
    const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
    if (!m) return null;
    return m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
  };
  for (const m of xml.matchAll(/<(?:item|entry)[\s>][\s\S]*?<\/(?:item|entry)>/gi)) {
    const b = m[0];
    const link = grab(b, 'link') || (b.match(/<link[^>]+href="([^"]+)"/i) || [])[1] || null;
    items.push({
      title: strip(grab(b, 'title') || ''),
      date: grab(b, 'pubDate') || grab(b, 'published') || grab(b, 'updated') || null,
      url: link,
      source: strip(grab(b, 'source') || '') || null,
    });
  }
  return items;
}

/* ═══════════ המקורות ═══════════ */
const SOURCES = [
  {
    id: 'maya-reports',
    title: 'דיווחי מאיה',
    why: 'רשימת הדיווחים המיידיים והתקופתיים · מזהה דוח חדש שטרם נטען',
    blockedOnCI: 'מאיה חוסמת ברמת WAF כתובות של מרכזי נתונים ומחזירה security violation. עובד מהרצה מקומית.',
    candidates: [
      {
        label: 'mayaapi · company/reports',
        url: `https://mayaapi.tase.co.il/api/company/reports?companyId=${COMPANY_ID}&lang=he`,
        init: { headers: { 'X-Maya-With': 'allow', Referer: 'https://maya.tase.co.il/', Accept: 'application/json' } },
        parse: (b) => {
          const j = json(b); if (!j) return null;
          const rows = j.Reports || j.reports || j.Items || j.items || (Array.isArray(j) ? j : null);
          if (!Array.isArray(rows)) return null;
          return rows.slice(0, 30).map((r) => ({
            title: r.Title || r.title || r.SubjectDesc || null,
            date: r.PubDate || r.pubDate || r.Date || r.PublicationDate || null,
            reference: r.RptId || r.rptId || r.ReferenceNumber || null,
            url: (r.RptId || r.rptId) ? `https://maya.tase.co.il/reports/details/${r.RptId || r.rptId}` : null,
          }));
        },
      },
      {
        label: 'mayaapi · v1/company/reports',
        url: `https://mayaapi.tase.co.il/api/v1/company/reports?companyId=${COMPANY_ID}&lang=he`,
        init: { headers: { 'X-Maya-With': 'allow', Referer: 'https://maya.tase.co.il/', Accept: 'application/json' } },
        parse: (b) => { const j = json(b); const rows = j && (j.Reports || j.Items); return Array.isArray(rows)
          ? rows.slice(0, 30).map((r) => ({ title: r.Title || null, date: r.PubDate || null,
              reference: r.RptId || null, url: r.RptId ? `https://maya.tase.co.il/reports/details/${r.RptId}` : null })) : null; },
      },
    ],
    check: (v) => Array.isArray(v) && v.length > 0 && v.some((r) => r.title),
  },

  {
    id: 'magna-reports',
    title: 'דיווחי מגנא',
    why: 'אתר ההפצה של רשות ניירות ערך · המקור הרשמי לקבצי ה-XBRL',
    blockedOnCI: 'מגנא מחזירה 403 עם דף חסימה זהה לכל נתיב. עובד מהרצה מקומית.',
    candidates: [
      {
        label: 'magna · חיפוש לפי ח.פ.',
        url: `https://www.magna.isa.gov.il/api/reports/search?corporateNumber=${CORP_ID}&pageSize=30`,
        init: { headers: { Accept: 'application/json', Referer: 'https://www.magna.isa.gov.il/' } },
        parse: (b) => { const j = json(b); const rows = j && (j.Reports || j.results || j.Items || (Array.isArray(j) ? j : null));
          return Array.isArray(rows) ? rows.slice(0, 30).map((r) => ({
            title: r.Subject || r.subject || r.Title || null,
            date: r.PublicationDate || r.publishDate || null,
            reference: r.ReferenceNumber || r.referenceNumber || null,
            files: r.Files || r.files || null })) : null; },
      },
      {
        label: 'magna · דף התוצאות · פרסור HTML',
        url: `https://www.magna.isa.gov.il/?q=${encodeURIComponent(CORP_ID)}`,
        parse: (b) => {
          const refs = [...new Set([...b.matchAll(/\b(20\d\d-\d\d-\d{6})\b/g)].map((m) => m[1]))];
          return refs.length ? refs.map((reference) => ({ reference, title: null, date: null })) : null;
        },
      },
    ],
    check: (v) => Array.isArray(v) && v.length > 0,
  },

  {
    id: 'bond-quote',
    title: 'ציטוט אג״ח סדרה א׳',
    why: 'התשואה השוטפת · הפריט האחרון שחסר בלשונית מידע למשקיע',
    candidates: [
      {
        /* המבנה אומת בגישוש מול הדף החי: טבלת ביצועים בזוגות
           <td>תווית</td><td dir="ltr">ערך</td>, ולצדה שורת תקציר עם
           <label>תווית: </label><span>ערך</span>. שני המקורות נקראים,
           והטבלה גוברת כי היא מדויקת יותר. */
        label: 'ביזפורטל · טבלת ביצועים',
        url: `https://www.bizportal.co.il/bonds/quote/generalview/${BOND_ID}`,
        init: { headers: { 'User-Agent': BROWSER, Accept: 'text/html' } },
        parse: (b) => {
          const num = (v) => { const n = Number(String(v).replace(/[%,\s]/g, '')); return Number.isFinite(n) ? n : null; };
          const tbl = {};
          for (const m of b.matchAll(/<td>([^<]{2,30})<\/td><td dir="ltr">(-?[\d.,]+)<\/td>/g)) tbl[m[1].trim()] = num(m[2]);
          const lbl = (name) => {
            const m = b.match(new RegExp(name + ':\\s*<\\/label>\\s*<span[^>]*>([^<]+)<'));
            return m ? num(m[1]) : null;
          };
          const basePrice = (b.match(/<dt>שער בסיס<\/dt><dd>([\d.,]+)<\/dd>/) || [])[1];
          const out = {
            price: num(basePrice),
            yieldGross: tbl['ברוטו להחזקה'] ?? lbl('תשואה ברוטו'),
            yieldNet: tbl['נטו להחזקה'] ?? lbl('תשואה נטו'),
            duration: tbl['מח"מ'] ?? lbl('מח"מ'),
            adjustedGross: tbl['ערך מתואם ברוטו'] ?? null,
            adjustedNet: tbl['ערך מתואם נטו'] ?? null,
            yearsToMaturity: tbl['טווח לפדיון'] ?? null,
            govSpread: tbl['מרווח ממשלתי'] ?? null,
          };
          return (Number.isFinite(out.price) || Number.isFinite(out.yieldGross)) ? out : null;
        },
      },
    ],
    check: (v) => v && (Number.isFinite(v.price) || Number.isFinite(v.yieldGross)),
  },

  {
    id: 'news',
    title: 'כתבות שפורסמו',
    why: 'הקשר חיצוני לדיווחים · מה שהעיתונות מדווחת ואינו בגילוי',
    candidates: [
      {
        label: 'Google News RSS',
        url: `https://news.google.com/rss/search?q=${encodeURIComponent('"' + NAME + '"')}&hl=he&gl=IL&ceid=IL:he`,
        parse: (b) => { const items = parseFeed(b); return items.length ? items.slice(0, 25) : null; },
      },
      {
        label: 'ביזפורטל · חיפוש',
        url: `https://www.bizportal.co.il/search?q=${encodeURIComponent(NAME)}`,
        parse: (b) => {
          const hits = [...b.matchAll(/href="(\/[^"]*\/news\/[^"]+)"[^>]*>([^<]{10,140})</g)]
            .map((m) => ({ url: 'https://www.bizportal.co.il' + m[1], title: strip(m[2]), date: null }));
          return hits.length ? hits.slice(0, 25) : null;
        },
      },
    ],
    check: (v) => Array.isArray(v) && v.length > 0 && v.every((i) => i.title),
  },
];

/* ═══════════ בדיקה עצמית · הפרסרים מול פיקסטורות, בלי רשת ═══════════
   הרשת אינה זמינה בסביבת הפיתוח, אבל ההיגיון של הפרסור כן ניתן לבדיקה.
   כשנקודת הקצה תתברר, רק הכתובת תשתנה — הפרסור כבר מוכח. */
const FIXTURES = {
  'maya-reports': {
    candidate: 0,
    body: JSON.stringify({ Reports: [
      { RptId: 1552631, Title: 'דוח רבעוני ליום 30.6.2026', PubDate: '2026-08-27T17:15:00' },
      { RptId: 1544120, Title: 'הגעה לרוב הדרוש · שמעוני 19', PubDate: '2025-09-10T09:00:00' }] }),
    expect: (v) => v.length === 2 && v[0].reference === 1552631 && v[0].url.includes('1552631'),
  },
  'magna-reports': {
    candidate: 1,
    body: '<a href="/Details?ref=2026-01-078335">דוח</a> <span>2026-01-049263</span> <i>2026-01-078335</i>',
    expect: (v) => v.length === 2 && v.map((r) => r.reference).includes('2026-01-078335'),
  },
  'bond-quote': {
    candidate: 0,
    /* מבנה אמיתי · הועתק מהדף החי בגישוש */
    body: '<div class="paper_data_wrap"><dl><dt>שער בסיס</dt><dd>100.77</dd></dl></div>' +
      '<li><label>תשואה ברוטו: </label> <span style=\'font-weight:bold;\'>9.2%</span></li>' +
      '<table><tbody><tr><td>ברוטו להחזקה</td><td dir="ltr">9.2</td></tr>' +
      '<tr><td>ערך מתואם ברוטו</td><td dir="ltr">103.12</td></tr>' +
      '<tr><td>מח"מ</td><td dir="ltr">1.59</td></tr>' +
      '<tr><td>נטו להחזקה</td><td dir="ltr">7.7</td></tr>' +
      '<tr><td>ערך מתואם נטו</td><td dir="ltr">102.66</td></tr>' +
      '<tr><td>טווח לפדיון</td><td dir="ltr">1.73</td></tr>' +
      '<tr><td>מרווח ממשלתי</td><td dir="ltr">5.87</td></tr></tbody></table>',
    expect: (v) => v.price === 100.77 && v.yieldGross === 9.2 && v.yieldNet === 7.7 &&
      v.duration === 1.59 && v.govSpread === 5.87 && v.yearsToMaturity === 1.73,
  },
  news: {
    candidate: 0,
    body: `<rss><channel>
      <item><title><![CDATA[מיי טאון מדווחת על תעודת גמר]]></title>
        <link>https://example.com/a</link><pubDate>Mon, 27 Apr 2026 08:00:00 GMT</pubDate>
        <source url="x">גלובס</source></item>
      <item><title>הרחבת אשראי בנקאי</title><link>https://example.com/b</link>
        <pubDate>Tue, 01 Sep 2026 08:00:00 GMT</pubDate></item>
    </channel></rss>`,
    expect: (v) => v.length === 2 && v[0].title.includes('תעודת גמר') && v[0].source === 'גלובס' && v[1].url.endsWith('/b'),
  },
};

if (SELFTEST) {
  let bad = 0;
  for (const src of SOURCES) {
    const fx = FIXTURES[src.id];
    if (!fx) { console.log(`⊘ ${src.id} — אין פיקסטורה`); continue; }
    const cand = src.candidates[fx.candidate];
    let parsed = null, err = null;
    try { parsed = cand.parse(fx.body); } catch (e) { err = e.message; }
    const shapeOk = parsed != null && src.check(parsed);
    const expectOk = shapeOk && fx.expect(parsed);
    if (expectOk) console.log(`✓ ${src.id} · ${cand.label} — הפרסור והוולידציה תקינים`);
    else { bad++; console.error(`✗ ${src.id} · ${cand.label} — ${err || (parsed == null ? 'הפרסור החזיר null' : !shapeOk ? 'נפל בוולידציית המבנה' : 'הפלט אינו כמצופה')}`); console.error('  ', JSON.stringify(parsed)); }
  }
  console.log(bad ? `\n${bad} פרסרים נכשלו` : '\nכל הפרסרים עברו. מה שנותר לאמת הוא כתובות נקודות הקצה, וזה קורה בריצה הראשונה ב-Actions.');
  process.exit(bad ? 1 : 0);
}

/* ═══════════ הרצה ═══════════ */
async function runSource(src) {
  const attempts = [];
  for (const cand of src.candidates) {
    const t0 = Date.now();
    try {
      const res = await http(cand.url, cand.init || {});
      const ms = Date.now() - t0;
      if (!res.ok) { attempts.push({ candidate: cand.label, url: cand.url, status: res.status, ms, result: 'HTTP שגוי' }); continue; }
      let parsed = null, perr = null;
      try { parsed = cand.parse(res.body); } catch (e) { perr = e.message; }
      if (parsed == null) { attempts.push({ candidate: cand.label, url: cand.url, status: res.status, bytes: res.bytes, ms, result: perr ? 'שגיאת פרסור: ' + perr : 'הפרסור לא זיהה מבנה' }); continue; }
      if (!src.check(parsed)) { attempts.push({ candidate: cand.label, url: cand.url, status: res.status, bytes: res.bytes, ms, result: 'נפל בוולידציית המבנה — לא נכנס' }); continue; }
      attempts.push({ candidate: cand.label, url: cand.url, status: res.status, bytes: res.bytes, ms, result: 'הצליח' });
      return { ok: true, value: parsed, attempts, winner: cand.label };
    } catch (e) {
      attempts.push({ candidate: cand.label, url: cand.url, ms: Date.now() - t0, result: 'שגיאת רשת: ' + e.message });
    }
  }
  return { ok: false, value: null, attempts, winner: null };
}

const previous = existsSync(OUT) ? JSON.parse(await readFile(OUT, 'utf8')) : { sources: {} };
const targets = SOURCES.filter((s) => !ONLY || s.id === ONLY);
const now = new Date().toISOString();
const out = { updatedAt: now, company: { name: 'קבוצת מיי טאון בע"מ', tase: COMPANY_ID, corpId: CORP_ID }, sources: {} };
const status = { ranAt: now, env: process.env.GITHUB_ACTIONS ? 'GitHub Actions' : 'הרצה מקומית', results: [] };

for (const src of targets) {
  const r = await runSource(src);
  const prev = previous.sources?.[src.id];
  out.sources[src.id] = r.ok
    ? { title: src.title, data: r.value, fetchedAt: now, stale: false, via: r.winner, error: null }
    : { title: src.title, data: prev?.data ?? null, fetchedAt: prev?.fetchedAt ?? null, stale: true, via: prev?.via ?? null,
        error: r.attempts.map((a) => `${a.candidate}: ${a.result}`).join(' | ') };
  status.results.push({ id: src.id, title: src.title, why: src.why, blockedOnCI: src.blockedOnCI || null, ok: r.ok, via: r.winner,
    count: Array.isArray(r.value) ? r.value.length : r.value ? 1 : 0, attempts: r.attempts });
  console.log(`${r.ok ? '✓' : '✗'} ${src.id} — ${r.ok ? `דרך ${r.winner}` : 'כל המועמדים נפלו'}`);
  for (const a of r.attempts) console.log(`    ${a.candidate}: ${a.result}${a.status ? ` (HTTP ${a.status})` : ''}`);
}

/* קבצי XBRL שכבר אצלנו — כדי שהדוח יידע מה חסר */
if (existsSync(XBRL_DIR)) {
  const { readdir } = await import('node:fs/promises');
  const have = (await readdir(XBRL_DIR)).filter((n) => n.toLowerCase().endsWith('.xbrl'));
  const refs = have.map((n) => (n.match(/(20\d\d-\d\d-\d{6})/) || [])[1]).filter(Boolean);
  out.xbrlOnDisk = { files: have, references: refs };
  const seen = out.sources['magna-reports']?.data;
  if (Array.isArray(seen)) {
    const missing = seen.map((r) => r.reference).filter((r) => r && !refs.includes(String(r)));
    out.xbrlMissing = missing;
    if (missing.length) console.log(`\nדיווחים במגנא שאין להם XBRL אצלנו: ${missing.join(', ')}`);
  }
}

await mkdir('data', { recursive: true });
await writeFile(OUT, JSON.stringify(out, null, 2) + '\n', 'utf8');
await writeFile(STATUS, JSON.stringify(status, null, 2) + '\n', 'utf8');
console.log(`\nנשמר ${OUT} ו-${STATUS}`);

const failed = status.results.filter((r) => !r.ok);
if (failed.length === targets.length) {
  console.error('\nכל המקורות נפלו. הנתונים הקודמים נשמרו ומסומנים כמיושנים.');
  process.exit(0); // לא מפילים את ה-Action · הפרסור והבנייה ממשיכים
}
