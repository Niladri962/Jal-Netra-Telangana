// Configurable regulatory & operational thresholds and parameter knowledge.
// Regulatory references: BIS IS 10500:2012 (Drinking Water — Specification), CPHEEO Manual on
// Water Supply and Treatment (2024 edition), WHO Guidelines for Drinking-water Quality (4th ed.).
// Operational thresholds (ORP, flow ratio, pressure) are illustrative defaults, not regulatory limits.

import type { Param, Severity, Thresholds } from './types';
import { clamp } from './rng';

export const DEFAULT_THRESHOLDS: Thresholds = {
  ph: { lowWarn: 6.5, lowCrit: 6.0, highWarn: 8.5, highCrit: 9.2 },
  tds: { warn: 500, crit: 2000 },
  turbidity: { warn: 1, crit: 5 },
  chlorine: { lowWarn: 0.2, lowCrit: 0.1, highWarn: 1.0, highCrit: 4.0 },
  orp: { lowWarn: 450, lowCrit: 300 },
  flowRatio: { warn: 0.7, crit: 0.4 },
  pressure: { lowWarn: 0.7, lowCrit: 0.3, highWarn: 6, highCrit: 8 },
  lpcdNorm: 100,
  lpcdWarnPct: 75,
  lpcdCritPct: 40,
  lossTolerancePct: 8,
  lossUncertaintyPct: 4,
  lossCritPct: 20,
  healthWarn: 40,
  healthCrit: 70,
  forecastDeficitPct: 20,
};

export interface ParamEval {
  severity: Severity;
  s: number; // 0..1 contribution intensity
  direction: 'low' | 'high' | 'ok';
}

function lowBand(v: number, warn: number, crit: number): ParamEval {
  if (v >= warn) {
    const near = clamp((warn * 1.4 - v) / (warn * 0.4), 0, 1);
    return { severity: 'normal', s: 0.12 * near, direction: 'ok' };
  }
  if (v >= crit) return { severity: 'warning', s: 0.4 + (0.3 * (warn - v)) / Math.max(1e-9, warn - crit), direction: 'low' };
  return { severity: 'critical', s: 0.75 + 0.25 * clamp((crit - v) / Math.max(1e-9, crit), 0, 1), direction: 'low' };
}

function highBand(v: number, warn: number, crit: number): ParamEval {
  if (v <= warn) return { severity: 'normal', s: 0.12 * clamp(v / warn, 0, 1) ** 3, direction: 'ok' };
  if (v <= crit) return { severity: 'warning', s: 0.4 + (0.3 * (v - warn)) / Math.max(1e-9, crit - warn), direction: 'high' };
  return { severity: 'critical', s: 0.75 + 0.25 * clamp((v - crit) / crit, 0, 1), direction: 'high' };
}

function both(v: number, t: { lowWarn: number; lowCrit: number; highWarn: number; highCrit: number }): ParamEval {
  const lo = lowBand(v, t.lowWarn, t.lowCrit);
  const hi = highBand(v, t.highWarn, t.highCrit);
  return lo.s >= hi.s ? lo : hi;
}

/** Evaluate one parameter against the configured thresholds. `baselineFlow` is needed for flow. */
export function evalParam(p: Param, v: number, t: Thresholds, baselineFlow = 100): ParamEval {
  switch (p) {
    case 'ph':
      return both(v, t.ph);
    case 'tds':
      return highBand(v, t.tds.warn, t.tds.crit);
    case 'turbidity':
      return highBand(v, t.turbidity.warn, t.turbidity.crit);
    case 'chlorine':
      return both(v, t.chlorine);
    case 'orp':
      return lowBand(v, t.orp.lowWarn, t.orp.lowCrit);
    case 'flow':
      return lowBand(v / Math.max(1e-6, baselineFlow), t.flowRatio.warn, t.flowRatio.crit);
    case 'pressure':
      return both(v, t.pressure);
  }
}

export const QUALITY_PARAMS: Param[] = ['ph', 'tds', 'turbidity', 'chlorine', 'orp'];
export const HYDRAULIC_PARAMS: Param[] = ['flow', 'pressure'];

export const RISK_WEIGHTS: Record<Param, number> = {
  chlorine: 28,
  turbidity: 24,
  ph: 14,
  tds: 10,
  orp: 6,
  flow: 10,
  pressure: 8,
};

export interface ParamInfo {
  label: string;
  short: string;
  unit: string;
  decimals: number;
  min: number;
  max: number;
  step: number;
  standard: string;
  low?: { title: string; meaning: string; causes: string[]; consequences: string[]; actions: string[] };
  high?: { title: string; meaning: string; causes: string[]; consequences: string[]; actions: string[] };
  category: 'Water quality' | 'Chemical safety' | 'Infrastructure';
}

