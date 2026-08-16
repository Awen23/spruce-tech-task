import {
  BASE_TEMP_C,
  FLAT_TARIFF,
  HOURS_PER_YEAR,
  HOUSE,
  Occupancy,
  SEASONAL_PERFORMANCE_FACTOR,
  TIME_OF_USE_TARIFF,
} from './constants';
import {
  baseloadProfile,
  generationProfile,
  gridChargeHours,
  heatPumpProfile,
  runScenarios,
  simulate,
} from './engine';
import { londonWeather } from './weather';

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

const weather = londonWeather();
const temp = weather.outdoorTempC;
const heatPump = heatPumpProfile(HOUSE.annualHeatKwh, temp);
const baseload = baseloadProfile(HOUSE.annualBaseloadKwh, HOUSE.occupancy);
const demand = baseload.map((kwh, h) => kwh + heatPump[h]);
const generation = generationProfile(weather, HOUSE.kwp, 1);
const NEVER = new Array(24).fill(false);

describe('hourly curves', () => {
  it('scale to their annual totals', () => {
    expect(baseload).toHaveLength(HOURS_PER_YEAR);
    expect(sum(baseload)).toBeCloseTo(HOUSE.annualBaseloadKwh, 6);
    // Heat pump electricity is the heat required divided by its efficiency.
    expect(sum(heatPump)).toBeCloseTo(HOUSE.annualHeatKwh / SEASONAL_PERFORMANCE_FACTOR, 6);
  });

  it('need no heating when it is warmer than the base temperature', () => {
    const warmHours = heatPump.filter((_, h) => temp[h] >= BASE_TEMP_C);
    expect(warmHours.length).toBeGreaterThan(0);
    expect(Math.max(...warmHours)).toBe(0);
  });


  it('peak household electricity in the evening, not the morning', () => {
    const day = baseload.slice(0, 24);
    expect(Math.max(...day.slice(16, 21))).toBeGreaterThan(Math.max(...day.slice(6, 10)));
  });

  it('give OUT_ALL_DAY the deepest daytime trough', () => {
    const midday = (o: Occupancy) => {
      const day = baseloadProfile(3500, o).slice(0, 24);
      return sum(day.slice(9, 16)) / sum(day);
    };
    expect(midday('OUT_ALL_DAY')).toBeLessThan(midday('IN_HALF_DAY'));
    expect(midday('IN_HALF_DAY')).toBeLessThan(midday('HOME_ALL_DAY'));
  });

  it('produce a plausible solar yield per kWp', () => {
    // MCS quotes 950 kWh/kWp for a south-facing 35-degree roof in southern England.
    const perKwp = sum(generationProfile(weather, 1, 1));
    expect(perKwp).toBeGreaterThan(800);
    expect(perKwp).toBeLessThan(1200);
  });

  it('scale linearly with system size and orientation', () => {
    expect(sum(generationProfile(weather, 8, 1))).toBeCloseTo(sum(generation) * 2, 6);
    expect(sum(generationProfile(weather, 4, 0.5))).toBeCloseTo(sum(generation) * 0.5, 6);
  });

  it('are inverted across the year — solar peaks in summer, heating in winter', () => {
    const JANUARY = [0, 744]; // hours into the year
    const JULY = [4344, 5088];
    const across = (profile: number[], [from, to]: number[]) => sum(profile.slice(from, to));

    expect(across(generation, JULY)).toBeGreaterThan(across(generation, JANUARY));
    expect(across(heatPump, JANUARY)).toBeGreaterThan(across(heatPump, JULY));
  });
});

describe('the hourly loop', () => {
  const cheap = gridChargeHours(TIME_OF_USE_TARIFF);
  const noSolar = new Array(HOURS_PER_YEAR).fill(0);

  it.each([
    ['solar + battery', generation, true, cheap],
    ['solar only', generation, false, NEVER],
    ['battery only', noSolar, true, cheap],
    ['nothing', noSolar, false, NEVER],
  ] as const)('conserves energy: %s', (_name, gen, hasBattery, hours) => {
    // Nothing is created or destroyed. Everything that came in either met demand, was
    // sold, was lost to battery inefficiency, or is still sitting in the battery.
    const f = simulate(gen, demand, hasBattery, hours);
    const inbound = f.generationKwh + f.importedKwh;
    const outbound = sum(demand) + f.exportedKwh + f.lossesKwh + f.finalChargeKwh;
    expect(inbound).toBeCloseTo(outbound, 4);
  });

  it('never exports more than it generated', () => {
    const f = simulate(generation, demand, true, cheap);
    expect(f.exportedKwh).toBeLessThanOrEqual(f.generationKwh + 1e-9);
  });

  it('loses nothing when there is no battery', () => {
    expect(simulate(generation, demand, false, NEVER).lossesKwh).toBe(0);
  });
});

describe('tariffs', () => {
  it('grid-charges only in the cheapest hours', () => {
    const hours = gridChargeHours(TIME_OF_USE_TARIFF)
      .map((isCheap, h) => (isCheap ? h : -1))
      .filter((h) => h >= 0);
    expect(hours).toEqual([4, 5, 6, 13, 14, 15, 22, 23]);
  });

  it('never grid-charges on a flat tariff', () => {
    // With one price all day there is nothing to gain, only the round-trip to lose.
    expect(gridChargeHours(FLAT_TARIFF)).toEqual(NEVER);
  });

  it('prices every hour of the day', () => {
    expect(FLAT_TARIFF.ratesPerKwh).toHaveLength(24);
    expect(TIME_OF_USE_TARIFF.ratesPerKwh).toHaveLength(24);
  });
});

describe('scenarios', () => {
  const results = runScenarios(weather);
  const get = (kit: string, tariffId: string) =>
    results.scenarios.find((s) => s.kit === kit && s.tariffId === tariffId)!;

  it('covers every kit on every tariff', () => {
    expect(results.scenarios).toHaveLength(8);
  });

  it('saves exactly nothing with a battery on a flat tariff', () => {
    expect(get('battery', FLAT_TARIFF.id).annualSaving).toBe(0);
  });

  it('makes a battery worthwhile only on a time-of-use tariff', () => {
    expect(get('battery', TIME_OF_USE_TARIFF.id).annualSaving).toBeGreaterThan(300);
  });

  it('makes solar worthwhile on both tariffs', () => {
    expect(get('solar', FLAT_TARIFF.id).annualSaving).toBeGreaterThan(0);
    expect(get('solar', TIME_OF_USE_TARIFF.id).annualSaving).toBeGreaterThan(0);
  });
});
