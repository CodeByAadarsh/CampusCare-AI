/**
 * Pulls structured details out of a free-text complaint, so students only have to describe the problem:
 *   location        "Block B · Corridor · 2nd floor"      (null when no place is mentioned)
 *   occurredAt      ISO time the problem was noticed     (from "since morning", "2 days ago", "since 10 am", …)
 *   whenText        the words that gave the time         ("since morning")
 *   recurring       true for "every day", "daily", "roz" …
 *   peopleCount     an explicit number ("around 50 students")
 *   manyAffected    "many students", "whole class", "everyone" …
 *   missing         details that could not be found, e.g. ["location"]
 *
 * Rule-based (regular expressions + a campus place list): fast, explainable, and it works without the
 * AI service. The Python AI service implements the same rules (campuscare_ai/extract.py); both are
 * checked against the same cases (tests/extraction_cases.json in the AI service).
 */

const NUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, few: 3, couple: 2, several: 3 };
const UNIT_MIN = { minute: 1, min: 1, hour: 60, hr: 60, day: 1440, week: 10080, month: 43200 };
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const ORD = { ground: 'Ground', first: '1st', '1st': '1st', second: '2nd', '2nd': '2nd', third: '3rd', '3rd': '3rd', fourth: '4th', '4th': '4th', fifth: '5th', '5th': '5th', top: 'Top' };
const ACRONYMS = new Set(['ece', 'cse', 'eee', 'ee', 'me', 'ice', 'vlsi', 'dsp', 'rf', 'dbms', 'it']);
const NUM_WORDS = 'a|an|one|two|three|four|five|six|seven|eight|nine|ten|few|couple of|several|\\d+';
const UNITS = 'minutes?|mins?|hours?|hrs?|days?|weeks?|months?';

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const num = (w) => (/^\d+$/.test(w) ? Number(w) : NUM[w.replace(' of', '')] ?? 1);
const unitMinutes = (u) => UNIT_MIN[u.replace(/s$/, '')] ?? 1;
const gender = (w) => (/^(girl|ladies|women)/.test(w) ? 'Girls' : /^staff/.test(w) ? 'Staff' : 'Boys');
const deptLabel = (w) => (ACRONYMS.has(w) ? w.toUpperCase() : w.split(' ').map(cap).join(' '));

// ------------------------------------------------------------------ location
const PLACES = [
  [/\bcentral library\b/, 'Central Library'],
  [/\be-?library\b/, 'E-library'],
  [/\breading hall\b/, 'Library reading hall'],
  [/\blibrary\b/, 'Library'],
  [/\bfood court\b/, 'Food court'],
  [/\b(canteen|cafeteria)\b/, 'Canteen'],
  [/\bmess\b/, 'Mess'],
  [/\bauditorium\b/, 'Auditorium'],
  [/\bseminar hall\b/, 'Seminar hall'],
  [/\bconference room\b/, 'Conference room'],
  [/\b(admin|administrative) (block|building)\b/, 'Admin block'],
  [/\bstaff ?room\b/, 'Staff room'],
  [/\bworkshop\b/, 'Workshop'],
  [/\bserver room\b/, 'Server room'],
  [/\bmain gate\b/, 'Main gate'],
  [/\bback gate\b/, 'Back gate'],
  [/\bgate (?:no\.? ?)?(\d{1,2})\b/, (m) => `Gate ${m[1]}`],
  [/\b(bike|two[- ]wheeler|car|faculty) parking\b/, (m) => `${cap(m[1])} parking`],
  [/\bparking\b/, 'Parking area'],
  [/\bcycle stand\b/, 'Cycle stand'],
  [/\bbasketball court\b/, 'Basketball court'],
  [/\b(playground|sports ground|football ground|cricket ground)\b/, (m) => cap(m[1])],
  [/\bsports complex\b/, 'Sports complex'],
  [/\bgym\b/, 'Gym'],
  [/\bgarden\b/, 'Garden'],
  [/\bboundary wall\b/, 'Boundary wall'],
  [/\bbus stop\b/, 'Bus stop'],
];

const SUB_PLACES = [
  [/\b(boys?'?|girls?'?|gents|ladies|staff) (?:washroom|toilet|bathroom|restroom)s?\b/, (m) => `${gender(m[1])} washroom`],
  [/\b(?:washroom|toilet|bathroom|restroom|urinal)s?\b/, 'Washroom'],
  [/\bcorridor\b/, 'Corridor'],
  [/\b(?:staircase|stairwell|stairs)\b/, 'Staircase'],
  [/\b(?:lift|elevator)\b/, 'Lift'],
  [/\blobby\b/, 'Lobby'],
  [/\b(?:terrace|rooftop)\b/, 'Terrace'],
  [/\bbalcony\b/, 'Balcony'],
];