export const PARAM_INFO: Record<Param, ParamInfo> = {
  ph: {
    label: 'pH',
    short: 'pH',
    unit: 'pH',
    decimals: 2,
    min: 3,
    max: 12,
    step: 0.05,
    category: 'Water quality',
    standard: 'BIS IS 10500:2012 — acceptable range 6.5–8.5 (no relaxation).',
    low: {
      title: 'Acidic pH',
      meaning: 'Water is more acidic than the BIS acceptable range.',
      causes: ['Over-dosing of acidic coagulant/chlorine gas at the WTP', 'Acidic groundwater blending', 'Sensor calibration drift'],
      consequences: ['Corrosion of pipes and fittings; possible leaching of metals', 'Reduced effectiveness of coagulation', 'Consumer complaints (metallic taste)'],
      actions: ['Verify with a calibrated field pH meter', 'Check chemical dosing at the treatment plant', 'Inspect lime/pH correction system', 'Collect confirmatory sample for laboratory analysis'],
    },
    high: {
      title: 'Alkaline pH',
      meaning: 'Water is more alkaline than the BIS acceptable range.',
      causes: ['Lime over-dosing', 'Cement-lined tank leaching (new tanks)', 'Source water change'],
      consequences: ['Chlorine disinfection becomes less effective at high pH (less HOCl)', 'Scaling of pipes and taps', 'Bitter/soapy taste'],
      actions: ['Verify pH with a calibrated meter', 'Review lime dosing and pH correction', 'Increase residual chlorine monitoring frequency', 'Collect confirmatory laboratory sample'],
    },
  },
  tds: {
    label: 'Total Dissolved Solids',
    short: 'TDS',
    unit: 'mg/L',
    decimals: 0,
    min: 0,
    max: 2000,
    step: 10,
    category: 'Water quality',
    standard: 'BIS IS 10500:2012 — acceptable limit 500 mg/L; permissible 2,000 mg/L in absence of an alternate source.',
    high: {
      title: 'Elevated TDS',
      meaning:
        'Dissolved mineral content is above the BIS acceptable limit. Elevated TDS is primarily a taste/acceptability and scaling concern — it is NOT by itself an indicator of acute toxicity. Specific ions (fluoride, nitrate, arsenic) must be tested separately.',
      causes: ['Groundwater blending or local borewell intrusion', 'Saline/mineralised source water', 'Cross-connection with untreated supply', 'Sensor fouling (conductivity probe)'],
      consequences: ['Brackish or salty taste — consumers may revert to unsafe alternate sources', 'Scaling of pipes, taps and household utensils', 'Possible presence of specific ions of health concern (requires lab testing)'],
      actions: ['Collect confirmatory sample for full chemical analysis (incl. fluoride, nitrate, hardness)', 'Investigate source and any borewell cross-connections', 'Clean/recalibrate conductivity probe', 'Inform consumers if confirmed above permissible limit'],
    },
  },
  turbidity: {
    label: 'Turbidity',
    short: 'Turb',
    unit: 'NTU',
    decimals: 2,
    min: 0,
    max: 50,
    step: 0.1,
    category: 'Water quality',
    standard: 'BIS IS 10500:2012 — acceptable 1 NTU; permissible 5 NTU. WHO: <1 NTU for effective disinfection.',
    high: {
      title: 'High turbidity',
      meaning: 'Suspended particles in the water are above limits. Particles can shield micro-organisms from chlorine and consume chlorine demand.',
      causes: ['Treatment failure (coagulation/filtration)', 'Pipe break or negative-pressure ingress', 'Source contamination after rainfall', 'Sediment disturbance in storage tanks'],
      consequences: ['Reduced disinfection effectiveness', 'Possible microbial contamination risk', 'Aesthetic complaints (cloudy water)'],
      actions: ['Collect confirmatory samples (turbidity + bacteriological)', 'Inspect WTP filtration and coagulation units', 'Check the distribution line for breaks or ingress', 'Flush affected mains and clean storage tank if required', 'Increase residual chlorine monitoring'],
    },
  },
  chlorine: {
    label: 'Free Residual Chlorine',
    short: 'FRC',
    unit: 'mg/L',
    decimals: 2,
    min: 0,
    max: 5,
    step: 0.01,
    category: 'Chemical safety',
    standard: 'BIS IS 10500:2012 — minimum 0.2 mg/L at consumer end (0.5 mg/L where protection against viral infection is required); CPHEEO guidance 0.2 mg/L at tail end. WHO guideline value 5 mg/L.',
    low: {
      title: 'Low residual chlorine',
      meaning: 'Residual chlorine has fallen below the configured operational minimum, so protection against re-contamination in the network is reduced.',
      causes: ['Chlorinator failure or empty hypochlorite stock', 'High chlorine demand (contamination or high turbidity)', 'Long residence time in storage', 'Sensor fault'],
      consequences: ['Reduced disinfection protection in the distribution network', 'Potential microbiological safety concern (not a confirmation of contamination)', 'Higher public-health surveillance priority'],
      actions: ['Verify residual chlorine with a DPD field test kit at tank and tail-end taps', 'Inspect chlorination equipment and hypochlorite stock', 'Collect bacteriological sample', 'If confirmed, restore dosing and flush lines; notify the designated public health officer'],
    },
    high: {
      title: 'High residual chlorine',
      meaning: 'Residual chlorine is above the BIS permissible level.',
      causes: ['Chlorinator over-dosing', 'Manual shock-dosing not flushed', 'Sensor calibration error'],
      consequences: ['Strong taste/odour; consumers may reject supply', 'Increased disinfection by-product formation potential'],
      actions: ['Verify with DPD test', 'Adjust dosing rate', 'Flush affected lines', 'Recalibrate sensor'],
    },
  },
  orp: {
    label: 'Oxidation-Reduction Potential',
    short: 'ORP',
    unit: 'mV',
    decimals: 0,
    min: 0,
    max: 900,
    step: 5,
    category: 'Water quality',
    standard: 'Operational indicator only (no BIS limit). ORP > ~650 mV is often associated with rapid inactivation; low ORP suggests weak oxidising capacity.',
    low: {
      title: 'Low ORP',
      meaning: 'Oxidising capacity of the water is low, consistent with weak disinfection.',
      causes: ['Low free chlorine', 'High organic/chlorine demand', 'High pH'],
      consequences: ['Supports the low-chlorine signal; not conclusive on its own'],
      actions: ['Cross-check with residual chlorine', 'Clean ORP electrode'],
    },
  },
  flow: {
    label: 'Water Flow',
    short: 'Flow',
    unit: 'L/min',
    decimals: 0,
    min: 0,
    max: 200,
    step: 1,
    category: 'Infrastructure',
    standard: 'Operational: compared to the node baseline (design) flow. Warning below 70%, critical below 40% (configurable).',
    low: {
      title: 'Reduced flow',
      meaning: 'Measured flow is well below the node baseline, so the village receives less water.',
      causes: ['Pipeline leakage upstream', 'Valve partially closed / blockage', 'Pump failure or power outage', 'Upstream supply reduction'],
      consequences: ['Lower daily supply and LPCD for the village', 'Possible supply deficit and equity impact', 'Low pressure can allow contaminant ingress'],
      actions: ['Compare upstream vs downstream flow (water balance)', 'Field inspection of the distribution main', 'Check pump status and power supply', 'Inspect valves'],
    },
  },
  pressure: {
    label: 'Water Pressure',
    short: 'Pres',
    unit: 'bar',
    decimals: 2,
    min: 0,
    max: 10,
    step: 0.05,
    category: 'Infrastructure',
    standard: 'Operational: residual pressure ~0.7 bar (7 m head) at ferrule points per CPHEEO guidance. Warning <0.7 or >6 bar (configurable).',
    low: {
      title: 'Low pressure',
      meaning: 'Network pressure is low. Combined with a water-balance gap it suggests leakage; on its own it can indicate supply interruption.',
      causes: ['Leak or burst', 'Pump failure', 'High simultaneous demand', 'Air locks'],
      consequences: ['Tail-end households receive little or no water', 'Risk of contaminant ingress during negative pressure events'],
      actions: ['Check for leaks along the segment', 'Verify pump operation', 'Inspect air valves'],
    },
    high: {
      title: 'High pressure',
      meaning: 'Pressure exceeds the safe operating range for the distribution network.',
      causes: ['Pressure-reducing valve failure', 'Sudden valve closure (water hammer)'],
      consequences: ['Pipe bursts and joint failures', 'Higher leakage rates'],
      actions: ['Inspect PRVs and surge protection', 'Operate valves slowly'],
    },
  },
};

export function fmt(p: Param, v: number) {
  const info = PARAM_INFO[p];
  return `${v.toFixed(info.decimals)} ${info.unit === 'pH' ? '' : info.unit}`.trim();
}

/** ORP is coupled to chlorine, pH and turbidity (simplified empirical relation, illustrative). */
export function orpFrom(chlorine: number, ph: number, turbidity: number) {
  return clamp(340 + 300 * Math.log10(1 + 8 * Math.max(0, chlorine)) - 40 * (ph - 7) - 4 * turbidity, 80, 880);
}

export function sevRank(s: Severity) {
  return s === 'critical' ? 2 : s === 'warning' ? 1 : 0;
}
export function worst(a: Severity, b: Severity): Severity {
  return sevRank(a) >= sevRank(b) ? a : b;
}
