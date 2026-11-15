import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { DateStrip } from '../components/DateStrip'
import { LunaraMark } from '../components/LunaraMark'
import { PREGNANCY_WEEKS } from '../content/pregnancyWeeks'
import {
  db,
  getHealthProfile,
  getSetting,
  getOvulations,
  getPeriodStarts,
  SK,
  type DailyLog,
  type Goal,
} from '../db/schema'
import { addDays, daysBetween } from '../engine/cycle'
import { buildCycleForecast } from '../engine/cycleForecast'
import {
  analyzePatterns,
  type CyclePhase,
  type PatternInsight,
} from '../engine/patterns'
import { periWindowSummary } from '../engine/perimenopause'
import {
  pregnancyTimeline,
  resolvePregnancyDating,
  type PregnancyDatingMethod,
  type PregnancyDatingResult,
} from '../engine/pregnancyDating'
import {
  applyPredictionContext,
  periodTimingStatus,
} from '../engine/predictionContext'
import { localToday } from '../lib/dates'
import { useHorizontalDrag } from '../lib/useHorizontalDrag'
import { publishWidgetSnapshot, type CycleWidgetSnapshot } from '../native/widgets'
import { useApp, type TrackerFocus } from '../state/appStore'

interface DailyInsight {
  key: string
  eyebrow: string
  value: string
  detail: string
  tone: 'rose' | 'teal' | 'blue'
  action: 'cycle' | 'ttc' | TrackerFocus
}

interface PhaseHero {
  tone: 'period' | 'ovulation' | 'fertile' | 'cycle' | 'peri' | 'empty'
  eyebrow: string
  title: string
  body: string
}

const PREGNANCY_DATING_LABELS: Record<PregnancyDatingMethod, string> = {
  'clinician-edd': 'clinician-assigned due date',
  lmp: 'last-period date',
  conception: 'conception date',
  'ivf-day-3': 'day-3 embryo transfer',
  'ivf-day-5': 'day-5 embryo transfer',
}

function pregnancyDatingStatus(dating: PregnancyDatingResult): string {
  return dating.provisional ? 'provisional estimate' : 'clinician assigned'
}

function phaseFor(
  goal: Goal,
  cycleDay: number | null,
  daysToOvulation: number | null,
  uncertaintyDays: number,
  stale = false,
  flowLogged = false,
): PhaseHero {
  // A months-old period start tells us how long tracking lapsed, not where the
  // cycle is. Ask for a fresh date instead of counting across the gap.
  if (stale) {
    return {
      tone: 'empty',
      eyebrow: 'Your cycle',
      title: 'Let’s pick this back up',
      body: 'It has been a while since a period was logged, so Lunara paused its estimates. Add your most recent period to restart them.',
    }
  }
  // A day with logged flow is a period day, also after day 5 (blind test L3).
  if (cycleDay && (flowLogged || cycleDay <= 5)) {
    return {
      tone: 'period',
      eyebrow: 'Period:',
      title: `Day ${cycleDay}`,
      body: 'Your period day, based on the flow dates you logged.',
    }
  }
  if (daysToOvulation === 0) {
    return {
      tone: 'ovulation',
      eyebrow: 'Estimated today',
      title: 'Ovulation may be today',
      body: `A calendar estimate with an uncertainty window of about ±${uncertaintyDays} days.`,
    }
  }
  if (daysToOvulation != null && daysToOvulation > 0 && daysToOvulation <= 5) {
    return {
      tone: 'fertile',
      eyebrow: 'Estimated fertile window',
      title: `Estimated ovulation in about ${daysToOvulation} ${daysToOvulation === 1 ? 'day' : 'days'}`,
      body: 'Logging discharge, ovulation tests, and temperature can add useful context.',
    }
  }
  if (goal === 'peri') {
    return {
      tone: 'peri',
      eyebrow: 'Midlife tracking',
      title: cycleDay ? `Cycle day ${cycleDay}` : 'Notice the pattern',
      body: 'Cycle timing and the symptoms you choose to log are summarized privately.',
    }
  }
  if (cycleDay) {
    return {
      tone: 'cycle',
      eyebrow: goal === 'ttc' ? 'Trying to conceive' : 'Your cycle',
      title: `Cycle day ${cycleDay}`,
      body: 'A simple day count from the first day of your most recent logged period.',
    }
  }
  return {
    tone: 'empty',
    eyebrow: 'Your cycle',
    title: 'Start with your dates',
    body: 'Add two period starts to unlock a personal estimate and uncertainty range.',
  }
}

