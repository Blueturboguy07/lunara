import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState, type CSSProperties } from 'react'
import {
  PERIMENOPAUSE_RELIEF,
  PERIMENOPAUSE_SOURCES,
} from '../content/perimenopauseRelief'
import { db, getPeriodStarts } from '../db/schema'
import { PERI_SYMPTOMS } from '../db/taxonomy'
import { addDays } from '../engine/cycle'
import {
  buildPerimenopauseSummary,
  periMonthlyTimeline,
  type PeriDomainId,
} from '../engine/perimenopause'
import { formatShort, localToday } from '../lib/dates'
import { useApp } from '../state/appStore'
import { ArrowIcon } from '../components/ArrowIcon'
import '../styles/health.css'

export interface PerimenopauseScreenProps {
  onBack: () => void
}

function valueStyle(value: number): CSSProperties {
  return { '--health-value': `${Math.min(100, Math.max(0, value))}%` } as CSSProperties
}

function trendLabel(trend: ReturnType<typeof buildPerimenopauseSummary>['trend']): string {
  if (trend === 'increasing') return 'more symptom burden than the prior 28 days'
  if (trend === 'easing') return 'less symptom burden than the prior 28 days'
  if (trend === 'steady') return 'similar to the prior 28 days'
  return 'log 5+ days in each window to compare'
}

interface RecentSymptom {
  name: string
  activeDays: number
  latestDate: string
}

