// Headless end-to-end test of the simulation engine (run: npm run test:engine)
import { useStore } from '../src/store';
import { answerLocal } from '../src/engine/assistant';

const S = () => useStore.getState();
let fails = 0;
const check = (cond: boolean, msg: string) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fails++; };

const k = S().derived.kpi;
console.log(`Dataset: ${k.villages} villages, ${k.sensors} nodes, ${k.population} people, ${k.supplyMLD} MLD, ${k.avgLpcd} LPCD`);
console.log(`Initial active alerts: ${S().alerts.filter(a => a.status === 'active').length}`);
check(S().sim.districts.length === 33, '33 districts');
check(k.villages >= 100, '>=100 villages');

const vid = S().plan.featuredVillageId;
const v = S().sim.villages[vid];
const tap = v.nodeIds[v.nodeIds.length - 1];
check(S().derived.villages[vid].status === 'normal', `featured village ${v.name} starts normal`);
const risk0 = S().derived.villages[vid].qualityRisk, health0 = S().derived.villages[vid].healthPriority;

const tests: [string, number, string][] = [
  ['chlorine', 0.05, 'Low residual chlorine'],
  ['turbidity', 15, 'High turbidity'],
  ['tds', 1200, 'Elevated TDS'],
  ['ph', 9.6, 'Alkaline pH'],
  ['flow', 25, 'Sudden flow drop'],
  ['pressure', 0.2, 'Low pressure'],
];
for (const [p, val, title] of tests) {
  const base = S().sim.nodes[tap].current[p as 'ph'];
  S().setParam(tap, p as any, val);
  const act = S().alerts.filter(a => a.status === 'active' && a.nodeId === tap && a.param === p);
  check(act.length === 1 && act[0].title.startsWith(title), `${p} ${base} -> ${val}: alert "${act[0]?.title}" severity=${act[0]?.severity} prev=${act[0]?.prevValue}`);
  if (p === 'chlorine') {
    const vd = S().derived.villages[vid];
    check(vd.status === 'critical', `village status red (${vd.status})`);
    check(vd.qualityRisk > risk0, `risk ${risk0} -> ${vd.qualityRisk}`);
    check(vd.healthPriority > health0, `health priority ${health0} -> ${vd.healthPriority} (${vd.healthStatus})`);
    const ans = answerLocal(`Why is ${v.name} showing a red alert?`, { state: S().sim, derived: S().derived, alerts: S().alerts, th: S().thresholds, fc: S().forecast });
    check(/chlorine/i.test(ans.text), 'assistant explains chlorine');
    console.log('---\n' + ans.text.slice(0, 600) + '\n---');
  }
  S().restoreNode(tap, [p as any]);
  const still = S().alerts.filter(a => a.status === 'active' && a.nodeId === tap && a.param === p);
  check(still.length === 0, `${p} restored -> alert auto-resolved`);
}
check(S().derived.villages[vid].status === 'normal', 'featured village back to normal');

// Flow on inlet should create a water-balance alert on the distribution main
const inlet = v.nodeIds[0];
S().setParam(inlet, 'flow', S().sim.nodes[inlet].baseline.flow * 0.6);
const seg = S().derived.segments[`seg-d-${vid}`];
check(seg.classification !== 'normal', `inlet flow -40% -> segment ${seg.classification} ${seg.lossPct}% (${seg.color})`);
S().setParam(inlet, 'pressure', S().sim.nodes[inlet].baseline.pressure * 0.5);
check(S().derived.segments[`seg-d-${vid}`].classification === 'leak', `with low pressure -> ${S().derived.segments[`seg-d-${vid}`].classification}`);
S().restoreNode(inlet);
check(S().derived.segments[`seg-d-${vid}`].classification === 'normal', 'restored -> segment normal');

// Population / equity
const eq0 = S().derived.villages[vid].equityScore;
S().setPopulation(vid, v.population * 3);
check(S().derived.villages[vid].equityScore < eq0, `population x3: equity ${eq0} -> ${S().derived.villages[vid].equityScore}, lpcd ${S().derived.villages[vid].lpcd}`);
S().restoreVillage(vid);

// Forecast responds
const d0 = S().derived.villages[vid].forecast.avg7Demand;
S().setForecast({ temperatureC: 42, lpcd: 135 });
check(S().derived.villages[vid].forecast.avg7Demand > d0, `forecast ${d0} -> ${S().derived.villages[vid].forecast.avg7Demand} kL/d`);

// Events + ticks
S().addEvent('main-burst', 'nlg');
check(S().derived.segments['seg-t-nlg'].severity !== 'normal', `main burst -> ${S().derived.segments['seg-t-nlg'].classification}`);
for (let i = 0; i < 100; i++) S().tick();
console.log(`After 100 ticks: active alerts ${S().alerts.filter(a => a.status === 'active').length}, history ${S().alerts.length}`);
for (const q of ['Which villages currently have abnormal water quality?', 'Which district has the highest water supply deficit?', 'What should an operator do when chlorine levels drop?', 'Which villages have high turbidity?', 'Show water supply performance for the last 30 days', 'Which villages have the lowest water equity scores?', 'Is there a possible relationship between water quality and diarrhoeal cases?', 'Which pipeline segments require immediate inspection?', 'What is the projected water demand for the next 30 days?']) {
  const a = answerLocal(q, { state: S().sim, derived: S().derived, alerts: S().alerts, th: S().thresholds, fc: S().forecast });
  console.log(`Q: ${q}\n   -> ${a.text.split('\n')[0]}`);
}
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
