import { Browser } from '@capacitor/browser'
import { Children, isValidElement, type ReactNode, useEffect, useMemo, useState } from 'react'
import { LunaraMark } from '../components/LunaraMark'
import {
  createDefaultHealthProfile,
  db,
  getPeriodStarts,
  putHealthProfile,
  setSetting,
  SK,
  type ActivityLevel,
  type AnswerChoice,
  type ContraceptionMethod,
  type CycleRegularity,
  type Goal,
  type HealthCondition,
  type HealthProfile,
  type WearableBrand,
} from '../db/schema'
import {
  ANTHROPIC_MODELS,
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_OPENAI_MODEL,
  type AssistantProvider,
} from '../lib/assistant'
import { localToday } from '../lib/dates'
import {
  DEFAULT_PUBLIK_MODEL,
  markPublikCardSeen,
  provisionPublik,
  PUBLIK_BUILD,
  PUBLIK_DATA_PATH,
  PUBLIK_WHY_IT_COSTS,
  publikAvailable,
  publikBalanceLine,
  publikLinkButtonLabel,
  PublikApiError,
  type PublikInstall,
} from '../lib/publik'
import { addDays, toEpochDay } from '../engine/cycle'
import {
  resolvePregnancyDating,
  type PregnancyDatingMethod,
} from '../engine/pregnancyDating'
import type { HealthAuthorization } from '../native/health'
import { importAppleHealthPeriodHistory } from '../native/healthImport'
import { nativePlatform } from '../native/runtime'
import {
  SECURE_SECRET_KEYS,
  setSecureSecret,
} from '../native/secureVault'

type StepId =
  | 'welcome'
  | 'name'
  | 'birth-year'
  | 'privacy'
  | 'goal'
  | 'cycle-context'
  | 'cycle-history'
  | 'hormonal-context'
  | 'pregnancy-context'
  | 'ttc-context'
  | 'tracking'
  | 'symptom-baseline'
  | 'conditions'
  | 'cycle-signals'
  | 'wellbeing'
  | 'movement'
  | 'biometrics'
  | 'sleep'
  | 'summary'
  | 'ai'
  | 'finish'

type Option = {
  id: string
  label: string
  detail?: string
  icon?: string
}

type Draft = {
  displayName: string
  birthYear: string
  privacyAccepted: boolean
  goal: Goal | null
  regularity: CycleRegularity
  contraception: ContraceptionMethod
  bleedingPattern: string
  periodStarts: [string, string, string]
  dateConfidence: 'known' | 'approximate' | 'unknown'
  typicalCycleLength: string
  typicalPeriodLength: string
  tryingSince: string
  pregnancyDatingMethod: PregnancyDatingMethod
  pregnancyDatingDate: string
  numberOfBabies: number
  trackingAreas: string[]
  baselineSymptoms: string[]
  conditions: HealthCondition[]
  abnormalities: string[]
  hormonalSignals: string[]
  sleepImpact: AnswerChoice | undefined
  skinImpact: AnswerChoice | undefined
  activityImpact: AnswerChoice | undefined
  mentalHealthSignals: string[]
  sexualWellnessGoals: string[]
  activityLevel: ActivityLevel
  wearable: WearableBrand
  heightCm: string
  weightKg: string
  sleepGoals: string[]
}

const GOALS: Array<{ id: Goal; icon: string; label: string; detail: string }> = [
  { id: 'cycle', icon: '◒', label: 'Understand my cycle', detail: 'Periods, body patterns, and what changes over time' },
  { id: 'ttc', icon: '✦', label: 'Try to conceive', detail: 'A cautious fertile window with OPK and temperature context' },
  { id: 'pregnancy', icon: '◡', label: 'Follow my pregnancy', detail: 'Provisional dating, weekly context, and a private journal' },
  { id: 'peri', icon: '≈', label: 'Navigate perimenopause', detail: 'Changing cycles, hot flashes, sleep, and symptom trends' },
]

const CONTRACEPTION_OPTIONS: Option[] = [
  { id: 'none', label: 'None', detail: 'Cycle estimates can use your natural bleeding history.' },
  { id: 'combined-pill-patch-ring', label: 'Combined pill, patch, or ring', detail: 'These usually suppress ovulation, so Lunara will not show a fertile-window forecast.' },
  { id: 'progestin-only-pill', label: 'Progestin-only pill', detail: 'Bleeding can be less predictable; medication tracking stays available.' },
  { id: 'injection', label: 'Injection', detail: 'Cycle and fertile-window forecasts will be paused.' },
  { id: 'implant', label: 'Implant', detail: 'Cycle and fertile-window forecasts will be paused.' },
  { id: 'hormonal-iud', label: 'Hormonal IUD', detail: 'Bleeding tracking remains useful, but it may not represent a natural cycle.' },
  { id: 'copper-iud', label: 'Copper IUD', detail: 'Natural-cycle estimates may still be available when enough history exists.' },
  { id: 'barrier', label: 'Condoms or another barrier method' },
  { id: 'sterilization', label: 'Sterilization' },
  { id: 'other', label: 'Another method' },
  { id: 'prefer-not-to-say', label: 'Prefer not to say' },
]

const TRACKING_AREAS: Option[] = [
  { id: 'periods', icon: '◒', label: 'Periods & spotting' },
  { id: 'symptoms', icon: '✣', label: 'Symptoms & pain' },
  { id: 'mood', icon: '◡', label: 'Mood & energy' },
  { id: 'discharge', icon: '◌', label: 'Discharge' },
  { id: 'sleep', icon: '☾', label: 'Sleep' },
  { id: 'movement', icon: '↗', label: 'Movement' },
  { id: 'fertility', icon: '✦', label: 'Fertility signals' },
  { id: 'sexual-wellbeing', icon: '♡', label: 'Sexual wellbeing' },
]

const SYMPTOM_OPTIONS: Option[] = [
  { id: 'cramps', label: 'Cramps' },
  { id: 'fatigue', label: 'Fatigue' },
  { id: 'bloating', label: 'Bloating' },
  { id: 'tender-breasts', label: 'Tender breasts' },
  { id: 'headache', label: 'Headache' },
  { id: 'backache', label: 'Backache' },
  { id: 'acne', label: 'Acne or oily skin' },
  { id: 'insomnia', label: 'Trouble sleeping' },
  { id: 'hot-flashes', label: 'Hot flashes' },
  { id: 'night-sweats', label: 'Night sweats' },
  { id: 'vaginal-dryness', label: 'Vaginal dryness' },
  { id: 'none', label: 'Nothing right now' },
]

const CONDITION_OPTIONS: Array<Option & { id: HealthCondition }> = [
  { id: 'pcos', label: 'PCOS' },
  { id: 'endometriosis', label: 'Endometriosis' },
  { id: 'fibroids', label: 'Fibroids' },
  { id: 'adenomyosis', label: 'Adenomyosis' },
  { id: 'thyroid-condition', label: 'A thyroid condition' },
  { id: 'perimenopause', label: 'Perimenopause' },
  { id: 'postpartum', label: 'Recently postpartum' },
  { id: 'yeast-infections', label: 'Recurring yeast infections' },
  { id: 'uti', label: 'Recurring UTIs' },
  { id: 'bacterial-vaginosis', label: 'Recurring bacterial vaginosis' },
  { id: 'other', label: 'Another relevant condition' },
]

const ABNORMALITY_OPTIONS: Option[] = [
  { id: 'unpredictable-cycles', label: 'Unpredictable cycles' },
  { id: 'missed-periods', label: 'Periods sometimes disappear for months' },
  { id: 'heavy-bleeding', label: 'Very heavy bleeding' },
  { id: 'spotting-between-periods', label: 'Spotting between periods' },
  { id: 'bleeding-over-8-days', label: 'Bleeding that lasts more than 8 days' },
  { id: 'severe-pain', label: 'Pain that disrupts daily life' },
  { id: 'none', label: 'None of these' },
]

