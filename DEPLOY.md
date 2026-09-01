# פרסום האתר · GitHub Pages

מדריך מלא להעלאת מרכז הבקרה לאוויר, מהצעד הראשון ועד הדומיין המותאם.
הרפו: `RealEstateIL/MyTown` · **ציבורי** · ענף ברירת מחדל `main`.

**הכתובת שתתקבל:** `https://realestateil.github.io/MyTown/`

---

## 0 · לפני שמתחילים · האם זה כבר פעיל

ל-API של גיטהאב הרפו מסומן `has_pages: true`. ייתכן שהאתר כבר באוויר.

1. `https://github.com/RealEstateIL/MyTown` → **Settings** → **Pages** (בתפריט הצד).
2. אם בראש העמוד מופיע *Your site is live at…* — האתר קיים. עברו לסעיף 3 (אימות)
   ואז לסעיף 4 (העדכון האוטומטי), ודלגו על 1–2.
3. אם מופיע *GitHub Pages is currently disabled* — המשיכו לסעיף 1.

---

## 1 · בדיקות מוכנות · שבע דקות שחוסכות שעה

הפרויקט הזה כבר בנוי נכון ל-Pages, אבל כדאי לעבור על הרשימה:

| בדיקה | מצב ברפו | למה זה חשוב |
|---|---|---|
| `index.html` בשורש הרפו | ✅ קיים | Pages מגיש אותו כדף הבית אוטומטית |
| כל הנתיבים יחסיים | ✅ `fetch("data/app/…")` | נתיב מוחלט (`/data/…`) היה נשבר בתת-נתיב `/MyTown/` |
| אין תלות בשרת צד-שרת | ✅ אתר סטטי בלבד | Pages מגיש קבצים בלבד · אין PHP, אין Node בזמן ריצה |
| `fetch` עובד | ✅ מעל `https://` | זו בדיוק הבעיה שפתיחה מ-`file://` יוצרת · Pages פותר אותה |
| גודל הרפו | ✅ ~861KB | המגבלה 1GB לאתר |
| אין סודות בקוד | ✅ נתונים פומביים בלבד | **כל מה שברפו יהיה גלוי לכל העולם** |

**אזהרה אחת אמיתית:** פרסום Pages על רפו ציבורי חושף את כל תוכן הענף — כולל
`data/`, `SPEC.md`, `CONTENTSPEC.md` והיסטוריית הגיט. במקרה הזה הכל גילוי ציבורי
ממאיה, אז אין בעיה. אם בעתיד ייכנס לרפו נתון שאינו לפרסום — הוא יהיה באוויר.

---

## 2 · ההפעלה · שתי דרכים

### דרך א׳ · Deploy from a branch · שתי דקות

הכי מהירה. מתאימה אם רוצים אתר באוויר עכשיו.

1. **Settings** → **Pages**.
2. תחת **Build and deployment** → **Source**: בחרו **Deploy from a branch**.
3. תחת **Branch**: בחרו `main`, ותיקייה `/ (root)`. לחצו **Save**.
4. המתינו 1–3 דקות. בלשונית **Actions** תופיע ריצה בשם `pages-build-deployment`.
5. חזרו ל-**Settings → Pages** ורעננו — תופיע השורה *Your site is live at*.

**קובץ שכדאי להוסיף בדרך הזו:** בשורש הרפו צרו קובץ ריק בשם `.nojekyll`.
בלעדיו Pages מריץ Jekyll על התוכן, ו-Jekyll מתעלם מקבצים ותיקיות שמתחילים
בקו תחתון או בנקודה. היום זה לא מזיק לרפו הזה, אבל זו מלכודת שקטה שמתפוצצת
ביום שמוסיפים תיקייה כזו.

```bash
touch .nojekyll
git add .nojekyll && git commit -m "Pages: לעקוף את Jekyll" && git push
```

### דרך ב׳ · GitHub Actions · מומלץ לרפו הזה

יותר ארוכה בהקמה, אבל פותרת בעיה אמיתית: הרפו הזה מתעדכן לבד כל יום
דרך `update.yml`, וה-commit הזה נעשה בידי בוט. פריסה דרך Actions נותנת
שליטה מפורשת מתי האתר נבנה מחדש, כולל אחרי ריצת הנתונים היומית.
בנוסף היא מדלגת על Jekyll לגמרי, כך ש-`.nojekyll` מיותר.

