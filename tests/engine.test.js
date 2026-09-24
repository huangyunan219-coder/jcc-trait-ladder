import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateBoard, assignEmblems } from '../dist/engine.js';

const data = { traits: [
  { id: 'a', name: '甲', breakpoints: [2, 4], countable: true, emblem: true },
  { id: 'b', name: '乙', breakpoints: [2], countable: true, emblem: true },
  { id: 'c', name: '丙', breakpoints: [3], countable: true, emblem: true },
  { id: 'solo', name: '专属', breakpoints: [1], countable: false, emblem: false },
  { id: 'one', name: '单层普通', breakpoints: [1], countable: true, emblem: false },
] };
const unit = (id, traits = {}, slots = 1) => ({ id, baseId: id, name: id, traits, slots, cost: 2 });

test('counts each active eligible trait once, including one-member ordinary traits', () => {
  const result = evaluateBoard([unit('u', {a: 4, solo: 1, one: 1})], {}, data);
  assert.equal(result.score, 2);
  assert.equal(result.active.length, 3);
});

test('tracks population separately from units and rejects duplicate forms', () => {
  assert.equal(evaluateBoard([unit('dragon', {a: 2}, 2)], {}, data).slots, 2);
  assert.throws(() => evaluateBoard([unit('lux1'), {...unit('lux2'), baseId: 'lux1'}], {}, data), /重复/);
});

test('emblems cannot duplicate native traits or each other on the same unit', () => {
  assert.throws(() => evaluateBoard([unit('u', {a: 1})], {u: ['a']}, data), /已有/);
  assert.throws(() => evaluateBoard([unit('u')], {u: ['a', 'a']}, data), /重复/);
  assert.throws(() => evaluateBoard([unit('u')], {u: ['solo']}, data), /转职/);
});

test('equipment slots and unknown carriers are validated', () => {
  assert.throws(() => evaluateBoard([unit('u')], {u: ['a']}, data, {u: 3}), /装备/);
  assert.throws(() => evaluateBoard([unit('u')], {ghost: ['a']}, data), /携带/);
});

test('multiple copies must use distinct eligible carriers', () => {
  const result = assignEmblems([unit('x'), unit('y')], {a: 2}, data);
  assert.equal(result.score, 1);
  assert.deepEqual(Object.values(result.assignments).map(x => x.length), [1, 1]);
  assert.equal(assignEmblems([unit('x')], {a: 2}, data).score, 0);
});

test('assignment finds a feasible distribution despite a constrained host', () => {
  const units = [unit('x', {a: 1}), unit('y', {b: 1})];
  const result = assignEmblems(units, {a: 1, b: 1}, data, {x: 2, y: 2});
  assert.equal(result.score, 2);
  assert.deepEqual(result.assignments, {x: ['b'], y: ['a']});
});

test('capacity conflicts choose the maximum number of activated traits', () => {
  const units = [unit('x', {a: 1, b: 1, c: 2}), unit('y')];
  const result = assignEmblems(units, {a: 1, b: 1, c: 1}, data, {x: 3, y: 2});
  assert.equal(result.score, 1);
  assert.equal(Object.values(result.assignments).flat().length, 1);
});

test('unused emblems do not fabricate a contribution or mutate source data', () => {
  const units = [unit('x', {a: 1})];
  const before = JSON.stringify(units);
  const result = assignEmblems(units, {a: 1, c: 1}, data);
  assert.equal(result.score, 0);
  assert.deepEqual(result.unused, {a: 1, c: 1});
  assert.equal(JSON.stringify(units), before);
});

test('rejects malformed emblem inventory', () => {
  for (const inventory of [{a: -1}, {a: 1.5}, {missing: 1}, {solo: 1}]) {
    assert.throws(() => assignEmblems([unit('x')], inventory, data));
  }
});

test('assignment agrees with independent brute force on small equipment problems', () => {
  const types = ['a', 'b'];
  for (let mask = 0; mask < 16; mask++) {
    const units = [unit('x', {a: mask & 1 ? 1 : 0, b: mask & 2 ? 1 : 0}),
      unit('y', {a: mask & 4 ? 1 : 0, b: mask & 8 ? 1 : 0})];
    let expected = 0;
    for (let first = -1; first < 2; first++) for (let second = -1; second < 2; second++) {
      if (first >= 0 && first === second) continue;
      const counts = {a: units.reduce((n, u) => n + (u.traits.a || 0), 0),
        b: units.reduce((n, u) => n + (u.traits.b || 0), 0)};
      let valid = true;
      for (const [i, emblem] of [first, second].entries()) {
        if (emblem < 0) continue;
        if (units[i].traits[types[emblem]]) valid = false;
        counts[types[emblem]]++;
      }
      if (valid) expected = Math.max(expected, Number(counts.a >= 2) + Number(counts.b >= 2));
    }
    assert.equal(assignEmblems(units, {a: 1, b: 1}, data, {x: 2, y: 2}).score, expected);
  }
});
