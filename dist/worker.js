import { search } from './search.js';

let dataPromise;
self.onmessage = async ({data: request}) => {
  try {
    dataPromise ||= fetch('./data/s18.json').then(response => {
      if (!response.ok) throw new Error('赛季数据加载失败，请刷新后重试');
      return response.json();
    });
    const data = await dataPromise;
    let lastProgress=0;
    const result = search(data, request.input, {timeBudgetMs: request.timeBudgetMs ?? 5000,
      seed: request.seed, onProgress: result => {
        if(performance.now()-lastProgress<300)return;
        lastProgress=performance.now();
        self.postMessage({id: request.id, type: 'progress', result});
      }});
    self.postMessage({id: request.id, type: 'result', result});
  } catch (error) {
    self.postMessage({id: request.id, type: 'error', message: error.message || '计算失败，请调整条件后重试'});
  }
};