const HORMONAL_SIGNAL_OPTIONS: Option[] = [
  { id: 'acne-oily-skin', label: 'Acne or oily skin' },
  { id: 'excess-hair', label: 'New facial or body hair' },
  { id: 'hair-loss', label: 'Hair thinning or loss' },
  { id: 'weight-change', label: 'Unexplained weight change' },
  { id: 'low-libido', label: 'Lower sex drive' },
  { id: 'hot-flashes', label: 'Hot flashes or night sweats' },
  { id: 'none', label: 'None of these' },
]

const SLEEP_GOALS: Option[] = [
  { id: 'fall-asleep', label: 'Fall asleep more easily' },
  { id: 'stay-asleep', label: 'Stay asleep through the night' },
  { id: 'wake-rested', label: 'Wake up feeling more rested' },
  { id: 'sleep-quality', label: 'Understand sleep quality' },
  { id: 'bedtime-routine', label: 'Build a steadier bedtime routine' },
]

const HORMONAL_METHODS = new Set<ContraceptionMethod>([
  'combined-pill-patch-ring',
  'progestin-only-pill',
  'injection',
  'implant',
  'hormonal-iud',
])

const DEFAULT_DRAFT: Draft = {
  displayName: '',
  birthYear: '',
  privacyAccepted: false,
  goal: null,
  regularity: 'unsure',
  contraception: 'unknown',
  bleedingPattern: '',
  periodStarts: ['', '', ''],
  dateConfidence: 'unknown',
  typicalCycleLength: '28',
  typicalPeriodLength: '5',
  tryingSince: '',
  pregnancyDatingMethod: 'lmp',
  pregnancyDatingDate: '',
  numberOfBabies: 1,
  trackingAreas: ['periods', 'symptoms', 'mood'],
  baselineSymptoms: [],
  conditions: [],
  abnormalities: [],
  hormonalSignals: [],
  sleepImpact: undefined,
  skinImpact: undefined,
  activityImpact: undefined,
  mentalHealthSignals: [],
  sexualWellnessGoals: [],
  activityLevel: 'unknown',
  wearable: 'unknown',
  heightCm: '',
  weightKg: '',
  sleepGoals: [],
}

function Frame({
  step,
  stepNumber,
  totalSteps,
  chapter,
  children,
  onBack,
  onSkip,
}: {
  step: StepId
  stepNumber: number
  totalSteps: number
  chapter?: string
  children: ReactNode
  onBack?: () => void
  onSkip?: () => void
}) {
  const showProgress = step !== 'welcome' && step !== 'finish'
  const childList = Children.toArray(children)
  const actionIndex = childList.findIndex(
    (child) =>
      isValidElement<{ className?: string }>(child) &&
      child.props.className?.split(/\s+/).includes('cta'),
  )
  const action = actionIndex >= 0 ? childList[actionIndex] : null
  const body = actionIndex >= 0
    ? childList.filter((_, index) => index !== actionIndex)
    : childList

  return (
    <section className={`page onboarding onboarding-${step}`}>
      <div className="ob-atmosphere" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <div className="ob-shell-top">
        <header className="ob-appbar">
          {showProgress && onBack
            ? <button type="button" className="back-btn" onClick={onBack} aria-label="Go back">‹</button>
            : <span className="ob-appbar-spacer" aria-hidden="true" />}
          <div className="lunara-brand-button ob-appbar-mark" aria-label="Lunara">
            <LunaraMark decorative size={24} />
          </div>
          {showProgress && onSkip
            ? <button type="button" className="ob-skip" onClick={onSkip}>Skip</button>
            : <span className="ob-appbar-spacer" aria-hidden="true" />}
        </header>
        {showProgress && (
          <div className="onboarding-progress">
            <div className="ob-progress-meta">
              <span>{chapter ?? 'Your baseline'}</span>
              <span>{stepNumber} of {totalSteps}</span>
            </div>
            <div className="progress-track" aria-label={`Step ${stepNumber} of ${totalSteps}`}>
              <span style={{ width: `${(stepNumber / totalSteps) * 100}%` }} />
            </div>
          </div>
        )}
      </div>
      <div className="ob-shell-scroll">
        <div className="onboarding-content">{body}</div>
      </div>
      {action && (
        <footer className="ob-shell-footer">
          <div className="ob-shell-footer-inner">{action}</div>
        </footer>
      )}
    </section>
  )
}

function CrescentMark({ quiet = false }: { quiet?: boolean }) {
  return (
    <LunaraMark
      className={`ob-crescent-mark ${quiet ? 'quiet' : ''}`}
      decorative
      size={64}
    />
  )
}

function Moonseed({ mood = 'bright' }: { mood?: 'bright' | 'thinking' | 'resting' }) {
  return (
    <div className={`moonseed moonseed-${mood}`} aria-hidden="true">
      <span className="moonseed-orbit" />
      <CrescentMark quiet={mood === 'resting'} />
      <span className="moonseed-star">✦</span>
    </div>
  )
}

function OptionCard({
  option,
  selected,
  onClick,
  selectionDetail,
}: {
  option: Option
  selected: boolean
  onClick: () => void
  selectionDetail?: string
}) {
  return (
    <button
      type="button"
      className={`ob-option ${option.icon ? 'with-icon' : ''} ${selected ? 'selected' : ''}`}
      aria-pressed={selected}
      onClick={onClick}
    >
      {option.icon && <span className="ob-option-icon" aria-hidden="true">{option.icon}</span>}
      <span className="ob-option-copy">
        <strong>{option.label}</strong>
        {selected && (selectionDetail ?? option.detail) && <small>{selectionDetail ?? option.detail}</small>}
      </span>
      <span className="ob-check" aria-hidden="true">{selected ? '✓' : ''}</span>
    </button>
  )
}

function ChipGrid({
  options,
  values,
  onToggle,
  exclusive,
}: {
  options: Option[]
  values: string[]
  onToggle: (id: string) => void
  exclusive?: string
}) {
  return (
    <div className="ob-chip-grid">
      {options.map((option) => {
        const selected = values.includes(option.id)
        return (
          <button
            type="button"
            key={option.id}
            className={`ob-chip ${selected ? 'selected' : ''}`}
            aria-pressed={selected}
            onClick={() => onToggle(option.id)}
            data-exclusive={exclusive === option.id ? 'true' : undefined}
          >
            {option.icon && <span aria-hidden="true">{option.icon}</span>}
            {option.label}
            <i aria-hidden="true">{selected ? '✓' : '+'}</i>
          </button>
        )
      })}
    </div>
  )
}

function QuestionIntro({
  eyebrow,
  title,
  body,
}: {
  eyebrow: string
  title: string
  body?: string
}) {
  return (
    <div className="ob-question-intro">
      <p className="eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      {body && <p className="muted">{body}</p>}
    </div>
  )
}

function finiteNumber(value: string): number | undefined {
  if (!value.trim()) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || ''
}

function choiceLabel(value: AnswerChoice | undefined): string {
  if (value === 'yes') return 'Yes'
  if (value === 'no') return 'No'
  if (value === 'unsure') return 'Not sure yet'
  return 'Not answered'
}

function onboardingHealthPermission(
  authorization: HealthAuthorization,
): HealthProfile['permissions']['healthData'] {
  if (authorization === 'granted' || authorization === 'partial') return 'granted'
  if (authorization === 'requested') return 'requested'
  if (authorization === 'denied') return 'denied'
  return 'not-requested'
}

function recentCycleLength(startsNewestFirst: string[]): number | undefined {
  const gaps = startsNewestFirst
    .slice(0, -1)
    .map((date, index) => toEpochDay(date) - toEpochDay(startsNewestFirst[index + 1]))
    .filter((gap) => gap >= 15 && gap <= 90)
    .sort((a, b) => a - b)
  if (!gaps.length) return undefined
  return gaps[Math.floor(gaps.length / 2)]
}

