/** Every number the calculation uses, with its source. Anything estimated says so. */

/** 365 x 24. Every hourly array in the system is this long. */
export const HOURS_PER_YEAR = 8760;

// ---------------------------------------------------------------------------
// Tariffs — data, not types. Adding a real one is data entry, not a code change.
// ---------------------------------------------------------------------------

export interface Tariff {
  id: string;
  name: string;
  /** Paid per kWh sold back. Well below the import price, which is why using your own
   *  solar beats exporting it. Same on both tariffs: export is a separate contract, and
   *  you may pick any of them whoever supplies your import. */
  exportRatePerKwh: number;
  /** Import price for each hour of the day. 24 entries, midnight first. */
  ratesPerKwh: number[];
}

/** Ofgem price cap, 1 July - 30 September 2026 (national average). */
const CAP_RATE = 0.2611;

export const FLAT_TARIFF: Tariff = {
  id: 'flat',
  name: 'Standard tariff',
  /** Octopus Outgoing Fixed, the rate since March 2026. SEG rates run 4-16.5p. */
  exportRatePerKwh: 0.12,
  ratesPerKwh: new Array(24).fill(CAP_RATE),
};

/** Octopus Cosy, London region, Q2 2026. Rates vary by region. */
const CHEAP = 0.1307;
const MID = 0.2663;
const PEAK = 0.3995;

export const TIME_OF_USE_TARIFF: Tariff = {
  id: 'tou',
  name: 'Time-of-use tariff',
  exportRatePerKwh: 0.12,
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
 * Heat delivered per unit of electricity consumed. 11,000 kWh of heat therefore costs
 * 11,000 / 2.8 kWh of electricity. Median measured across UK installations.
 */
export const SEASONAL_PERFORMANCE_FACTOR = 2.8;

/**
 * Outdoor temperature above which a UK house needs no heating. CIBSE TM41's base for UK
 * degree days: 19 C indoor less the ~3.5 C occupants, cooking and sunlight give free.
 *
 * Only sets the shape of the year, never the total, so it cannot move the bill.
 */
export const BASE_TEMP_C = 15.5;

/**
 * How much of the day the property is occupied. MCS MGD 003 archetypes:
 *   HOME_ALL_DAY  someone is in between 9am and 5pm on weekdays
 *   IN_HALF_DAY   empty for half the day, either all morning or all afternoon
 *   OUT_ALL_DAY   typically empty on weekdays
 */
export type Occupancy = 'HOME_ALL_DAY' | 'IN_HALF_DAY' | 'OUT_ALL_DAY';

/** Household electricity a year, by household size. Ofgem Typical Domestic Consumption
 *  Values, for homes that are not electrically heated. */
export const TDCV = { low: 1800, medium: 2700, high: 4100 };

export const HOUSE = {
  /** Household electricity excluding the heat pump: lights, fridge, appliances. */
  annualBaseloadKwh: TDCV.medium,

  /**
   * Heat needed per year, not electricity drawn or gas burned. Scales the whole heat pump
   * side of the model.
   *
   * ESTIMATED, and the weakest number here. A 3-bed semi, above the median home. In a real
   * tool it would come off the EPC or from the installer's heat-loss figure — note that
   * carries its own assumed weather year and indoor temperature, which must match ours.
   */
  annualHeatKwh: 11000,

  /** MCS MGD 003 default archetype, used when the real pattern is unknown. */
  occupancy: 'IN_HALF_DAY' as Occupancy,

  /** Solar system size in kilowatt-peak. Typical UK domestic install. */
  kwp: 4.0,

  /** Relative to an ideal south-facing 35-degree unshaded roof. 1.0 flatters most houses;
   *  see ORIENTATIONS. */
  orientationFactor: 1.0,
};

const NOMINAL_KWH = 5.0;

export const BATTERY = {
  /** Capacity on the box. A label only; the simulation uses usableKwh. */
  nominalKwh: NOMINAL_KWH,

  /** Draining lithium flat damages it. Industry typical, no standards body. */
  usableKwh: NOMINAL_KWH * 0.9,

  /** Put 10 kWh in, get 9 out. Industry range is 85-92%, so this is the optimistic end. */
  roundTripEfficiency: 0.9,

  /** In or out. Chosen, and it never binds: anything above 2.5 fills the battery inside
   *  a cheap window. */
  maxKwhPerHour: 3.0,
};

// ---------------------------------------------------------------------------
// Hourly and calendar data
// ---------------------------------------------------------------------------

/**
 * Household electricity by hour of day, excluding the heat pump. Relative weights only;
 * the total is scaled to the household's annual figure.
 *
 * ESTIMATED. They differ across the middle of the day, which is when solar generates.
 * Daytime hours scaled to 70% once, to bring self-consumption closer to MCS MGD 003.
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

// ---------------------------------------------------------------------------
// UI inputs
// ---------------------------------------------------------------------------

/**
 * Example properties, standing in for records arriving from the installer's tool. All
 * London, because that is the only weather we hold.
 *
 * Heat demand is ESTIMATED. An EPC band cannot really give it — the band is a rating per
 * square metre, so these quietly assume the house grows as the band worsens. Stops at E:
 * an F home insulates first, and cannot claim the Boiler Upgrade Scheme grant until it has.
 */
export const PROPERTIES = [
  { id: '1', address: '4 Meadow Court, E14', kind: 'New-build flat', epc: 'B', annualHeatKwh: 5000, annualBaseloadKwh: TDCV.low },
  { id: '2', address: '18 Alder Way, SW16', kind: '3-bed semi', epc: 'C', annualHeatKwh: 11000, annualBaseloadKwh: TDCV.medium },
  { id: '3', address: '27 Elm Row, N8', kind: '3-bed semi', epc: 'D', annualHeatKwh: 14000, annualBaseloadKwh: TDCV.medium },
  { id: '4', address: '9 Victoria Terrace, SE22', kind: 'Victorian terrace', epc: 'E', annualHeatKwh: 18000, annualBaseloadKwh: TDCV.high },
];

/** Roof output relative to a south-facing 35-degree roof, which is what the weather
 *  snapshot assumes. MCS orientation factors for a 35-degree pitch. */
export const ORIENTATIONS = [
  { label: 'South', factor: 1.0 },
  { label: 'South-east / south-west', factor: 0.94 },
  { label: 'East / west', factor: 0.78 },
  { label: 'North', factor: 0.48 },
];

/** Fully installed, at the one system size this models. Midpoints of UK 2026 ranges:
 *  £5,500-£8,000 for 4 kWp, £2,500-£4,000 for 5 kWh. Assumes the 0% VAT relief. */
export const SOLAR_INSTALL_COST = 6500;
export const BATTERY_INSTALL_COST = 3000;
