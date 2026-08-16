/**
 * The weather the whole calculation is built on: one row per hour of a year.
 *
 * Source: PVGIS (European Commission). Committed as a snapshot because PVGIS sends no
 * CORS headers, so a browser cannot call it. To refresh, run this and keep P and T2m:
 *
 *   https://re.jrc.ec.europa.eu/api/v5_3/seriescalc?lat=51.51&lon=-0.13
 *     &peakpower=1&loss=14&angle=35&aspect=0&pvcalculation=1&outputformat=json
 *     &startyear=2023&endyear=2023
 *
 * peakpower=1 returns results per kWp. loss=14 is the PVGIS default for wiring, inverter
 * and dirt. angle=35 is a typical UK roof pitch. aspect=0 is SOUTH in PVGIS, not north.
 *
 * 2023 because yield across the 19 available years ranges 939-1,089 kWh/kWp, and 2023
 * gives 1,007 — within 1% of the mean. It is also the most recent non-leap year.
 */

import { HOURS_PER_YEAR } from './constants';
import snapshot from './pvgis-london-2023.json';

export interface Weather {
  /** Watts generated per 1 kWp of panels installed, each hour. Each row covers one hour,
   *  so this is also watt-hours. */
  wattsPerKwp: number[];
  /** Outdoor air temperature in degrees C, each hour. */
  outdoorTempC: number[];
  location: string;
  year: number;
}

export function londonWeather(): Weather {
  if (snapshot.P.length !== HOURS_PER_YEAR || snapshot.T2m.length !== HOURS_PER_YEAR) {
    throw new Error(
      `Expected ${HOURS_PER_YEAR} hours of weather, got ${snapshot.P.length}. ` +
        `A leap year returns 8,784 — pick a non-leap year.`,
    );
  }

  return {
    wattsPerKwp: snapshot.P,
    outdoorTempC: snapshot.T2m,
    location: 'London',
    year: 2023,
  };
}
