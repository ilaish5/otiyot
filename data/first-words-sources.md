# First reading words: sources and method

`first-words.json` holds 500 fully vocalized Hebrew words for a 5-year-old starting to read, graded by the vowel progression the app already uses (`js/words.js`). This file lists every source, how it was used, the level rule, the counts, and the words that still need a human check.

Validate with `python3 data/validate_words.py` (add `--strict` to also fail on reported structure exceptions). Both pass.

## Entry format

`{ id, text, plain, pic, level, syllables, letters, category, sources, confidence, note? }`

- `text`: full nikud, NFC-normalized (the same mark order as `js/words.js`). Only Hebrew letters, U+05B0–U+05BB, U+05BC dagesh, U+05C1/U+05C2 shin/sin dots and U+05C7 qamats qatan.
- `plain`: `text` with the marks removed (so a word spelled with qubuts keeps its haser letters, e.g. שֻׁלְחָן → שלחן).
- `id`: latin slug. All 42 words from `js/words.js` are included and keep their app ids (the app keys progress by id).
- `level`, `syllables`, `letters`: computed by `analyze()` in `validate_words.py`, never typed by hand.
- `sources`: word-selection sources first, then the nikud cross-checks (`nikud:nakdan`, `nikud:wiktionary`). `judgment` means no source listed the word.
- `confidence`: `high` = Dicta Nakdan offers exactly this vocalization and Hebrew Wiktionary either has the same headword or has no conflicting one; `check` = the sources disagree (reason in `note`).
- Order: by level, then by how common the word is (see Ranking).

## Sources

### Which words (selection)

