/**
 * The whole calculation, in the order it runs.
 *
 *   1. Build three hourly curves — solar, heat pump, household
 *   2. Walk the year hour by hour, deciding where each kWh goes
 *   3. Apply a tariff to what was bought and sold
 *   4. Run all four kit options on both tariffs and compare
 *
 * All four options include the heat pump, "nothing" included, so a saving means "what
 * adding solar and/or a battery saves a home that already has one".
 *
 * Hourly rather than annual totals because solar peaks in summer and heating in winter,
 * because solar is worth 26p used now against 12p exported, and because a battery's
 * charge depends on every hour before it.
 */

import {
  BASE_TEMP_C,
  BASELOAD_SHAPES,
  BATTERY,
  BATTERY_INSTALL_GBP,
  SOLAR_INSTALL_GBP,
  DAYS_PER_MONTH,
  HOURS_PER_YEAR,
  HOUSE,
  Occupancy,
  SEASONAL_PERFORMANCE_FACTOR,
  TARIFFS,
  Tariff,
  USABLE_BATTERY_KWH,
} from './constants';
import { Weather } from './weather';

/** One value per hour of a year: always 8,760 entries. */
export type Hourly = number[];

const total = (values: number[]) => values.reduce((sum, v) => sum + v, 0);

// ---------------------------------------------------------------------------
// 1. Hourly curves
// ---------------------------------------------------------------------------

/** Household electricity each hour. Same daily shape all year — no weekday/weekend split. */
export function baseloadProfile(annualKwh: number, occupancy: Occupancy): Hourly {
  const shape = BASELOAD_SHAPES[occupancy]; // 24 relative weights
  const perDay = annualKwh / 365;
  const shapeTotal = total(shape);
  // Split each day's kWh across the hours in proportion to the weights.
  return hours((h) => (perDay * shape[h % 24]) / shapeTotal);
}

/**
 * Electricity the heat pump consumes each hour.
 *
 * Demand is proportional to how far the outdoor temperature falls below BASE_TEMP_C (the
 * "degree day" approach), scaled so the year totals the heat required divided by the heat
 * pump's efficiency. So the pattern comes from real weather and the total from a
 * heat-loss survey.
 *
 * No daily shape on top. The outdoor temperature already carries the daily cycle, so a
 * shape mirroring it would count that twice. A thermostat schedule is a separate thing,
 * and we assume a constant indoor target — reasonable for a heat pump, which is usually
 * run steady rather than set back overnight.
 */
export function heatPumpProfile(annualHeatKwh: number, outdoorTempC: Hourly): Hourly {
  // Degrees below the base temperature. Zero when it is mild enough to need no heating.
  const weights = hours((h) => Math.max(0, BASE_TEMP_C - outdoorTempC[h]));

  // Heat the house needs, converted to the electricity needed to deliver it.
  const annualElecKwh = annualHeatKwh / SEASONAL_PERFORMANCE_FACTOR;

  const weightTotal = total(weights);
  if (weightTotal === 0) return weights; // Never cold enough to need heating.
  // Spread the year's electricity across hours in proportion to how cold each one was.
  return weights.map((w) => (annualElecKwh * w) / weightTotal);
}

/** Solar generated each hour. PVGIS gives watts per kWp, and a row is an hour. */
export function generationProfile(weather: Weather, kwp: number, orientation: number): Hourly {
  return weather.wattsPerKwp.map((watts) => (watts / 1000) * kwp * orientation);
}

/** Collapse 8,760 hourly values into 12 monthly totals. */
export function monthlyTotals(hourly: Hourly): number[] {
  let hour = 0; // walks straight through the year, month by month
  return DAYS_PER_MONTH.map((days) => {
    let sum = 0;
    for (let i = 0; i < days * 24; i++) sum += hourly[hour++];
    return sum;
  });
}

/** Build a full year by calling valueAt() for each hour. */
function hours(valueAt: (hour: number) => number): Hourly {
  return Array.from({ length: HOURS_PER_YEAR }, (_, h) => valueAt(h));
}

// ---------------------------------------------------------------------------
// 2. The hourly loop
// ---------------------------------------------------------------------------

