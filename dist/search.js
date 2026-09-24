import { assignEmblems } from './engine.js';

export function prepareRoster(data, raw = {}) {
  const input = {population: 8, emblems: {}, locked: [], excluded: [], occupiedSlots: {},
    allowFiveCosts: true, requireFiveCost: false, luxForm: 'any', ...raw};
  if (!Number.isInteger(input.population) || input.population < 1 || input.population > 12) {
    throw new Error('人口须为 1–12 的整数');
  }
  for (const key of ['locked', 'excluded']) {
    if (!Array.isArray(input[key]) || input[key].some(id => typeof id !== 'string')) throw new Error('阵容条件格式无效');
    input[key] = [...new Set(input[key])];
  }
  for (const key of ['emblems', 'occupiedSlots']) {
    if (!input[key] || typeof input[key] !== 'object' || Array.isArray(input[key])) throw new Error('转职或装备格格式无效');
  }
  const known = new Set(data.units.flatMap(unit => [unit.id, unit.baseId || unit.id]));
  for (const id of [...input.locked, ...input.excluded, ...Object.keys(input.occupiedSlots)]) {
    if (!known.has(id)) throw new Error('存在不属于当前赛季的弈子');
  }
  for (const count of Object.values(input.occupiedSlots)) {
    if (!Number.isInteger(count) || count < 0 || count > 3) throw new Error('已占用装备格须为 0–3');
  }
  if (input.requireFiveCost && !input.allowFiveCosts) throw new Error('含五费方案不能同时禁用五费');
  const luxId = data.special?.lux;
  const forms = data.units.filter(unit => unit.baseId === luxId).map(unit => unit.form);
  if (!['any', 'none', ...forms].includes(input.luxForm)) throw new Error('拉克丝形态无效');
  const units = data.units.filter(unit => {
    if (unit.name === '卡兹克' || (data.special?.khazix &&
      (unit.id === data.special.khazix || unit.baseId === data.special.khazix))) return false;
    if (input.excluded.includes(unit.id) || input.excluded.includes(unit.baseId)) return false;
    if (!input.allowFiveCosts && unit.cost >= 5) return false;
    if (unit.baseId === luxId && input.luxForm !== 'any' && input.luxForm !== unit.form) return false;
    return true;
  });
  // Validate inventory even when filtering leaves no eligible carriers.
  assignEmblems([], input.emblems, data, {});
  const lockedGroups = input.locked.map(id => units.filter(unit => unit.id === id || unit.baseId === id));
  if (lockedGroups.some(group => group.length === 0)) throw new Error('锁定弈子被排除，或不符合五费 / 形态限制');
  const lockedBases = lockedGroups.map(group => group[0].baseId || group[0].id);
  if (new Set(lockedBases).size !== lockedBases.length) throw new Error('同一个弈子不能锁定多个形态');
  if (lockedGroups.reduce((sum, group) => sum + Math.min(...group.map(unit => unit.slots ?? 1)), 0) > input.population) {
    throw new Error('锁定弈子占用的人口超过上限');
  }
  if (!units.length) throw new Error('当前条件下没有可用弈子，请减少排除条件');
  return {units, input, lockedGroups, lockedBases: new Set(lockedBases)};
}

