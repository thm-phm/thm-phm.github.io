import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solve } from '../projects/timetable-solver/js/solver.js';
import { parseProblem, encode, decode, atMostK } from '../projects/timetable-solver/js/encode.js';

// Small deterministic PRNG so failures are reproducible.
function rng(seed) { return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32); }

function bruteForce(n, clauses) {
  for (let m = 0; m < 1 << n; m++) {
    const val = (l) => ((m >> (Math.abs(l) - 1)) & 1) === (l > 0 ? 1 : 0);
    if (clauses.every((c) => c.some(val))) return true;
  }
  return false;
}
const satisfies = (model, clauses) => clauses.every((c) => c.some((l) => (model[Math.abs(l)] === 1) === l > 0));

test('agrees with brute force on 2000 random 3-SAT instances', () => {
  const r = rng(42);
  for (let t = 0; t < 2000; t++) {
    const n = 3 + Math.floor(r() * 10), m = Math.floor(r() * n * 6);
    const clauses = Array.from({ length: m }, () => {
      const len = 1 + Math.floor(r() * 3);
      return Array.from({ length: len }, () => (1 + Math.floor(r() * n)) * (r() < 0.5 ? -1 : 1));
    });
    const res = solve(n, clauses);
    assert.equal(res.sat, bruteForce(n, clauses), `instance ${t}`);
    if (res.sat) assert.ok(satisfies(res.model, clauses), `model check ${t}`);
  }
});

test('pigeonhole 5→4 is UNSAT', () => {
  const P = 5, H = 4, v = (p, h) => p * H + h + 1, cl = [];
  for (let p = 0; p < P; p++) cl.push([...Array(H).keys()].map((h) => v(p, h)));
  for (let h = 0; h < H; h++) for (let a = 0; a < P; a++) for (let b = a + 1; b < P; b++) cl.push([-v(a, h), -v(b, h)]);
  assert.equal(solve(P * H, cl).sat, false);
});

test('sequential counter allows exactly the assignments with ≤ k true', () => {
  for (let n = 1; n <= 6; n++) for (let k = 0; k <= n; k++) {
    for (let m = 0; m < 1 << n; m++) {
      let nv = n; const cl = [];
      const xs = [...Array(n).keys()].map((i) => i + 1);
      atMostK(xs, k, () => ++nv, (c) => cl.push(c));
      xs.forEach((x, i) => cl.push([(m >> i) & 1 ? x : -x]));
      const ones = xs.filter((_, i) => (m >> i) & 1).length;
      assert.equal(solve(nv, cl).sat, ones <= k, `n=${n} k=${k} m=${m}`);
    }
  }
});

test('timetable: respects clashes, blocks and max days', () => {
  const p = parseProblem(`
    A Lec: Mon 9-11 | Tue 9-11
    B Lec: Mon 10-12 | Wed 9-11
    C Tut: Tue 10-12 | Wed 10-11
    BLOCK Work: Thu 9-17
  `);
  const enc = encode(p, { maxDays: 3 });
  const res = solve(enc.numVars, enc.clauses);
  assert.ok(res.sat);
  const chosen = decode(p, enc, res.model);
  for (let i = 0; i < chosen.length; i++) for (let j = i + 1; j < chosen.length; j++) {
    const a = chosen[i], b = chosen[j];
    assert.ok(!(a.day === b.day && a.start < b.end && b.start < a.end), 'clash');
  }
  assert.ok(new Set(chosen.map((c) => c.day)).size <= 3);
  // Two days is impossible: every clash-free choice spreads over Mon, Tue and Wed.
  const one = encode(p, { maxDays: 2 });
  assert.equal(solve(one.numVars, one.clauses).sat, false);
});