export interface EnergyFlows {
  generationKwh: number;
  /** Everything bought from the grid, including battery charging. */
  importedKwh: number;
  exportedKwh: number;
  /** Lost to battery round-trip inefficiency. */
  lossesKwh: number;
  /** Left in the battery when the year ends. */
  finalChargeKwh: number;
  importByHour: Hourly;
  exportByHour: Hourly;
}

/**
 * Priority each hour:
 *   1. Solar meets demand directly — avoids paying 26p rather than earning 12p
 *   2. Surplus solar charges the battery
 *   3. Grid charges the battery, if this hour is cheap
 *   4. Battery meets remaining demand — but NOT in an hour we just grid-charged in, since
 *      doing both buys electricity, loses 10% of it and hands it straight back
 *   5. Anything left is exported; anything still needed is imported
 *
 * `gridChargeHours` is a 24-hour mask the caller derives from the tariff, so this knows
 * when electricity is cheap without knowing what it costs. That keeps money out of here,
 * so one simulated year can be priced against several tariffs.
 */
export function simulate(
  generation: Hourly,
  demand: Hourly,
  hasBattery: boolean,
  gridChargeHours: boolean[],
): EnergyFlows {
  const importByHour: Hourly = new Array(HOURS_PER_YEAR).fill(0);
  const exportByHour: Hourly = new Array(HOURS_PER_YEAR).fill(0);
  const { powerKw, roundTripEfficiency: efficiency } = BATTERY;
  // Charging loses energy, so filling the remaining room draws more than the room.
  const drawToFill = (held: number) => (USABLE_BATTERY_KWH - held) / efficiency;

  let charge = 0; // kWh in the battery right now — the only state carried between hours
  let generationKwh = 0;
  let importedKwh = 0;
  let exportedKwh = 0;
  let lossesKwh = 0;

  for (let hour = 0; hour < HOURS_PER_YEAR; hour++) {
    let surplus = generation[hour]; // solar not yet spoken for
    let unmet = demand[hour]; // demand not yet met
    generationKwh += surplus;

    // 1. Solar straight to demand, capped by whichever of the two runs out first.
    const direct = Math.min(surplus, unmet);
    surplus -= direct;
    unmet -= direct;

    if (hasBattery) {
      // 2. Leftover solar into the battery, limited by charge rate and space left.
      const fromSolar = Math.max(0, Math.min(surplus, powerKw, drawToFill(charge)));
      charge += fromSolar * efficiency; // only what survives the round trip lands
      lossesKwh += fromSolar * (1 - efficiency);
      surplus -= fromSolar;

      if (gridChargeHours[hour % 24]) {
        // 3. Cheap hour: top up from the grid with whatever charge rate solar left over.
        const fromGrid = Math.max(0, Math.min(powerKw - fromSolar, drawToFill(charge)));
        charge += fromGrid * efficiency;
        lossesKwh += fromGrid * (1 - efficiency);
        importedKwh += fromGrid; // bought, but it serves demand later, not now
        importByHour[hour] += fromGrid;
      } else {
        // 4. Otherwise discharge to cover demand. Never in the same hour as step 3.
        const discharge = Math.max(0, Math.min(unmet, charge, powerKw));
        charge -= discharge; // discharge is one-for-one, the loss was taken on the way in
        unmet -= discharge;
      }
    }

    // 5. Settle up with the grid: buy the shortfall, sell the leftover.
    importedKwh += unmet;
    importByHour[hour] += unmet;
    exportedKwh += surplus;
    exportByHour[hour] = surplus;
  }

  return {
    generationKwh,
    importedKwh,
    exportedKwh,
    lossesKwh,
    finalChargeKwh: charge,
    importByHour,
    exportByHour,
  };
}

// ---------------------------------------------------------------------------
// 3. Money
// ---------------------------------------------------------------------------

/**
 * Hours the battery should charge from the grid: those at the cheapest rate. Charging
 * whenever the price is below the day's average would pick the same hours for these
 * tariffs, so the simple rule costs nothing.
 *
 * All-false when the price never changes — on a flat tariff, shifting electricity through
 * time earns nothing and loses the round-trip.
 */
export function gridChargeHours(tariff: Tariff): boolean[] {
  const cheapest = Math.min(...tariff.ratesPerKwh);
  // One price all day, so there is nothing to shift.
  if (cheapest === Math.max(...tariff.ratesPerKwh)) return new Array(24).fill(false);
  return tariff.ratesPerKwh.map((rate) => rate === cheapest);
}