function compactDate(date: string | null | undefined): string {
  if (!date) return 'Not available'
  return new Date(date + 'T12:00:00').toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })
}

function loggedSignals(log?: DailyLog): { count: number; detail: string } {
  if (!log) return { count: 0, detail: 'No check-in recorded for this date' }
  const named = [
    ...(log.symptoms ?? []),
    ...(log.moods ?? []),
    ...(log.flow ? [`${log.flow} flow`] : []),
    ...(log.discharge ? [`${log.discharge.replace('-', ' ')} discharge`] : []),
    ...(log.opk ? [`${log.opk} ovulation test`] : []),
    ...((log.intimacyEvents ?? (log.sex ? [log.sex] : [])).map((item) =>
      item.replaceAll('-', ' '),
    )),
  ]
  const structuredEventCount =
    (log.digestion?.length ?? 0) +
    (log.activities?.length ?? 0) +
    (log.lifestyle?.length ?? 0)
  const contextualEventCount =
    structuredEventCount > 0 ? structuredEventCount : (log.events?.length ?? 0)
  const count =
    named.length +
    (log.checkInComplete ? 1 : 0) +
    (log.bbt !== undefined ? 1 : 0) +
    (log.pregnancyTest ? 1 : 0) +
    contextualEventCount +
    (log.weightKg !== undefined ? 1 : 0) +
    (log.waterMl !== undefined ? 1 : 0) +
    (log.sleepMinutes !== undefined ? 1 : 0) +
    (log.steps !== undefined ? 1 : 0) +
    (log.notes?.trim() ? 1 : 0)

  return {
    count,
    detail:
      named.length > 0
        ? named.slice(0, 2).join(' · ')
        : log.checkInComplete && count === 1
          ? 'Check-in marked complete'
          : count > 0
            ? 'Measurements or notes recorded'
            : 'No check-in recorded for this date',
  }
}

function estimatedCyclePhase(
  cycleDay: number | null,
  daysToOvulation: number | null,
): CyclePhase | null {
  if (cycleDay == null) return null
  if (cycleDay <= 5) return 'menstrual'
  if (daysToOvulation == null) return null
  if (daysToOvulation > 2) return 'follicular'
  if (daysToOvulation >= -1) return 'ovulatory'
  return 'luteal'
}

function symptomPatternForDate(
  patterns: PatternInsight[],
  cycleDay: number | null,
  daysToOvulation: number | null,
): PatternInsight | undefined {
  if (cycleDay == null) return undefined
  const dayCluster = patterns.find(
    (pattern) =>
      pattern.kind === 'cycle-day-cluster' &&
      pattern.evidence.cycleDayRange !== undefined &&
      cycleDay >= pattern.evidence.cycleDayRange.start &&
      cycleDay <= pattern.evidence.cycleDayRange.end,
  )
  if (dayCluster) return dayCluster

  const phase = estimatedCyclePhase(cycleDay, daysToOvulation)
  if (!phase) return undefined
  return patterns.find(
    (pattern) =>
      pattern.kind === 'phase-association' && pattern.evidence.phase === phase,
  )
}

