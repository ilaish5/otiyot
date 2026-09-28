// דפי צביעה. כל צורה עם class="r" היא אזור שאפשר למלא בנגיעה.
// class="ln" = קו קישוט (רק בשכבת הקווים), class="under" = קו מתחת לצבע, class="tx" = טקסט.
// viewBox קבוע: 800x600.

function star(cx, cy, r) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    pts.push(`${(cx + rr * Math.cos(a)).toFixed(1)} ${(cy + rr * Math.sin(a)).toFixed(1)}`);
  }
  return `<path class="r" d="M${pts.join(' L')} Z"/>`;
}

// רעמה: עיגול עם "גלים" בחוץ
function scallop(cx, cy, r, n) {
  const step = (Math.PI * 2) / n;
  const bump = 2 * r * Math.sin(step / 2) * 0.54;
  const p = (i) => `${(cx + r * Math.cos(i * step)).toFixed(1)} ${(cy + r * Math.sin(i * step)).toFixed(1)}`;
  let d = `M${p(0)}`;
  for (let i = 1; i <= n; i++) d += ` A${bump.toFixed(1)} ${bump.toFixed(1)} 0 0 1 ${p(i)}`;
  return `<path class="r" d="${d} Z"/>`;
}

const car = `
  <rect class="r" x="-10" y="470" width="820" height="140"/>
  ${[40, 200, 360, 520, 680].map((x) => `<rect class="r" x="${x}" y="528" width="90" height="16" rx="6"/>`).join('')}
  <circle class="r" cx="680" cy="110" r="55"/>
  <rect class="r" x="112" y="262" width="22" height="80" rx="4"/>
  <rect class="r" x="70" y="236" width="120" height="30" rx="8"/>
  <path class="r" d="M90 400 Q86 342 150 334 L330 316 L385 258 L505 258 L548 322 L688 334 Q740 340 742 400 Z"/>
  <circle class="r" cx="440" cy="268" r="30"/>
  <path class="r" d="M400 276 L494 276 L526 320 L376 320 Z"/>
  <path class="r" d="M300 348 L690 356 L690 376 L300 370 Z"/>
  <circle class="r" cx="250" cy="368" r="34"/>
  <text class="tx" x="250" y="384" text-anchor="middle" font-size="44" font-family="Rubik, sans-serif" font-weight="700">5</text>
  <rect class="r" x="690" y="385" width="80" height="22" rx="6"/>
  <ellipse class="r" cx="716" cy="356" rx="14" ry="10"/>
  <circle class="r" cx="210" cy="410" r="64"/><circle class="r" cx="210" cy="410" r="26"/>
  <circle class="r" cx="600" cy="410" r="64"/><circle class="r" cx="600" cy="410" r="26"/>
  <path class="ln" d="M14 300 L58 300 M4 342 L46 342 M22 384 L56 384"/>`;

const tractor = `
  <path class="r" d="M-10 500 Q200 470 400 495 T810 490 L810 610 L-10 610 Z"/>
  <path class="r" d="M560 140 a38 38 0 0 1 66 -26 a48 48 0 0 1 88 12 a34 34 0 0 1 16 58 L566 184 a22 22 0 0 1 -6 -44 Z"/>
  <rect class="r" x="170" y="150" width="210" height="190" rx="10"/>
  <rect class="r" x="200" y="180" width="150" height="100" rx="8"/>
  <rect class="r" x="150" y="126" width="250" height="32" rx="10"/>
  <path class="r" d="M370 290 L620 290 Q650 290 650 320 L650 410 L370 410 Z"/>
  <rect class="r" x="626" y="312" width="16" height="78" rx="4"/>
  <rect class="r" x="540" y="196" width="22" height="96"/>
  <rect class="r" x="532" y="184" width="38" height="16" rx="4"/>
  <circle class="r" cx="250" cy="410" r="112"/><circle class="r" cx="250" cy="410" r="44"/>
  <path class="r" d="M104 400 A146 146 0 0 1 396 400 L366 400 A116 116 0 0 0 134 400 Z"/>
  <circle class="r" cx="570" cy="440" r="66"/><circle class="r" cx="570" cy="440" r="24"/>`;