/** Annual cost: what was imported, less what was earned exporting. */
export function priceFlows(flows: EnergyFlows, tariff: Tariff): number {
  let cost = 0;
  for (let hour = 0; hour < HOURS_PER_YEAR; hour++) {
    cost += flows.importByHour[hour] * tariff.ratesPerKwh[hour % 24]; // rate for this hour
    cost -= flows.exportByHour[hour] * tariff.exportRatePerKwh; // one flat export rate
  }
  return cost;
}

// ---------------------------------------------------------------------------
// 4. Compare the options
// ---------------------------------------------------------------------------

export type Kit = 'nothing' | 'battery' | 'solar' | 'solarAndBattery';

export interface Scenario {
  kit: Kit;
  tariffId: string;
  tariffName: string;
  annualCostGbp: number;
  /** Against the baseline: this home, flat tariff, no solar, no battery. Negative means
   *  the option costs more than doing nothing. */
  annualSavingGbp: number;
  installCostGbp: number;
  /** Undefined when the option saves nothing, so never pays back. */
  paybackYears?: number;
}

export interface Results {
  /** What the household pays today. Every saving is measured against this. */
  baselineCostGbp: number;
  /** Every kit option against every tariff. */
  scenarios: Scenario[];
  /** 12 values each. Nearly inverted across the year. */
  monthly: { generationKwh: number[]; heatPumpKwh: number[] };
  annual: { generationKwh: number; heatPumpKwh: number; baseloadKwh: number };
}

const NEVER = new Array(24).fill(false);

/** Anything the caller may vary. Everything else comes from HOUSE. */
export interface Options {
  annualHeatKwh?: number;
  annualBaseloadKwh?: number;
  occupancy?: Occupancy;
  orientationFactor?: number;
}

/** Every option includes the heat pump, the baseline too. See the note at the top. */
export function runScenarios(weather: Weather, options: Options = {}): Results {
  const {
    annualHeatKwh = HOUSE.annualHeatKwh,
    annualBaseloadKwh = HOUSE.annualBaseloadKwh,
    occupancy = HOUSE.occupancy,
    orientationFactor = HOUSE.orientationFactor,
  } = options;

  // Demand is the same in every option, so build it once.
  const heatPump = heatPumpProfile(annualHeatKwh, weather.outdoorTempC);
  const baseload = baseloadProfile(annualBaseloadKwh, occupancy);
  const demand = baseload.map((kwh, hour) => kwh + heatPump[hour]);

  const generation = generationProfile(weather, HOUSE.kwp, orientationFactor);
  const noGeneration: Hourly = new Array(HOURS_PER_YEAR).fill(0);

  // The one fixed reference point: this house on the flat tariff with no kit.
  const baselineCostGbp = priceFlows(simulate(noGeneration, demand, false, NEVER), TARIFFS[0]);

  const scenarios: Scenario[] = [];

  for (const tariff of TARIFFS) {
    const cheapHours = gridChargeHours(tariff); // empty for a flat tariff

    const kits: [Kit, Hourly, boolean, number][] = [
      ['nothing', noGeneration, false, 0],
      ['battery', noGeneration, true, BATTERY_INSTALL_GBP],
      ['solar', generation, false, SOLAR_INSTALL_GBP],
      ['solarAndBattery', generation, true, SOLAR_INSTALL_GBP + BATTERY_INSTALL_GBP],
    ];

    for (const [kit, gen, hasBattery, installCostGbp] of kits) {
      const annualCostGbp = priceFlows(simulate(gen, demand, hasBattery, cheapHours), tariff);
      const annualSavingGbp = baselineCostGbp - annualCostGbp;
      scenarios.push({
        kit,
        tariffId: tariff.id,
        tariffName: tariff.name,
        annualCostGbp,
        annualSavingGbp,
        installCostGbp,
        paybackYears: annualSavingGbp > 0 ? installCostGbp / annualSavingGbp : undefined,
      });
    }
  }

  return {
    baselineCostGbp,
    scenarios,
    monthly: {
      generationKwh: monthlyTotals(generation),
      heatPumpKwh: monthlyTotals(heatPump),
    },
    annual: {
      generationKwh: total(generation),
      heatPumpKwh: total(heatPump),
      baseloadKwh: total(baseload),
    },
  };
}
