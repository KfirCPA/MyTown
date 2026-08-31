/**
 * probe-sources.mjs — גישוש ממוקד · המבנה סביב המספרים בעמוד האג״ח
 *
 * הסבב הקודם הראה: מאיה ומגנא חוסמות ברמת WAF ואינן ניתנות לשליפה
 * מראנר; ביזפורטל מחזיר 200 עם הנתונים בפנים. נותר לראות איך המספרים
 * יושבים במקור כדי לכתוב פרסר מדויק. נמחק אחרי הסבב הזה.
 */
const BOND_ID = 1214626;
const URL = `https://www.bizportal.co.il/bonds/quote/generalview/${BOND_ID}`;
const BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const res = await fetch(URL, { headers: { 'User-Agent': BROWSER, Accept: 'text/html' } });
const html = await res.text();
console.log(`${res.status} · ${html.length} תווים\n`);

/* בלוקי JSON מוטמעים — אם יש, הם המקור הנקי ביותר */
for (const m of html.matchAll(/<script[^>]*(?:id="__NEXT_DATA__"|type="application\/json")[^>]*>([\s\S]{0,400})/g)) {
  console.log('── בלוק JSON מוטמע:\n   ' + m[1].slice(0, 380).replace(/\s+/g, ' ') + '\n');
}

const NEEDLES = ['תשואה', 'שער', 'מיי טאון', 'ברוטו', 'לפדיון', 'מח"מ', 'שינוי'];
for (const n of NEEDLES) {
  let i = -1, shown = 0;
  while ((i = html.indexOf(n, i + 1)) >= 0 && shown < 2) {
    const around = html.slice(Math.max(0, i - 130), i + 190).replace(/\s+/g, ' ');
    console.log(`── "${n}" @${i}\n   ${around}\n`);
    shown++;
  }
  if (!shown) console.log(`── "${n}" — לא נמצא\n`);
}