export function Today() {
  const {
    openSheet,
    setCalendarOpen,
    setArticleSlug,
    setTab,
    setCycleReportOpen,
    setTtcDetailOpen,
    setPregnancyDetailOpen,
    setPerimenopauseOpen,
  } = useApp()
  const today = localToday()
  const [selectedDate, setSelectedDate] = useState(today)
  // Which way the last change moved, so the incoming day animates in from the
  // side it came from instead of always rising from below.
  const [enterFrom, setEnterFrom] = useState<'none' | 'next' | 'previous'>('none')

  const goToDate = (date: string, direction: 'none' | 'next' | 'previous' = 'none') => {
    setEnterFrom(direction)
    setSelectedDate(date)
  }

  const heroDrag = useHorizontalDrag({
    onCommit: (direction) =>
      goToDate(addDays(selectedDate, direction), direction === 1 ? 'next' : 'previous'),
  })

  const data = useLiveQuery(async () => {
    const [periodStarts, ovulations, profile, legacyPregnancyLmp, historyLogs, selectedLog] =
      await Promise.all([
        getPeriodStarts(),
        getOvulations(),
        getHealthProfile(),
        getSetting(SK.pregnancyLMP),
        db.dailyLogs
          .where('date')
          .belowOrEqual(selectedDate)
          .toArray(),
        db.dailyLogs.get(selectedDate),
      ])
    const forecastPeriodStarts = periodStarts.filter((date) => date <= selectedDate)
    const forecastOvulations = ovulations.filter((date) => date <= selectedDate)
    const recentLogs = historyLogs.filter(
      (log) => log.date >= addDays(selectedDate, -27),
    )
    const forecast = buildCycleForecast(
      {
        periodStarts: forecastPeriodStarts,
        ovulations: forecastOvulations,
        today: selectedDate,
      },
      {
        baselineCycleLength: profile.cycle.typicalCycleLength,
        positiveOpkDates: recentLogs
          .filter((log) => log.opk === 'positive' && log.date <= selectedDate)
          .map((log) => log.date),
        bbtShiftDates: forecastOvulations,
      },
    )
    const rawPrediction = forecast.prediction
    const personalized = applyPredictionContext(rawPrediction, profile, {
      completedCycles: forecast.diagnostics.completedCycleCount,
      bbtShiftEstimateCount: forecastOvulations.length,
      positiveOpkThisCycle: forecast.diagnostics.evidence.some(
        (item) => item.kind === 'opk-suggestive',
      ),
    })
    const pregnancyLmp = profile.reproductive.pregnancyLmp ?? legacyPregnancyLmp
    const pregnancyDating =
      (profile.reproductive.pregnancyDating
        ? resolvePregnancyDating({
            method: profile.reproductive.pregnancyDating.method,
            date: profile.reproductive.pregnancyDating.inputDate,
            clinicianConfirmed:
              profile.reproductive.pregnancyDating.authority === 'clinician-assigned',
          })
        : undefined) ??
      (pregnancyLmp
        ? resolvePregnancyDating({
            method: 'lmp',
            date: pregnancyLmp,
          })
        : undefined)
    const symptomPatterns = analyzePatterns(
      historyLogs.map((log) => ({
        date: log.date,
        checkInComplete: log.checkInComplete,
        symptoms: log.symptoms,
      })),
      forecastPeriodStarts,
    )
    return {
      prediction: personalized.prediction,
      predictionContext: personalized,
      forecastDiagnostics: forecast.diagnostics,
      goal: profile.primaryGoal,
      pregnancy: pregnancyDating ? pregnancyTimeline(pregnancyDating, selectedDate) : null,
      periScore: periWindowSummary(recentLogs, selectedDate).score,
      symptomPatterns,
      selectedLog,
    }
  }, [selectedDate])

  useEffect(() => {
    if (!data || selectedDate !== today) return

    let snapshot: CycleWidgetSnapshot
    if (data.goal === 'pregnancy') {
      const pregnancy = data.pregnancy
      snapshot = pregnancy
        ? {
            generatedAt: new Date().toISOString(),
            headline: `${pregnancy.week} weeks, ${pregnancy.dayOfWeek} days`,
            detail: `${pregnancy.daysRemaining} days to ${
              pregnancy.dating.provisional ? 'your estimated due date' : 'your due date'
            } · ${pregnancyDatingStatus(pregnancy.dating)}`,
            phase: 'pregnancy',
            accent: 'apricot',
          }
        : {
            generatedAt: new Date().toISOString(),
            headline: 'Open Lunara',
            detail: 'Review your pregnancy timeline.',
            phase: 'pregnancy',
            accent: 'apricot',
          }
    } else {
      const cycleDay = data.prediction.cycleDay
      const nextPeriodDate = data.prediction.nextPeriodStart ?? undefined
      const daysToOvulation = data.prediction.ovulationDate
        ? daysBetween(selectedDate, data.prediction.ovulationDate)
        : null
      const inPeriod = cycleDay != null && (cycleDay <= 5 || Boolean(data.selectedLog?.flow))
      const ovulationToday = daysToOvulation === 0
      snapshot = {
        generatedAt: new Date().toISOString(),
        headline: inPeriod
          ? `Period · Day ${cycleDay}`
          : ovulationToday
            ? 'Ovulation may be today'
            : cycleDay
              ? `Cycle day ${cycleDay}`
              : 'Open Lunara',
        detail: ovulationToday
          ? `Calendar estimate · about ±${data.prediction.uncertaintyDays} days`
          : nextPeriodDate
            ? `Next period estimate · ${nextPeriodDate}`
            : 'Log a period date to update your private summary.',
        cycleDay: cycleDay ?? undefined,
        phase: inPeriod
          ? 'period'
          : ovulationToday
            ? 'ovulation'
            : data.prediction.fertileWindow &&
                selectedDate >= data.prediction.fertileWindow.start &&
                selectedDate <= data.prediction.fertileWindow.end
              ? 'fertile'
              : 'follicular',
        nextPeriodDate,
        fertileToday: Boolean(
          data.prediction.fertileWindow &&
            selectedDate >= data.prediction.fertileWindow.start &&
            selectedDate <= data.prediction.fertileWindow.end,
        ),
        accent: inPeriod ? 'rose' : 'teal',
      }
    }

    void publishWidgetSnapshot(snapshot).catch(() => undefined)
  }, [data, selectedDate, today])

  if (!data) return <div className="page page-loading" aria-label="Loading today" />

  if (data.goal === 'pregnancy') {
    const pregnancy = data.pregnancy
    const pregnancySignals = loggedSignals(data.selectedLog)
    return (
      <div className="page today-page pregnancy-page">
        <Header date={selectedDate} today={today} onCalendar={() => setCalendarOpen(true)} />
        <section className="date-panel" aria-label="Choose a day to review">
          <DateStrip
            selectedDate={selectedDate}
            prediction={data.prediction}
            onSelectDate={setSelectedDate}
            today={today}
          />
        </section>
        {pregnancy ? (
          <section
            key={selectedDate}
            className="phase-hero phase-pregnancy"
            aria-label={`Pregnancy week ${pregnancy.week}`}
          >
            <div className="pregnancy-growth-mark" aria-hidden="true">
              <span className="growth-orbit growth-orbit-one" />
              <span className="growth-orbit growth-orbit-two" />
              <span className="growth-seed">
                <i />
              </span>
            </div>
            <div className="phase-copy">
              <span className="phase-eyebrow">Your pregnancy</span>
              <h1>
                {pregnancy.week} weeks, {pregnancy.dayOfWeek} days
              </h1>
              <p>
                Trimester {pregnancy.trimester} · {pregnancy.daysRemaining} days to{' '}
                {pregnancy.dating.provisional ? 'your estimated due date' : 'your due date'}
              </p>
              <span className="phase-eyebrow">
                Based on {PREGNANCY_DATING_LABELS[pregnancy.dating.method]} ·{' '}
                {pregnancyDatingStatus(pregnancy.dating)}
              </span>
            </div>
            <button
              className="phase-detail-link"
              onClick={() => setPregnancyDetailOpen(true)}
            >
              Due {pregnancy.estimatedDueDate}
              <span aria-hidden="true">›</span>
            </button>
          </section>
        ) : (
          <div className="card empty-card">
            Add or check your pregnancy dating source in Settings to see pregnancy progress.
          </div>
        )}

        <section className="today-quick-actions" aria-label={`Log for ${compactDate(selectedDate)}`}>
          <button
            type="button"
            className={data.selectedLog?.flow ? 'quick-action is-recorded' : 'quick-action'}
            onClick={() => openSheet(selectedDate, 'flow')}
          >
            <span className="quick-action-circle quick-action-period" aria-hidden="true">
              <svg viewBox="0 0 40 40">
                <path d="M20 6c4.7 6.3 9.3 11.3 9.3 17.2A9.3 9.3 0 0 1 20 32.5a9.3 9.3 0 0 1-9.3-9.3C10.7 17.3 15.3 12.3 20 6Z" />
                <path d="m23.2 15.3 2.9 2.9-8.9 8.9-4.1 1.2 1.2-4.1 8.9-8.9Z" />
              </svg>
            </span>
            <strong>{data.selectedLog?.flow ? 'Edit period' : 'Log period'}</strong>
          </button>
          <button
            type="button"
            className={
              (data.selectedLog?.symptoms?.length ?? 0) > 0
                ? 'quick-action is-recorded'
                : 'quick-action'
            }
            onClick={() => openSheet(selectedDate, 'symptoms')}
          >
            <span className="quick-action-circle" aria-hidden="true">
              <svg viewBox="0 0 40 40">
                <path d="M20 10v20M10 20h20" />
              </svg>
            </span>
            <strong>Symptoms</strong>
          </button>
          <button
            type="button"
            className={
              (data.selectedLog?.intimacyEvents?.length ?? 0) > 0 || data.selectedLog?.sex
                ? 'quick-action is-recorded'
                : 'quick-action'
            }
            onClick={() => openSheet(selectedDate, 'intimacy')}
          >
            <span className="quick-action-circle" aria-hidden="true">
              <svg viewBox="0 0 40 40">
                <path d="M20 31.5S8.5 25 8.5 16.8c0-4.6 5.7-7.4 9-4.1L20 15l2.5-2.3c3.3-3.3 9 .5 9 4.1C31.5 25 20 31.5 20 31.5Z" />
              </svg>
            </span>
            <strong>Sex</strong>
          </button>
        </section>

        <section className="daily-insights-section" aria-labelledby="pregnancy-daily-insights-title">
          <div className="section-heading daily-heading">
            <h2 id="pregnancy-daily-insights-title">
              My daily insights
              <span className="daily-heading-when">
                {' · '}
                {selectedDate === today ? 'Today' : compactDate(selectedDate)}
              </span>
            </h2>
          </div>
          <div className="daily-insight-rail">
            <button
              type="button"
              className="daily-insight-tile insight-blue"
              onClick={() => pregnancy ? setPregnancyDetailOpen(true) : setTab('settings')}
            >
              <span>Pregnancy timeline</span>
              <strong>{pregnancy ? `Week ${pregnancy.week} + ${pregnancy.dayOfWeek}` : 'Needs dating'}</strong>
              <small>
                {pregnancy
                  ? `Trimester ${pregnancy.trimester}, from your selected dating source`
                  : 'Add a dating source in settings'}
              </small>
              <i aria-hidden="true">›</i>
            </button>
            <button
              type="button"
              className="daily-insight-tile insight-teal"
              onClick={() => pregnancy ? setPregnancyDetailOpen(true) : setTab('settings')}
            >
              <span>{pregnancy?.dating.provisional ? 'Estimated due date' : 'Due date'}</span>
              <strong>{pregnancy ? compactDate(pregnancy.estimatedDueDate) : 'Not set'}</strong>
              <small>
                {pregnancy
                  ? `Based on ${PREGNANCY_DATING_LABELS[pregnancy.dating.method]}`
                  : 'No pregnancy date is currently stored'}
              </small>
              <i aria-hidden="true">›</i>
            </button>
            <button
              type="button"
              className="daily-insight-tile insight-rose"
              onClick={() => openSheet(selectedDate, 'symptoms')}
            >
              <span>Your daily log</span>
              <strong>
                {pregnancySignals.count > 0 ? `${pregnancySignals.count} logged` : 'Nothing yet'}
              </strong>
              <small>{pregnancySignals.detail}</small>
              <i aria-hidden="true">›</i>
            </button>
          </div>
        </section>
        {pregnancy && (
          <button className="card phase-reading-card" onClick={() => setPregnancyDetailOpen(true)}>
            <div className="section-label">What to expect at {pregnancy.week} weeks</div>
            <p>{PREGNANCY_WEEKS[pregnancy.week] ?? 'Growing steadily, one quiet day at a time.'}</p>
            <span>Open the week guide <b aria-hidden="true">↗</b></span>
          </button>
        )}
        <Disclaimer />
      </div>
    )
  }

  const rawDaysUntil =
    data.prediction.nextPeriodStart != null
      ? daysBetween(selectedDate, data.prediction.nextPeriodStart)
      : null
  const timing = periodTimingStatus(
    selectedDate,
    data.prediction.nextPeriodStart,
    data.prediction.uncertaintyDays,
  )
  const daysLate =
    timing.state === 'beyond-estimated-window' ? timing.daysBeyondWindow : 0
  const daysToOvulation =
    data.prediction.ovulationDate != null
      ? daysBetween(selectedDate, data.prediction.ovulationDate)
      : null
  const fertileSoon = daysToOvulation != null && daysToOvulation >= 0 && daysToOvulation <= 5
  const stale = data.forecastDiagnostics.stale
  const phase = phaseFor(
    data.goal,
    data.prediction.cycleDay,
    daysToOvulation,
    data.prediction.uncertaintyDays,
    stale,
    Boolean(data.selectedLog?.flow),
  )
  // A negative countdown means the estimate has passed. Saying "in 0 days"
  // reads as "today"; the honest phrasing is how far past the estimate we are.
  const periodEstimate =
    rawDaysUntil == null
      ? null
      : rawDaysUntil > 0
        ? `Next period estimated in ${rawDaysUntil} day${rawDaysUntil === 1 ? '' : 's'}`
        : rawDaysUntil === 0
          ? 'Next period estimated today'
          : `Estimated period was ${-rawDaysUntil} day${rawDaysUntil === -1 ? '' : 's'} ago`
  const estimate =
    data.goal === 'ttc' && daysToOvulation != null && daysToOvulation >= 0
      ? `Estimated ovulation in about ${daysToOvulation} day${daysToOvulation === 1 ? '' : 's'}`
      : periodEstimate
  const fertileWindow = data.prediction.fertileWindow
  const insideEstimatedFertileWindow = Boolean(
    fertileWindow &&
      selectedDate >= fertileWindow.start &&
      selectedDate <= fertileWindow.end,
  )
  const daysUntilFertileWindow =
    fertileWindow && selectedDate < fertileWindow.start
      ? daysBetween(selectedDate, fertileWindow.start)
      : null
  const fertilityInsight: DailyInsight = fertileWindow
    ? {
        key: 'fertility-timing',
        eyebrow: 'Fertility timing',
        value: insideEstimatedFertileWindow
          ? 'Inside estimate'
          : daysUntilFertileWindow != null
            ? `Starts in ${daysUntilFertileWindow}d`
            : 'Outside estimate',
        detail: `${compactDate(fertileWindow.start)}–${compactDate(
          fertileWindow.end,
        )} calendar estimate · not contraception`,
        tone: 'rose',
        action: data.goal === 'ttc' ? 'ttc' : 'cycle',
      }
    : {
        key: 'fertility-timing',
        eyebrow: 'Fertility timing',
        value: 'Not available',
        detail:
          data.predictionContext.reasons.some(
            (reason) => reason.code === 'hormonal-contraception',
          )
            ? 'Hidden in a hormonal-contraception context · not contraception guidance'
            : 'More eligible cycle history is needed · not contraception',
        tone: 'rose',
        action: data.goal === 'ttc' ? 'ttc' : 'cycle',
      }
  const symptomPattern = symptomPatternForDate(
    data.symptomPatterns,
    data.prediction.cycleDay,
    daysToOvulation,
  )
  const symptomPatternInsight: DailyInsight = symptomPattern
    ? {
        key: 'symptom-pattern',
        eyebrow: 'Symptoms to expect?',
        value: symptomPattern.signal,
        detail: `${symptomPattern.evidence.occurrences} complete check-ins · ${symptomPattern.evidence.cyclesObserved} cycles · association only`,
        tone: 'teal',
        action: 'cycle',
      }
    : {
        key: 'symptom-pattern',
        eyebrow: 'Symptoms to expect?',
        value: 'No pattern yet',
        detail: 'Complete check-ins across at least 2 cycles to build personal evidence',
        tone: 'teal',
        action: 'symptoms',
      }
  const cyclePositionInsight: DailyInsight = {
    key: 'cycle-position',
    eyebrow:
      data.prediction.cycleDay != null &&
      (data.prediction.cycleDay <= 5 || Boolean(data.selectedLog?.flow))
        ? 'Period position'
        : 'Cycle position',
    value:
      data.prediction.cycleDay != null
        ? `Day ${data.prediction.cycleDay}`
        : 'Needs dates',
    detail:
      data.prediction.cycleDay != null
        ? 'Counted from your most recent logged period start'
        : 'Log a period start to calculate this',
    tone: 'blue',
    action: 'cycle',
  }
  const dailyInsights = [
    fertilityInsight,
    symptomPatternInsight,
    cyclePositionInsight,
  ]

  function openInsight(action: DailyInsight['action']) {
    if (action === 'ttc') {
      setTtcDetailOpen(true)
      return
    }
    if (action === 'cycle') {
      setCycleReportOpen(true)
      return
    }
    openSheet(selectedDate, action)
  }

  return (
    <div className={`page today-page goal-${data.goal}`}>
      <Header date={selectedDate} today={today} onCalendar={() => setCalendarOpen(true)} />

      <section className="date-panel" aria-label="Choose a day to review">
        <DateStrip
          selectedDate={selectedDate}
          prediction={data.prediction}
          onSelectDate={setSelectedDate}
          today={today}
        />
      </section>

      <section
        key={selectedDate}
        className={`phase-hero phase-${phase.tone} enter-${enterFrom}${
          heroDrag.dragging ? ' is-dragging' : ''
        }`}
        aria-label={`${phase.eyebrow} ${phase.title}. Swipe sideways for another day.`}
        style={{
          // Following the pointer from the first pixel is what makes the drag
          // feel like it is moving the day rather than triggering it.
          transform: `translate3d(${heroDrag.offset}px, 0, 0)`,
          transition: heroDrag.dragging ? 'none' : undefined,
          ...(heroDrag.dragging || heroDrag.settling
            ? { animation: 'none', opacity: 1 - Math.min(Math.abs(heroDrag.offset) / 620, 0.35) }
            : {}),
        }}
        {...heroDrag.handlers}
      >
        <div className="phase-geometry" aria-hidden="true">
          <span className="phase-arc phase-arc-one" />
          <span className="phase-arc phase-arc-two" />
          <span className="phase-seed" />
        </div>
        <div className="phase-copy">
          <span className="phase-eyebrow">{phase.eyebrow}</span>
          <h1>{phase.title}</h1>
          <p>{phase.body}</p>
        </div>
        <button
          className="phase-detail-link"
          onClick={() =>
            data.goal === 'ttc' ? setTtcDetailOpen(true) : setCycleReportOpen(true)
          }
        >
          {estimate ? (
            <>
              {estimate} ·{' '}
              {data.prediction.source === 'baseline'
                ? 'starting-length estimate'
                : `±${data.prediction.uncertaintyDays} days`}
            </>
          ) : (
            <>What’s important today? Learn more</>
          )}
          <span aria-hidden="true">›</span>
        </button>
      </section>

      <section className="today-quick-actions" aria-label={`Log for ${compactDate(selectedDate)}`}>
        <button
          type="button"
          className={data.selectedLog?.flow ? 'quick-action is-recorded' : 'quick-action'}
          onClick={() => openSheet(selectedDate, 'flow')}
        >
          <span className="quick-action-circle quick-action-period" aria-hidden="true">
            <svg viewBox="0 0 40 40">
              <path d="M20 6c4.7 6.3 9.3 11.3 9.3 17.2A9.3 9.3 0 0 1 20 32.5a9.3 9.3 0 0 1-9.3-9.3C10.7 17.3 15.3 12.3 20 6Z" />
              <path d="m23.2 15.3 2.9 2.9-8.9 8.9-4.1 1.2 1.2-4.1 8.9-8.9Z" />
            </svg>
          </span>
          <strong>{data.selectedLog?.flow ? 'Edit period' : 'Log period'}</strong>
        </button>
        <button
          type="button"
          className={
            (data.selectedLog?.symptoms?.length ?? 0) > 0
              ? 'quick-action is-recorded'
              : 'quick-action'
          }
          onClick={() => openSheet(selectedDate, 'symptoms')}
        >
          <span className="quick-action-circle" aria-hidden="true">
            <svg viewBox="0 0 40 40">
              <path d="M20 10v20M10 20h20" />
            </svg>
          </span>
          <strong>Symptoms</strong>
        </button>
        <button
          type="button"
          className={
            (data.selectedLog?.intimacyEvents?.length ?? 0) > 0 || data.selectedLog?.sex
              ? 'quick-action is-recorded'
              : 'quick-action'
          }
          onClick={() => openSheet(selectedDate, 'intimacy')}
        >
          <span className="quick-action-circle" aria-hidden="true">
            <svg viewBox="0 0 40 40">
              <path d="M20 31.5S8.5 25 8.5 16.8c0-4.6 5.7-7.4 9-4.1L20 15l2.5-2.3c3.3-3.3 9 .5 9 4.1C31.5 25 20 31.5 20 31.5Z" />
            </svg>
          </span>
          <strong>Sex</strong>
        </button>
      </section>

      <section className="daily-insights-section" aria-labelledby="daily-insights-title">
        <div className="section-heading daily-heading">
          <h2 id="daily-insights-title">
            My daily insights
            <span className="daily-heading-when">
              {' · '}
              {selectedDate === today ? 'Today' : compactDate(selectedDate)}
            </span>
          </h2>
        </div>
        <div className="daily-insight-rail">
          {dailyInsights.map((insight) => (
            <button
              key={insight.key}
              type="button"
              className={`daily-insight-tile insight-${insight.tone}`}
              onClick={() => openInsight(insight.action)}
            >
              <span>{insight.eyebrow}</span>
              <strong>{insight.value}</strong>
              <small>{insight.detail}</small>
              <i aria-hidden="true">›</i>
            </button>
          ))}
        </div>
      </section>

      <button
        className={`prediction-basis-card evidence-${data.predictionContext.evidenceMode}`}
        onClick={() =>
          data.goal === 'ttc' ? setTtcDetailOpen(true) : setCycleReportOpen(true)
        }
      >
        <span className="prediction-basis-glyph" aria-hidden="true">
          {data.predictionContext.evidenceMode === 'suppressed' ? '—' : '±'}
        </span>
        <span>
          <small>Prediction basis</small>
          <strong>
            {data.predictionContext.evidenceMode === 'suppressed'
              ? 'Some forecasts are responsibly paused'
              : data.predictionContext.evidenceMode === 'insufficient'
                ? 'Waiting for real cycle history'
                : data.predictionContext.evidenceMode === 'baseline-calendar'
                  ? 'Broad calendar starting estimate'
                  : data.predictionContext.evidenceMode === 'cycle-history-plus-signals'
                    ? 'Cycle history with retrospective signals'
                    : 'Personal cycle history'}
          </strong>
          <em>{data.predictionContext.reasons[0]?.message}</em>
          {data.forecastDiagnostics.periodWindow && (
            <span className="prediction-basis-window">
              Current estimated range {data.forecastDiagnostics.periodWindow.start}–
              {data.forecastDiagnostics.periodWindow.end}
            </span>
          )}
        </span>
        <i aria-hidden="true">›</i>
      </button>

      {daysLate > 0 && (
        <aside className="card signal-card late-card">
          <span className="signal-icon" aria-hidden="true">i</span>
          <div>
            <strong>A late estimate is not a diagnosis</strong>
            <p>
              This date is {daysLate} {daysLate === 1 ? 'day' : 'days'} beyond the upper end of
              the displayed estimate. Cycles shift for many reasons. If pregnancy is possible,
              follow your test instructions.
            </p>
          </div>
        </aside>
      )}

      {data.goal === 'peri' && (
        <button className="card peri-score-card" onClick={() => setPerimenopauseOpen(true)}>
          <div className="peri-score-copy">
            <div className="section-label">Your monthly symptom summary</div>
            <strong>
              {data.periScore === 0
                ? 'Ready for your first check-in'
                : 'Your recent pattern is ready to review'}
            </strong>
            <span>Calculated only from symptoms you chose to record</span>
          </div>
          <div className="peri-score-value">
            <strong>{data.periScore}</strong>
            <span>of 100</span>
          </div>
        </button>
      )}

      <button
        className="card phase-reading-card"
        onClick={() =>
          setArticleSlug(fertileSoon ? 'fertile-window' : data.goal === 'peri' ? 'peri-what-is' : 'cycle-phases')
        }
      >
        <div className="section-label">
          {fertileSoon ? 'Understand your fertile window' : data.goal === 'peri' ? 'Understand midlife changes' : 'For this part of your cycle'}
        </div>
        <p>
          {fertileSoon
            ? 'Spot the signals that can add context to a calendar estimate.'
            : data.goal === 'peri'
              ? 'Track changes month to month without turning a pattern into a diagnosis.'
              : 'Learn what may be changing — and what can vary from person to person.'}
        </p>
        <span>Explore the guide <b aria-hidden="true">↗</b></span>
      </button>

      <Disclaimer />
    </div>
  )
}

