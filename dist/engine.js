/** Pure board rules. The search and the interface both use this independent evaluator. */
export function evaluateBoard(units, assignments = {}, data, occupiedSlots = {}) {
  const counts = Object.fromEntries(data.traits.map(trait => [trait.id, 0]));
  const traitMap = new Map(data.traits.map(trait => [trait.id, trait]));
  const bases = new Set();
  const ids = new Set(units.map(unit => unit.id));
  let slots = 0;
  let cost = 0;
  for (const id of Object.keys(assignments)) {
    if (!ids.has(id)) throw new Error('转职携带者不在阵容中');
  }
  for (const unit of units) {
    const base = unit.baseId || unit.id;
    if (bases.has(base)) throw new Error('同名弈子或不同形态重复上场');
    bases.add(base);
    slots += unit.slots ?? 1;
    cost += unit.cost;
    for (const [id, value] of Object.entries(unit.traits)) {
      if (!traitMap.has(id) || !Number.isInteger(value) || value < 0) throw new Error('弈子羁绊数据无效');
      counts[id] += value;
    }
    const equipped = assignments[unit.id] || [];
    const occupied = occupiedSlots[unit.id] ?? occupiedSlots[base] ?? 0;
    if (!Number.isInteger(occupied) || occupied < 0 || occupied > 3 || equipped.length + occupied > 3) {
      throw new Error('转职超过可用装备格');
    }
    if (new Set(equipped).size !== equipped.length) throw new Error('同一种转职不能重复装备');
    for (const id of equipped) {
      if (!traitMap.get(id)?.emblem) throw new Error('不存在这种转职');
      if (unit.traits[id]) throw new Error('弈子已有该羁绊，不能重复计入转职');
      counts[id]++;
    }
  }
  // A conditional trait is data-driven, never assumed to be a free extra trait.
  for (const trait of data.traits) {
    if (trait.requires) {
      const met = Object.entries(trait.requires).every(([id, minimum]) => counts[id] >= minimum);
      counts[trait.id] = met ? 1 : 0;
    }
  }
  const details = data.traits.map(trait => {
    const count = counts[trait.id];
    const thresholds = trait.breakpoints;
    const tier = thresholds.filter(threshold => count >= threshold).length;
    return {...trait, count, tier, needed: Math.max(0, thresholds[0] - count)};
  });
  const active = details.filter(trait => trait.tier > 0);
  return {score: active.filter(trait => trait.countable).length, slots, cost, counts, active,
    inactive: details.filter(trait => trait.tier === 0 && trait.countable), assignments};
}

/** Maximum flow: each emblem type can visit a carrier once; carriers have equipment capacity. */
function placeEmblems(units, requested, occupiedSlots) {
  if (!requested.length) return {};
  const sink = requested.length + units.length + 1;
  const graph = Array.from({length: sink + 1}, () => []);
  function edge(from, to, capacity) {
    const forward = {to, capacity, reverse: graph[to].length};
    const backward = {to: from, capacity: 0, reverse: graph[from].length};
    graph[from].push(forward);
    graph[to].push(backward);
    return forward;
  }
  const carrierEdges = [];
  let needed = 0;
  requested.forEach((request, index) => {
    edge(0, index + 1, request.need);
    needed += request.need;
    units.forEach((unit, unitIndex) => {
      if (!unit.traits[request.id]) {
        carrierEdges.push({id: request.id, unitId: unit.id,
          edge: edge(index + 1, requested.length + unitIndex + 1, 1)});
      }
    });
  });
  units.forEach((unit, index) => edge(requested.length + index + 1, sink,
    3 - (occupiedSlots[unit.id] ?? occupiedSlots[unit.baseId || unit.id] ?? 0)));

  function augment(node, seen) {
    if (node === sink) return true;
    seen.add(node);
    for (const next of graph[node]) {
      if (next.capacity > 0 && !seen.has(next.to) && augment(next.to, seen)) {
        next.capacity--;
        graph[next.to][next.reverse].capacity++;
        return true;
      }
    }
    return false;
  }
  let placed = 0;
  while (placed < needed && augment(0, new Set())) placed++;
  if (placed !== needed) return null;
  const assignments = {};
  // Iterate in board order so output is stable even when a flow path was rerouted.
  for (const unit of units) {
    const list = carrierEdges.filter(item => item.unitId === unit.id && item.edge.capacity === 0).map(item => item.id);
    if (list.length) assignments[unit.id] = list;
  }
  return assignments;
}

/** Maximize newly activated eligible traits, with a concrete legal assignment for every result. */
export function assignEmblems(units, inventory = {}, data, occupiedSlots = {}) {
  const base = evaluateBoard(units, {}, data, occupiedSlots);
  const map = new Map(data.traits.map(trait => [trait.id, trait]));
  for (const [id, count] of Object.entries(inventory)) {
    if (!map.get(id)?.emblem || !Number.isSafeInteger(count) || count < 0 || count > 30) {
      throw new Error('转职名称或数量无效（每种为 0–30 个）');
    }
  }
  const candidates = data.traits.filter(trait => trait.countable && trait.emblem && !trait.requires)
    .map(trait => ({id: trait.id, need: Math.max(0, trait.breakpoints[0] - base.counts[trait.id])}))
    .filter(request => request.need > 0 && request.need <= (inventory[request.id] || 0)
      && units.filter(unit => !unit.traits[request.id]
        && (occupiedSlots[unit.id] ?? occupiedSlots[unit.baseId || unit.id] ?? 0) < 3).length >= request.need)
    .sort((a, b) => a.need - b.need || a.id.localeCompare(b.id));
  let assignments = placeEmblems(units, candidates, occupiedSlots);
  if (assignments === null) {
    let bestCount = 0;
    assignments = {};
    const selected = [];
    function choose(index) {
      if (selected.length + candidates.length - index <= bestCount) return;
      const trial = placeEmblems(units, selected, occupiedSlots);
      // Adding more requirements cannot repair an infeasible placement.
      if (trial === null) return;
      if (selected.length > bestCount) {
        bestCount = selected.length;
        assignments = trial;
      }
      if (index === candidates.length) return;
      selected.push(candidates[index]);
      choose(index + 1);
      selected.pop();
      choose(index + 1);
    }
    choose(0);
  }
  const result = evaluateBoard(units, assignments, data, occupiedSlots);
  const unused = {...inventory};
  for (const list of Object.values(assignments)) for (const id of list) unused[id]--;
  result.unused = Object.fromEntries(Object.entries(unused).filter(([, count]) => count > 0));
  return result;
}
