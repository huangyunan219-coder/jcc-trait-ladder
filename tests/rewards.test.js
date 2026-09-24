import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {rewardForScore} from '../dist/rewards.js';

const rewards=JSON.parse(fs.readFileSync(new URL('../dist/data/s18-rewards.json',import.meta.url),'utf8'));

test('reward lookup uses the exact CN milestone without inventing lower-tier fallback',()=>{
  assert.equal(rewardForScore(10,rewards).label,'18金币');
  assert.equal(rewardForScore(10,rewards).verified,true);
  for(const score of [5,8,9,12,13,14,15,16,17]){
    const result=rewardForScore(score,rewards);
    assert.equal(result.verified,false);
    assert.match(result.label,/待核实/);
    assert.doesNotMatch(result.label,/18金币|冠冕/);
  }
  assert.equal(rewardForScore(null,rewards),null);
});

test('alternative rewards are separate options, never a guaranteed combined payout',()=>{
  const six=rewardForScore(6,rewards);
  assert.equal(six.verified,true);
  assert.match(six.label,/10金币.*或.*3个3费弈子/);
  assert.ok(six.notes.length>0);
  const eleven=rewardForScore(11,rewards);
  assert.match(eleven.label,/金铲铲冠冕.*或.*金锅锅冠冕.*或.*金锅铲冠冕/);
});

test('reward snapshot distinguishes evidence from missing data and carries sources',()=>{
  assert.deepEqual(rewards.tiers.map(t=>t.traits),Array.from({length:15},(_,i)=>i+2));
  for(const tier of rewards.tiers){
    if(tier.confidence==='high'){
      assert.equal(tier.exists,true);
      assert.ok(tier.reward || tier.possibleRewards?.length);
      assert.ok(tier.sourceUrls.length>0);
    }else{
      assert.equal(tier.reward,null);
      assert.equal(tier.exists,null);
    }
  }
  assert.equal(rewards.mechanics.grantTiming,null);
  assert.equal(rewards.mechanics.cumulativeLowerTiers,null);
});