1. **Settings** → **Pages** → **Source**: בחרו **GitHub Actions**.
2. צרו את `.github/workflows/pages.yml` עם התוכן הבא:

```yaml
name: פרסום האתר

on:
  push:
    branches: [main]
  # מריץ פרסום גם אחרי שריצת הנתונים היומית סיימה ודחפה commit
  workflow_run:
    workflows: ["עדכון נתוני מייטאון"]
    types: [completed]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

# פריסה אחת בכל רגע · ריצה חדשה מבטלת ממתינה, לא רצה
concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: .          # כל הרפו · index.html ו-data/ בשורש
      - id: deployment
        uses: actions/deploy-pages@v4
```

3. commit ו-push ל-`main`. הריצה תתחיל מיד, ובסופה יופיע קישור לאתר
   בסיכום הריצה ובלשונית **Settings → Pages**.

**מה עולה לאוויר:** `path: .` מעלה את כל הרפו. אם תרצו להעלות רק את מה
שהאתר צריך, החליפו בשלב הכנה שמעתיק ל-`_site/`:

```yaml
      - name: הכנת התיקייה לפרסום
        run: |
          mkdir -p _site
          cp index.html control-room-v1.html _site/
          cp -r data _site/
          cp -r dist _site/
      - uses: actions/upload-pages-artifact@v3
        with:
          path: _site
```

---

## 3 · אימות · שבע בדיקות אחרי שהאתר עלה

| # | מה בודקים | איך | תקין כאשר |
|---|---|---|---|
| 1 | הדף נטען | פתחו `https://realestateil.github.io/MyTown/` | האפליקציה עולה, לא 404 |
| 2 | **הנתונים** נטענים | F12 → **Network** → רעננו | `meta.json`, `bond.json` וכו׳ מחזירים 200 |
| 3 | אין שגיאות | F12 → **Console** | ריק · שגיאת CORS או 404 תופיע כאן |
| 4 | הלשוניות | לחצו על כל אחת מארבע הלשוניות | תוכן מוצג, אין מסך שגיאה |
| 5 | לשונית הבקרה | גלגל השיניים בבאנר, או `/MyTown/#ctrl` | נפתחת · הוסיפו את הכתובת למועדפים |
| 6 | מובייל | פתחו בטלפון | הפריסה RTL תקינה, הגופן Heebo נטען |
| 7 | HTTPS | הכתובת עם מנעול | Pages מנפיק תעודה אוטומטית |

**404 בכתובת הראשית** = ה-Source לא נשמר או שהענף שגוי. חזרו ל-Settings → Pages.
**הדף עולה אבל מסך שגיאת נתונים** = בדקו ב-Network איזה JSON נכשל.
שימו לב שהנתיבים ב-Pages **רגישים לאותיות גדולות וקטנות** — `/MyTown/` ולא `/mytown/`.

---

## 4 · אחרי ההפעלה · האתר והאוטומציה היומית

`update.yml` דוחף commit ל-`data/` בימים א׳–ה׳. כדי שהאתר יציג את הנתון החדש
צריך שהפרסום ירוץ אחריו:

| דרך הפריסה | מה קורה אחרי ה-commit היומי | אם לא מתעדכן |
|---|---|---|
| **Deploy from a branch** | `pages-build-deployment` אמור לרוץ מעצמו | דחיפה של בוט לא תמיד מפעילה ריצות · עברו לדרך ב׳ |
| **GitHub Actions** (דרך ב׳) | ה-`workflow_run` מפעיל פרסום מיד בסיום | בדקו שהשם ב-`workflows:` זהה בדיוק ל-`name:` שב-`update.yml` |

**מטמון.** Pages מגיש קבצים עם `Cache-Control: max-age=600`. אחרי פרסום, עד
עשר דקות ייתכן שיוגש קובץ ישן. אם רואים נתון ישן — `Ctrl+Shift+R`, ואם זה
מטריד באופן קבוע, אפשר להוסיף חותמת גרסה לשליפות ב-`index.html`
(`fetch("data/app/meta.json?v=" + BUILD)`).

**ניטור.** לשונית **Actions** מראה את שתי הריצות. גיטהאב שולח מייל על כישלון.
ה-`::warning` של שעון הדיווח ממשיך לעבוד בדיוק כמו קודם.

---

## 5 · דומיין מותאם · אופציונלי

נניח `mytown.example.com`.

