// רשימת מילים מדורגת לפי תנועות. כל שלב מוסיף תנועה חדשה על גבי הקודמות.

export const LEVELS = [
  { id: 1, name: 'קָמָץ וּפַתַח', sound: 'אָ' },
  { id: 2, name: 'חִירִיק', sound: 'אִ' },
  { id: 3, name: 'חוֹלָם וְשׁוּרוּק', sound: 'אוֹ · אוּ' },
  { id: 4, name: 'צֵירֵה וְסֶגּוֹל', sound: 'אֵ · אֶ' },
  { id: 5, name: 'שְׁוָא', sound: 'אְ' },
];

export const BASE_WORDS = [
  // שלב 1 — קמץ ופתח
  { id: 'aba', text: 'אַבָּא', pic: '👨', level: 1 },
  { id: 'saba', text: 'סַבָּא', pic: '👴', level: 1 },
  { id: 'dag', text: 'דָּג', pic: '🐟', level: 1 },
  { id: 'gan', text: 'גַּן', pic: '🛝', level: 1 },
  { id: 'yam', text: 'יָם', pic: '🌊', level: 1 },
  { id: 'sal', text: 'סַל', pic: '🧺', level: 1 },
  { id: 'kaf', text: 'כַּף', pic: '🥄', level: 1 },
  { id: 'halav', text: 'חָלָב', pic: '🥛', level: 1 },
  { id: 'gamal', text: 'גָּמָל', pic: '🐫', level: 1 },
  { id: 'kan', text: 'קַן', pic: '🪺', level: 1 },
  { id: 'banana', text: 'בָּנָנָה', pic: '🍌', level: 1 },

  // שלב 2 — חיריק
  { id: 'ima', text: 'אִמָּא', pic: '👩', level: 2 },
  { id: 'pil', text: 'פִּיל', pic: '🐘', level: 2 },
  { id: 'sir', text: 'סִיר', pic: '🍲', level: 2 },
  { id: 'shir', text: 'שִׁיר', pic: '🎵', level: 2 },
  { id: 'tik', text: 'תִּיק', pic: '🎒', level: 2 },
  { id: 'kir', text: 'קִיר', pic: '🧱', level: 2 },
  { id: 'mayim', text: 'מַיִם', pic: '💧', level: 2 },
  { id: 'bayit', text: 'בַּיִת', pic: '🏠', level: 2 },
  { id: 'gitara', text: 'גִּיטָרָה', pic: '🎸', level: 2 },

  // שלב 3 — חולם ושורוק
  { id: 'dov', text: 'דּוֹב', pic: '🐻', level: 3 },
  { id: 'sus', text: 'סוּס', pic: '🐴', level: 3 },
  { id: 'tut', text: 'תּוּת', pic: '🍓', level: 3 },
  { id: 'shum', text: 'שׁוּם', pic: '🧄', level: 3 },
  { id: 'or', text: 'אוֹר', pic: '💡', level: 3 },
  { id: 'hol', text: 'חוֹל', pic: '🏖️', level: 3 },
  { id: 'kova', text: 'כּוֹבַע', pic: '🧢', level: 3 },
  { id: 'kadur', text: 'כַּדּוּר', pic: '⚽', level: 3 },
  { id: 'tapuah', text: 'תַּפּוּחַ', pic: '🍎', level: 3 },

  // שלב 4 — צירה וסגול
  { id: 'etz', text: 'עֵץ', pic: '🌳', level: 4 },
  { id: 'kelev', text: 'כֶּלֶב', pic: '🐕', level: 4 },
  { id: 'yeled', text: 'יֶלֶד', pic: '🧒', level: 4 },
  { id: 'lehem', text: 'לֶחֶם', pic: '🍞', level: 4 },
  { id: 'shemesh', text: 'שֶׁמֶשׁ', pic: '☀️', level: 4 },
  { id: 'geshem', text: 'גֶּשֶׁם', pic: '🌧️', level: 4 },
  { id: 'beitza', text: 'בֵּיצָה', pic: '🥚', level: 4 },

  // שלב 5 — שווא ומילים ארוכות
  { id: 'savta', text: 'סַבְתָּא', pic: '👵', level: 5 },
  { id: 'mechonit', text: 'מְכוֹנִית', pic: '🚗', level: 5 },
  { id: 'tractor', text: 'טְרַקְטוֹר', pic: '🚜', level: 5 },
  { id: 'arye', text: 'אַרְיֵה', pic: '🦁', level: 5 },
  { id: 'rakevet', text: 'רַכֶּבֶת', pic: '🚂', level: 5 },
  { id: 'glida', text: 'גְּלִידָה', pic: '🍦', level: 5 },
];