export function Onboarding({ onDone }: { onDone: () => void }) {
  const [current, setCurrent] = useState<StepId>('welcome')
  const [draft, setDraft] = useState<Draft>(DEFAULT_DRAFT)
  const [provider, setProvider] = useState<AssistantProvider>('anthropic')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState(DEFAULT_ANTHROPIC_MODEL)
  const [baseUrl, setBaseUrl] = useState('')
  // publik API: offered only on a native, adult, token-carrying build; preselected when it is.
  const [publikHere, setPublikHere] = useState(false)
  const [publikBusy, setPublikBusy] = useState(false)
  const [publikError, setPublikError] = useState<string | null>(null)
  const [publikInstall, setPublikInstall] = useState<PublikInstall | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [healthImportBusy, setHealthImportBusy] = useState(false)
  const [healthImportAttempted, setHealthImportAttempted] = useState(false)
  const [healthImportAuthorization, setHealthImportAuthorization] =
    useState<HealthAuthorization>('not-determined')
  const [healthImportMessage, setHealthImportMessage] = useState<string | null>(null)
  const thisYear = new Date().getFullYear()
  const birth = Number(draft.birthYear)
  const age = /^\d{4}$/.test(draft.birthYear) ? thisYear - birth : null
  const yearOk =
    age !== null &&
    birth >= thisYear - 100 &&
    birth <= thisYear - 13

  const adult = age !== null && age >= 18
  useEffect(() => {
    // publikAvailable() also checks SK.birthYear, which is not saved until finish();
    // the step itself is gated on the typed year, so only the build/vault checks matter here.
    if (!adult) return
    let alive = true
    void publikAvailable({ assumeAdult: true }).then((ok) => {
      if (!alive || !ok) return
      setPublikHere(true)
      setProvider((current) => (current === 'anthropic' && !apiKey.trim() ? 'publik' : current))
      setModel((current) => (current === DEFAULT_ANTHROPIC_MODEL ? DEFAULT_PUBLIK_MODEL : current))
    })
    return () => {
      alive = false
    }
  }, [adult])

  const hormonalMethod = HORMONAL_METHODS.has(draft.contraception)
  const steps = useMemo<StepId[]>(() => {
    const next: StepId[] = ['welcome', 'name', 'birth-year', 'privacy', 'goal']
    if (draft.goal === 'pregnancy') {
      next.push('pregnancy-context')
    } else {
      next.push('cycle-context')
      if (hormonalMethod) next.push('hormonal-context')
      else next.push('cycle-history')
      if (draft.goal === 'ttc') next.push('ttc-context')
    }
    next.push('tracking', 'symptom-baseline', 'conditions')
    if (draft.goal !== 'pregnancy') next.push('cycle-signals')
    next.push('wellbeing', 'movement', 'biometrics')
    if (
      draft.trackingAreas.includes('sleep') ||
      draft.sleepImpact === 'yes' ||
      draft.goal === 'peri'
    ) next.push('sleep')
    next.push('summary')
    if ((age ?? 0) >= 18) next.push('ai')
    next.push('finish')
    return next
  }, [age, draft.goal, draft.sleepImpact, draft.trackingAreas, hormonalMethod])

  const progressSteps: StepId[] = steps.filter((step) => step !== 'welcome' && step !== 'finish')
  const progressIndex = Math.max(1, progressSteps.indexOf(current) + 1)
  function patch(next: Partial<Draft>) {
    setDraft((previous) => ({ ...previous, ...next }))
  }

  function toggle(key: keyof Draft, value: string, exclusive?: string) {
    setDraft((previous) => {
      const currentValues = previous[key]
      if (!Array.isArray(currentValues)) return previous
      let nextValues: string[]
      if (value === exclusive) {
        nextValues = currentValues.includes(value) ? [] : [value]
      } else {
        nextValues = currentValues.filter((item) => item !== exclusive)
        nextValues = nextValues.includes(value)
          ? nextValues.filter((item) => item !== value)
          : [...nextValues, value]
      }
      return { ...previous, [key]: nextValues }
    })
  }

  function scrollSetupTop() {
    requestAnimationFrame(() => {
      const setupScroller = document.querySelector<HTMLElement>('.ob-shell-scroll')
      if (setupScroller) {
        setupScroller.scrollTo({ top: 0, behavior: 'auto' })
        return
      }
      document.querySelector('main')?.scrollTo({ top: 0, behavior: 'auto' })
    })
  }

  function next() {
    const index = steps.indexOf(current)
    setCurrent(steps[Math.min(index + 1, steps.length - 1)])
    scrollSetupTop()
  }

  function back() {
    const index = steps.indexOf(current)
    setCurrent(steps[Math.max(index - 1, 0)])
    scrollSetupTop()
  }

  function chooseProvider(nextProvider: AssistantProvider) {
    setProvider(nextProvider)
    setBaseUrl('')
    setPublikError(null)
    if (nextProvider === 'publik') {
      setModel(DEFAULT_PUBLIK_MODEL)
    } else if (nextProvider === 'anthropic') {
      setModel(DEFAULT_ANTHROPIC_MODEL)
    } else {
      setModel(DEFAULT_OPENAI_MODEL)
    }
  }

  /**
   * "Continue with publik API": the disclosure above was read, so this is the
   * consent moment — POST /installs runs now, and the first-run card with the
   * real balance follows on the same screen (CONTRACT §12.1). The birth year is
   * saved first because publikAvailable() reads it. A failure never blocks
   * setup: Lunara AI offers Connect again.
   */
  async function connectPublik() {
    setPublikBusy(true)
    setPublikError(null)
    try {
      await setSetting(SK.birthYear, draft.birthYear)
      const install = await provisionPublik()
      setPublikInstall(install)
      await setSetting(SK.publikDisclosureVersion, String(PUBLIK_BUILD.disclosureVersion))
    } catch (reason) {
      setPublikError(
        reason instanceof PublikApiError
          ? `${reason.message} You can connect publik API later from Lunara AI.`
          : reason instanceof Error
            ? reason.message
            : 'Could not connect publik API. You can try again later from Lunara AI.',
      )
    } finally {
      setPublikBusy(false)
    }
  }

  async function continueFromPublikCard() {
    await markPublikCardSeen()
    next()
  }

  async function importApplePeriodsDuringOnboarding() {
    setHealthImportBusy(true)
    setHealthImportAttempted(true)
    setHealthImportMessage(null)
    try {
      const today = localToday()
      const result = await importAppleHealthPeriodHistory({
        startDate: addDays(today, -730),
        endDate: today,
      })
      setHealthImportAuthorization(result.authorization)
      if (!result.available) {
        setHealthImportMessage(result.reason ?? 'Apple Health period import is unavailable.')
        return
      }
      if (!result.periodSamples) {
        setHealthImportMessage(
          'No period records were returned. Apple does not tell apps whether read access was denied or Health has no menstrual-flow history.',
        )
        return
      }

      const recentStarts = (await getPeriodStarts()).slice(-3).reverse()
      const importedCycleLength = recentCycleLength(recentStarts)
      patch({
        periodStarts: [
          recentStarts[0] ?? '',
          recentStarts[1] ?? '',
          recentStarts[2] ?? '',
        ],
        dateConfidence: recentStarts.length ? 'known' : draft.dateConfidence,
        typicalCycleLength: importedCycleLength
          ? String(importedCycleLength)
          : draft.typicalCycleLength,
      })
      setHealthImportMessage(
        recentStarts.length
          ? `Imported ${result.uniqueSamples} period record${result.uniqueSamples === 1 ? '' : 's'} and found ${recentStarts.length} recent period start${recentStarts.length === 1 ? '' : 's'}. You can correct the dates below.`
          : `Imported ${result.uniqueSamples} menstrual-flow record${result.uniqueSamples === 1 ? '' : 's'}, but none was marked as a cycle start. You can add recent start dates below.`,
      )
    } catch (error) {
      setHealthImportMessage(
        error instanceof Error ? error.message : 'Apple Health period import failed.',
      )
    } finally {
      setHealthImportBusy(false)
    }
  }

  async function finish() {
    if (!draft.goal) return
    setSaving(true)
    setSaveError(null)
    try {
      const defaults = createDefaultHealthProfile()
      const pregnancyDating =
        draft.goal === 'pregnancy' && draft.pregnancyDatingDate
          ? resolvePregnancyDating({
              method: draft.pregnancyDatingMethod,
              date: draft.pregnancyDatingDate,
              clinicianConfirmed: draft.pregnancyDatingMethod === 'clinician-edd',
            })
          : null
      const validStarts =
        draft.goal === 'pregnancy'
          ? draft.pregnancyDatingMethod === 'lmp' && draft.pregnancyDatingDate
            ? [draft.pregnancyDatingDate]
            : []
          : draft.periodStarts.filter(Boolean).sort().reverse()
      const latestStart = validStarts[0]
      const decidedAt = new Date().toISOString()
      const profile: HealthProfile = {
        ...defaults,
        displayName: draft.displayName.trim() || undefined,
        birthYear: finiteNumber(draft.birthYear),
        goals: [draft.goal],
        primaryGoal: draft.goal,
        cycle: {
          regularity: draft.regularity,
          lastPeriodStart: latestStart,
          typicalCycleLength: hormonalMethod ? undefined : finiteNumber(draft.typicalCycleLength),
          typicalPeriodLength: finiteNumber(draft.typicalPeriodLength),
          dateConfidence: latestStart ? draft.dateConfidence : 'unknown',
          abnormalities: draft.abnormalities.filter((item) => item !== 'none'),
          baselineSymptoms: draft.baselineSymptoms.filter((item) => item !== 'none'),
          hormonalSignals: draft.hormonalSignals.filter((item) => item !== 'none'),
        },
        reproductive: {
          contraception: draft.contraception,
          pregnancyLmp:
            draft.goal === 'pregnancy' && draft.pregnancyDatingMethod === 'lmp'
              ? draft.pregnancyDatingDate || undefined
              : undefined,
          pregnancyDating: pregnancyDating
            ? {
                method: pregnancyDating.method,
                inputDate: pregnancyDating.inputDate,
                estimatedDueDate: pregnancyDating.estimatedDueDate,
                gestationalStart: pregnancyDating.gestationalStart,
                authority: pregnancyDating.authority,
                provisional: pregnancyDating.provisional,
                updatedAt: decidedAt,
              }
            : undefined,
          numberOfBabies:
            draft.goal === 'pregnancy' ? draft.numberOfBabies : undefined,
          tryingSince: draft.goal === 'ttc' && draft.tryingSince ? draft.tryingSince : undefined,
        },
        conditions: draft.conditions,
        wellbeing: {
          sleepImpact: draft.sleepImpact,
          sleepGoals: draft.sleepGoals,
          skinImpact: draft.skinImpact,
          activityImpact: draft.activityImpact,
          activityLevel: draft.activityLevel,
          wearable: draft.wearable,
          mentalHealthSignals: draft.mentalHealthSignals,
          sexualWellnessGoals: draft.sexualWellnessGoals,
        },
        biometrics: {
          heightCm: finiteNumber(draft.heightCm),
          weightKg: finiteNumber(draft.weightKg),
        },
        permissions: {
          ...defaults.permissions,
          healthData: onboardingHealthPermission(healthImportAuthorization),
        },
        privacy: {
          ageBand:
            age === null
              ? 'unknown'
              : age >= 18
                ? 'adult'
                : age >= 16
                  ? '16-17'
                  : '13-15',
          minimumAgeConfirmed: yearOk,
          localOnly: true,
          onboardingVersion: 2,
          consentLedger: [
            {
              purpose: 'local-health-storage',
              state: draft.privacyAccepted ? 'granted' : 'declined',
              version: 1,
              decidedAt,
            },
            {
              purpose: 'assistant-sharing',
              state:
                age !== null &&
                age >= 18 &&
                (provider === 'publik' ? publikInstall !== null : apiKey.trim().length > 0)
                  ? 'granted'
                  : 'not-requested',
              version: 1,
              decidedAt,
            },
            {
              purpose: 'publik-api',
              state:
                age !== null && age >= 18 && provider === 'publik' && publikInstall !== null
                  ? 'granted'
                  : 'not-requested',
              version: 1,
              decidedAt,
            },
            {
              purpose: 'health-import',
              state: healthImportAttempted
                ? healthImportAuthorization === 'denied'
                  ? 'declined'
                  : 'granted'
                : 'not-requested',
              version: 1,
              decidedAt,
            },
          ],
        },
      }

      await putHealthProfile(profile)
      await Promise.all([
        setSetting(SK.goal, draft.goal),
        setSetting(SK.birthYear, draft.birthYear),
        setSetting(SK.cycleLength, draft.typicalCycleLength),
        setSetting(SK.aiProvider, provider),
        setSetting(
          SK.aiModel,
          model.trim() ||
            (provider === 'publik'
              ? DEFAULT_PUBLIK_MODEL
              : provider === 'anthropic'
                ? DEFAULT_ANTHROPIC_MODEL
                : DEFAULT_OPENAI_MODEL),
        ),
        setSetting(SK.aiBaseUrl, provider === 'publik' ? '' : baseUrl.trim()),
      ])

      if (draft.goal === 'pregnancy' && pregnancyDating) {
        // Compatibility for existing pregnancy detail views. This setting is
        // the calculated gestational start, while the versioned profile keeps
        // the true input method and authoritative due date.
        await setSetting(SK.pregnancyLMP, pregnancyDating.gestationalStart)
      }
      for (const date of validStarts) {
        const existing = await db.dailyLogs.get(date)
        if (!existing?.flow) {
          await db.dailyLogs.put({ ...(existing ?? { date }), date, flow: 'medium' })
        }
      }

      if (provider !== 'publik' && apiKey.trim()) {
        await setSecureSecret(
          provider === 'anthropic'
            ? SECURE_SECRET_KEYS.anthropicApiKey
            : SECURE_SECRET_KEYS.openAiApiKey,
          apiKey.trim(),
        )
      }

      await setSetting(SK.onboarded, '1')
      onDone()
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Could not finish setup.')
      setSaving(false)
    }
  }

  const frameProps = {
    step: current,
    stepNumber: progressIndex,
    totalSteps: progressSteps.length,
    onBack: back,
  }

  if (current === 'welcome') {
    return (
      <Frame step={current} stepNumber={0} totalSteps={progressSteps.length}>
        <div className="onboarding-hero">
          <div className="ob-hero-art">
            <Moonseed />
            <span className="ob-hero-label">Built for private, local-first tracking</span>
          </div>
          <div>
            <p className="eyebrow">Meet Lunara</p>
            <h1>A clearer map of your changing body.</h1>
            <p className="lead">
              Start with what you know. Lunara will adapt its questions, show when an estimate is
              uncertain, and keep core tracking on this device.
            </p>
          </div>
          <div className="ob-proof-row" aria-label="Lunara principles">
            <span><strong>Local</strong><small>Core history</small></span>
            <span><strong>Explainable</strong><small>Every estimate</small></span>
            <span><strong>Optional</strong><small>Sensitive answers</small></span>
          </div>
          <p className="ob-legal">Educational estimates only—not diagnosis or birth control.</p>
        </div>
        <button className="cta" onClick={next}>Build my baseline <span aria-hidden="true">→</span></button>
      </Frame>
    )
  }

  if (current === 'name') {
    return (
      <Frame {...frameProps} chapter="About you" onSkip={next}>
        <div className="ob-top-figure"><Moonseed mood="thinking" /></div>
        <QuestionIntro
          eyebrow="Let’s make this feel like yours"
          title="What should Lunara call you?"
          body="A first name or nickname is enough. It never has to leave your device."
        />
        <div className="field ob-hero-field">
          <label htmlFor="display-name">Name or nickname</label>
          <input
            id="display-name"
            autoComplete="given-name"
            placeholder="Optional"
            value={draft.displayName}
            onChange={(event) => patch({ displayName: event.target.value })}
          />
        </div>
        <div className="spacer" />
        <button className="cta" onClick={next}>
          {draft.displayName.trim() ? `Continue as ${firstName(draft.displayName)}` : 'Continue'}
        </button>
      </Frame>
    )
  }

  if (current === 'birth-year') {
    return (
      <Frame {...frameProps} chapter="About you">
        <QuestionIntro
          eyebrow={draft.displayName ? `Nice to meet you, ${firstName(draft.displayName)}` : 'A useful baseline'}
          title="What year were you born?"
          body="Age changes which cycle ranges are considered typical. It does not decide what your body should do."
        />
        <div className="ob-number-stage">
          <input
            aria-label="Birth year"
            type="number"
            inputMode="numeric"
            placeholder="1998"
            min={thisYear - 100}
            max={thisYear - 13}
            value={draft.birthYear}
            onChange={(event) => patch({ birthYear: event.target.value })}
          />
          <span>{yearOk ? `${thisYear - birth} years old` : 'Age 13 or older'}</span>
        </div>
        <div className="ob-why">
          <span aria-hidden="true">i</span>
          <p><strong>Why we ask</strong> Cycle variability differs across adolescence, adulthood, and perimenopause.</p>
        </div>
        <div className="spacer" />
        <button className="cta" disabled={!yearOk} onClick={next}>Continue</button>
      </Frame>
    )
  }

  if (current === 'privacy') {
    return (
      <Frame {...frameProps} chapter="Privacy">
        <QuestionIntro
          eyebrow="Sensitive data deserves a clear boundary"
          title="Your core health history stays on this device."
          body="Lunara needs permission to store the answers and logs you choose to enter. You can export or erase them from Settings."
        />
        <div className="ob-summary-list privacy">
          <article>
            <span className="local">Local</span>
            <div><strong>Core tracking</strong><p>Cycle dates, symptoms, notes, and your profile are stored in Lunara’s local database.</p></div>
          </article>
          <article>
            <span className="paused">Off</span>
            <div><strong>Cloud account</strong><p>No Lunara account, advertising profile, or background cloud sync is created.</p></div>
          </article>
          <article>
            <span className="cautious">Ask first</span>
            <div><strong>AI and health imports</strong><p>They remain separate and require an explicit setup or operating-system permission later.</p></div>
          </article>
        </div>
        {age !== null && age < 18 && (
          <div className="ob-safety-note">
            <strong>Age-aware setup</strong>
            <p>Optional AI setup is hidden for this profile. Regional or guardian requirements may also apply before distribution.</p>
          </div>
        )}
        <label className={`ob-consent ${draft.privacyAccepted ? 'selected' : ''}`}>
          <input
            type="checkbox"
            checked={draft.privacyAccepted}
            onChange={(event) => patch({ privacyAccepted: event.target.checked })}
          />
          <span>
            <strong>Store my selected health information locally</strong>
            <small>I understand Lunara provides educational estimates, not diagnosis or contraception.</small>
          </span>
        </label>
        <div className="spacer" />
        <button className="cta" disabled={!draft.privacyAccepted} onClick={next}>Continue privately</button>
      </Frame>
    )
  }

  if (current === 'goal') {
    return (
      <Frame {...frameProps} chapter="Your mode">
        <QuestionIntro
          eyebrow="Choose your primary mode"
          title="What is happening in your life right now?"
          body="This changes the rest of setup. You can switch modes later without losing your history."
        />
        <div className="ob-option-stack">
          {GOALS.map((goal) => (
            <OptionCard
              key={goal.id}
              option={goal}
              selected={draft.goal === goal.id}
              onClick={() => patch({ goal: goal.id })}
            />
          ))}
        </div>
        <button className="cta" disabled={!draft.goal} onClick={next}>Shape my setup</button>
      </Frame>
    )
  }

  if (current === 'cycle-context') {
    return (
      <Frame {...frameProps} chapter="Cycle context" onSkip={() => { patch({ contraception: 'prefer-not-to-say' }); next() }}>
        <div className="ob-chapter-band">
          <Moonseed mood="thinking" />
          <div><span>Chapter 1</span><strong>How your cycle is shaped</strong></div>
        </div>
        <QuestionIntro
          eyebrow="Prediction eligibility"
          title="Are you using contraception now?"
          body="Some hormonal methods suppress ovulation or create withdrawal bleeding. That changes which predictions are responsible to show."
        />
        <div className="ob-option-stack compact">
          {CONTRACEPTION_OPTIONS.map((option) => (
            <OptionCard
              key={option.id}
              option={option}
              selected={draft.contraception === option.id}
              onClick={() => patch({ contraception: option.id as ContraceptionMethod })}
            />
          ))}
        </div>
        <button className="cta" disabled={draft.contraception === 'unknown'} onClick={next}>Continue</button>
      </Frame>
    )
  }

  if (current === 'cycle-history') {
    const regularityOptions: Array<{ id: CycleRegularity; label: string; detail: string }> = [
      { id: 'regular', label: 'Usually predictable', detail: 'The gap is roughly similar, though it does not need to be exactly the same.' },
      { id: 'irregular', label: 'Often unpredictable', detail: 'Lunara will show wider ranges and avoid pretending there is one exact day.' },
      { id: 'unsure', label: 'I’m not sure yet', detail: 'That is enough to start. Your prospective history matters more than a guess.' },
    ]
    return (
      <Frame {...frameProps} chapter="Cycle context" onSkip={() => { patch({ dateConfidence: 'unknown' }); next() }}>
        <QuestionIntro
          eyebrow="Your real history beats a generic 28-day cycle"
          title="What do you know about your recent periods?"
          body="Add up to three true period starts—not spotting. Fewer dates are completely fine."
        />
        <div className="ob-option-stack compact">
          {regularityOptions.map((option) => (
            <OptionCard
              key={option.id}
              option={option}
              selected={draft.regularity === option.id}
              onClick={() => patch({ regularity: option.id })}
            />
          ))}
        </div>
        {nativePlatform === 'ios' && (
          <section className="ob-health-import" aria-labelledby="apple-health-import-title">
            <div className="ob-health-import-icon" aria-hidden="true">
              <LunaraMark decorative size={28} />
            </div>
            <div className="ob-health-import-copy">
              <span className="eyebrow">Optional shortcut</span>
              <strong id="apple-health-import-title">Bring in period history from Apple Health</strong>
              <p>
                Lunara requests read-only access to menstrual-flow records, keeps their source
                attached, and never replaces a period date you entered yourself.
              </p>
            </div>
            <button
              type="button"
              className="ob-health-import-button"
              disabled={healthImportBusy}
              onClick={importApplePeriodsDuringOnboarding}
            >
              {healthImportBusy
                ? 'Checking Apple Health…'
                : healthImportAttempted
                  ? 'Import again'
                  : 'Import from Apple Health'}
            </button>
            {healthImportMessage && (
              <p className="ob-health-import-status" role="status">
                {healthImportMessage}
              </p>
            )}
          </section>
        )}
        <div className="ob-date-card">
          <strong>Recent period starts</strong>
          {draft.periodStarts.map((date, index) => (
            <label key={index}>
              <span>{index === 0 ? 'Most recent' : index === 1 ? 'One before' : 'Two before'}</span>
              <input
                type="date"
                max={localToday()}
                value={date}
                onChange={(event) => {
                  const periodStarts: Draft['periodStarts'] = [...draft.periodStarts]
                  periodStarts[index] = event.target.value
                  patch({
                    periodStarts,
                    dateConfidence: event.target.value ? 'known' : draft.dateConfidence,
                  })
                }}
              />
            </label>
          ))}
        </div>
        <div className="ob-inline-fields">
          <label>
            <span>Usual cycle</span>
            <div><input type="number" min="15" max="90" value={draft.typicalCycleLength} onChange={(event) => patch({ typicalCycleLength: event.target.value })} /><i>days</i></div>
          </label>
          <label>
            <span>Usual bleeding</span>
            <div><input type="number" min="1" max="14" value={draft.typicalPeriodLength} onChange={(event) => patch({ typicalPeriodLength: event.target.value })} /><i>days</i></div>
          </label>
        </div>
        <button className="cta" onClick={next}>Continue</button>
      </Frame>
    )
  }

  if (current === 'hormonal-context') {
    const options: Option[] = [
      { id: 'scheduled', label: 'Scheduled withdrawal bleeding' },
      { id: 'unpredictable', label: 'Unpredictable bleeding or spotting' },
      { id: 'none', label: 'Little or no bleeding' },
      { id: 'unsure', label: 'Not sure yet' },
    ]
    return (
      <Frame {...frameProps} chapter="Cycle context" onSkip={next}>
        <QuestionIntro
          eyebrow="Your mode has adapted"
          title="What bleeding pattern have you noticed?"
          body="Lunara can track bleeding and medication adherence, but it will pause fertile-window estimates while this method makes them unreliable."
        />
        <div className="ob-prediction-gate">
          <span aria-hidden="true">◌</span>
          <div>
            <strong>Fertility forecast paused</strong>
            <p>Not a failure—this is the medically honest state for this context.</p>
          </div>
        </div>
        <div className="ob-option-stack">
          {options.map((option) => (
            <OptionCard key={option.id} option={option} selected={draft.bleedingPattern === option.id} onClick={() => patch({ bleedingPattern: option.id })} />
          ))}
        </div>
        <button className="cta" onClick={next}>Continue</button>
      </Frame>
    )
  }

  if (current === 'pregnancy-context') {
    const datingOptions: Array<Option & { id: PregnancyDatingMethod }> = [
      { id: 'clinician-edd', label: 'Clinician-assigned due date', detail: 'Used as the current authoritative timeline anchor.' },
      { id: 'lmp', label: 'First day of my last period', detail: 'Creates a provisional 280-day estimate.' },
      { id: 'conception', label: 'Conception date', detail: 'Creates a provisional estimate from the date entered.' },
      { id: 'ivf-day-3', label: 'Day-3 embryo transfer', detail: 'Uses the transfer date and embryo age.' },
      { id: 'ivf-day-5', label: 'Day-5 embryo transfer', detail: 'Uses the transfer date and embryo age.' },
    ]
    const datingLabel =
      draft.pregnancyDatingMethod === 'clinician-edd'
        ? 'Assigned due date'
        : draft.pregnancyDatingMethod === 'lmp'
          ? 'First day of last period'
          : draft.pregnancyDatingMethod === 'conception'
            ? 'Estimated conception date'
            : 'Embryo transfer date'
    return (
      <Frame {...frameProps} chapter="Pregnancy baseline" onSkip={next}>
        <div className="ob-chapter-band pregnancy">
          <Moonseed />
          <div><span>Pregnancy mode</span><strong>Start with a provisional timeline</strong></div>
        </div>
        <QuestionIntro
          eyebrow="Dating source matters"
          title="Which date should anchor your timeline?"
          body="Lunara preserves the source instead of quietly treating every pregnancy as LMP-dated."
        />
        <div className="ob-option-stack compact">
          {datingOptions.map((option) => (
            <OptionCard
              key={option.id}
              option={option}
              selected={draft.pregnancyDatingMethod === option.id}
              onClick={() => patch({ pregnancyDatingMethod: option.id, pregnancyDatingDate: '' })}
            />
          ))}
        </div>
        <div className="ob-date-card single">
          <label>
            <span>{datingLabel}</span>
            <input
              type="date"
              min={draft.pregnancyDatingMethod === 'clinician-edd' ? localToday() : undefined}
              max={draft.pregnancyDatingMethod === 'clinician-edd' ? undefined : localToday()}
              value={draft.pregnancyDatingDate}
              onChange={(event) =>
                patch({
                  pregnancyDatingDate: event.target.value,
                  dateConfidence: event.target.value ? 'known' : 'unknown',
                })
              }
            />
          </label>
        </div>
        <h2 className="ob-subquestion">How many babies are you expecting?</h2>
        <div className="ob-segmented" role="group" aria-label="Number of babies">
          {[1, 2, 3].map((count) => (
            <button
              key={count}
              className={draft.numberOfBabies === count ? 'selected' : ''}
              onClick={() => patch({ numberOfBabies: count })}
            >
              {count === 3 ? '3+' : count}
            </button>
          ))}
        </div>
        <div className="ob-why">
          <span aria-hidden="true">i</span>
          <p><strong>What this does not do</strong> It does not confirm gestational age or replace prenatal care.</p>
        </div>
        <div className="spacer" />
        <button className="cta" disabled={!draft.pregnancyDatingDate} onClick={next}>Build pregnancy timeline</button>
      </Frame>
    )
  }

  if (current === 'ttc-context') {
    return (
      <Frame {...frameProps} chapter="Trying to conceive" onSkip={next}>
        <QuestionIntro
          eyebrow="A more useful fertility plan"
          title="When did you start trying?"
          body="Optional. Lunara uses this only for age-aware education and clinician-conversation prompts—not to label infertility."
        />
        <div className="field ob-hero-field">
          <label htmlFor="trying-since">Month you started</label>
          <input id="trying-since" type="month" max={localToday().slice(0, 7)} value={draft.tryingSince} onChange={(event) => patch({ tryingSince: event.target.value })} />
        </div>
        <div className="ob-why">
          <span aria-hidden="true">✦</span>
          <p><strong>Evidence, not certainty</strong> OPKs can suggest an LH surge. A sustained temperature shift is retrospective. Neither confirms an exact ovulation day.</p>
        </div>
        <div className="spacer" />
        <button className="cta" onClick={next}>Continue</button>
      </Frame>
    )
  }

  if (current === 'tracking') {
    return (
      <Frame {...frameProps} chapter="Your tracker">
        <div className="ob-chapter-band">
          <Moonseed />
          <div><span>Chapter 2</span><strong>Choose what deserves space</strong></div>
        </div>
        <QuestionIntro
          eyebrow="You control the tracker"
          title="What would you like to understand?"
          body="Choose as many as you want. This changes logging shortcuts and which questions appear next."
        />
        <ChipGrid options={TRACKING_AREAS} values={draft.trackingAreas} onToggle={(id) => toggle('trackingAreas', id)} />
        <div className="ob-selection-note">
          <strong>{draft.trackingAreas.length} areas selected</strong>
          <span>Everything remains editable in Tracker settings.</span>
        </div>
        <button className="cta" disabled={!draft.trackingAreas.length} onClick={next}>Personalize my tracker</button>
      </Frame>
    )
  }

  if (current === 'symptom-baseline') {
    return (
      <Frame {...frameProps} chapter="Your tracker" onSkip={next}>
        <QuestionIntro
          eyebrow="A baseline, not a diagnosis"
          title="What are you noticing today?"
          body="This seeds your first check-in. Lunara only calls something a pattern after it repeats across prospectively tracked cycles."
        />
        <ChipGrid options={SYMPTOM_OPTIONS} values={draft.baselineSymptoms} exclusive="none" onToggle={(id) => toggle('baselineSymptoms', id, 'none')} />
        <div className="ob-why">
          <span aria-hidden="true">i</span>
          <p>An unlogged day is treated as missing—not as a symptom-free day.</p>
        </div>
        <div className="spacer" />
        <button className="cta" onClick={next}>Continue</button>
      </Frame>
    )
  }

  if (current === 'conditions') {
    return (
      <Frame {...frameProps} chapter="Health context" onSkip={next}>
        <QuestionIntro
          eyebrow="Use only what you already know"
          title="Have you been told you have any of these?"
          body="Choose diagnosed or clinician-discussed conditions only. Lunara will never infer one from this onboarding."
        />
        <div className="ob-option-stack compact">
          {CONDITION_OPTIONS.map((option) => (
            <OptionCard
              key={option.id}
              option={option}
              selected={draft.conditions.includes(option.id)}
              onClick={() => toggle('conditions', option.id)}
              selectionDetail="Used to widen uncertainty and tailor caution—not as a diagnosis."
            />
          ))}
        </div>
        <button className="cta" onClick={next}>Continue</button>
      </Frame>
    )
  }

  if (current === 'cycle-signals') {
    return (
      <Frame {...frameProps} chapter="Health context" onSkip={next}>
        <QuestionIntro
          eyebrow="What you have already noticed"
          title="Do any of these describe your cycle?"
          body="These answers can add safety prompts or make estimates more cautious. They never identify the cause."
        />
        <ChipGrid options={ABNORMALITY_OPTIONS} values={draft.abnormalities} exclusive="none" onToggle={(id) => toggle('abnormalities', id, 'none')} />
        <h2 className="ob-subquestion">Any other changes?</h2>
        <ChipGrid options={HORMONAL_SIGNAL_OPTIONS} values={draft.hormonalSignals} exclusive="none" onToggle={(id) => toggle('hormonalSignals', id, 'none')} />
        <div className="ob-safety-note">
          <strong>Seek urgent care for severe symptoms.</strong>
          <p>Sudden severe pelvic pain, fainting, trouble breathing, or very heavy bleeding with dizziness cannot be assessed in an app.</p>
        </div>
        <button className="cta" onClick={next}>Continue</button>
      </Frame>
    )
  }

  if (current === 'wellbeing') {
    const impactOptions: Array<{ id: AnswerChoice; label: string }> = [
      { id: 'yes', label: 'Yes' },
      { id: 'no', label: 'No' },
      { id: 'unsure', label: 'Not sure' },
    ]
    return (
      <Frame {...frameProps} chapter="Daily wellbeing" onSkip={next}>
        <QuestionIntro
          eyebrow="Look beyond period dates"
          title="Where does your cycle seem to show up?"
          body="Your answers choose which check-ins and educational cards appear. They are not used to claim cause and effect."
        />
        <div className="ob-impact-grid">
          {([
            ['sleepImpact', 'Sleep', '☾'],
            ['skinImpact', 'Skin', '✺'],
            ['activityImpact', 'Energy', '↗'],
          ] as const).map(([key, label, icon]) => (
            <section key={key}>
              <div><span aria-hidden="true">{icon}</span><strong>{label}</strong></div>
              <div>
                {impactOptions.map((option) => (
                  <button
                    key={option.id}
                    className={draft[key] === option.id ? 'selected' : ''}
                    onClick={() => patch({ [key]: option.id })}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
        <h2 className="ob-subquestion">Mood or mental-health changes you want to track</h2>
        <ChipGrid
          options={[
            { id: 'mood-swings', label: 'Mood swings' },
            { id: 'anxiety', label: 'Anxiety' },
            { id: 'low-mood', label: 'Low mood' },
            { id: 'irritability', label: 'Irritability' },
            { id: 'brain-fog', label: 'Brain fog' },
            { id: 'none', label: 'None right now' },
          ]}
          values={draft.mentalHealthSignals}
          exclusive="none"
          onToggle={(id) => toggle('mentalHealthSignals', id, 'none')}
        />
        {draft.trackingAreas.includes('sexual-wellbeing') && (
          <>
            <h2 className="ob-subquestion">Sexual-wellbeing goals</h2>
            <ChipGrid
              options={[
                { id: 'comfort', label: 'More comfort' },
                { id: 'libido', label: 'Understand desire' },
                { id: 'connection', label: 'Feel more connected' },
                { id: 'confidence', label: 'Build confidence' },
                { id: 'prefer-not', label: 'Prefer not to answer' },
              ]}
              values={draft.sexualWellnessGoals}
              exclusive="prefer-not"
              onToggle={(id) => toggle('sexualWellnessGoals', id, 'prefer-not')}
            />
          </>
        )}
        <button className="cta" onClick={next}>Continue</button>
      </Frame>
    )
  }

  if (current === 'movement') {
    const activityOptions: Array<Option & { id: ActivityLevel }> = [
      { id: 'mostly-sedentary', label: 'Mostly seated or resting' },
      { id: 'some-active-breaks', label: 'Some active breaks' },
      { id: 'on-feet-most-of-day', label: 'On my feet most of the day' },
      { id: 'very-active', label: 'Very active most days' },
      { id: 'unknown', label: 'I do not track this' },
    ]
    const wearableOptions: Array<Option & { id: WearableBrand }> = [
      { id: 'none', label: 'No wearable' },
      { id: 'apple', label: 'Apple Watch / Health' },
      { id: 'fitbit', label: 'Fitbit' },
      { id: 'garmin', label: 'Garmin' },
      { id: 'other', label: 'Another device' },
      { id: 'unknown', label: 'Not sure' },
    ]
    return (
      <Frame {...frameProps} chapter="Daily wellbeing" onSkip={next}>
        <QuestionIntro
          eyebrow="Optional movement context"
          title="What does a typical day feel like?"
          body="This can shape movement check-ins. It does not improve period prediction on its own."
        />
        <div className="ob-option-stack compact">
          {activityOptions.map((option) => (
            <OptionCard key={option.id} option={option} selected={draft.activityLevel === option.id} onClick={() => patch({ activityLevel: option.id })} />
          ))}
        </div>
        <h2 className="ob-subquestion">Do you use a wearable?</h2>
        <div className="ob-chip-grid wearable">
          {wearableOptions.map((option) => (
            <button key={option.id} className={`ob-chip ${draft.wearable === option.id ? 'selected' : ''}`} onClick={() => patch({ wearable: option.id })}>
              {option.label}<i>{draft.wearable === option.id ? '✓' : '+'}</i>
            </button>
          ))}
        </div>
        <div className="ob-why">
          <span aria-hidden="true">↗</span>
          <p><strong>Permission comes later</strong> Lunara explains the benefit before asking iOS or Android for health access.</p>
        </div>
        <button className="cta" onClick={next}>Continue</button>
      </Frame>
    )
  }

  if (current === 'biometrics') {
    return (
      <Frame {...frameProps} chapter="Optional measurements" onSkip={next}>
        <QuestionIntro
          eyebrow="Your choice"
          title="Would you like to add body measurements?"
          body="Useful for weight trends and clinician reports. Lunara does not pretend these make a calendar estimate precise."
        />
        <div className="ob-measure-grid">
          <label>
            <span>Height</span>
            <div><input type="number" inputMode="decimal" placeholder="165" value={draft.heightCm} onChange={(event) => patch({ heightCm: event.target.value })} /><i>cm</i></div>
          </label>
          <label>
            <span>Weight</span>
            <div><input type="number" inputMode="decimal" placeholder="65" value={draft.weightKg} onChange={(event) => patch({ weightKg: event.target.value })} /><i>kg</i></div>
          </label>
        </div>
        <div className="ob-data-boundary">
          <span aria-hidden="true">◇</span>
          <div><strong>Stored as profile context</strong><p>Daily changes belong in your timeline; this is only the starting value.</p></div>
        </div>
        <div className="spacer" />
        <button className="cta" onClick={next}>Continue</button>
      </Frame>
    )
  }

  if (current === 'sleep') {
    return (
      <Frame {...frameProps} chapter="Sleep" onSkip={next}>
        <div className="ob-night-map">
          <Moonseed mood="resting" />
          <span className="ob-night-path" />
          <i>✦</i><i>✦</i><i>✦</i>
        </div>
        <QuestionIntro
          eyebrow="Your final wellbeing chapter"
          title="What would make sleep feel better?"
          body={`You said sleep impact is “${choiceLabel(draft.sleepImpact)}.” Choose any goals worth checking in on.`}
        />
        <div className="ob-option-stack compact">
          {SLEEP_GOALS.map((option) => (
            <OptionCard key={option.id} option={option} selected={draft.sleepGoals.includes(option.id)} onClick={() => toggle('sleepGoals', option.id)} />
          ))}
        </div>
        <button className="cta" onClick={next}>Build my map</button>
      </Frame>
    )
  }

  if (current === 'summary') {
    const hasHistory = draft.periodStarts.some(Boolean)
    const confidenceText = draft.goal === 'pregnancy'
      ? hasHistory ? 'Provisional LMP-based timeline' : 'Pregnancy timeline waiting for a date'
      : hormonalMethod
        ? 'Bleeding tracking; fertility forecast paused'
        : hasHistory
          ? `${draft.periodStarts.filter(Boolean).length} observed start${draft.periodStarts.filter(Boolean).length === 1 ? '' : 's'}; still learning`
          : 'No forecast until you log a real period'
    return (
      <Frame {...frameProps} chapter="Your map">
        <div className="ob-analysis-hero">
          <Moonseed mood="thinking" />
          <span>Baseline assembled on this device</span>
        </div>
        <QuestionIntro
          eyebrow="Here is what your answers actually change"
          title={`${firstName(draft.displayName) || 'Your'} setup is ready to learn.`}
          body="No mystery score and no pretend diagnosis. Every active or paused feature has a reason."
        />
        <div className="ob-summary-list">
          <article>
            <span className={hormonalMethod ? 'paused' : 'learning'}>{hormonalMethod ? 'Paused' : 'Learning'}</span>
            <div><strong>Cycle & fertility</strong><p>{confidenceText}</p></div>
          </article>
          <article>
            <span className="active">Active</span>
            <div><strong>Daily tracker</strong><p>{draft.trackingAreas.length} areas prioritized; all other signals remain available.</p></div>
          </article>
          <article>
            <span className="cautious">Cautious</span>
            <div><strong>Pattern insights</strong><p>Preliminary only after 2 complete cycles; stronger cards require at least 3.</p></div>
          </article>
          <article>
            <span className="local">Local</span>
            <div><strong>Health profile</strong><p>Stored in Lunara’s on-device database and editable from Settings.</p></div>
          </article>
        </div>
        <div className="ob-why">
          <span aria-hidden="true">i</span>
          <p>Conditions and baseline symptoms only tailor caution, logging, and education. They do not generate a condition result.</p>
        </div>
        <button className="cta" onClick={next}>Continue to optional AI</button>
      </Frame>
    )
  }

  if (current === 'ai') {
    return (
      <Frame {...frameProps} chapter="Optional companion" onSkip={next}>
        <QuestionIntro
          eyebrow="AI is separate from prediction"
          title="Choose how the assistant runs."
          body={
            publikHere
              ? 'Core tracking and calculations work without AI. The assistant runs on publik API unless you bring your own key.'
              : 'Core tracking and calculations work without AI. You bring your own credential.'
          }
        />
        <div className="ai-provider-grid">
          {publikHere && (
            <OptionCard
              option={{ id: 'publik', icon: '◐', label: 'publik API', detail: 'No account, no key. Free starter usage, then priced per use.' }}
              selected={provider === 'publik'}
              onClick={() => chooseProvider('publik')}
            />
          )}
          <OptionCard
            option={{ id: 'anthropic', icon: '✳', label: 'Anthropic', detail: 'An API key, or a token from `claude setup-token` to use your Claude subscription.' }}
            selected={provider === 'anthropic'}
            onClick={() => chooseProvider('anthropic')}
          />
          <OptionCard
            option={{ id: 'openai', icon: '✦', label: 'OpenAI', detail: 'Bring your own project key. Stored in Keychain or Keystore on native.' }}
            selected={provider === 'openai'}
            onClick={() => chooseProvider('openai')}
          />
        </div>
        {provider === 'publik' && publikInstall ? (
          <div className="card ai-setup-card">
            <p className="microcopy"><strong>Lunara AI is ready.</strong></p>
            <p className="publik-balance">{publikBalanceLine(publikInstall.balanceMicros, publikInstall.claimState)}</p>
            <p className="microcopy">{publikInstall.costSentence ?? PUBLIK_WHY_IT_COSTS}</p>
            <p className="microcopy">{PUBLIK_DATA_PATH}</p>
            {publikInstall.claimUrl && (
              <button className="cta" onClick={() => void Browser.open({ url: publikInstall.claimUrl as string })}>
                {publikLinkButtonLabel(publikInstall.claimState)}
              </button>
            )}
          </div>
        ) : provider === 'publik' ? (
          <div className="card ai-setup-card">
            <p className="microcopy"><strong>Lunara AI uses publik API.</strong></p>
            <p className="microcopy">
              <strong>Cost.</strong> {PUBLIK_WHY_IT_COSTS} Every new phone starts with free usage and no
              card; most people spend under $2 a month.
            </p>
            <p className="microcopy">
              <strong>Where your messages go.</strong> {PUBLIK_DATA_PATH}
            </p>
            <p className="microcopy">
              By continuing you agree to the{' '}
              <a href="https://publikhq.com/developers#why" target="_blank" rel="noreferrer">publik API terms</a>.
              You can switch to your own key at any time in AI settings.
            </p>
            {publikError && <p className="microcopy" role="alert">{publikError}</p>}
            <button className="text-button" onClick={() => chooseProvider('anthropic')}>Use my own key instead</button>
          </div>
        ) : provider === 'anthropic' ? (
          <div className="card ai-setup-card">
            <div className="field">
              <label htmlFor="anthropic-key">Anthropic API key or CLI token</label>
              <input
                id="anthropic-key"
                type="password"
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="Set up later if you prefer"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="anthropic-model">Model</label>
              <select
                id="anthropic-model"
                value={ANTHROPIC_MODELS.some((entry) => entry.id === model) ? model : DEFAULT_ANTHROPIC_MODEL}
                onChange={(event) => setModel(event.target.value)}
              >
                {ANTHROPIC_MODELS.map((entry) => (
                  <option key={entry.id} value={entry.id}>{entry.label}</option>
                ))}
              </select>
            </div>
            <p className="microcopy">
              To bill answers to a Claude subscription instead of API credits, run{' '}
              <code>claude setup-token</code> on a computer where you are signed in and paste the
              token here. Lunara cannot run the CLI itself from a mobile app.
            </p>
          </div>
        ) : (
          <div className="card ai-setup-card">
            <div className="field">
              <label htmlFor="openai-key">OpenAI project key</label>
              <input
                id="openai-key"
                type="password"
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="Set up later if you prefer"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="openai-model">Model</label>
              <input id="openai-model" autoCapitalize="none" spellCheck={false} value={model} onChange={(event) => setModel(event.target.value)} />
            </div>
            <p className="microcopy">Use a dedicated project key with a spending limit. Never paste a personal or reused secret into screenshots or chat.</p>
          </div>
        )}
        {provider === 'publik' && publikInstall ? (
          <button className="cta" onClick={() => void continueFromPublikCard()}>
            {publikInstall.claimState === 'claimed' ? 'Continue' : 'Not now — keep the free starter'}
          </button>
        ) : provider === 'publik' ? (
          <button className="cta" onClick={() => void connectPublik()} disabled={publikBusy}>
            {publikBusy ? 'Connecting publik API…' : 'Continue with publik API'}
          </button>
        ) : (
          <button className="cta" onClick={next}>
            {apiKey.trim() ? 'Continue' : 'Connect later'}
          </button>
        )}
      </Frame>
    )
  }

  return (
    <Frame step={current} stepNumber={progressSteps.length} totalSteps={progressSteps.length}>
      <div className="onboarding-finish">
        <div className="ob-finish-orbit"><Moonseed /><span /><span /></div>
        <p className="eyebrow">Your baseline, not a verdict</p>
        <h1>Ready to notice what changes.</h1>
        <p className="lead">
          Lunara will start uncertain, show why, and learn from complete check-ins and real cycle history.
        </p>
        <div className="ob-commitment">
          <strong>I’ll use estimates as context—not contraception or diagnosis.</strong>
          <span>Predictions can be wrong, especially with irregular cycles, hormonal contraception, postpartum changes, or limited data.</span>
        </div>
        {saveError && <p className="error-text">{saveError}</p>}
      </div>
      <button className="cta" disabled={saving} onClick={finish}>
        {saving ? 'Securing your baseline…' : 'Enter Lunara'}
      </button>
    </Frame>
  )
}