export function search(data, rawInput, options = {}) {
  const started = performance.now();
  const budget = Number.isFinite(options.timeBudgetMs) ? Math.max(0, options.timeBudgetMs) : 5000;
  const deadline = started + budget;
  const {units, input, lockedGroups, lockedBases} = prepareRoster(data, rawInput);
  const traits = data.traits.filter(trait => trait.countable);
  const threshold = traits.map(trait => trait.breakpoints[0]);
  const vectors = new Map(units.map(unit => [unit.id, traits.map(trait => unit.traits[trait.id] || 0)]));
  const inventory = traits.map(trait => input.emblems[trait.id] || 0);
  let visited = 0;
  let timedOut = false;
  let bestScore = -1;
  let boards = [];
  const saved = new Set();
  let rngState = (options.seed ?? 20264143) >>> 0;
  const random = () => {
    rngState = (Math.imul(rngState, 1664525) + 1013904223) >>> 0;
    return rngState / 4294967296;
  };
  const slotsOf = board => board.reduce((sum, unit) => sum + (unit.slots ?? 1), 0);
  const baseOf = unit => unit.baseId || unit.id;
  const vectorOf = board => {
    const vector = Array(traits.length).fill(0);
    for (const unit of board) vectors.get(unit.id).forEach((count, index) => vector[index] += count);
    return vector;
  };
  function estimate(vector) {
    let value = 0;
    for (let i = 0; i < traits.length; i++) {
      const count = vector[i] + inventory[i];
      value += (count >= threshold[i] ? 100 : 0) + Math.min(count / threshold[i], 1) * 12;
    }
    return value;
  }
  function keep(board) {
    if (!board.length || slotsOf(board) !== input.population) return null;
    if (input.requireFiveCost && !board.some(unit => unit.cost >= 5)) return null;
    visited++;
    const key = board.map(unit => unit.id).sort().join('|');
    const result = assignEmblems(board, input.emblems, data, input.occupiedSlots);
    if (saved.has(key)) return result;
    saved.add(key);
    if (result.score > bestScore) bestScore = result.score;
    boards.push({...result, unitIds: board.map(unit => unit.id), key});
    boards.sort((a, b) => b.score - a.score || a.cost - b.cost || b.slots - a.slots || a.key.localeCompare(b.key));
    boards = boards.slice(0, 10);
    return result;
  }
  const roots = [];
  function buildRoots(index, board) {
    if (index === lockedGroups.length) { roots.push(board); return; }
    for (const unit of lockedGroups[index]) buildRoots(index + 1, [...board, unit]);
  }
  buildRoots(0, []);
  const candidates = units.filter(unit => !lockedBases.has(baseOf(unit)))
    .sort((a, b) => {
      const weight = unit => vectors.get(unit.id).reduce((sum, count, i) => sum + count / threshold[i], 0) / (unit.slots ?? 1);
      return weight(b) - weight(a) || a.cost - b.cost;
    });

  // Seed the bounded exact search with practical boards. This phase never claims optimality.
  const heuristicDeadline = units.length > 18 ? started + Math.min(budget * 0.55, 2800) : started;
  let restart = 0;
  while (performance.now() < heuristicDeadline) {
    let board = [...roots[restart % roots.length]];
    if (input.requireFiveCost && !board.some(unit => unit.cost >= 5)) {
      const fiveCosts = candidates.filter(unit => unit.cost >= 5 && slotsOf(board) + (unit.slots ?? 1) <= input.population);
      if (fiveCosts.length) board.push(fiveCosts[restart % fiveCosts.length]);
    }
    let vector = vectorOf(board);
    let slots = slotsOf(board);
    const bases = new Set(board.map(baseOf));
    while (slots < input.population && performance.now() < heuristicDeadline) {
      let choice = null;
      let best = -Infinity;
      for (const unit of candidates) {
        if (bases.has(baseOf(unit)) || slots + (unit.slots ?? 1) > input.population) continue;
        const next = vector.map((count, i) => count + vectors.get(unit.id)[i]);
        const noise = restart === 0 ? 0 : random() * (restart % 4 === 0 ? 220 : 65);
        const score = estimate(next) - unit.cost * 0.03 + noise;
        if (score > best) { choice = unit; best = score; }
      }
      if (!choice) break;
      board.push(choice);
      bases.add(baseOf(choice));
      slots += choice.slots ?? 1;
      vector = vector.map((count, i) => count + vectors.get(choice.id)[i]);
    }
    let current = keep(board);
    for (let round = 0; round < 5 && performance.now() < heuristicDeadline; round++) {
      const moves = [];
      for (let out = 0; out < board.length; out++) {
        if (lockedBases.has(baseOf(board[out]))) continue;
        for (const incoming of candidates) {
          if (incoming.id === board[out].id) continue;
          if (board.some((u, i) => i !== out && baseOf(u) === baseOf(incoming))) continue;
          if (slots - (board[out].slots ?? 1) + (incoming.slots ?? 1) > input.population) continue;
          const nextVector = vector.map((count, i) => count - vectors.get(board[out].id)[i] + vectors.get(incoming.id)[i]);
          moves.push({out, incoming, estimate: estimate(nextVector)});
        }
      }
      moves.sort((a, b) => b.estimate - a.estimate);
      let improvement = null;
      for (const move of moves.slice(0, 16)) {
        if (performance.now() >= heuristicDeadline) break;
        const next = [...board];
        next[move.out] = move.incoming;
        const result = keep(next);
        if (result && (!current || result.score > current.score || (result.score === current.score && result.cost < current.cost))) {
          improvement = {board: next, result};
          break;
        }
      }
      if (!improvement) break;
      board = improvement.board;
      current = improvement.result;
      slots = slotsOf(board);
      vector = vectorOf(board);
    }
    restart++;
    if (restart % 8 === 0 && options.onProgress) options.onProgress({boards, complete: false, visited, elapsedMs: performance.now() - started});
  }

  // The suffix relaxation overestimates reachable traits, so pruning cannot hide a better score.
  const suffix = Array.from({length: candidates.length + 1}, () => Array(traits.length).fill(0));
  for (let i = candidates.length - 1; i >= 0; i--) {
    suffix[i] = suffix[i + 1].map((count, t) => count + vectors.get(candidates[i].id)[t]);
  }
  let nodes = 0;
  function visit(index, board, slots, bases, vector) {
    nodes++;
    if (performance.now() >= deadline) { timedOut = true; return; }
    if (slots === input.population || index === candidates.length) { keep(board); return; }
    let upper = 0;
    for (let t = 0; t < traits.length; t++) {
      if (traits[t].requires || vector[t] + suffix[index][t] + inventory[t] >= threshold[t]) upper++;
    }
    if (upper < bestScore) return;
    let extended = false;
    for (let i = index; i < candidates.length; i++) {
      const unit = candidates[i];
      const base = baseOf(unit);
      const nextSlots = slots + (unit.slots ?? 1);
      if (bases.has(base) || nextSlots > input.population) continue;
      extended = true;
      bases.add(base);
      board.push(unit);
      visit(i + 1, board, nextSlots, bases, vector.map((count, t) => count + vectors.get(unit.id)[t]));
      board.pop();
      bases.delete(base);
      if (timedOut) return;
    }
    if (!extended) keep(board);
  }
  for (const root of roots) {
    visit(0, [...root], slotsOf(root), new Set(root.map(baseOf)), vectorOf(root));
    if (timedOut) break;
  }
  return {boards, complete: !timedOut, visited, nodes, elapsedMs: performance.now() - started};
}
