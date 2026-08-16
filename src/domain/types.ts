/**
 * Domain entities — the persistence shape.
 *
 * Each interface here is intended to become a database table, so they carry ids and
 * foreign keys even though nothing in the engine needs them yet.
 *
 * The engine never takes these objects. Every calculation function takes plain numbers
 * and arrays, so it stays pure and testable without building a whole object graph.
 * Result types are defined next to the code that produces them, not here.
 */

/**
 * One value per hour for a whole year: 365 x 24 = 8,760 entries.
 *
 * TypeScript can't usefully enforce a fixed array length, so the length is a convention
 * checked where weather data is loaded (data/pvgis.ts).
 */
export type Hourly = number[];

/** How much of the day someone is at home. Changes when household electricity is used. */
export type Occupancy = 'HOME_ALL_DAY' | 'IN_HALF_DAY' | 'OUT_ALL_DAY';

export interface Property {
  id: string;
  /** Household electricity for the year, EXCLUDING the heat pump: lights, appliances,
   *  fridge, kettle. The heat pump is separate because its consumption depends on the
   *  weather. */
  annualBaseloadKwh: number;
  occupancy: Occupancy;
}

export interface PvSystem {
  id: string;
  propertyId: string;
  /** System size in kilowatt-peak — the headline number on a solar quote. */
  kwp: number;
}

export interface Battery {
  id: string;
  propertyId: string;
  /** Capacity printed on the box. Not all of it is usable — see dodPct. */
  nominalKwh: number;
  /** Depth of discharge: the percentage of nominalKwh you may actually use. Draining
   *  lithium flat damages it, so manufacturers reserve a slice at the bottom.
   *  Usable capacity = nominalKwh * dodPct / 100. */
  dodPct: number;
  /** Round-trip efficiency: put 10 kWh in, get roundTripPct% of it back out. */
  roundTripPct: number;
  /** Max charge or discharge rate in kW. One simulation step is an hour, so this also
   *  caps how many kWh can move in or out per step. */
  powerKw: number;
}

export interface HeatPump {
  id: string;
  propertyId: string;
  /** Heat DELIVERED to the house per year, NOT electricity consumed. A heat pump
   *  delivers roughly 3x the heat it consumes, so confusing the two overstates the bill
   *  threefold. */
  annualHeatKwh: number;
  /** Efficiency at a handful of outdoor temperatures.
   *  In a database this is a child table — an array does not map to a column. */
  copPoints: CopPoint[];
}

/**
 * Coefficient of Performance at one outdoor temperature: heat delivered per unit of
 * electricity consumed. COP falls as it gets colder, because a heat pump extracts heat
 * from outdoor air and cold air has less to give — so it is least efficient exactly when
 * the house needs the most heat.
 */
export interface CopPoint {
  ambientC: number;
  cop: number;
}

/**
 * An electricity tariff. Deliberately generic — no supplier or product names anywhere in
 * the domain, so adding a real tariff is an INSERT rather than a code change.
 */
export interface Tariff {
  id: string;
  name: string;
  /** Paid to the household per kWh exported to the grid. Always well below the import
   *  rate, which is why using your own solar beats selling it. */
  exportRatePerKwh: number;
  /** Import price by time of day. A flat tariff is one slot covering 0-24.
   *  In a database this is a child table. */
  slots: TariffSlot[];
}

export interface TariffSlot {
  /** Inclusive start hour, 0-23. */
  fromHour: number;
  /** Exclusive end hour, 1-24. */
  toHour: number;
  ratePerKwh: number;
}