const lion = `
  <path class="r" d="M-10 540 Q400 500 810 540 L810 610 L-10 610 Z"/>
  ${scallop(400, 290, 200, 14)}
  <circle class="r" cx="318" cy="172" r="38"/><circle class="r" cx="482" cy="172" r="38"/>
  <circle class="r" cx="318" cy="172" r="18"/><circle class="r" cx="482" cy="172" r="18"/>
  <circle class="r" cx="400" cy="298" r="128"/>
  <ellipse class="r" cx="372" cy="350" rx="34" ry="26"/><ellipse class="r" cx="428" cy="350" rx="34" ry="26"/>
  <path class="r" d="M378 320 Q400 310 422 320 Q412 342 400 344 Q388 342 378 320 Z"/>
  <circle class="r" cx="355" cy="272" r="15"/><circle class="r" cx="445" cy="272" r="15"/>
  <path class="ln" d="M400 344 L400 362 M400 362 Q386 380 366 372 M400 362 Q414 380 434 372"/>`;

const space = `
  <rect class="r" x="0" y="0" width="800" height="600"/>
  ${[250, 320, 400, 480, 600, 720].map((r) => `<circle class="under" cx="800" cy="300" r="${r}"/>`).join('')}
  <circle class="r" cx="800" cy="300" r="190"/>
  <circle class="r" cx="565" cy="215" r="16"/>
  <circle class="r" cx="491" cy="383" r="24"/>
  <circle class="r" cx="409" cy="217" r="28"/><circle class="r" cx="362" cy="184" r="9"/>
  <circle class="r" cx="344" cy="448" r="20"/>
  <circle class="r" cx="203" cy="237" r="62"/>
  <path class="ln" d="M147 216 Q203 228 259 216 M143 256 Q203 270 263 256"/>
  <circle class="r" cx="91" cy="425" r="40"/>
  <path class="r" fill-rule="evenodd" transform="rotate(-15 91 425)" d="M13 425 a78 18 0 1 0 156 0 a78 18 0 1 0 -156 0 Z M33 425 a58 11 0 1 0 116 0 a58 11 0 1 0 -116 0 Z"/>
  ${star(120, 90, 14)}${star(300, 80, 10)}${star(650, 540, 12)}${star(480, 560, 9)}${star(250, 520, 11)}${star(560, 90, 9)}${star(56, 250, 8)}`;

const rocket = `
  <circle class="r" cx="140" cy="150" r="60"/><circle class="r" cx="120" cy="134" r="12"/><circle class="r" cx="162" cy="172" r="9"/>
  ${star(650, 110, 16)}${star(700, 300, 10)}${star(90, 380, 12)}${star(620, 480, 9)}${star(220, 520, 10)}
  <path class="r" d="M322 350 L248 450 L248 500 L322 452 Z"/>
  <path class="r" d="M478 350 L552 450 L552 500 L478 452 Z"/>
  <path class="r" d="M338 452 Q340 540 400 592 Q460 540 462 452 Z"/>
  <path class="r" d="M366 452 Q370 515 400 552 Q430 515 434 452 Z"/>
  <path class="r" d="M400 60 Q482 150 482 330 L482 460 L318 460 L318 330 Q318 150 400 60 Z"/>
  <path class="r" d="M400 60 Q443 107.5 464 180 L336 180 Q357 107.5 400 60 Z"/>
  <rect class="r" x="318" y="420" width="164" height="40"/>
  <circle class="r" cx="400" cy="275" r="46"/><circle class="r" cx="400" cy="275" r="30"/>`;

export const PAGES = [
  { id: 'car', name: 'מְכוֹנִית מֵרוֹץ', svg: car },
  { id: 'tractor', name: 'טְרַקְטוֹר', svg: tractor },
  { id: 'lion', name: 'אַרְיֵה', svg: lion },
  { id: 'space', name: 'מַעֲרֶכֶת הַשֶּׁמֶשׁ', svg: space },
  { id: 'rocket', name: 'רָקֶטָה', svg: rocket },
  { id: 'blank', name: 'דַּף חָלָק', svg: '' },
];
