/**
 * The whole calculation, in the order it runs.
 *
 *   1. Build three hourly curves — solar, heat pump, household
 *   2. Walk the year hour by hour, deciding where each kWh goes
 *   3. Apply a tariff to what was bought and sold
 *   4. Run all four kit options on both tariffs and compare
 *
 * The heat pump is being installed either way, so every option includes it, "nothing"
 * included. A saving is therefore what solar and/or a battery add to that install.
 *
 * Hourly rather than annual totals: solar peaks in summer and heating in winter, solar is
 * worth more used than exported, and a battery depends on every hour before it.
 */

import {
  BASE_TEMP_C,
  BASELOAD_SHAPES,
  BATTERY,
  BATTERY_INSTALL_COST,
  SOLAR_INSTALL_COST,
  HOURS_PER_YEAR,
  HOUSE,
  Occupancy,
  SEASONAL_PERFORMANCE_FACTOR,
  TARIFFS,
  Tariff,
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
 * Electricity the heat pump consumes each hour. Demand is proportional to how far the
 * outdoor temperature falls below BASE_TEMP_C — the "degree day" approach — so the shape
 * comes from real weather and the total from the heat-loss figure.
 *
 * The house is taken to be exactly on temperature every hour, so only the loss is worked
 * out. Nothing tracks how warm it actually is: no drifting down once the heating stops,
 * and no cost to warming it back up.
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

/** Solar generated each hour. PVGIS gives watts per kWp (kilowatt-peak, the array's rated
 *  size), and a row is an hour, so watts / 1000 is that hour's kWh per kWp. */
export function generationProfile(weather: Weather, kwp: number, orientation: number): Hourly {
  return weather.wattsPerKwp.map((watts) => (watts / 1000) * kwp * orientation);
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
  const { usableKwh, maxKwhPerHour, roundTripEfficiency: efficiency } = BATTERY;
  // How much to pull in to fill the battery — more than the empty space, since only 90%
  // of what goes in survives the trip. 2.5 kWh of room needs 2.78 kWh drawn.
  const drawNeededToFill = (held: number) => (usableKwh - held) / efficiency;

  let stored = 0; // kWh in the battery — the only state carried between hours
  let generationKwh = 0;
  let importedKwh = 0;
  let exportedKwh = 0;
  let lossesKwh = 0;

  // Each hour, two running remainders shrink as the steps below account for them.
  for (let hour = 0; hour < HOURS_PER_YEAR; hour++) {
    let unusedSolar = generation[hour];
    let unmetDemand = demand[hour];
    generationKwh += unusedSolar;

    // 1. Solar straight to demand, capped by whichever of the two runs out first.
    const direct = Math.min(unusedSolar, unmetDemand);
    unusedSolar -= direct;
    unmetDemand -= direct;

    if (hasBattery) {
      // 2. Leftover solar into the battery. Whichever runs out first: the solar, the
      //    charge rate, or the space. (max(0) is floating-point dust, not a real case.)
      const fromSolar = Math.max(
        0,
        Math.min(unusedSolar, maxKwhPerHour, drawNeededToFill(stored)),
      );
      stored += fromSolar * efficiency; // only what survives the round trip lands
      lossesKwh += fromSolar * (1 - efficiency);
      unusedSolar -= fromSolar;

      if (gridChargeHours[hour % 24]) {
        // 3. Cheap hour: top up from the grid with whatever charge rate solar left over.
        const fromGrid = Math.max(
          0,
          Math.min(maxKwhPerHour - fromSolar, drawNeededToFill(stored)),
        );
        stored += fromGrid * efficiency;
        lossesKwh += fromGrid * (1 - efficiency);
        importedKwh += fromGrid; // bought, but it serves demand later, not now
        importByHour[hour] += fromGrid;
      } else {
        // 4. Otherwise discharge to cover demand. Never in the same hour as step 3.
        const discharge = Math.max(0, Math.min(unmetDemand, stored, maxKwhPerHour));
        stored -= discharge; // one-for-one: the loss was taken on the way in
        unmetDemand -= discharge;
      }
    }

    // 5. Settle up with the grid: buy the shortfall, sell the leftover.
    importedKwh += unmetDemand;
    importByHour[hour] += unmetDemand;
    exportedKwh += unusedSolar;
    exportByHour[hour] = unusedSolar;
  }

  return {
    generationKwh,
    importedKwh,
    exportedKwh,
    lossesKwh,
    finalChargeKwh: stored,
    importByHour,
    exportByHour,
  };
}

// ---------------------------------------------------------------------------
// 3. Money
// ---------------------------------------------------------------------------

/**
 * Hours the battery should charge from the grid: those at the cheapest rate. All-false on
 * a flat tariff, where shifting electricity through time earns nothing.
 */
export function gridChargeHours(tariff: Tariff): boolean[] {
  const cheapest = Math.min(...tariff.ratesPerKwh);
  // One price all day, so there is nothing to shift.
  if (cheapest === Math.max(...tariff.ratesPerKwh)) return new Array(24).fill(false);
  return tariff.ratesPerKwh.map((rate) => rate === cheapest);
}

/** Annual cost: what was imported, minus what was earned exporting. */
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
  annualCost: number;
  /** Against the baseline: this home, flat tariff, no solar, no battery. Negative means
   *  the option costs more than doing nothing. */
  annualSaving: number;
  installCost: number;
  /** Undefined when the option saves nothing, so never pays back. */
  paybackYears?: number;
}

