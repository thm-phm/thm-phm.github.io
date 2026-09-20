// app.js — wires the page to the encoder and solver.
import { solve, toDimacs } from './solver.js';
import { parseProblem, encode, decode, blockingClause, DAYS, fmtTime, fmtSlot } from './encode.js';

const SAMPLE = `
# Sample data: made-up times, not a real Monash timetable.
# Format:  UNIT Activity: Day start-end | Day start-end | ...
# Each activity needs exactly one of its options.
FIT2014 Lecture: Thu 10-12 | Tue 10-12
FIT2014 Tutorial: Thu 15-17 | Mon 12-14 | Tue 15-17 | Wed 9-11
FIT2014 Workshop: Wed 13-15 | Thu 13-15 | Fri 10-12
ECC2010 Lecture: Wed 10-12 | Thu 9-11
ECC2010 Tutorial: Tue 12-13 | Tue 16-17 | Wed 15-16 | Thu 12-13
ECX2360 Seminar: Thu 16-18 | Tue 13-15
ECX2360 Workshop: Mon 14-16 | Wed 16-18 | Fri 11-13

# Times you can't do anything.
BLOCK Work: Mon 9-17 | Fri 9-17
BLOCK Gym: Tue 18-20 | Wed 18-20 | Thu 18-20
`.trimStart();

const $ = (id) => document.getElementById(id);
const els = {
  spec: $('spec'), maxDays: $('maxDays'), earliest: $('earliest'), latest: $('latest'),
  status: $('status'), grid: $('grid'), stats: $('stats'), log: $('log'),
  counts: $('counts'), preview: $('clausePreview'),
};

// Solutions already shown by "Show another" (as blocking clauses). Cleared when the input changes.
let blocked = [];
let current = null;   // { problem, enc } for the latest valid input

function readPrefs() {
  const num = (el) => (el.value === '' ? null : Number(el.value));
  return { maxDays: num(els.maxDays), earliest: num(els.earliest), latest: num(els.latest) };
}

function build(prefsOverride = {}) {
  const problem = parseProblem(els.spec.value);
  const enc = encode(problem, { ...readPrefs(), ...prefsOverride });
  return { problem, enc };
}

function run(problem, enc) {
  const clauses = enc.clauses.concat(blocked);
  return solve(enc.numVars, clauses);
}

// ---------- actions ----------

function onSolve() {
  els.log.innerHTML = '';
  try {
    current = build();
    const res = run(current.problem, current.enc);
    show(current, res);
    renderFormula(current);
  } catch (e) { showError(e); }
}

function onMinimise() {
  els.log.innerHTML = '';
  try {
    current = build({ maxDays: null });
    let res = run(current.problem, current.enc);
    const logs = [];
    if (!res.sat) { show(current, res); return; }
    let best = { ...current, res }, days = countDays(decode(current.problem, current.enc, res.model));
    logs.push({ sat: true, text: `No day limit → SAT, uses ${days} day${days === 1 ? '' : 's'}` });
    let totalMs = res.stats.ms;
    // Keep asking for one fewer day until the solver proves it impossible.
    while (days > 1) {
      const attempt = build({ maxDays: days - 1 });
      const r = run(attempt.problem, attempt.enc);
      totalMs += r.stats.ms;
      if (!r.sat) { logs.push({ sat: false, text: `≤ ${days - 1} day${days - 1 === 1 ? '' : 's'} → UNSAT (${r.stats.conflicts} conflict${r.stats.conflicts === 1 ? '' : 's'})` }); break; }
      days = countDays(decode(attempt.problem, attempt.enc, r.model));
      logs.push({ sat: true, text: `≤ ${days} days → SAT` });
      best = { ...attempt, res: r };
    }
    current = { problem: best.problem, enc: best.enc };
    els.maxDays.value = String(days);
    show(current, best.res, `Optimal: ${days} day${days === 1 ? '' : 's'} on campus`,
      `Proved optimal in ${logs.length} solver call${logs.length === 1 ? '' : 's'} (${totalMs.toFixed(1)} ms total)`);
    els.log.innerHTML = logs.map((l) => `<li class="${l.sat ? 'sat' : 'unsat'}">${l.text}</li>`).join('');
    renderFormula(current);
  } catch (e) { showError(e); }
}

function onNext() {
  if (!current || !current.last) { invalidate(); return onSolve(); }   // start the cycle again
  blocked.push(blockingClause(current.last));
  try {
    current = build();
    const res = run(current.problem, current.enc);
    const n = blocked.length;
    if (res.sat) show(current, res, `Alternative #${n}`, `${n} previous timetable${n === 1 ? '' : 's'} excluded by blocking clauses`);
    else show(current, res, 'No more timetables', `All ${n} valid timetable${n === 1 ? '' : 's'} have been shown for these settings`);
  } catch (e) { showError(e); }
}

function onReset() {
  els.spec.value = SAMPLE;
  els.maxDays.value = els.earliest.value = els.latest.value = '';
  invalidate(); onSolve();
}

function invalidate() { blocked = []; }

// ---------- rendering ----------

const countDays = (chosen) => new Set(chosen.map((c) => c.day)).size;

