import test from 'node:test';
import assert from 'node:assert/strict';
import { search, prepareRoster } from '../dist/search.js';
import { evaluateBoard } from '../dist/engine.js';

const traits = ['a', 'b', 'c'].map(id => ({id, name:id, breakpoints:[2], countable:true, emblem:true}));
const unit = (id, ids, cost = 1, slots = 1) => ({id, baseId:id, name:id, cost, slots,
  traits:Object.fromEntries(ids.map(id => [id, 1]))});
const data = {traits, units: [unit('ab',['a','b']),unit('ac',['a','c']),unit('bc',['b','c']),
  unit('a',['a']),unit('b',['b']),unit('dragon',['c'],5,2)]};

function bruteForce(population, emblemCount) {
  let best = 0;
  for (let mask = 1; mask < 1 << data.units.length; mask++) {
    const board = data.units.filter((_, i) => mask & (1 << i));
    if (board.reduce((n,u) => n+u.slots,0)>population) continue;
    const counts = Object.fromEntries(traits.map(t => [t.id,board.reduce((n,u)=>n+(u.traits[t.id]||0),0)]));
    const hosts = board.filter(u => !u.traits.a).length;
    counts.a += Math.min(emblemCount, hosts);
    best = Math.max(best,Object.values(counts).filter(n=>n>=2).length);
  }
  return best;
}

test('exact search agrees with independent complete enumeration', () => {
  for (const population of [2,3,4]) for (const emblemCount of [0,1,2]) {
    const result = search(data,{population,emblems:{a:emblemCount}},{timeBudgetMs:3000});
    assert.equal(result.complete,true);
    assert.equal(result.boards[0].score,bruteForce(population,emblemCount));
    for (const board of result.boards) {
      assert.equal(board.slots, population);
      const units = board.unitIds.map(id=>data.units.find(u=>u.id===id));
      assert.equal(evaluateBoard(units,board.assignments,data).score,board.score);
    }
  }
});

test('lock/exclude/five-cost constraints hold on every recommendation', () => {
  const result = search(data,{population:3,locked:['a'],excluded:['ab'],allowFiveCosts:false},{timeBudgetMs:3000});
  assert.ok(result.boards.length);
  for (const board of result.boards) {
    assert.ok(board.unitIds.includes('a'));
    assert.ok(!board.unitIds.includes('ab'));
    assert.ok(!board.unitIds.includes('dragon'));
  }
});

test('reports impossible or malformed input instead of silently dropping constraints', () => {
  for (const input of [{population:1,locked:['dragon']}, {population:3,locked:['a'],excluded:['a']},
    {population:3,locked:['ghost']}, {population:3,emblems:{missing:1}}, {population:NaN}]) {
    assert.throws(()=>search(data,input,{timeBudgetMs:3000}));
  }
});

test('a time limit is not a proof of optimality or infeasibility', () => {
  const result = search(data,{population:3},{timeBudgetMs:0});
  assert.equal(result.complete,false);
});

test('KhaZix is excluded from every search, and at most one Lux form may be fielded', () => {
  const special = {...data, special:{khazix:'khazix',lux:'lux'},
    units:[...data.units,{...unit('khazix',['a','b','c'],3),name:'卡兹克'},
      {...unit('lux-a',['a'],5),baseId:'lux',form:'a'},
      {...unit('lux-b',['b'],5),baseId:'lux',form:'b'}]};
  const before = JSON.stringify(special);
  const roster = prepareRoster(special,{population:3,luxForm:'b'});
  assert.ok(!roster.units.some(u=>u.id==='khazix'));
  assert.ok(!roster.units.some(u=>u.id==='lux-a'));
  const result = search(special,{population:3,locked:['lux']},{timeBudgetMs:3000});
  assert.ok(result.boards.every(b=>b.unitIds.filter(id=>id.startsWith('lux-')).length===1));
  assert.ok(result.boards.every(b=>!b.unitIds.includes('khazix')));
  assert.throws(()=>search(special,{population:3,locked:['khazix']}));
  assert.equal(JSON.stringify(special),before);
});

test('with-five-cost mode must actually include at least one five-cost unit', () => {
  const result = search(data,{population:3,requireFiveCost:true},{timeBudgetMs:3000});
  assert.ok(result.boards.length);
  assert.ok(result.boards.every(board=>board.unitIds.includes('dragon')));
  assert.throws(()=>search(data,{population:3,requireFiveCost:true,allowFiveCosts:false}));
});
