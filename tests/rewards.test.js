import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {rewardForScore} from '../dist/rewards.js';

const rewards=JSON.parse(fs.readFileSync(new URL('../dist/data/s18-rewards.json',import.meta.url),'utf8'));

test('every reward from 2 through 16 matches the supplied table',()=>{
  const expected=[
    '1 金币 + 装备重铸器','3 金币','6 金币','随机基础装备散件',
    '10 金币 或 3 张三费卡','8 金币 + 组件锤',
    '2 随机散件 + 重铸器 或 成装锻造器','2 金币 + 3 张五费卡',
    '25 金币','光明装备箱 + 2 张四费卡','冠冕三选一',
    '光明装备宝箱 / 光明偷偷 + 拆卸器','3 个杰作升级','3 件杰作升级','3 件光明装备',
  ];
  assert.deepEqual(rewards.tiers.map(t=>t.traits),expected.map((_,i)=>i+2));
  expected.forEach((label,index)=>{
    assert.deepEqual(rewardForScore(index+2,rewards),{available:true,label});
  });
});

test('unlisted scores do not inherit another tier reward',()=>{
  for(const score of [0,1,17,25]){
    assert.deepEqual(rewardForScore(score,rewards),{available:false,label:'暂无对应档位奖励'});
  }
  for(const score of [null,undefined,-1,2.5,NaN,'10']) assert.equal(rewardForScore(score,rewards),null);
});

test('alternative rewards remain alternatives and do not become a combined payout',()=>{
  assert.match(rewardForScore(6,rewards).label,/金币 或/);
  assert.match(rewardForScore(8,rewards).label,/重铸器 或 成装/);
  assert.match(rewardForScore(13,rewards).label,/宝箱 \/ 光明偷偷/);
});
