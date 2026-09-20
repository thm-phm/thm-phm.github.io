// solver.js — a small DPLL SAT solver.
//
// Input:  number of variables and a list of clauses in DIMACS style
//         (each clause is an array of non-zero ints; 3 means x3, -3 means NOT x3).
// Output: { sat: true, model } or { sat: false }, plus search statistics.
//
// Techniques used:
//   * Two watched literals — each clause "watches" two literals and is only
//     revisited when one of them becomes false, so unit propagation doesn't
//     rescan every clause after every assignment.
//   * Chronological backtracking — classic DPLL: on conflict, undo to the most
//     recent decision that hasn't been flipped yet and try the other value.
//   * Activity-based branching — variables that appear in conflicts get their
//     score bumped, so the search focuses on the constrained part of the problem.

export function solve(numVars, clauses, { maxConflicts = 1e6 } = {}) {
  const t0 = performance.now();
  const stats = { decisions: 0, propagations: 0, conflicts: 0, ms: 0 };

  // value[v]: 0 = unassigned, 1 = true, -1 = false
  const value = new Int8Array(numVars + 1);
  const valueOf = (lit) => (lit > 0 ? value[lit] : -value[-lit]);
  const activity = new Float64Array(numVars + 1);

  // Watch lists are indexed by literal: 2v for v, 2v+1 for -v.
  const idx = (lit) => (lit > 0 ? 2 * lit : 2 * -lit + 1);
  const watches = Array.from({ length: 2 * numVars + 2 }, () => []);

  const trail = [];       // literals in the order they were made true
  const levelStart = [];  // trail index where each decision level begins
  const decisionLit = []; // the literal decided at each level
  const flipped = [];     // whether that level has already tried both values
  let qhead = 0;          // next trail position to propagate

  const assign = (lit) => {
    value[Math.abs(lit)] = lit > 0 ? 1 : -1;
    trail.push(lit);
  };

  const cls = [];
  for (const c of clauses) {
    if (c.length === 0) return done(false);
    if (c.length === 1) {
      const v = valueOf(c[0]);
      if (v === -1) return done(false);   // contradicts another unit clause
      if (v === 0) assign(c[0]);
      continue;
    }
    const arr = Int32Array.from(c);
    const ci = cls.push(arr) - 1;
    watches[idx(arr[0])].push(ci);
    watches[idx(arr[1])].push(ci);
  }

  // Returns the index of a conflicting clause, or -1 if propagation succeeded.
  function propagate() {
    while (qhead < trail.length) {
      const falseLit = -trail[qhead++];
      const list = watches[idx(falseLit)];
      let i = 0;
      while (i < list.length) {
        const ci = list[i];
        const c = cls[ci];
        // Keep the false watched literal in position 1.
        if (c[0] === falseLit) { c[0] = c[1]; c[1] = falseLit; }
        if (valueOf(c[0]) === 1) { i++; continue; }   // clause already satisfied

        // Look for a replacement literal to watch.
        let moved = false;
        for (let k = 2; k < c.length; k++) {
          if (valueOf(c[k]) !== -1) {
            c[1] = c[k]; c[k] = falseLit;
            watches[idx(c[1])].push(ci);
            list[i] = list[list.length - 1]; list.pop();  // O(1) removal
            moved = true;
            break;
          }
        }
        if (moved) continue;

        // No replacement: the clause is unit or conflicting.
        if (valueOf(c[0]) === -1) return ci;
        assign(c[0]);
        stats.propagations++;
        i++;
      }
    }
    return -1;
  }

  function undoTo(pos) {
    while (trail.length > pos) value[Math.abs(trail.pop())] = 0;
    qhead = Math.min(qhead, trail.length);
  }

  function pickBranchVar() {
    let best = 0, bestScore = -1;
    for (let v = 1; v <= numVars; v++) {
      if (value[v] === 0 && activity[v] > bestScore) { best = v; bestScore = activity[v]; }
    }
    return best;
  }

  for (;;) {
    const confl = propagate();
    if (confl !== -1) {
      stats.conflicts++;
      if (stats.conflicts > maxConflicts) return done(false, true);
      for (const lit of cls[confl]) activity[Math.abs(lit)] += 1;

      // Backtrack to the most recent level that still has an untried value.
      for (;;) {
        if (levelStart.length === 0) return done(false);
        const pos = levelStart.pop();
        const lit = decisionLit.pop();
        const wasFlipped = flipped.pop();
        undoTo(pos);
        if (!wasFlipped) {
          levelStart.push(trail.length); decisionLit.push(-lit); flipped.push(true);
          assign(-lit);
          break;
        }
      }
      continue;
    }

    const v = pickBranchVar();
    if (v === 0) return done(true);   // every variable assigned, no conflict
    stats.decisions++;
    levelStart.push(trail.length); decisionLit.push(v); flipped.push(false);
    assign(v);   // try "true" first
  }

  function done(sat, gaveUp = false) {
    stats.ms = performance.now() - t0;
    const res = { sat, stats };
    if (gaveUp) res.unknown = true;
    if (sat) {
      res.model = new Int8Array(numVars + 1);
      for (let v = 1; v <= numVars; v++) res.model[v] = value[v] === 1 ? 1 : 0;
    }
    return res;
  }
}

// Standard DIMACS CNF text, the input format every SAT solver understands.
export function toDimacs(numVars, clauses, comments = []) {
  const lines = comments.map((c) => `c ${c}`);
  lines.push(`p cnf ${numVars} ${clauses.length}`);
  for (const c of clauses) lines.push(`${c.join(' ')} 0`);
  return lines.join('\n') + '\n';
}