function Header({
  date,
  today,
  onCalendar,
}: {
  date: string
  today: string
  onCalendar: () => void
}) {
  const setTab = useApp((s) => s.setTab)
  const selected = new Date(date + 'T12:00:00')
  const relativeDays = daysBetween(today, date)
  const relativeLabel =
    relativeDays === 0
      ? 'Today'
      : relativeDays === -1
        ? 'Yesterday'
        : relativeDays === 1
          ? 'Tomorrow'
          : selected.toLocaleDateString(undefined, { weekday: 'long' })

  return (
    <header className="today-header">
      <button
        type="button"
        className="lunara-brand-button"
        onClick={() => setTab('settings')}
        aria-label="Open settings"
      >
        <LunaraMark decorative />
      </button>
      <div className="today-heading">
        <span>{relativeLabel}</span>
        <strong>{selected.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}</strong>
      </div>
      <button
        type="button"
        className="icon-button calendar-button"
        onClick={onCalendar}
        aria-label="Open calendar"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="3.5" y="5.5" width="17" height="15" rx="4" />
          <path d="M7.5 3.5v4M16.5 3.5v4M3.5 10h17" />
          <path className="calendar-seed" d="M8 14h.01M12 14h.01M16 14h.01M8 17.5h.01M12 17.5h.01" />
        </svg>
      </button>
    </header>
  )
}

function Disclaimer() {
  return (
    <p className="disclaimer">
      Lunara is not a medical device. Predictions are estimates and are not contraception.{' '}
      <strong>This app does not give medical advice. Check with a doctor.</strong>
    </p>
  )
}