export interface Results {
  /** This home once the heat pump is in, on the standard tariff, with no solar or
   *  battery. Savings measure against the total. Splits cleanly, since with no solar or
   *  battery every kWh of demand is simply bought at that hour's rate. */
  baseline: { total: number; heatPump: number; household: number };
  /** Every kit option against every tariff. */
  scenarios: Scenario[];
}

const NEVER = new Array(24).fill(false);

/** Overrides for HOUSE. Anything omitted falls back to it. */
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
    orientationFactor = HOUSE.orientation.factor,
  } = options;

  // Demand is the same in every option, so build it once.
  const heatPump = heatPumpProfile(annualHeatKwh, weather.outdoorTempC);
  const baseload = baseloadProfile(annualBaseloadKwh, occupancy);
  const demand = baseload.map((kwh, hour) => kwh + heatPump[hour]);

  const generation = generationProfile(weather, HOUSE.kwp, orientationFactor);
  const noGeneration: Hourly = new Array(HOURS_PER_YEAR).fill(0);

  // The one fixed reference point: this house on the flat tariff with no kit.
  const billFor = (profile: Hourly) =>
    priceFlows(simulate(noGeneration, profile, false, NEVER), TARIFFS[0]);
  const baseline = {
    total: billFor(demand),
    heatPump: billFor(heatPump),
    household: billFor(baseload),
  };

  const scenarios: Scenario[] = [];

  for (const tariff of TARIFFS) {
    const cheapHours = gridChargeHours(tariff); // false for flat, otherwise true for cheapest-only

    const kits: [Kit, Hourly, boolean, number][] = [
      ['nothing', noGeneration, false, 0],
      ['battery', noGeneration, true, BATTERY_INSTALL_COST],
      ['solar', generation, false, SOLAR_INSTALL_COST],
      ['solarAndBattery', generation, true, SOLAR_INSTALL_COST + BATTERY_INSTALL_COST],
    ];

    for (const [kit, gen, hasBattery, installCost] of kits) {
      const annualCost = priceFlows(simulate(gen, demand, hasBattery, cheapHours), tariff);
      const annualSaving = baseline.total - annualCost;
      scenarios.push({
        kit,
        tariffId: tariff.id,
        tariffName: tariff.name,
        annualCost,
        annualSaving,
        installCost,
        paybackYears: annualSaving > 0 ? installCost / annualSaving : undefined,
      });
    }
  }

  return { baseline, scenarios };
}
