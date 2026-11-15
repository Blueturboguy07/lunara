import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { db, getPeriodStarts } from '../db/schema'
import { buildCycleReport } from '../engine/patterns'
import { completedCycles, symptomFrequency } from '../engine/stats'
import { formatShort } from '../lib/dates'
import { localToday } from '../lib/dates'
import { useApp } from '../state/appStore'
import { ArrowIcon } from '../components/ArrowIcon'
import '../styles/reports.css'

export function Graphs() {
  const setReportOpen = useApp((s) => s.setReportOpen)
  const [cycleWindow, setCycleWindow] = useState<6 | 12>(6)
  const today = localToday()
  const data = useLiveQuery(async () => {
    const [periodStarts, logs] = await Promise.all([getPeriodStarts(), db.dailyLogs.toArray()])
    const report = buildCycleReport(logs, periodStarts, today)
    return {
      cycles: completedCycles(periodStarts).slice(-12),
      symptoms: symptomFrequency(logs).slice(0, 6),
      report,
    }
  }, [today])

  if (!data) return <div className="page page-loading" aria-label="Loading trends" />

  const displayCycles = data.cycles.slice(-cycleWindow)
  const maxLen = Math.max(28, ...displayCycles.map((cycle) => cycle.length))
  const windowStats = cycleWindow === 6
    ? data.report.cycleWindows.six
    : data.report.cycleWindows.twelve
  const maxSymptomCount = Math.max(1, ...data.symptoms.map((symptom) => symptom.count))
  const fertilitySeries = data.report.fertilitySignals.slice(-60)
  const bbt = fertilitySeries.filter(
    (point): point is typeof point & { bbtCelsius: number } => point.bbtCelsius !== undefined,
  ).slice(-30)
  const bbtValues = bbt.map((point) => point.bbtCelsius)
  const bbtMin = bbtValues.length ? Math.min(...bbtValues) - 0.1 : 36
  const bbtMax = bbtValues.length ? Math.max(...bbtValues) + 0.1 : 37
  const bbtPoints = bbtValues.map((value, index) => {
    const x = bbtValues.length === 1 ? 150 : 16 + (index / (bbtValues.length - 1)) * 268
    const y = 102 - ((value - bbtMin) / (bbtMax - bbtMin)) * 82
    return { x, y, value }
  })
  const latestTemperature = bbtValues.length ? bbtValues[bbtValues.length - 1] : null
  const positiveOpks = fertilitySeries.filter((point) => point.opk === 'positive')
  const trendCopy =
    windowStats.trendDirection === 'insufficient-data'
      ? 'More completed cycles are needed for a direction.'
      : windowStats.trendDirection === 'stable'
        ? 'No clear length direction in this window.'
        : `Lengths have moved ${windowStats.trendDirection} by about ${Math.abs(
            windowStats.trendDaysPerCycle ?? 0,
          ).toFixed(1)} days per cycle in this window.`

  return (
    <div className="page trends-page">
      <header className="page-title-block">
        <span className="page-kicker">Your body, over time</span>
        <h1>Your patterns</h1>
        <p>Look for direction, not perfection. Every log adds a little more context.</p>
      </header>

      <button className="report-callout" onClick={() => setReportOpen(true)}>
        <span className="report-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M7 3.5h7l4 4v13H7zM14 3.5v4h4M10 12h5M10 15.5h5" />
          </svg>
        </span>
        <span className="report-copy">
          <span>For your next appointment</span>
          <strong>Create a doctor-ready summary</strong>
          <small>A clear, printable view of what you logged</small>
        </span>
        <span className="report-arrow" aria-hidden="true"><ArrowIcon /></span>
      </button>

      <section className="metric-grid" aria-label="Cycle summary">
        <article className="metric-card metric-rose">
          <span>Average cycle</span>
          <strong>{windowStats.averageDays ?? '—'}{windowStats.averageDays && <small> days</small>}</strong>
          <i aria-hidden="true" />
        </article>
        <article className="metric-card metric-teal">
          <span>Recent variation</span>
          <strong>{windowStats.rangeDays ?? '—'}{windowStats.rangeDays !== null && <small> days</small>}</strong>
          <i aria-hidden="true" />
        </article>
      </section>

      <section className="card chart-card">
        <div className="chart-heading">
          <div>
            <div className="section-label">Cycle length</div>
            <h2>One cycle at a time</h2>
          </div>
          <div className="report-window-switch" aria-label="Cycle history window">
            <button
              className={cycleWindow === 6 ? 'is-active' : ''}
              onClick={() => setCycleWindow(6)}
              aria-pressed={cycleWindow === 6}
            >
              6
            </button>
            <button
              className={cycleWindow === 12 ? 'is-active' : ''}
              onClick={() => setCycleWindow(12)}
              aria-pressed={cycleWindow === 12}
            >
              12
            </button>
          </div>
        </div>
        {displayCycles.length < 2 ? (
          <EmptyChart
            title="Your rhythm will appear here"
            body="Log a couple of period starts to see how your cycle length moves."
          />
        ) : (
          <>
            <div className="bars" aria-label="Recent cycle lengths">
              <span className="chart-guide guide-top" aria-hidden="true" />
              <span className="chart-guide guide-middle" aria-hidden="true" />
              {displayCycles.map((cycle, index) => (
                <div
                  key={cycle.start}
                  className={`bar${index === displayCycles.length - 1 ? ' is-latest' : ''}`}
                  style={{ height: `${Math.max((cycle.length / maxLen) * 100, 12)}%` }}
                  role="img"
                  aria-label={`${formatShort(cycle.start)} cycle: ${cycle.length} days`}
                >
                  <span>{cycle.length}</span>
                </div>
              ))}
            </div>
            <div className="chart-axis">
              <span>{formatShort(displayCycles[0].start)}</span>
              <span>Most recent</span>
            </div>
            <p className="report-method-note">{trendCopy} {windowStats.methodology}</p>
          </>
        )}
      </section>

      <section className="card chart-card">
        <div className="chart-heading">
          <div>
            <div className="section-label">Bleeding</div>
            <h2>Logged episode length</h2>
          </div>
          <span className="report-sample">{data.report.bleedingTrend.sampleSize} episodes</span>
        </div>
        {data.report.bleedingTrend.episodes.length < 2 ? (
          <EmptyChart
            title="Flow history will appear here"
            body="Log flow on each bleeding day to see episode length and the heaviest level selected."
          />
        ) : (
          <>
            <div className="flow-episode-strip" aria-label="Recent logged bleeding episodes">
              {data.report.bleedingTrend.episodes.map((episode) => (
                <div className="flow-episode" key={episode.start}>
                  <span
                    className={`flow-drop flow-${episode.heaviestFlow ?? 'unknown'}`}
                    aria-hidden="true"
                  />
                  <strong>{episode.days}d</strong>
                  <small>{formatShort(episode.start)}</small>
                </div>
              ))}
            </div>
            <p className="report-method-note">{data.report.bleedingTrend.methodology}</p>
          </>
        )}
      </section>

      <section className="card chart-card symptom-card">
        <div className="chart-heading">
          <div>
            <div className="section-label">Symptoms</div>
            <h2>What shows up most</h2>
          </div>
          <span className="botanical-mark" aria-hidden="true" />
        </div>
        {data.symptoms.length === 0 ? (
          <EmptyChart
            title="No patterns yet"
            body="Symptoms you choose to log will gather here without judgment."
          />
        ) : (
          <div className="symptom-list">
            {data.symptoms.map((symptom, index) => (
              <div className="symptom-row" key={symptom.name}>
                <div className="symptom-meta">
                  <span><i>{index + 1}</i>{symptom.name}</span>
                  <strong>{symptom.count}×</strong>
                </div>
                <div className="symptom-track" aria-hidden="true">
                  <span style={{ width: `${(symptom.count / maxSymptomCount) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card chart-card">
        <div className="chart-heading">
          <div>
            <div className="section-label">Symptoms by phase</div>
            <h2>Complete check-ins only</h2>
          </div>
          <span className="report-sample">
            {data.report.completeness.completeCheckInDays} complete
          </span>
        </div>
        {data.report.symptomPhaseSummaries.length === 0 ? (
          <EmptyChart
            title="No comparable phase summary yet"
            body="Mark check-ins complete so missing days are never mistaken for symptom-free days."
          />
        ) : (
          <div className="phase-summary-list">
            {data.report.symptomPhaseSummaries.slice(0, 5).map((summary) => (
              <div className="phase-summary-row" key={summary.signal}>
                <div>
                  <strong>{summary.signal}</strong>
                  <span>{summary.phase}</span>
                </div>
                <p>{summary.occurrences}/{summary.completedCheckInsInPhase}</p>
              </div>
            ))}
          </div>
        )}
        <p className="report-method-note">
          Unlogged and partial days are excluded. These are associations in your entries, not
          proof that a phase caused a symptom.
        </p>
      </section>

      <section className="card chart-card temperature-card">
        <div className="chart-heading">
          <div>
            <div className="section-label">Basal temperature</div>
            <h2>Your latest readings</h2>
          </div>
          {latestTemperature !== null && (
            <strong className="latest-reading">{latestTemperature.toFixed(2)}°</strong>
          )}
        </div>
        {bbt.length < 3 ? (
          <EmptyChart
            title="Three readings unlock the line"
            body="Measure after waking, before getting up, for a more readable pattern."
          />
        ) : (
          <>
            <svg
              className="bbt-chart"
              viewBox="0 0 300 120"
              role="img"
              aria-label={`Basal temperature readings from ${bbtValues[0].toFixed(2)} to ${latestTemperature?.toFixed(2)} degrees Celsius`}
            >
              <defs>
                <linearGradient id="bbt-area" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--teal-500)" stopOpacity=".24" />
                  <stop offset="100%" stopColor="var(--teal-500)" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path className="bbt-grid-line" d="M16 20H284M16 61H284M16 102H284" />
              <path
                className="bbt-area"
                d={`M${bbtPoints.map((point) => `${point.x},${point.y}`).join(' L')} L284,108 L16,108 Z`}
              />
              <polyline
                className="bbt-line"
                points={bbtPoints.map((point) => `${point.x},${point.y}`).join(' ')}
              />
              {bbtPoints.map((point, index) => (
                <circle
                  key={bbt[index].date}
                  className={index === bbtPoints.length - 1 ? 'bbt-point is-latest' : 'bbt-point'}
                  cx={point.x}
                  cy={point.y}
                  r={index === bbtPoints.length - 1 ? 4.5 : 2.8}
                />
              ))}
            </svg>
            <div className="chart-axis">
              <span>{formatShort(bbt[0].date)}</span>
              <span>{formatShort(bbt[bbt.length - 1].date)}</span>
            </div>
            <div className="opk-summary">
              <span>Positive OPK logs</span>
              <strong>{positiveOpks.length}</strong>
              <small>in the displayed signal history</small>
            </div>
            <p className="report-method-note">
              BBT and OPK are plotted as observations. A chart alone does not confirm exact
              ovulation or pregnancy.
            </p>
          </>
        )}
      </section>

      <section className="card report-quality-card">
        <div>
          <span className="section-label">Data completeness · 90 days</span>
          <h2>{data.report.completeness.completeCoveragePercent}% complete</h2>
          <p>
            {data.report.completeness.completeCheckInDays} complete check-ins ·{' '}
            {data.report.completeness.daysWithAnyEntry} days with any entry
          </p>
        </div>
        <div className="report-coverage-track" aria-hidden="true">
          <span style={{ width: `${data.report.completeness.entryCoveragePercent}%` }} />
          <i style={{ width: `${data.report.completeness.completeCoveragePercent}%` }} />
        </div>
        <small>{data.report.completeness.methodology}</small>
      </section>
    </div>
  )
}

function EmptyChart({ title, body }: { title: string; body: string }) {
  return (
    <div className="empty-chart">
      <span className="empty-orbit" aria-hidden="true"><i /></span>
      <div>
        <strong>{title}</strong>
        <p>{body}</p>
      </div>
    </div>
  )
}
