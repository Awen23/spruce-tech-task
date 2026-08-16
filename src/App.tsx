import { useMemo, useState } from 'react';
import {
  BATTERY,
  HOUSE,
  ORIENTATIONS,
  PROPERTIES,
  SEASONAL_PERFORMANCE_FACTOR,
} from './calculator/constants';
import { Kit, runScenarios, Scenario } from './calculator/engine';
import { londonWeather } from './calculator/weather';
import './App.css';

const WEATHER = londonWeather();

const CARDS: { kit: Kit; title: string; blurb: string }[] = [
  { kit: 'solar', title: 'Solar panels', blurb: `${HOUSE.kwp} kWp on the roof` },
  { kit: 'battery', title: 'Battery', blurb: `${BATTERY.nominalKwh} kWh, no panels` },
  { kit: 'solarAndBattery', title: 'Solar + battery', blurb: 'Both together' },
];

const OCCUPANCIES = [
  { value: 'HOME_ALL_DAY', label: 'Someone home all day' },
  { value: 'IN_HALF_DAY', label: 'Home about half the day' },
  { value: 'OUT_ALL_DAY', label: 'Out on weekdays' },
] as const;

const gbp = (n: number) => `${n < 0 ? '−' : ''}£${Math.abs(Math.round(n)).toLocaleString()}`;

export default function App() {
  const [propertyId, setPropertyId] = useState(PROPERTIES[2].id);
  const [occupancy, setOccupancy] = useState<(typeof OCCUPANCIES)[number]['value']>('IN_HALF_DAY');
  const [orientation, setOrientation] = useState(ORIENTATIONS[0].label);
  const [showAssumptions, setShowAssumptions] = useState(false);

  const property = PROPERTIES.find((p) => p.id === propertyId)!;
  const orientationFactor = ORIENTATIONS.find((o) => o.label === orientation)!.factor;

  const results = useMemo(
    () =>
      runScenarios(WEATHER, {
        annualHeatKwh: property.annualHeatKwh,
        annualBaseloadKwh: property.annualBaseloadKwh,
        occupancy,
        orientationFactor,
      }),
    [property, occupancy, orientationFactor],
  );

  /** The better of the two tariffs for a given kit. */
  const best = (kit: Kit): Scenario =>
    results.scenarios
      .filter((s) => s.kit === kit)
      .reduce((a, b) => (b.annualSavingGbp > a.annualSavingGbp ? b : a));

  const doNothingOnTou = results.scenarios.find(
    (s) => s.kit === 'nothing' && s.tariffId === 'tou',
  )!;

  return (
    <div className="page">
      <header>
        <span className="logo">spruce</span>
        <h1>What could solar or a battery add?</h1>
        <p className="sub">
          Savings on top of a heat pump, simulated hour by hour across a year of real
          weather.
        </p>
      </header>

      <label className="field wide">
        <span>Property</span>
        <select value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
          {PROPERTIES.map((p) => (
            <option key={p.id} value={p.id}>
              {p.address} — {p.kind}, EPC {p.epc}
            </option>
          ))}
        </select>
      </label>

      <p className="meta">
        EPC {property.epc} · {property.annualHeatKwh.toLocaleString()} kWh of heat a year ·
        currently paying <strong>{gbp(results.baselineCostGbp)}</strong> for electricity
      </p>

      <div className="cards">
        {CARDS.map(({ kit, title, blurb }) => {
          const s = best(kit);
          return (
            <div className="card" key={kit}>
              <h2>{title}</h2>
              <p className="blurb">{blurb}</p>
              <p className="saving">{gbp(s.annualSavingGbp)}</p>
              <p className="per">saved a year</p>
              <dl>
                <div>
                  <dt>Pays back in</dt>
                  <dd>{s.paybackYears ? `${s.paybackYears.toFixed(1)} years` : 'never'}</dd>
                </div>
                <div>
                  <dt>Costs</dt>
                  <dd>{gbp(s.installCostGbp)}</dd>
                </div>
                <div>
                  <dt>Best on</dt>
                  <dd>{s.tariffId === 'tou' ? 'Time-of-use' : 'Standard'}</dd>
                </div>
              </dl>
            </div>
          );
        })}
      </div>

      <p className="note">
        Each card shows whichever tariff suits that kit best, which is why they differ. A
        time-of-use tariff only pays if something moves electricity off the late-afternoon
        peak — here, the battery. We assume the heat pump is <em>not</em> smart-scheduled,
        so on its own it runs hardest through the peak and the same tariff costs{' '}
        <strong>{gbp(-doNothingOnTou.annualSavingGbp)}</strong> more a year. A controlled
        heat pump would close much of that gap; we don't model one.
      </p>

      <button className="toggle" onClick={() => setShowAssumptions(!showAssumptions)}>
        {showAssumptions ? 'Hide' : 'Show'} assumptions
      </button>

      {showAssumptions && (
        <section className="assumptions">
          <div className="editable">
            <label className="field">
              <span>Who's home during the day?</span>
              <select value={occupancy} onChange={(e) => setOccupancy(e.target.value as never)}>
                {OCCUPANCIES.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Which way does the roof face?</span>
              <select value={orientation} onChange={(e) => setOrientation(e.target.value)}>
                {ORIENTATIONS.map((o) => (
                  <option key={o.label} value={o.label}>
                    {o.label} ({Math.round(o.factor * 100)}% of best)
                  </option>
                ))}
              </select>
            </label>
          </div>

          <ul className="fixed">
            <li>Weather is London, 2023 — a typical year, not a sunny one.</li>
            <li>Heat pump efficiency is a flat {SEASONAL_PERFORMANCE_FACTOR}, the UK field average.</li>
            <li>The heat pump is not smart-scheduled; it heats whenever the house is cold.</li>
            <li>Household electricity is {property.annualBaseloadKwh.toLocaleString()} kWh a year, on an estimated daily shape.</li>
            <li>The battery charges whenever electricity is cheapest, with no limit on wear.</li>
            <li>First-year savings only — no price rises, degradation or standing charges.</li>
          </ul>
        </section>
      )}
    </div>
  );
}