const DEPTS = 'digital electronics|microprocessor|communication|electronics|chemistry|robotics|physics|computer|drawing|analog|civil|mech|vlsi|dbms|ece|cse|eee|ice|dsp|rf|ee|me';

function firstMatch(rules, t) {
  for (const [re, out] of rules) {
    const m = t.match(re);
    if (m) return typeof out === 'function' ? out(m) : out;
  }
  return null;
}

function building(t, original) {
  let m = t.match(/\b(?:bus )?route (?:no\.? ?)?(\d{1,3})\b/);
  if (m) return { label: `Bus route ${m[1]}` };
  m = t.match(/\bbus (?:no\.?|number) ?(\d{1,3})\b/);
  if (m) return { label: `Bus no. ${m[1]}` };
  m = original.match(/\b([A-Z][a-z]+) route\b/);
  if (m && !/^(The|Bus|Route|Our|My|This|That|Same)$/.test(m[1])) return { label: `${m[1]} route bus` };

  m = t.match(/\b(boys?'?|girls?'?|men'?s|women'?s|ladies) ?hostel\b/);
  if (m) return { label: `${gender(m[1])} Hostel` };
  if (/\bhostel\b/.test(t)) return { label: 'Hostel' };

  m = t.match(new RegExp(`\\b(${DEPTS}) (?:lab|laboratory)\\b(?: (?:no\\.? ?)?(\\d{1,2})\\b)?`));
  if (m) return { label: `${deptLabel(m[1])} Lab${m[2] ? ` ${m[2]}` : ''}`, labNumber: m[2] || null };
  m = original.match(/\bIT (?:lab|Lab|department|dept)\b/);
  if (m) return { label: /lab/i.test(m[0]) ? 'IT Lab' : 'IT department' };
  m = t.match(new RegExp(`\\b(${DEPTS}) (?:department|dept)\\b`));
  if (m) return { label: `${deptLabel(m[1])} department` };

  m = t.match(/\b(?:block|building|bldg|tower) ?[-–]? ?([a-z]|\d{1,2})\b/);
  if (m) return { label: `Block ${m[1].toUpperCase()}` };
  m = original.match(/\b([A-Z])[- ]?[Bb]lock\b/);
  if (m) return { label: `Block ${m[1]}` };
  m = original.match(/\b([A-Z])[- ][Ww]ing\b/);
  if (m) return { label: `${m[1]} wing` };
  return null;
}

