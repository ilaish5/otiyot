# מעבדת דיבור

כלי להורה, על ה-Mac בלבד. משווה בין מנועי הקראה (TTS) וזיהוי דיבור (STT) לפני שבוחרים מנוע לאפליקציה:
הקולות של Apple ושל הדפדפן מול מודלים פתוחים שרצים על המחשב, ומול ivrit.ai בשרת RunPod של תמלול ההרצאות.
הממשק (`lab/index.html`) מדבר עם שרת קטן (`lab/server.py`).

## הפעלה

```bash
cd "/Users/ilaish/Desktop/פרויקטים/תחומים/אישי/reading=learning"
python3 lab/server.py
```

ואז לפתוח את http://127.0.0.1:8766/lab/ .
ב-Safari הקולות והזיהוי הם של Apple, כמו באייפד. ב-Chrome הזיהוי נשלח ל-Google.
עוצרים עם Ctrl+C (השרת סוגר גם את תהליכי המודלים).

השרת צריך רק python3 רגיל. כל מודל רץ בתהליך נפרד בסביבה משלו, נטען בפעם הראשונה שמשתמשים בו ונשאר טעון.
ההגדרות ב-`lab/config.json`. הקובץ נוצר מ-`config.example.json` ולא נכנס לגיט.

## מנועים

| מזהה | סוג | מה זה | איפה רץ |
|---|---|---|---|
| `say` | הקראה | הקולות העבריים של macOS (כרגע Carmit). הקול מחליט לבד איך לקרוא את הניקוד | Mac |
| `kokoro` | הקראה | Kokoro עברית, הקול של שאול (גבר). רישיון לא מסחרי | מעבד, `~/.venvs/otiyot-lab` |
| `bluetts` | הקראה | BlueTTS 2.5, קולות של נשים וגברים. רישיון MIT | מעבד, `~/.venvs/otiyot-lab` |
| `runpod-ivrit` | זיהוי | ivrit.ai (whisper-large-v3-turbo) בשרת RunPod של תמלול ההרצאות | ענן |
| `local-ivrit` | זיהוי | אותו מודל ivrit.ai בגרסת MLX | הכרטיס הגרפי של ה-Mac |

הקראה עם ניקוד ב-Kokoro וב-BlueTTS: הניקוד של האפליקציה מתורגם לצלילים ב-phonikud.
לניקוד רגיל אין סימן הטעמה, אז יש מילון הטעמה לכל מילות האפליקציה (`engines/hebrew.py`).
מילה שאינה במילון מקבלת הטעמה מהמודל phonikud-onnx. טקסט בלי ניקוד עובר דרך RenikudPlus.

זמנים שנמדדו על ה-M3 (מילה אחת):
- הקראה: say כ-0.7 שניות. Kokoro ו-BlueTTS כ-0.4 שניות (בפעם הראשונה 1 עד 2 שניות לטעינה). כל מילה נשמרת במטמון.
- זיהוי מקומי: כ-1.9 שניות. הפעלה ראשונה כ-5 עד 7 שניות.
- RunPod: חם 1.1 עד 1.7 שניות. אחרי חצי דקה בלי עבודה כ-5 שניות. הפעלה קרה 18 עד 94 שניות (נמדד). השרת נכבה אחרי 5 שניות בלי עבודה, אז בשימוש רגיל רוב המילים יפגשו הפעלה חצי קרה או קרה.

משהו לשים אליו לב: ב-Kokoro, במילה בודדת לפעמים נשמע צליל קצר לפני המילה.
בבדיקה אוטומטית Whisper שמע "סדג" במקום "דג" ו"אז ביי" במקום "בית". כדאי להקשיב ולדרג.
ב-BlueTTS הקול `female` הכי פחות יציב: בחלק מהמילים הוא מפיק שקט (למשל "גְּלִידָה").
השרת מנסה עד 12 זרעים, ואם כולם שקטים מוצגת שגיאה בתא במקום הקלטה שקטה. הקולות noa, lily, adam ו-daniel יציבים.

## איפה הנתונים

- `lab/data/recordings/` ו-`lab/data/recordings.json`: ההקלטות (WAV 16kHz) והתוצאות של כל מנוע.
- `lab/data/ratings.json`: הדירוגים של ההקראות.
- `lab/data/tts-cache/`: קבצי הקראה שמורים, כדי לא לייצר שוב.
- `lab/data/logs/`: יומנים של תהליכי המודלים.
- המודלים עצמם מחוץ לפרויקט: `~/.cache/otiyot-lab` ו-`~/.cache/huggingface`. הסביבה: `~/.venvs/otiyot-lab`.

