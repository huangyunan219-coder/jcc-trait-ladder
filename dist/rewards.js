/** Match an exact milestone; never substitute another tier's reward. */
export function rewardForScore(score, data) {
  if (!Number.isInteger(score) || score<0) return null;
  const tier=data.tiers.find(item=>item.traits===score);
  return tier
    ? {available:true,label:tier.reward}
    : {available:false,label:'暂无对应档位奖励'};
}
