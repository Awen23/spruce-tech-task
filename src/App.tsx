import { useMemo, useState } from 'react';
import {
  BATTERY,
  HOUSE,
  ORIENTATIONS,
  PROPERTIES,
  SEASONAL_PERFORMANCE_FACTOR,
  TARIFFS,
  TIME_OF_USE_TARIFF,
} from './calculator/constants';
import { Kit, runScenarios } from './calculator/engine';
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
  const [tariffId, setTariffId] = useState(TIME_OF_USE_TARIFF.id);
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

  const on = (kit: Kit) => results.scenarios.find((s) => s.kit === kit && s.tariffId === tariffId)!;

  return (
    <div className="page">
      <header>
        <h1>What could solar or a battery add?</h1>
        <p className="sub">
          What solar and a battery would add to a heat pump install, simulated hour by hour
          across a year of real weather.
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
        Electricity today <strong>{gbp(results.baseline.household)}</strong> · heating adds{' '}
        <strong>{gbp(results.baseline.heatPump)}</strong> · so{' '}
        <strong>{gbp(results.baseline.total)}</strong> a year with the heat pump in.
      </p>

      <div className="tariffs">
        {TARIFFS.map((t) => (
          <button
            key={t.id}
            className={t.id === tariffId ? 'on' : ''}
            onClick={() => setTariffId(t.id)}
          >
            {t.name}
          </button>
        ))}
      </div>

      <div className="cards">
        {CARDS.map(({ kit, title, blurb }) => {
          const s = on(kit);
          return (
            <div className="card" key={kit}>
              <h2>{title}</h2>
              <p className="blurb">{blurb}</p>
              <p className="saving">{gbp(s.annualSaving)}</p>
              <p className="per">saved a year</p>
              <dl>
                <div>
                  <dt>Pays back in</dt>
                  <dd>{s.paybackYears ? `${s.paybackYears.toFixed(1)} years` : 'never'}</dd>
                </div>
                <div>
                  <dt>Costs</dt>
                  <dd>{gbp(s.installCost)}</dd>
                </div>
              </dl>
            </div>
          );
        })}
      </div>

      <p className="note">
        A time-of-use tariff prices each hour differently — 13p in three cheap windows, 40p
        from 16:00 to 19:00. That spread is the only thing a battery earns from: buy cheap,
        cover the peak. On a standard tariff every hour costs the same, so it saves nothing.
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
            <li>
              EPC {property.epc}, {property.annualHeatKwh.toLocaleString()} kWh of heat a
              year, a {HOUSE.kwp} kWp roof and a {BATTERY.nominalKwh} kWh battery.
            </li>
            <li>Weather is London, 2023 — a typical year, not a sunny one.</li>
            <li>Heat pump efficiency is a flat {SEASONAL_PERFORMANCE_FACTOR}, the UK field average.</li>
            <li>The house is held at one temperature all year.</li>
            <li>Nothing shifts to dodge the expensive hours — not the heating, not appliances.</li>
            <li>Household electricity is {property.annualBaseloadKwh.toLocaleString()} kWh a year, on an estimated daily shape.</li>
            <li>The battery charges whenever electricity is cheapest, with no limit on wear.</li>
            <li>First-year savings only — no price rises, degradation or standing charges.</li>
          </ul>
        </section>
      )}
    </div>
  );
}
