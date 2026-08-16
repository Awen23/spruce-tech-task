/**
 * Seed data and defaults. Every number carries its source.
 *
 * Only values the engine actually uses live here — an unused constant is a bug.
 */

import { CopPoint, Occupancy, Tariff } from './types';

/** 365 x 24. Every hourly array in the system is this long. */
export const HOURS_PER_YEAR = 8760;

// ---------------------------------------------------------------------------
// Tariffs — data, not types. Adding a real one is an INSERT, not a code change.
// ---------------------------------------------------------------------------

/** One price all day. Source: Ofgem price cap, 1 July - 30 September 2026. */
export const FLAT_TARIFF: Tariff = {
  id: 'flat',
  name: 'Standard variable (price cap)',
  exportRatePerKwh: 0.12,
  slots: [{ fromHour: 0, toHour: 24, ratePerKwh: 0.2611 }],
};

/**
 * Price varies by time of day: cheap overnight and midday, expensive late afternoon.
 * Shape is typical of UK heat-pump tariffs; rates are indicative, not a real product.
 */
export const TIME_OF_USE_TARIFF: Tariff = {
  id: 'tou',
  name: 'Time-of-use (heat pump tariff)',
  exportRatePerKwh: 0.15,
  slots: [
    { fromHour: 0, toHour: 4, ratePerKwh: 0.3328 },
    { fromHour: 4, toHour: 7, ratePerKwh: 0.1453 }, // cheap
    { fromHour: 7, toHour: 13, ratePerKwh: 0.3328 },
    { fromHour: 13, toHour: 16, ratePerKwh: 0.1453 }, // cheap
    { fromHour: 16, toHour: 19, ratePerKwh: 0.5168 }, // peak
    { fromHour: 19, toHour: 22, ratePerKwh: 0.3328 },
    { fromHour: 22, toHour: 24, ratePerKwh: 0.1453 }, // cheap
  ],
};

export const TARIFFS = [FLAT_TARIFF, TIME_OF_USE_TARIFF];

// ---------------------------------------------------------------------------
// Heat pump
// ---------------------------------------------------------------------------

/**
 * Efficiency at five outdoor temperatures: units of heat delivered per unit of
 * electricity. Roughly halves between a mild day and a cold one.
 *
 * Source: the four EN 14825 test points manufacturers must publish (-7, +2, +7, +12 C),
 * plus a +20 C point to extend the curve over the mild end of the UK year.
 */
export const DEFAULT_COP_POINTS: CopPoint[] = [
  { ambientC: -7, cop: 1.95 },
  { ambientC: 2, cop: 2.55 },
  { ambientC: 7, cop: 3.05 },
  { ambientC: 12, cop: 3.6 },
  { ambientC: 20, cop: 4.2 },
];

/**
 * Outdoor temperature above which a UK house needs no heating. Below it, heat demand is
 * proportional to how far below it we are.
 *
 * Source: the base temperature MCS and CIBSE Guide A use for UK degree days. Below a
 * comfortable 19-21 C because occupants, cooking and sunlight supply the rest for free.
 */
export const BASE_TEMP_C = 15.5;

// ---------------------------------------------------------------------------
// Property and equipment defaults
// ---------------------------------------------------------------------------

export const DEFAULTS = {
  /** Household electricity excluding the heat pump. Source: MCS MGD 003 fallback. */
  annualBaseloadKwh: 3500,

  /** Used when occupancy is unknown. Source: MCS MGD 003 default. */
  occupancy: 'IN_HALF_DAY' as Occupancy,

  /** Heat DELIVERED per year, not electricity consumed. Typical UK 3-bed semi.
   *  Weakest-sourced number here: real houses range from ~8,000 (well insulated) to
   *  ~18,000 (solid wall Victorian), and this scales the heat pump linearly. */
  annualHeatKwh: 11000,

  /** Typical UK domestic solar install. */
  kwp: 4.0,

  /** Capacity printed on the box. */
  batteryNominalKwh: 5.0,

  /** Share of nominal capacity actually usable. Source: MCS MGD 003 default for lithium.
   *  Gives 5.0 * 0.90 = 4.5 kWh usable. */
  batteryDodPct: 90,

  /** Put 10 kWh in, get 9 kWh out. */
  batteryRoundTripPct: 90,

  /** Max charge/discharge rate. A step is one hour, so this also caps kWh per step. */
  batteryPowerKw: 3.0,

  /** Roof output relative to an ideal south-facing 35-degree unshaded roof, which is what
   *  the PVGIS snapshot assumes. CHANGE FOR A MORE ACCURATE FIGURE — east/west is around
   *  0.78, north around 0.48, so 1.0 is optimistic for most real houses. */
  orientationFactor: 1.0,
};
