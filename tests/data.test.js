import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {search,prepareRoster} from '../dist/search.js';
import {evaluateBoard} from '../dist/engine.js';
const data=JSON.parse(fs.readFileSync(new URL('../dist/data/s18.json',import.meta.url),'utf8'));

test('S18 snapshot has unique IDs, complete references, real local icons and known special rules',()=>{
  assert.equal(data.counts.baseChampions,64);
  assert.equal(data.units.length,72);
  assert.equal(data.traits.filter(trait=>trait.countable).length,25);
  assert.equal(data.traits.filter(trait=>trait.emblem).length,20);
  assert.equal(new Set(data.units.map(unit=>unit.id)).size,data.units.length);
  assert.equal(new Set(data.traits.map(trait=>trait.id)).size,data.traits.length);
  assert.ok(!data.units.some(unit=>unit.name==='卡兹克'));
  const traitIds=new Set(data.traits.map(trait=>trait.id));
  for(const unit of data.units){
    assert.ok(Object.keys(unit.traits).every(id=>traitIds.has(id)));
    assert.ok(unit.cost>=1 && unit.cost<=5);
    assert.ok([1,2].includes(unit.slots));
    assert.ok(fs.existsSync(new URL('../dist/'+unit.icon,import.meta.url)));
  }
  for(const trait of data.traits){
    assert.ok(trait.breakpoints.length>0);
    assert.ok(trait.breakpoints.every((n,i)=>Number.isInteger(n)&&n>0&&(!i||n>trait.breakpoints[i-1])));
    assert.ok(fs.existsSync(new URL('../dist/'+trait.icon,import.meta.url)));
  }
  const dragon=data.units.find(unit=>unit.name==='远古巨龙');
  assert.equal(dragon.slots,2);
  assert.equal(dragon.traits['峡谷野怪'],2);
  assert.ok(data.units.filter(unit=>unit.form).every(unit=>unit.traits[unit.form]===2));
});

test('real 8/9/10 population recommendations respect mode, inventory, and independent score',()=>{
  const configurations=[{population:8,allowFiveCosts:false},{population:8,requireFiveCost:true},
    {population:9},{population:10,emblems:{'猎人':1,'法师':2}}];
  for(const input of configurations){
    const result=search(data,input,{timeBudgetMs:650});
    assert.ok(result.boards.length,'a real roster should yield a feasible board');
    const roster=prepareRoster(data,input).units;
    for(const board of result.boards){
      const units=board.unitIds.map(id=>roster.find(unit=>unit.id===id));
      assert.ok(units.every(Boolean));
      assert.equal(board.slots,input.population);
      assert.ok(!units.some(unit=>unit.name==='卡兹克'));
      if(input.allowFiveCosts===false)assert.ok(units.every(unit=>unit.cost<5));
      if(input.requireFiveCost)assert.ok(units.some(unit=>unit.cost===5));
      assert.equal(evaluateBoard(units,board.assignments,data).score,board.score);
      const used={};
      for(const id of Object.values(board.assignments).flat())used[id]=(used[id]||0)+1;
      for(const [id,count] of Object.entries(used))assert.ok(count<=(input.emblems?.[id]||0));
    }
  }
});
