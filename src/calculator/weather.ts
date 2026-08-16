/**
 * PVGIS adapter — hourly sunshine and outdoor temperature for a location.
 *
 * PVGIS is the European Commission's free solar dataset. No API key or account needed.
 *
 *   cachedWeatherYear()  a snapshot committed to this repo. Works anywhere.
 *   fetchWeatherYear()   the live API. Node or server only — PVGIS sends no CORS
 *                        headers, so browsers block it.
 *
 * The engine never imports this file; weather is passed in as a parameter.
 */

import { HOURS_PER_YEAR } from '../domain/constants';
import { Hourly } from '../domain/types';
import snapshot from './pvgis-london-2023.json';

export interface WeatherYear {
  /** Watts generated per 1 kWp of panels installed, for each hour. Each row covers one
   *  hour, so this is also watt-hours. */
  wattsPerKwp: Hourly;
  /** Outdoor air temperature in degrees C, for each hour. */
  outdoorTempC: Hourly;
  lat: number;
  lon: number;
  year: number;
}

/** Fixed query parameters. Callers vary only location and year. */
const PVGIS_SETTINGS = {
  /** Results per 1 kWp, so callers scale to any system size. */
  peakpower: 1,
  /** System losses %: wiring, inverter, dirt. PVGIS default. */
  loss: 14,
  /** Roof pitch in degrees. */
  angle: 35,
  /** Roof direction. PVGIS uses 0 = SOUTH, not north. Verified: aspect=0 yields 1,007
   *  kWh/kWp for London, aspect=180 yields 545. */
  aspect: 0,
  /** Return modelled panel output rather than raw sunlight. */
  pvcalculation: 1,
  outputformat: 'json',
};

export function pvgisUrl(lat: number, lon: number, year: number): string {
  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
    startyear: String(year),
    endyear: String(year),
    ...Object.fromEntries(Object.entries(PVGIS_SETTINGS).map(([k, v]) => [k, String(v)])),
  });
  return `https://re.jrc.ec.europa.eu/api/v5_3/seriescalc?${params}`;
}

/**
 * Fetch a year from the live API. Node or server only. ~1.7s, ~800 KB.
 * Valid years are 2005-2023; use non-leap years (a leap year returns 8,784 hours).
 */
export async function fetchWeatherYear(
  lat: number,
  lon: number,
  year: number,
): Promise<WeatherYear> {
  if (typeof window !== 'undefined') {
    throw new Error(
      'fetchWeatherYear() cannot run in a browser: PVGIS sends no CORS headers. Use ' +
        'cachedWeatherYear(), or call this from a backend and serve the result.',
    );
  }

  const response = await fetch(pvgisUrl(lat, lon, year));
  if (!response.ok) {
    throw new Error(`PVGIS returned ${response.status}: ${await response.text()}`);
  }
  const rows: { P: number; T2m: number }[] = (await response.json()).outputs.hourly;
  return validate({
    wattsPerKwp: rows.map((r) => r.P),
    outdoorTempC: rows.map((r) => r.T2m),
    lat,
    lon,
    year,
  });
}

/** The committed snapshot: London 2023. Regenerate with fetchWeatherYear(). */
export function cachedWeatherYear(): WeatherYear {
  return validate({
    wattsPerKwp: snapshot.P,
    outdoorTempC: snapshot.T2m,
    lat: 51.51,
    lon: -0.13,
    year: 2023,
  });
}

function validate(w: WeatherYear): WeatherYear {
  if (w.wattsPerKwp.length !== HOURS_PER_YEAR || w.outdoorTempC.length !== HOURS_PER_YEAR) {
    throw new Error(
      `Expected ${HOURS_PER_YEAR} hours of weather for ${w.year}, got ` +
        `${w.wattsPerKwp.length} power and ${w.outdoorTempC.length} temperature values. ` +
        `A leap year returns 8,784 — pick a non-leap year.`,
    );
  }
  return w;
}