| key | source | what it is | how it was used | words |
|---|---|---|---|---|
| `cdi` | Hebrew MacArthur-Bates CDI, Words & Sentences. Item list: [Wordbank Hebrew_WS instrument](https://github.com/langcog/wordbank/tree/master/raw_data/Hebrew_WS); adaptation: Maital, Dromi, Sagi & Bornstein 2000, [J. Child Lang. 27:43–67](https://pubmed.ncbi.nlm.nih.gov/10740967/); data: Gendler-Shalev & Dromi 2021, [Hebrew Web CDI](https://www.cambridge.org/core/journals/journal-of-child-language/article/hebrew-web-communicative-development-inventory-mbcdi-lexical-development-growth-curves/80A8AFEEB4ED71E3682560A77FBD7941) (via [Wordbank](http://wordbank.stanford.edu/)) | ~600 early words in 20 categories, with parent reports for 480 toddlers aged 24–35 months | each candidate was mapped by hand to its CDI item (verbs to the CDI infinitive); the share of toddlers who say the word drives the ranking | 321 |
| `moe-teimot` | Ministry of Education, [טעימות בעברית בגן הילדים](https://meyda.education.gov.il/files/PreSchool/teimot-be-ivrit.pdf) ([program page](https://pop.education.gov.il/kindergarten/magar-ganey-yeladim/teimot-ivrit/)) | kindergarten vocabulary program (body, family, home, colors, numbers, seasons, "words from the heart" lists) | the word, its plural, or the word with a one-letter prefix appears in the program text. This is a text match, not a curated list | 274 |
| `moe-common` | Ministry of Education, [שפה משותפת בגן](https://meyda.education.gov.il/files/PreSchool/common-language.pdf) | companion kindergarten language book | same text match | 192 |
| `primer-kp` | Kaley Kaluli, [סיפורים בקמץ פתח](https://www.kaleykaluli.com/wp-content/uploads/2016/06/Sipurim_Kamatz_Patach.pdf) | publicly posted first-grade reading primer written only with qamats/patah, with word banks | words that appear in its stories or word banks (supports level 1) | 48 |
| `wikt-basic` | Hebrew Wiktionary, [נספח:מלים בסיסיות](https://he.wiktionary.org/wiki/%D7%A0%D7%A1%D7%A4%D7%97:%D7%9E%D7%9C%D7%99%D7%9D_%D7%91%D7%A1%D7%99%D7%A1%D7%99%D7%95%D7%AA) | a general basic-vocabulary list (~1,350 lemmas, Swadesh-based and extended) | lemma match. General, not child-specific, so it is weaker support | 422 |
| `app` | `js/words.js` (BASE_WORDS) | the 42 words already in the app | kept (41 by exact text; קַן was corrected, see below) | 41 |
| `judgment` | my own judgment | common kindergarten words that none of the sources above list | only when nothing else matched | 18 |

### Nikud (second-source check)

| key | source | how it was used | words confirmed |
|---|---|---|---|
| `nikud:nakdan` | [Dicta Nakdan](https://nakdan.dicta.org.il) public API (`nakdan-2-0.loadbalancer.dicta.org.il/api`, genre "modern") | every candidate was sent unvocalized, in both the haser spelling and the ktiv male spelling; the entry passes if Nakdan offers exactly this vocalization (as its first choice or as an alternative; isolated words are often homographs) | 497 |
| `nikud:wiktionary` | [Hebrew Wiktionary](https://he.wiktionary.org) headwords, read through the MediaWiki API | the headwords of the page (haser, male and redirect titles) were compared after ignoring matres lectionis, so דּוֹב matches the headword דֹּב | 467 |

### Used for ranking and pictures (not listed per word)

- **OpenSubtitles 2018 Hebrew word frequencies** ([hermitdave/FrequencyWords, he_50k](https://github.com/hermitdave/FrequencyWords/tree/master/content/2018/he)): adult spoken-language frequency, the second input to the ranking.
- **Unicode CLDR Hebrew emoji names** ([cldr-json annotations/he](https://github.com/unicode-org/cldr-json/tree/main/cldr-json/cldr-annotations-full/annotations/he)): every picture was checked against its Hebrew name; 261 words have a picture.
- **Academy of the Hebrew Language**, spelling rules ([כתיב וניקוד](https://hebrew-academy.org.il/topic/sheelot_teshuvot/mivharteshuvot/ktiv-venikkud/), [הכתיב המלא](https://hebrew-academy.org.il/topic/hahlatot/missingvocalizationspelling/)): the reference for the spelling conventions below. The site blocks automated reading, so no word was checked against it directly.
- **RAMA, מבדק קריאה וכתיבה לכיתה א׳, teacher guide** ([PDF](https://meyda.education.gov.il/files/Yesodi/ivrit/madrich.pdf)): background only. It confirms that end-of-first-grade reading is tested on fully vocalized, very frequent words, but its item lists are not public.

### Looked for, not usable

- **CHILDES Hebrew corpora** (Berman, Ravid, Levy, Na'ama; [TalkBank](https://talkbank.org/childes/access/Other/Hebrew/)): downloads now need a TalkBank login, and the transcripts are in Latin transliteration. The Hebrew CDI production data stands in as the child-frequency measure.
- **Even-Shoshan / Milog**: no open API, so they were not queried. Hebrew Wiktionary headwords (dictionary-style vocalization) were used as the dictionary check instead.
- **An official MoE first-grade word list** (מילים שכיחות לכיתה א׳): no public list was found; the MoE sources above are the kindergarten programs.

## Spelling conventions

- Nikud as in vocalized children's books and the dictionaries, matching the style already in the app:
  - holam written with vav wherever full spelling has one: דּוֹב, כּוֹבַע, אוֹזֶן, צָהוֹב. It stays haser where full spelling has no vav: רֹאשׁ, לֹא, אֵיפֹה.
  - u follows the dictionary: qubuts where the dictionary has it (שֻׁלְחָן, בֻּבָּה, קֻפְסָה), shuruk otherwise (סוּס, תַּפּוּחַ, עוּגָה).
  - hiriq follows the dictionary: yod where the dictionary has it (פִּיל, תִּינוֹק), none in a doubled syllable (צִפּוֹר, כִּסֵּא, סִפּוּר).
- Dagesh kal at the start of a word and after a silent shva (דָּג, סַבְתָּא); dagesh hazak where a letter is doubled (אַבָּא, כַּדּוּר); shin and sin dots on every ש; patah genuva (תַּפּוּחַ, יָרֵחַ); mappiq (גָּבוֹהַּ).
- Loanwords keep a plain פ where it is read "f" (טֶלֶפוֹן).
- Qamats qatan (U+05C7) is supported by the level code and would count as "o" (level 3). None of the 500 words needs it; the one candidate that did, צׇהֳרַיִם, was not selected.
- Left out on purpose: words with a geresh (ג׳ירפה, פיג׳מה, צ׳יפס, ג׳ינס), because the allowed character set has no geresh; multi-word items (גַּן חַיּוֹת); proper names; slang (תַּפּוּד, פּוּפִּיק).
- Homographs: `plain` must be unique, so only one reading of each spelling is kept (for example שָׁם, not שֵׁם; זָקָן the beard, not זָקֵן; יָשֵׁן sleeping, not יָשָׁן old).

## Level rule (computed)

`analyze()` in `validate_words.py` is the single implementation, used both to build the file and to check it:

| level | needs | vowel marks |
|---|---|---|
| 1 | qamats / patah only | ָ ַ (plus dagesh, shin/sin dots, silent final letters, silent א / ה) |
| 2 | adds hiriq | ִ |
| 3 | adds holam / shuruk / qubuts | ֹ וֹ וּ ֻ, and qamats qatan ׇ (read "o") |
| 4 | adds tsere / segol | ֵ ֶ |
| 5 | any shva or hataf, or 4+ syllables | ְ ֱ ֲ ֳ |

A word's level is the highest level any of its vowels needs.

- Shuruk is a vav with a dagesh and no vowel of its own. A vav with a dagesh and a vowel (צַוָּאר, חַוָּה) is a consonant.
- **Decision:** the shva written inside a final kaf (ךְ) is silent spelling, so it does not raise the level. This affects 8 words: הָלַךְ כָּרִיךְ נָסִיךְ חָשׁוּךְ חִיּוּךְ אָרוֹךְ הוֹלֵךְ מֶלֶךְ. Under a strict "any shva" rule they would all be level 5.
- Syllables are the vowel nuclei: every full vowel, every hataf, patah genuva, and a vocal shva (on the first letter, or the second of two shvas in a row). Only four words reach 4 syllables without a shva, and they go to level 5: אוֹפַנַּיִם, אוֹפַנּוֹעַ, סֻכָּרִיָּה, הִיפּוֹפּוֹטָם.
- The structure check reports any non-final letter that has no vowel, is not a silent א, is not a yod mater after hiriq, tsere or segol, and is not followed by a vowel-carrying vav. Final and non-final letter forms, dagesh in a guttural, missing shin/sin dots and double vowels always fail. There are currently no exceptions.

## Selection and ranking

- 741 candidates were written, vocalized, checked against Nakdan and Wiktionary, and corrected. Each candidate got a priority tier: 1 = core (concrete, picturable, or in the CDI with high production), 2 = good, 3 = optional.
- For each level the tier-1 words were taken first, then tier 2 and tier 3, until the level target was reached. Targets: 100 / 80 / 110 / 100 / 110. Level 1 and level 3 had more good candidates than places; level 2 is the thinnest (only 87 real candidates use nothing but a-vowels and hiriq).
- "How common" score: `0.7 × CDI production + 0.3 × subtitle frequency` for CDI words, and `0.35 + 0.5 × subtitle frequency` for words the CDI does not have. CDI production is the share of 2–3-year-olds who say the word; subtitle frequency is log-scaled to 0–1.
- 479 of the 500 words (96%) have 2–5 letters.

## Counts

| level | words |
|---|---|
| 1 | 100 |
| 2 | 80 |
| 3 | 110 |
| 4 | 100 |
| 5 | 110 |
| total | 500 |

| category | total | L1 | L2 | L3 | L4 | L5 |
|---|---|---|---|---|---|---|
| home | 56 | 8 | 13 | 9 | 7 | 19 |
| food | 51 | 9 | 9 | 13 | 10 | 10 |
| verbs | 44 | 24 | 5 | 3 | 12 | 0 |
| animals | 44 | 9 | 2 | 12 | 2 | 19 |
| adjectives | 40 | 5 | 9 | 13 | 10 | 3 |
| family | 36 | 12 | 5 | 6 | 6 | 7 |
| toys | 36 | 3 | 4 | 13 | 5 | 11 |
| other | 34 | 3 | 7 | 11 | 5 | 8 |
| nature | 32 | 8 | 4 | 4 | 15 | 1 |
| body | 26 | 6 | 5 | 4 | 10 | 1 |
| clothes | 22 | 3 | 7 | 1 | 3 | 8 |
| vehicles | 19 | 0 | 3 | 6 | 2 | 8 |
| places | 18 | 2 | 5 | 1 | 1 | 9 |
| time | 17 | 5 | 2 | 3 | 4 | 3 |
| numbers | 13 | 1 | 0 | 1 | 8 | 3 |
| colors | 12 | 2 | 0 | 10 | 0 | 0 |

`family` covers family members and people (occupations, friends). `toys` includes school things (pencil, notebook). `other` holds greetings, question words, pronouns and a few shapes and feelings.

## Words marked "check" (7)

| word | level | why |
|---|---|---|
| פָּנָס (`panas`) | 1 | Nakdan: פָּנָס, Wiktionary: פַּנָּס (dagesh in nun). Same level either way |
| טֶלֶפוֹן (`telefon`) | 4 | Wiktionary: טֶלֶפוֹן (used here); Nakdan top: טֵלֵפוֹן. Same level either way |
| תֵּה (`te`) | 4 | Nakdan: תֵּה, Wiktionary: תֶּה. Same level either way |
| פָּאזֶל (`pazel`) | 4 | Wiktionary spells it without alef (פָּזֶל); Nakdan top is פָּאזֶל |
| רָקֶטָה (`raketa`) | 4 | Wiktionary: רָקֶטָה (used here); Nakdan: רָקֵטָה. Same level either way |
| סַבְתָּא (`savta`) | 5 | kept the app's סַבְתָּא; Wiktionary and Nakdan's top option give the Aramaic-style סָבְתָא |
| טֶלֶוִיזְיָה (`televizya`) | 5 | three forms seen: Wiktionary טֶלֶוִיזְיָה (used here), Nakdan טֵלֵוִיזְיָה, draft טֵלֶוִיזְיָה. Level 5 either way |

Where Nakdan and Wiktionary agreed with each other against my draft, their form replaced the draft. In the final list that happened for אָנָנָס, חָגָב, בָּלוֹן, and for קֵן (next section). Candidates whose two sources disagreed and that were not essential were dropped instead: נֶהָג/נַהָג, מַגָּב/מַגֵּב, נָמָל/נָמֵל, חַמִּים/חָמִים, and חֲלִילִית (the draft had a qamats).

## Differences from `js/words.js`

- **קַן → קֵן.** Nest is קֵן with tsere (Nakdan and Wiktionary agree), so it is level 4, not level 1. The app currently teaches it at level 1 with patah.
- **רַכֶּבֶת** is level 4 by the rule (no shva, 3 syllables); the app has it at level 5.
- The other 40 app words match exactly (text, level, picture, id).

## Words chosen by judgment only (18)

רִיס נָסִיךְ כִּיס כַּבָּאִית נוּרָה מוֹנִית חִיּוּךְ קוֹקוֹס חֶבֶל רָקֶטָה סְלִיחָה אַהֲבָה נְסִיכָה מִגְרָשׁ מַלְכָּה תַּחְפֹּשֶׂת דּוֹלְפִין חֲנֻכִּיָּה