function show({ problem, enc }, res, title, sub) {
  els.status.className = 'status' + (res.sat ? '' : ' bad');
  if (!res.sat) {
    current.last = null;
    els.status.innerHTML = `${title || 'No valid timetable (UNSAT)'}<small>${sub || 'The constraints contradict each other. Try loosening the day limit or hours.'}</small>`;
    renderGrid(problem, []);
  } else {
    const chosen = decode(problem, enc, res.model);
    current.last = chosen;
    const d = countDays(chosen);
    els.status.innerHTML = `${title || `Found a clash-free timetable · ${d} day${d === 1 ? '' : 's'} on campus`}<small>${sub || 'Try “Minimise days” to find the provably best one.'}</small>`;
    renderGrid(problem, chosen);
  }
  const s = res.stats;
  els.stats.innerHTML = [
    ['Variables', enc.numVars], ['Clauses', enc.clauses.length + blocked.length],
    ['Decisions', s.decisions], ['Propagations', s.propagations], ['Conflicts', s.conflicts], ['Time', `${s.ms.toFixed(2)} ms`],
  ].map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
}

function renderGrid(problem, chosen) {
  const allSlots = problem.activities.flatMap((a) => a.options).concat(problem.blocks);
  const maxDay = Math.max(4, ...allSlots.map((s) => s.day));   // always show Mon–Fri
  const days = [...Array(maxDay + 1).keys()];
  const startH = Math.min(8, Math.floor(Math.min(...allSlots.map((s) => s.start)) / 60));
  const endH = Math.max(19, Math.ceil(Math.max(...allSlots.map((s) => s.end)) / 60));
  const span = endH - startH;
  const units = [...new Set(problem.activities.map((a) => a.unit))];
  const colour = (u) => `var(--u${(units.indexOf(u) % 6) + 1})`;
  const pos = (s) => `top:calc(var(--hour) * ${(s.start / 60 - startH)});height:calc(var(--hour) * ${(s.end - s.start) / 60} - 2px)`;
  const used = new Set(chosen.map((c) => c.day));

  let html = '<div></div>' + days.map((d) => `<div class="dayhead${used.has(d) ? ' on' : ''}">${DAYS[d]}</div>`).join('');
  html += '<div class="times">' + [...Array(span).keys()].map((i) => `<span style="top:calc(var(--hour) * ${i})">${i ? fmtTime((startH + i) * 60) : ''}</span>`).join('') + '</div>';
  for (const d of days) {
    html += '<div class="col">';
    for (const b of problem.blocks.filter((b) => b.day === d))
      html += `<div class="ev block" style="${pos(clip(b, startH, endH))}"><b>${esc(b.label)}</b></div>`;
    chosen.filter((c) => c.day === d).forEach((c, i) => {
      html += `<div class="ev" title="${esc(`${c.unit} ${c.name} · ${fmtSlot(c)}`)}" style="--c:${colour(c.unit)};${pos(c)};animation-delay:${i * 40}ms"><b>${esc(c.unit)}</b>${esc(c.name)}</div>`;
    });
    html += '</div>';
  }
  els.grid.style.setProperty('--days', days.length);
  els.grid.style.setProperty('--span', span);
  els.grid.innerHTML = html;
}

const clip = (s, a, b) => ({ ...s, start: Math.max(s.start, a * 60), end: Math.min(s.end, b * 60) });

function renderFormula({ enc }) {
  const labels = {
    'exactly-one': 'Exactly one option per class', clash: 'Clashes', blocked: 'Blocked times',
    hours: 'Outside allowed hours', 'day-link': 'Class → day on campus', 'at-most-k': 'At most k days (sequential counter)',
  };
  const rows = Object.entries(enc.counts).map(([k, n]) => `<tr><td>${labels[k] || k}</td><td>${n}</td></tr>`);
  rows.push(`<tr><td>Total · ${enc.numVars} variables</td><td>${enc.clauses.length}</td></tr>`);
  els.counts.innerHTML = rows.join('');

  const name = varNamer(enc);
  const lit = (l) => (l < 0 ? '¬' : '') + name(Math.abs(l));
  els.preview.textContent = enc.clauses.slice(0, 60)
    .map((c, i) => `${enc.kinds[i].padEnd(12)} ${c.map(lit).join('  ∨  ')}`).join('\n')
    + (enc.clauses.length > 60 ? `\n… ${enc.clauses.length - 60} more` : '');
}

function varNamer(enc) {
  const dayOf = Object.fromEntries(Object.entries(enc.dayVars).map(([d, v]) => [v, `onCampus(${DAYS[d]})`]));
  return (v) => (v <= enc.options.length ? `[${enc.options[v - 1].label}]` : dayOf[v] || `s${v}`);
}

function downloadDimacs() {
  try {
    const { enc } = build();
    const name = varNamer(enc);
    const comments = ['Timetable problem generated by the SAT timetable solver', ...[...Array(enc.numVars).keys()].map((i) => `var ${i + 1} = ${name(i + 1)}`)];
    const blob = new Blob([toDimacs(enc.numVars, enc.clauses, comments)], { type: 'text/plain' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'timetable.cnf' });
    a.click(); URL.revokeObjectURL(a.href);
  } catch (e) { showError(e); }
}

function showError(e) {
  els.status.className = 'status bad';
  els.status.innerHTML = `Couldn't read the input<small>${esc(e.message)}</small>`;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- wiring ----------

$('solveBtn').addEventListener('click', () => { invalidate(); onSolve(); });
$('minBtn').addEventListener('click', () => { invalidate(); onMinimise(); });
$('nextBtn').addEventListener('click', onNext);
$('resetBtn').addEventListener('click', onReset);
$('dimacsBtn').addEventListener('click', downloadDimacs);
for (const el of [els.maxDays, els.earliest, els.latest]) el.addEventListener('change', () => { invalidate(); onSolve(); });
let typing;
els.spec.addEventListener('input', () => { invalidate(); clearTimeout(typing); typing = setTimeout(onSolve, 400); });

els.spec.value = SAMPLE;
onSolve();