1. **אצל רשם הדומיין** הוסיפו רשומה:
   - תת-דומיין (מומלץ): `CNAME` מ-`mytown` אל `realestateil.github.io`
   - דומיין ראשי (apex): ארבע רשומות `A` אל
     `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
2. **Settings → Pages → Custom domain**: הזינו את הדומיין ו-**Save**.
   גיטהאב יוצר commit עם קובץ `CNAME` בשורש הרפו. אל תמחקו אותו.
   *בדרך ב׳ (Actions)* — ודאו שהקובץ `CNAME` נכלל במה שמועלה.
3. המתינו לאימות ה-DNS (עד 24 שעות, בפועל דקות).
4. סמנו **Enforce HTTPS**. אם האפשרות אפורה — התעודה עדיין בהנפקה, חכו וחזרו.

מרגע זה `realestateil.github.io/MyTown` מפנה לדומיין החדש.

---

## 6 · תוספות שכדאי לשקול

| תוספת | קובץ | למה |
|---|---|---|
| **מניעת אינדוקס בגוגל** | `robots.txt` בשורש: `User-agent: *` + `Disallow: /` | כלי פנימי · שיתוף בקישור בלי שיופיע בחיפוש |
| **תיאור ותצוגה בשיתוף** | תגיות `og:title`, `og:description`, `og:image` ב-`<head>` | קישור שנשלח בוואטסאפ/סלאק ייראה כמו כרטיס ולא כמו URL עירום |
| **פאביקון** | `<link rel="icon" …>` | לשונית מזוהה בדפדפן |
| **דף 404** | `404.html` בשורש | כתובת שגויה תקבל דף בעברית ולא את ברירת המחדל של גיטהאב |
| **קובץ יחיד לצפייה אופליין** | כבר קיים · `dist/mytown-standalone.html` | למי שצריך לפתוח בדאבל־קליק בלי רשת |

**שימו לב:** `robots.txt` מונע אינדוקס, **לא** גישה. אתר Pages על רפו ציבורי
פתוח לכל מי שיש לו הקישור. הגבלת גישה אמיתית דורשת רפו פרטי בתוכנית בתשלום
(Pro/Team) עם Pages פרטי, או אחסון אחר.

---

## 7 · תקלות נפוצות

| תסמין | סיבה | פתרון |
|---|---|---|
| 404 בכתובת הראשית | Source לא הוגדר, או `index.html` לא בשורש הענף | Settings → Pages → בחרו `main` + `/ (root)` |
| הדף עולה, הנתונים לא | נתיב שגוי או קובץ חסר | Network → אתרו את ה-404 · ודאו ש-`data/` נדחף לרפו |
| שינוי לא מופיע | מטמון או פרסום שלא רץ | `Ctrl+Shift+R` · בדקו ריצה בלשונית Actions |
| קבצים שנעלמו | Jekyll בלע שם שמתחיל ב-`_` | הוסיפו `.nojekyll`, או עברו לדרך ב׳ |
| הדומיין לא נתפס | DNS לא התפשט או רשומה שגויה | `dig mytown.example.com` · השוו לסעיף 5 |
| Enforce HTTPS אפור | התעודה בהנפקה | המתינו · הסירו והחזירו את הדומיין אם עברו 24 שעות |
| הריצה נכשלת ב-`deploy-pages` | ה-Source לא הועבר ל-**GitHub Actions** | Settings → Pages → Source: GitHub Actions |
| נתיב עם אותיות קטנות | Pages רגיש לרישיות | `/MyTown/` · לא `/mytown/` |

---

## 8 · הסרה מהאוויר

**Settings** → **Pages** → תחת Source בחרו **None** (בדרך א׳), או מחקו את
`pages.yml` והסירו את הפריסה תחת **Settings → Environments → github-pages**.
האתר יורד תוך דקות. הרפו והנתונים אינם נמחקים.

---

## תקציר · הדרך הקצרה

```
1. Settings → Pages → Source: Deploy from a branch → main → / (root) → Save
2. touch .nojekyll && git add . && git commit -m "Pages" && git push
3. המתינו לריצת pages-build-deployment בלשונית Actions
4. https://realestateil.github.io/MyTown/
5. F12 → Network → ודאו ש-data/app/*.json מחזירים 200
```

מי שרוצה שהאתר יתעדכן אוטומטית אחרי ריצת הנתונים היומית — סעיף 2, דרך ב׳.
