// encode.js — turns a timetable problem into CNF (a list of clauses).
//
// One boolean variable per class option: "activity A uses option o".
// Constraints become clauses:
//   exactly-one  each activity picks exactly one of its options
//   clash        two options from different activities that overlap can't both be picked
//   blocked      an option overlapping a blocked time (work, gym...) is forbidden
//   hours        an option outside the allowed start/finish window is forbidden
//   max-days     at most K days on campus (day variables + sequential counter)

export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// ---------- parsing ----------

function parseTime(s) {
  const m = /^(\d{1,2})(?::(\d{2}))?$/.exec(s.trim());
  if (!m) throw new Error(`Bad time "${s}"`);
  const h = +m[1], min = +(m[2] || 0);
  if (h > 24 || min > 59) throw new Error(`Bad time "${s}"`);
  return h * 60 + min;
}

function parseSlot(s, lineNo) {
  // e.g. "Tue 10:00-12:00"
  const m = /^\s*(\w{3})\w*\s+([\d:]+)\s*-\s*([\d:]+)\s*$/.exec(s);
  if (!m) throw new Error(`Line ${lineNo}: can't read slot "${s.trim()}" (expected e.g. "Tue 10:00-12:00")`);
  const day = DAYS.findIndex((d) => d.toLowerCase() === m[1].toLowerCase());
  if (day < 0) throw new Error(`Line ${lineNo}: unknown day "${m[1]}"`);
  const start = parseTime(m[2]), end = parseTime(m[3]);
  if (end <= start) throw new Error(`Line ${lineNo}: slot ends before it starts`);
  return { day, start, end };
}

// Format:
//   UNIT Activity: Mon 9-11 | Wed 14:00-16:00     (options separated by |)
//   BLOCK Label: Mon 9-17 | Fri 9-17              (times you're unavailable)
//   # comment
export function parseProblem(text) {
  const activities = [], blocks = [];
  text.split('\n').forEach((raw, i) => {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) return;
    const colon = line.indexOf(':');
    if (colon < 0) throw new Error(`Line ${i + 1}: missing ":"`);
    const head = line.slice(0, colon).trim().split(/\s+/);
    const slots = line.slice(colon + 1).split('|').filter((s) => s.trim()).map((s) => parseSlot(s, i + 1));
    if (!slots.length) throw new Error(`Line ${i + 1}: no time slots`);
    if (head[0].toUpperCase() === 'BLOCK') {
      const label = head.slice(1).join(' ') || 'Blocked';
      slots.forEach((s) => blocks.push({ label, ...s }));
    } else {
      if (head.length < 2) throw new Error(`Line ${i + 1}: expected "UNIT Activity:"`);
      activities.push({ unit: head[0], name: head.slice(1).join(' '), options: slots });
    }
  });
  if (!activities.length) throw new Error('No classes found.');
  return { activities, blocks };
}

// ---------- encoding ----------

const overlaps = (a, b) => a.day === b.day && a.start < b.end && b.start < a.end;

export function encode(problem, prefs = {}) {
  const { activities, blocks } = problem;
  const clauses = [];
  const counts = {}, kinds = [];
  const add = (kind, c) => { clauses.push(c); kinds.push(kind); counts[kind] = (counts[kind] || 0) + 1; };

  // Primary variables: one per option.
  const options = [];   // var - 1 -> { act, opt, slot }
  activities.forEach((act, a) => act.options.forEach((slot, o) => {
    options.push({ a, o, slot, label: `${act.unit} ${act.name} ${fmtSlot(slot)}` });
    slot.v = options.length;
  }));
  let numVars = options.length;
  const fresh = () => ++numVars;

  // Exactly one option per activity: one "at least one" clause, then pairwise "at most one".
  for (const act of activities) {
    const vs = act.options.map((s) => s.v);
    add('exactly-one', vs);
    for (let i = 0; i < vs.length; i++)
      for (let j = i + 1; j < vs.length; j++) add('exactly-one', [-vs[i], -vs[j]]);
  }

  // Clashes between different activities.
  for (let i = 0; i < options.length; i++)
    for (let j = i + 1; j < options.length; j++)
      if (options[i].a !== options[j].a && overlaps(options[i].slot, options[j].slot))
        add('clash', [-options[i].slot.v, -options[j].slot.v]);

  // Blocked times and the allowed hours window.
  for (const opt of options) {
    const s = opt.slot;
    if (blocks.some((b) => overlaps(b, s))) add('blocked', [-s.v]);
    else if ((prefs.earliest != null && s.start < prefs.earliest) ||
             (prefs.latest != null && s.end > prefs.latest)) add('hours', [-s.v]);
  }

  // At most K days on campus.
  const dayVars = {};
  if (prefs.maxDays != null) {
    const used = [...new Set(options.map((o) => o.slot.day))].sort();
    for (const d of used) dayVars[d] = fresh();
    // Picking a class on day d forces "on campus on d".
    for (const opt of options) add('day-link', [-opt.slot.v, dayVars[opt.slot.day]]);
    atMostK(used.map((d) => dayVars[d]), prefs.maxDays, fresh, (c) => add('at-most-k', c));
  }

  return { numVars, clauses, kinds, counts, options, dayVars };
}

// Sinz's sequential counter (2005): at most k of xs are true, using O(n·k)
// auxiliary variables and clauses. s[i][j] means "at least j+1 of x0..xi are true".
export function atMostK(xs, k, fresh, add) {
  const n = xs.length;
  if (k >= n) return;
  if (k <= 0) { xs.forEach((x) => add([-x])); return; }
  const s = Array.from({ length: n - 1 }, () => Array.from({ length: k }, fresh));
  add([-xs[0], s[0][0]]);
  for (let j = 1; j < k; j++) add([-s[0][j]]);
  for (let i = 1; i < n - 1; i++) {
    add([-xs[i], s[i][0]]);
    add([-s[i - 1][0], s[i][0]]);
    for (let j = 1; j < k; j++) {
      add([-xs[i], -s[i - 1][j - 1], s[i][j]]);
      add([-s[i - 1][j], s[i][j]]);
    }
    add([-xs[i], -s[i - 1][k - 1]]);
  }
  add([-xs[n - 1], -s[n - 2][k - 1]]);
}

// Read the chosen option for each activity out of a satisfying model.
export function decode(problem, enc, model) {
  return problem.activities.map((act) => {
    const slot = act.options.find((s) => model[s.v] === 1);
    return { unit: act.unit, name: act.name, ...slot };
  });
}

// Clause that rules out exactly this assignment of options ("give me a different one").
export function blockingClause(chosen) {
  return chosen.map((c) => -c.v);
}

export function fmtTime(m) {
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
export function fmtSlot(s) {
  return `${DAYS[s.day]} ${fmtTime(s.start)}–${fmtTime(s.end)}`;
}
