/** Exact milestone only: unknown tiers must not inherit a lower verified payout. */
export function rewardForScore(score, data) {
  if (!Number.isInteger(score) || score<0) return null;
  const tier=data.tiers.find(item=>item.traits===score);
  if (!tier || tier.confidence!=='high' || tier.exists!==true) {
    return {verified:false,label:'国服奖励待核实',notes:'待核实不代表没有奖励；该档奖励与发放条件尚缺可靠来源。',sourceUrls:[]};
  }
  return {
    verified:true,
    label:tier.reward || tier.possibleRewards.join(' 或 '),
    notes:tier.notes || '国服公告所列档位奖励，实际发放按游戏内条件结算。',
    sourceUrls:tier.sourceUrls,
  };
}