export function PerimenopauseScreen({ onBack }: PerimenopauseScreenProps) {
  const today = localToday()
  const openSheet = useApp((state) => state.openSheet)
  const [reliefDomain, setReliefDomain] = useState<PeriDomainId>('temperature')
  const data = useLiveQuery(async () => {
    const [periodStarts, logs] = await Promise.all([getPeriodStarts(), db.dailyLogs.toArray()])
    const windowStart = addDays(today, -27)
    const symptomDates = new Map<string, Set<string>>()
    for (const log of logs) {
      if (log.date < windowStart || log.date > today) continue
      const signals = [...(log.symptoms ?? []), ...(log.moods ?? [])]
      for (const signal of signals) {
        if (!PERI_SYMPTOMS.includes(signal as (typeof PERI_SYMPTOMS)[number])) continue
        const dates = symptomDates.get(signal) ?? new Set<string>()
        dates.add(log.date)
        symptomDates.set(signal, dates)
      }
    }
    const symptoms: RecentSymptom[] = [...symptomDates.entries()]
      .map(([name, dates]) => ({
        name,
        activeDays: dates.size,
        latestDate: [...dates].sort().at(-1) ?? today,
      }))
      .sort((a, b) => b.activeDays - a.activeDays || b.latestDate.localeCompare(a.latestDate))
    return {
      summary: buildPerimenopauseSummary(logs, periodStarts, today),
      timeline: periMonthlyTimeline(logs, today),
      symptoms,
    }
  }, [today])
  const relief = useMemo(
    () => PERIMENOPAUSE_RELIEF.find((item) => item.domain === reliefDomain),
    [reliefDomain],
  )

  return (
    <div className="health-overlay">
      <header className="health-topbar">
        <button className="health-icon-button" onClick={onBack} aria-label="Close perimenopause view">
          ‹
        </button>
        <div className="health-topbar-title">Midlife changes</div>
        <span />
      </header>

      <div className="health-scroll">
        <main className="health-canvas">
          {!data ? (
            <div className="health-empty">
              <strong>Reading your private log</strong>
              <p>The summary is calculated on this device.</p>
            </div>
          ) : (
            <>
              <section className="peri-result-hero">
                <div className="peri-result-orbit" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </div>
                <div className="health-kicker">Past 28 days</div>
                <h1>Your monthly symptom snapshot</h1>
                <p>
                  Check in over time to see how often temperature, sleep, focus, mood, and body
                  changes appear in your own log.
                </p>
                <div className="peri-result-badges">
                  <span>Private on-device summary</span>
                  <span>Not a diagnosis</span>
                </div>
              </section>

              <section className="health-panel peri-current-result">
                <div className="peri-result-meta">
                  <div>
                    <div className="health-kicker">Current snapshot</div>
                    <h2>
                      {data.summary.loggedDays === 0
                        ? 'Ready for your first check-in'
                        : data.summary.score === 0
                          ? 'No tracked symptoms on logged days'
                          : 'Your logged pattern is ready'}
                    </h2>
                  </div>
                  <div className="peri-result-number" aria-label={`${data.summary.score} out of 100`}>
                    <strong>{data.summary.score}</strong>
                    <span>of 100</span>
                  </div>
                </div>
                <p className="health-lede">
                  {data.summary.loggedDays
                    ? `Calculated across ${data.summary.loggedDays} logged ${data.summary.loggedDays === 1 ? 'day' : 'days'} with ${data.summary.trackingCoverage}% calendar coverage.`
                    : 'Add symptoms on a few days to create a personal, descriptive baseline.'}
                </p>
                <p className="peri-result-trend">
                  <span aria-hidden="true"><ArrowIcon /></span>
                  {trendLabel(data.summary.trend)}
                </p>
                <button
                  className="health-action peri-checkin-action"
                  onClick={() => {
                    onBack()
                    openSheet(today)
                  }}
                >
                  {data.summary.loggedDays ? 'Update today’s check-in' : 'Start a check-in'}
                </button>
              </section>

              <section className="health-panel">
                <div className="health-section-head" style={{ paddingTop: 0 }}>
                  <h2>Your recent symptoms</h2>
                  <span>past 28 days</span>
                </div>
                {data.symptoms.length ? (
                  <div className="peri-symptom-list">
                    {data.symptoms.map((symptom) => (
                      <div className="peri-symptom-row" key={symptom.name}>
                        <span className="peri-symptom-mark" aria-hidden="true">✓</span>
                        <div>
                          <strong>{symptom.name}</strong>
                          <p>
                            {symptom.activeDays} logged {symptom.activeDays === 1 ? 'day' : 'days'} ·
                            latest {formatShort(symptom.latestDate)}
                          </p>
                        </div>
                        <span aria-hidden="true">›</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="health-empty" style={{ marginTop: 14 }}>
                    <strong>No tracked midlife symptoms in this window</strong>
                    <p>This means none were logged; it does not mean none occurred.</p>
                  </div>
                )}
              </section>

              <section className="health-panel">
                <div className="health-section-head" style={{ paddingTop: 0 }}>
                  <h2>Symptom domains</h2>
                  <span>share of logged days</span>
                </div>
                <div className="health-domain-list" style={{ marginTop: 17 }}>
                  {data.summary.domains.map((domain) => (
                    <div className="health-domain-row" key={domain.id}>
                      <span>{domain.label}</span>
                      <div className="health-meter">
                        <span style={valueStyle(domain.score)} />
                      </div>
                      <span>{domain.score}%</span>
                    </div>
                  ))}
                </div>
              </section>

              <section className="health-panel">
                <div className="health-section-head" style={{ paddingTop: 0 }}>
                  <h2>Six-window view</h2>
                  <span>28 days each</span>
                </div>
                <div className="health-spark" aria-label="Symptom burden by 28-day window">
                  {data.timeline.map((window) => (
                    <div className="health-spark-column" key={window.end}>
                      <div
                        className="health-spark-bar"
                        style={valueStyle(window.score)}
                        title={`${window.score} burden score`}
                      />
                      <small>{formatShort(window.end)}</small>
                    </div>
                  ))}
                </div>
              </section>

              <section className="health-panel">
                <div className="health-section-head" style={{ paddingTop: 0 }}>
                  <h2>Cycle observations</h2>
                  <span>descriptive only</span>
                </div>
                {data.summary.observations.length ? (
                  <div style={{ marginTop: 5 }}>
                    {data.summary.observations.map((observation) => (
                      <div
                        className="health-observation"
                        data-level={observation.level}
                        key={observation.id}
                      >
                        <strong>{observation.title}</strong>
                        <p>{observation.detail}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="health-empty" style={{ marginTop: 14 }}>
                    <strong>No strong cycle marker yet</strong>
                    <p>
                      Continue logging dates and flow. A quiet summary is not proof that a transition
                      is or is not happening.
                    </p>
                  </div>
                )}
              </section>

              <section>
                <div className="health-section-head">
                  <h2>Relief notebook</h2>
                  <span>choose a topic</span>
                </div>
                <div
                  style={{
                    display: 'flex',
                    overflowX: 'auto',
                    gap: 6,
                    padding: '11px 1px 10px',
                    scrollbarWidth: 'none',
                  }}
                >
                  {PERIMENOPAUSE_RELIEF.map((option) => (
                    <button
                      className="health-source"
                      style={
                        reliefDomain === option.domain
                          ? {
                              background: 'var(--health-ink)',
                              color: '#fff',
                              borderColor: 'var(--health-ink)',
                            }
                          : undefined
                      }
                      onClick={() => setReliefDomain(option.domain)}
                      key={option.id}
                    >
                      {option.title.split(' & ')[0]}
                    </button>
                  ))}
                </div>
                {relief && (
                  <article className="health-relief-card">
                    <h3>{relief.title}</h3>
                    <p>{relief.intro}</p>
                    <ul>
                      {relief.tryNow.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                    <details className="health-details" style={{ marginTop: 10 }}>
                      <summary>Questions for a clinician</summary>
                      <ul style={{ marginTop: 0 }}>
                        {relief.askAbout.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </details>
                    <a
                      className="health-source"
                      style={{ marginTop: 12 }}
                      href={relief.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Read public-health guidance
                    </a>
                  </article>
                )}
              </section>

              <section className="health-panel">
                <div className="health-kicker">Sources</div>
                <p className="health-lede" style={{ margin: '8px 0 12px' }}>
                  Educational content is grounded in current public-health guidance.
                </p>
                {PERIMENOPAUSE_SOURCES.map((source) => (
                  <a
                    className="health-source"
                    href={source.url}
                    target="_blank"
                    rel="noreferrer"
                    key={source.url}
                  >
                    {source.label}
                  </a>
                ))}
              </section>

              <p className="health-note">{data.summary.methodology}</p>
            </>
          )}
        </main>
      </div>
    </div>
  )
}
