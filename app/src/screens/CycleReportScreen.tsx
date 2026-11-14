import { useLiveQuery } from 'dexie-react-hooks'
import { useState, type CSSProperties } from 'react'
import { db, getPeriodStarts } from '../db/schema'
import { buildCycleReport } from '../engine/patterns'
import { completedCycles } from '../engine/stats'
import { formatShort, localToday } from '../lib/dates'
import { exportCurrentReport } from '../native/reportExport'
import '../styles/health.css'
import '../styles/reports.css'

export interface CycleReportScreenProps {
  onBack: () => void
}

function percentageStyle(value: number): CSSProperties {
  return { '--health-value': `${Math.min(100, Math.max(0, value))}%` } as CSSProperties
}

export function CycleReportScreen({ onBack }: CycleReportScreenProps) {
  const today = localToday()
  const [openEvidence, setOpenEvidence] = useState<string | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)
  const data = useLiveQuery(async () => {
    const [periodStarts, logs] = await Promise.all([getPeriodStarts(), db.dailyLogs.toArray()])
    return {
      report: buildCycleReport(logs, periodStarts, today),
      cycles: completedCycles(periodStarts).slice(-12),
    }
  }, [today])

  async function exportReport() {
    setExportError(null)
    try {
      await exportCurrentReport('Lunara private cycle report')
    } catch {
      setExportError('The report export sheet could not open. Please try again.')
    }
  }

  return (
    <div className="health-overlay">
      <header className="health-topbar">
        <button className="health-icon-button" onClick={onBack} aria-label="Close cycle report">
          ‹
        </button>
        <div className="health-topbar-title">Private cycle report</div>
        <button
          className="health-icon-button"
          onClick={() => void exportReport()}
          aria-label="Export report"
        >
          ↗
        </button>
      </header>

      <div className="health-scroll">
        <main className="health-canvas">
          {exportError && (
            <p className="report-export-error no-print" role="alert">
              {exportError}
            </p>
          )}
          {!data ? (
            <div className="health-empty">
              <strong>Building your report</strong>
              <p>Lunara calculates this summary on this phone.</p>
            </div>
          ) : (
            <>
              <section className="health-hero">
                <div className="health-kicker">Generated {formatShort(today)}</div>
                <h1 className="health-display">Your cycle, in context.</h1>
                <div className="health-hero-number">
                  {data.report.averageCycleDays ?? '—'}
                  <small>average days</small>
                </div>
              </section>

              <section>
                <div className="health-section-head">
                  <h2>At a glance</h2>
                  <span>{data.report.completedCycleCount} completed cycles</span>
                </div>
                <div className="health-metric-grid" style={{ marginTop: 11 }}>
                  <div className="health-metric">
                    <strong>
                      {data.report.shortestCycleDays == null
                        ? '—'
                        : `${data.report.shortestCycleDays}–${data.report.longestCycleDays}`}
                    </strong>
                    <span>cycle-length range · days</span>
                  </div>
                  <div className="health-metric">
                    <strong>{data.report.averageBleedingDays ?? '—'}</strong>
                    <span>average logged bleeding days</span>
                  </div>
                  <div className="health-metric">
                    <strong>{data.report.completeness.completeCheckInDays}</strong>
                    <span>complete check-ins · last 90</span>
                  </div>
                  <div className="health-metric">
                    <strong>{data.report.completeness.completeCoveragePercent}%</strong>
                    <span>complete-check-in coverage</span>
                  </div>
                </div>
              </section>

              <section className="health-panel">
                <div className="health-section-head" style={{ paddingTop: 0 }}>
                  <h2>Six vs twelve cycles</h2>
                  <span>completed cycles only</span>
                </div>
                <div className="health-metric-grid" style={{ marginTop: 13 }}>
                  {[data.report.cycleWindows.six, data.report.cycleWindows.twelve].map((window) => (
                    <div className="health-metric" key={window.windowCycles}>
                      <strong>{window.averageDays ?? '—'}</strong>
                      <span>
                        latest {window.windowCycles} · {window.sampleSize} available ·{' '}
                        {window.trendDirection}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="report-method-note">
                  The window stays fixed to the requested number and never fills missing cycles.
                  Direction is descriptive, not a forecast.
                </p>
              </section>

              <section className="health-panel">
                <div className="health-section-head" style={{ paddingTop: 0 }}>
                  <h2>Cycle rhythm</h2>
                  <span>most recent</span>
                </div>
                {data.cycles.length ? (
                  <div className="health-spark" aria-label="Recent cycle lengths">
                    {data.cycles.map((cycle) => (
                      <div className="health-spark-column" key={cycle.start}>
                        <div
                          className="health-spark-bar"
                          style={percentageStyle((cycle.length / 45) * 100)}
                          title={`${cycle.length} days`}
                        />
                        <small>{cycle.length}d</small>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="health-empty" style={{ marginTop: 12 }}>
                    <strong>No completed cycle yet</strong>
                    <p>Two period starts create the first cycle-length observation.</p>
                  </div>
                )}
              </section>

              <section className="health-panel">
                <div className="health-section-head" style={{ paddingTop: 0 }}>
                  <h2>Bleeding history</h2>
                  <span>{data.report.bleedingTrend.sampleSize} logged episodes</span>
                </div>
                {data.report.bleedingTrend.episodes.length ? (
                  <>
                    <div className="flow-episode-strip">
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
                    <p className="report-method-note">
                      {data.report.bleedingTrend.methodology}
                    </p>
                  </>
                ) : (
                  <div className="health-empty" style={{ marginTop: 12 }}>
                    <strong>No flow episodes logged yet</strong>
                    <p>Log a flow level on each bleeding day to make this summary useful.</p>
                  </div>
                )}
              </section>

              <section>
                <div className="health-section-head">
                  <h2>Patterns in your entries</h2>
                  <span>{data.report.patterns.length} found</span>
                </div>
                <div style={{ marginTop: 11 }}>
                  {data.report.patterns.length ? (
                    data.report.patterns.map((pattern) => {
                      const isOpen = openEvidence === pattern.id
                      return (
                        <button
                          className="health-pattern"
                          key={pattern.id}
                          onClick={() => setOpenEvidence(isOpen ? null : pattern.id)}
                          aria-expanded={isOpen}
                        >
                          <span className="health-pattern-top">
                            <h3>{pattern.title}</h3>
                            <span className="health-badge">{pattern.confidence}</span>
                          </span>
                          <p>{pattern.summary}</p>
                          {isOpen && (
                            <span className="health-evidence">
                              <b>Why this appeared</b>
                              <br />
                              {pattern.explanation}
                            </span>
                          )}
                        </button>
                      )
                    })
                  ) : (
                    <div className="health-empty">
                      <strong>No repeatable pattern yet</strong>
                      <p>
                        Patterns need at least three entries across two completed cycles. Lunara
                        does not turn one unusual day into a conclusion.
                      </p>
                    </div>
                  )}
                </div>
              </section>

              <section className="health-panel">
                <div className="health-section-head" style={{ paddingTop: 0 }}>
                  <h2>Symptoms by phase</h2>
                  <span>complete check-ins only</span>
                </div>
                {data.report.symptomPhaseSummaries.length ? (
                  <div className="phase-summary-list">
                    {data.report.symptomPhaseSummaries.map((summary) => (
                      <div className="phase-summary-row" key={summary.signal}>
                        <div>
                          <strong>{summary.signal}</strong>
                          <span>{summary.phase} · {summary.cyclesObserved} cycles</span>
                        </div>
                        <p>{summary.occurrences}/{summary.completedCheckInsInPhase}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="health-empty" style={{ marginTop: 12 }}>
                    <strong>No comparable phase summary yet</strong>
                    <p>
                      Mark check-ins complete so an unlogged day is never treated as
                      symptom-free.
                    </p>
                  </div>
                )}
                <p className="report-method-note">
                  These are associations in your entries. They do not show that a phase caused a
                  symptom and they do not diagnose a condition.
                </p>
              </section>

              <section className="health-panel">
                <div className="health-section-head" style={{ paddingTop: 0 }}>
                  <h2>Most logged</h2>
                  <span>all time</span>
                </div>
                {data.report.topSignals.length ? (
                  <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 13 }}>
                    {data.report.topSignals.map((signal) => {
                      const max = data.report.topSignals[0]?.count ?? 1
                      return (
                        <div key={signal.name}>
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              marginBottom: 6,
                              fontSize: 11,
                            }}
                          >
                            <strong>{signal.name}</strong>
                            <span>{signal.count} days</span>
                          </div>
                          <div className="health-meter">
                            <span style={percentageStyle((signal.count / max) * 100)} />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <p className="health-lede" style={{ marginTop: 10 }}>
                    Symptoms, moods, and events will appear here after you log them.
                  </p>
                )}
              </section>

              <section className="health-panel">
                <div className="health-section-head" style={{ paddingTop: 0 }}>
                  <h2>Fertility observations</h2>
                  <span>plotting data, not confirmation</span>
                </div>
                <div className="health-metric-grid" style={{ marginTop: 13 }}>
                  <div className="health-metric">
                    <strong>
                      {data.report.fertilitySignals.filter((point) => point.bbtCelsius != null).length}
                    </strong>
                    <span>BBT readings</span>
                  </div>
                  <div className="health-metric">
                    <strong>
                      {data.report.fertilitySignals.filter((point) => point.opk === 'positive').length}
                    </strong>
                    <span>positive OPK logs</span>
                  </div>
                </div>
                <p className="report-method-note">
                  BBT and OPK entries are shown as observations. Neither series identifies an
                  exact ovulation moment or confirms pregnancy.
                </p>
              </section>

              <p className="health-note">
                {data.report.methodology} Bring the original dates and details—not only this
                summary—to a healthcare appointment.
              </p>
              <button className="health-action" onClick={() => void exportReport()}>
                Print or save as PDF
              </button>
            </>
          )}
        </main>
      </div>
    </div>
  )
}
