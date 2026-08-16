/**
 * Every number the calculation uses, with its source.
 *
 * These all have to be defensible to a homeowner or an installer, so nothing here is a
 * guess without saying so.
 */

/** 365 x 24. Every hourly array in the system is this long. */
export const HOURS_PER_YEAR = 8760;

// ---------------------------------------------------------------------------
// Tariffs — data, not types. Adding a real one is data entry, not a code change.
// ---------------------------------------------------------------------------

export interface Tariff {
  id: string;
  name: string;
  /** Paid per kWh sold back to the grid. Always well below the import price, which is
   *  why using your own solar beats exporting it. */
  exportRatePerKwh: number;
  /** Import price for each hour of the day. 24 entries, midnight first. */
  ratesPerKwh: number[];
}

/** Source: Ofgem price cap, 1 July - 30 September 2026. */
const CAP_RATE = 0.2611;

export const FLAT_TARIFF: Tariff = {
  id: 'flat',
  name: 'Standard variable (price cap)',
  exportRatePerKwh: 0.12,
  ratesPerKwh: new Array(24).fill(CAP_RATE),
};

/**
 * Price changes through the day: cheap overnight and midday, expensive late afternoon.
 * Shape is typical of UK heat-pump tariffs; rates are indicative, not a real product.
 */
const CHEAP = 0.1453;
const MID = 0.3328;
const PEAK = 0.5168;

export const TIME_OF_USE_TARIFF: Tariff = {
  id: 'tou',
  name: 'Time-of-use (heat pump tariff)',
  exportRatePerKwh: 0.15,
  ratesPerKwh: [
    MID, MID, MID, MID, //       00:00 - 04:00
    CHEAP, CHEAP, CHEAP, //      04:00 - 07:00  cheap
    MID, MID, MID, MID, MID, MID, //  07:00 - 13:00
    CHEAP, CHEAP, CHEAP, //      13:00 - 16:00  cheap
    PEAK, PEAK, PEAK, //         16:00 - 19:00  peak
    MID, MID, MID, //            19:00 - 22:00
    CHEAP, CHEAP, //             22:00 - 24:00  cheap
  ],
};

export const TARIFFS = [FLAT_TARIFF, TIME_OF_USE_TARIFF];

// ---------------------------------------------------------------------------
// The house and its equipment
// ---------------------------------------------------------------------------

/**
 * Heat delivered per unit of electricity consumed, averaged over a year. 11,000 kWh of
 * heat therefore costs 11,000 / 2.8 kWh of electricity.
 *
 * Source: ~2.8 is the median measured across real UK heat pump installations.
 *
 * Simplification: real efficiency drops on cold days, exactly when the pump runs hardest.
 * Modelling that hour by hour moved every headline figure by under 1%, so this is a flat
 * average.
 */
export const SEASONAL_PERFORMANCE_FACTOR = 2.8;

/**
 * Outdoor temperature above which a UK house needs no heating. Below it, heat demand is
 * proportional to how far below we are.
 *
 * Source: the base temperature MCS and CIBSE Guide A use for UK degree days. Below a
 * comfortable 19-21 C because occupants, cooking and sunlight supply the rest.
 */
export const BASE_TEMP_C = 15.5;

/**
 * How much of the day the property is occupied. Definitions are MCS MGD 003 archetypes:
 *   HOME_ALL_DAY  someone is in between 9am and 5pm on weekdays
 *   IN_HALF_DAY   empty for half the day, either all morning or all afternoon
 *   OUT_ALL_DAY   typically empty on weekdays
 */
export type Occupancy = 'HOME_ALL_DAY' | 'IN_HALF_DAY' | 'OUT_ALL_DAY';

export const HOUSE = {
  /** Household electricity excluding the heat pump: lights, fridge, appliances.
   *  Source: MCS MGD 003 documented fallback. */
  annualBaseloadKwh: 3500,

  /** Heat DELIVERED per year, not electricity consumed. Typical UK 3-bed semi.
   *  Weakest-sourced number here: real houses run from ~8,000 (well insulated) to
   *  ~18,000 (solid wall Victorian), and this scales the heat pump linearly. */
  annualHeatKwh: 11000,

  /** Used when the household's actual pattern is unknown.
   *  Source: MCS MGD 003 default archetype. */
  occupancy: 'IN_HALF_DAY' as Occupancy,

  /** Solar system size in kilowatt-peak. Typical UK domestic install. */
  kwp: 4.0,

  /** Roof output relative to an ideal south-facing 35-degree unshaded roof, which is what
   *  the weather snapshot assumes. CHANGE FOR A MORE ACCURATE FIGURE — east or west is
   *  around 0.78 and north around 0.48, so 1.0 flatters most real houses. */
  orientationFactor: 1.0,
};

export const BATTERY = {
  /** Capacity printed on the box. */
  nominalKwh: 5.0,

  /** Share of that you may actually use — draining lithium flat damages it.
   *  Source: MCS MGD 003 default for lithium. Gives 4.5 kWh usable. */
  usableFraction: 0.9,

  /** Put 10 kWh in, get 9 kWh out. The rest is lost as heat. */
  roundTripEfficiency: 0.9,

  /** Max kWh in or out per hour. */
  powerKw: 3.0,
};

/** Capacity actually available to the simulation. */
export const USABLE_BATTERY_KWH = BATTERY.nominalKwh * BATTERY.usableFraction;

// ---------------------------------------------------------------------------
// Hourly and calendar data
// ---------------------------------------------------------------------------

/**
 * Household electricity by hour of day, excluding the heat pump. Relative weights — only
 * the shape is used; the total is scaled to the household's annual figure.
 *
 * ESTIMATED, and the weakest input in the model. The three differ across the middle of
 * the day, which is when solar generates. Daytime hours scaled to 70% once, to bring
 * self-consumption closer to the MCS MGD 003 tables.
 */
export const BASELOAD_SHAPES: Record<Occupancy, number[]> = {
  HOME_ALL_DAY: [
    0.55, 0.48, 0.45, 0.45, 0.5, 0.65, 0.95, 1.25, 1.25, 0.8, 0.77, 0.77,
    0.8, 0.77, 0.73, 0.77, 1.3, 1.65, 1.75, 1.55, 1.3, 1.1, 0.9, 0.68,
  ],
  IN_HALF_DAY: [
    0.6, 0.5, 0.45, 0.45, 0.5, 0.7, 1.1, 1.3, 1.1, 0.63, 0.59, 0.59,
    0.63, 0.59, 0.59, 0.66, 1.3, 1.7, 1.8, 1.6, 1.3, 1.1, 0.9, 0.7,
  ],
  // Out roughly 08:00-17:00, so a deep daytime trough and a sharper evening peak.
  OUT_ALL_DAY: [
    0.55, 0.48, 0.45, 0.45, 0.48, 0.65, 1.15, 1.45, 0.95, 0.32, 0.28, 0.28,
    0.28, 0.28, 0.28, 0.32, 0.75, 1.75, 2.05, 1.85, 1.5, 1.2, 0.95, 0.7,
  ],
};

/** Non-leap year, so this never varies. */
export const DAYS_PER_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