## פרטיות

- ההקלטות של הילד נשארות ב-`lab/data` על ה-Mac. התיקייה בקובץ `.gitignore` ולא עולה לגיטהאב.
- הפרויקט נמצא בשולחן העבודה. אם שולחן העבודה מסונכרן ל-iCloud, גם `lab/data` מסונכרן לחשבון ה-iCloud הפרטי.
  כדי להשאיר את ההקלטות רק על המחשב: לשנות את `data_dir` ב-`config.json` לתיקייה מחוץ לשולחן העבודה, למשל `~/Library/Application Support/otiyot-lab`.
- השרת מקשיב רק ל-127.0.0.1, כך שמכשיר אחר ברשת לא יכול להתחבר.
  הוא גם חוסם בקשות שמגיעות מאתרים אחרים שפתוחים בדפדפן (בדיקת Host, Origin ו-Sec-Fetch-Site).
- זיהוי מקומי והקראה מקומית לא שולחים שום דבר החוצה.
- `runpod-ivrit` שולח את ההקלטה לשרת RunPod הפרטי (כמו תמלול ההרצאות). המפתחות נקראים בזמן ריצה מ-`lecture-transcriber/.env` ולא נשמרים בפרויקט הזה.
- זיהוי הדיבור של הדפדפן שולח את הקול ל-Apple (Safari) או ל-Google (Chrome).

## התקנה מחדש (אם הסביבה נמחקה)

```bash
/opt/homebrew/bin/python3.13 -m venv ~/.venvs/otiyot-lab
~/.venvs/otiyot-lab/bin/pip install mlx-whisper soundfile kokoro-onnx phonikud-onnx
~/.venvs/otiyot-lab/bin/pip install --ignore-requires-python phonikud==0.4.1
git clone https://github.com/maxmelichov/BlueTTS ~/.cache/otiyot-lab/BlueTTS
~/.venvs/otiyot-lab/bin/pip install -e ~/.cache/otiyot-lab/BlueTTS
cd ~/.cache/otiyot-lab/BlueTTS && ~/.venvs/otiyot-lab/bin/hf download notmax123/BlueTTS2.5-onnx --local-dir onnx_models
mkdir -p ~/.cache/otiyot-lab/kokoro ~/.cache/otiyot-lab/phonikud
cd ~/.cache/otiyot-lab/kokoro && for f in kokoro.onnx voices-hebrew.bin config.json; do curl -LO https://huggingface.co/thewh1teagle/kokoro-hebrew-nc/resolve/main/$f; done
cd ~/.cache/otiyot-lab/phonikud && curl -LO https://huggingface.co/Phonikud/phonikud-onnx/resolve/main/phonikud-1.0.int8.onnx
~/.venvs/otiyot-lab/bin/hf download mlx-community/ivrit-ai-whisper-large-v3-turbo-mlx
~/.venvs/otiyot-lab/bin/hf download notmax123/RenikudPlus model.onnx
```

phonikud 0.4.1 מצהיר על פייתון עד 3.12, אבל הוא פייתון טהור ועובד ב-3.13 (ומכאן `--ignore-requires-python`).

## תוספות ל-API (מעבר לחוזה)

- `POST /api/tts` מקבל גם `"rate"` (בין 0.5 ל-1.5, ברירת מחדל 1). התשובה כוללת את הכותרות `X-Cold`, `X-G2P`, `X-Phonemes` ו-`X-Text-Used` (URL-encoded).
- `POST /api/warm?engine=ID` טוען מנוע מראש. ב-`runpod-ivrit` הוא שולח חצי שנייה של שקט כדי להעיר את השרת, וזה עולה עבודה קצרה ב-RunPod.
- `GET /api/status` מציג את מצב התהליכים.
- תוצאות זיהוי כוללות גם `audio_ms` ו-`sent_ms` (אחרי חיתוך השקט). ב-RunPod יש גם `delay_ms` (תור והפעלה) ו-`exec_ms`.
  הקלטה שקטה לגמרי לא נשלחת למנוע וחוזרת עם `"silent": true`.
