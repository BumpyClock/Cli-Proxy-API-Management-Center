import fs from 'node:fs/promises';

const round = Number(process.argv[2]);
if (!Number.isInteger(round) || round < 1 || round > 6) throw new Error('Round must be 1-6');
const metrics = ['design_coherence', 'typography', 'cleanliness', 'visual_design', 'ease_of_use', 'information_hierarchy', 'spacing_alignment', 'navigation_wayfinding', 'responsive_mobile', 'accessibility_visible', 'data_visualization', 'interaction_affordance'];
let bundle;
try { bundle = JSON.parse(await fs.readFile(`design-review/council/round-${round}/reviews.json`, 'utf8')); } catch (cause) { throw new Error('Cannot read raw council reviews', { cause }); }
const reviews = [];
for (const model of ['sol', 'muse', 'opus']) {
  const raw = bundle[model];
  if (typeof raw !== 'string') throw new Error(`Missing raw transcript for ${model}`);
  const start = raw.indexOf('{');
  let review;
  for (let end = raw.lastIndexOf('}'); end > start; end--) {
    try { review = JSON.parse(raw.slice(start, end + 1)); break; } catch { /* Try the next JSON object boundary in prose. */ }
  }
  if (!review || Number(review.round) !== round) throw new Error(`Invalid round in ${model}`);
  review.round = round;
  for (const key of metrics) {
    if (typeof review.scores?.[key] !== 'number' || review.scores[key] < 0 || review.scores[key] > 10) throw new Error(`Invalid ${model} score ${key}`);
  }
  if (Object.keys(review.scores).length !== metrics.length) throw new Error(`Unexpected metrics in ${model}`);
  const overallCalculated = metrics.reduce((sum, key) => sum + review.scores[key], 0) / metrics.length;
  reviews.push({ model, ...review, overallCalculated });
}
const councilMean = reviews.reduce((sum, review) => sum + review.overallCalculated, 0) / reviews.length;
const metricMeans = Object.fromEntries(metrics.map(key => [key, reviews.reduce((sum, review) => sum + review.scores[key], 0) / reviews.length]));
const result = { round, councilMean, metricMeans, reviews };
await fs.writeFile(`design-review/council/round-${round}/results.json`, JSON.stringify(result, null, 2) + '\n');
const statePath = 'design-review/council/state.json';
let state;
try { state = JSON.parse(await fs.readFile(statePath, 'utf8')); } catch (cause) { throw new Error('Cannot read council state', { cause }); }
const summary = { round, mean: councilMean, ...Object.fromEntries(reviews.map(review => [review.model, review.overallCalculated])) };
state.rounds = [...state.rounds.filter(item => item.round !== round), summary].sort((a, b) => a.round - b.round);
state.completedRound = round;
state.phase = councilMean >= state.target || round >= state.maxRounds ? 'final-verification' : 'implementation';
await fs.writeFile(statePath, JSON.stringify(state, null, 2) + '\n');
console.log(JSON.stringify({ ...summary, phase: state.phase }, null, 2));