function room(t) {
  const m = t.match(/\b(tutorial room|lecture hall|classroom|class|room|rm|lab|lt) ?(?:no\.?|number|#)? ?[-–]? ?(\d{1,4}[a-z]?)\b/);
  if (!m) return null;
  const kind = m[1];
  const n = m[2].toUpperCase();
  if (kind === 'lecture hall' || kind === 'lt') return { label: `LT-${n}`, kind: 'lt', n };
  if (kind === 'tutorial room') return { label: `Tutorial room ${n}`, kind: 'room', n };
  if (kind === 'lab') return { label: `Lab ${n}`, kind: 'lab', n };
  return { label: `Room ${n}`, kind: 'room', n };
}

export function extractLocation(text) {
  const original = String(text || '');
  const t = original.toLowerCase().replace(/\s+/g, ' ');
  const parts = [];
  const b = building(t, original);
  if (b) parts.push(b.label);
  const place = firstMatch(PLACES, t);
  if (place && !parts.includes(place)) parts.push(place);
  const sub = firstMatch(SUB_PLACES, t);
  if (sub) parts.push(sub);
  const f = t.match(/\b(ground|first|1st|second|2nd|third|3rd|fourth|4th|fifth|5th|top) floor\b/);
  if (f) parts.push(`${ORD[f[1]]} floor`);
  const r = room(t);
  if (r && !(r.kind === 'lab' && b?.labNumber === r.n)) parts.push(r.label);
  return parts.length ? parts.join(' · ') : null;
}

// ------------------------------------------------------------------ time noticed
function atClock(now, h, min, ampm) {
  let hour = Number(h) % 12;
  if (ampm === 'pm') hour += 12;
  const d = new Date(now);
  d.setHours(hour, Number(min || 0), 0, 0);
  if (d > now) d.setDate(d.getDate() - 1);
  return d;
}

function partOfDay(now, hour) {
  const d = new Date(now);
  d.setHours(hour, 0, 0, 0);
  return d > now ? new Date(now.getTime() - 60 * 60000) : d;
}

export function extractWhen(text, now = new Date()) {
  const t = String(text || '').toLowerCase().replace(/\s+/g, ' ');
  const ago = (minutes) => new Date(now.getTime() - minutes * 60000);
  let m;

  if ((m = t.match(/\b(just now|right now|abhi abhi|a few (?:minutes|mins) ago)\b/))) return { at: now, text: m[0] };
  if ((m = t.match(new RegExp(`\\b(${NUM_WORDS}) ?(${UNITS}) (?:ago|back)\\b`)))) return { at: ago(num(m[1]) * unitMinutes(m[2])), text: m[0] };
  if ((m = t.match(new RegExp(`\\b(?:since|for|from) (?:the )?(?:last |past )?(${NUM_WORDS}) ?(${UNITS})\\b`)))) {
    return { at: ago(num(m[1]) * unitMinutes(m[2])), text: m[0] };
  }
  if ((m = t.match(/\b(?:since|from|at|around) (\d{1,2})(?::(\d{2}))? ?(am|pm)\b/))) return { at: atClock(now, m[1], m[2], m[3]), text: m[0] };
  if ((m = t.match(/\b(?:since|this|from) morning\b|\bsubah se\b|\bmorning se\b/))) return { at: partOfDay(now, 8), text: m[0] };
  if ((m = t.match(/\b(?:since|this|from) afternoon\b/))) return { at: partOfDay(now, 13), text: m[0] };
  if ((m = t.match(/\b(?:since|this|from) evening\b|\bshaam se\b/))) return { at: partOfDay(now, 18), text: m[0] };
  if ((m = t.match(/\b(last night|yesterday night|kal raat)\b/))) {
    const d = new Date(now); d.setDate(d.getDate() - 1); d.setHours(21, 0, 0, 0);
    return { at: d, text: m[0] };
  }
  if ((m = t.match(/\b(?:since|from) yesterday\b|\byesterday\b|\bkal se\b/))) return { at: ago(24 * 60), text: m[0] };
  if ((m = t.match(new RegExp(`\\b(?:since|last|from) (${WEEKDAYS.join('|')})\\b`)))) {
    const d = new Date(now);
    const diff = (now.getDay() - WEEKDAYS.indexOf(m[1]) + 7) % 7;
    d.setDate(d.getDate() - diff); d.setHours(9, 0, 0, 0);
    if (d > now) d.setDate(d.getDate() - 7);
    return { at: d, text: m[0] };
  }
  if ((m = t.match(/\b(?:since |for |from )?(?:last|past) week\b|\bek hafte se\b/))) return { at: ago(7 * 1440), text: m[0] };
  if ((m = t.match(/\b(?:since the start of the semester|this semester|for months)\b/))) return { at: ago(30 * 1440), text: m[0] };
  if ((m = t.match(/\b(today|aaj)\b/))) return { at: ago(120), text: m[0] };
  return null;
}

// ------------------------------------------------------------------ people affected
export function extractPeople(text) {
  const t = String(text || '').toLowerCase();
  const m = t.match(/\b(\d{1,4}) ?\+? ?(?:students|people|of us|persons|girls|boys|members|classmates)\b/);
  const peopleCount = m ? Math.min(500, Number(m[1])) : null;
  const manyAffected = Boolean(peopleCount && peopleCount > 1)
    || /\b(many students|many people|lots of students|everyone|whole class|whole floor|whole hostel|whole batch|all of us|all students|entire (?:class|floor|hostel|batch|block)|sab log|sabko)\b/.test(t);
  return { peopleCount, manyAffected };
}

// ------------------------------------------------------------------ all together
export function extractDetails(text, now = new Date()) {
  const location = extractLocation(text);
  const when = extractWhen(text, now);
  const recurringMatch = String(text || '').toLowerCase().match(/\b(every ?day|daily|roz|every morning|every night|again and again)\b/);
  const { peopleCount, manyAffected } = extractPeople(text);
  return {
    location,
    occurredAt: when ? when.at.toISOString() : null,
    whenText: when ? when.text : recurringMatch ? recurringMatch[0] : null,
    recurring: Boolean(recurringMatch),
    peopleCount,
    manyAffected,
    missing: location ? [] : ['location'],
  };
}
