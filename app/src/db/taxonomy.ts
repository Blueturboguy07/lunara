/**
 * Loggable-item taxonomy, reconstructed category-by-category from
 * docs/RESEARCH.md §5. Icons are emoji placeholders until the original icon
 * set lands (M5).
 */
import type {
  ActivityEvent,
  DigestionEvent,
  Discharge,
  Flow,
  IntimacyEvent,
  LifestyleEvent,
  PregnancyTestResult,
  SymptomImpairment,
  SymptomSeverity,
} from './schema'

export const FLOWS: { id: Flow; label: string; icon: string }[] = [
  { id: 'light', label: 'Light', icon: '💧' },
  { id: 'medium', label: 'Medium', icon: '💧' },
  { id: 'heavy', label: 'Heavy', icon: '💧' },
  { id: 'clots', label: 'Clots', icon: '🩸' },
]

export const SYMPTOMS = [
  'Cramps',
  'Headache',
  'Migraine',
  'Tender breasts',
  'Bloating',
  'Acne',
  'Back pain',
  'Fatigue',
  'Nausea',
  'Dizziness',
  'Cravings',
  'Abdominal pain',
  'Ovulation pain',
  'Constipation',
  'Diarrhea',
  'Gas',
  'Indigestion',
  'Swelling',
  'Muscle aches',
  'Sore throat',
  'Feverish',
  'Chills',
  'Frequent urination',
  'Painful urination',
  'Dry skin',
  'Oily skin',
  'Hair changes',
  'Hot flashes',
  'Night sweats',
  'Brain fog',
  'Joint pain',
  'Insomnia',
] as const

export const MOODS = [
  'Calm',
  'Happy',
  'Energetic',
  'Sad',
  'Anxious',
  'Irritable',
  'Mood swings',
  'Low energy',
  'Focused',
  'Confident',
  'Sensitive',
  'Stressed',
  'Apathetic',
  'Restless',
] as const

export const DISCHARGES: { id: Discharge; label: string }[] = [
  { id: 'none', label: 'No discharge' },
  { id: 'sticky', label: 'Sticky' },
  { id: 'creamy', label: 'Creamy' },
  { id: 'egg-white', label: 'Egg white' },
  { id: 'watery', label: 'Watery' },
  { id: 'spotting', label: 'Spotting' },
  { id: 'unusual', label: 'Unusual for me' },
  { id: 'clumpy-white', label: 'Clumpy white' },
  { id: 'gray', label: 'Gray' },
]

export const SEX_OPTIONS: { id: IntimacyEvent; label: string }[] = [
  { id: 'no-sex', label: "Didn't have sex" },
  { id: 'protected', label: 'Protected sex' },
  { id: 'unprotected', label: 'Unprotected sex' },
  { id: 'oral', label: 'Oral sex' },
  { id: 'anal', label: 'Anal sex' },
  { id: 'masturbation', label: 'Masturbation' },
  { id: 'sensual-touch', label: 'Sensual touch' },
  { id: 'sex-toys', label: 'Sex toys' },
  { id: 'orgasm', label: 'Orgasm' },
  { id: 'neutral-drive', label: 'Neutral sex drive' },
  { id: 'high-drive', label: 'High sex drive' },
  { id: 'low-drive', label: 'Low sex drive' },
]

export const SYMPTOM_SEVERITIES: { id: SymptomSeverity; label: string }[] = [
  { id: 'mild', label: 'Mild' },
  { id: 'moderate', label: 'Moderate' },
  { id: 'severe', label: 'Severe' },
]

export const SYMPTOM_IMPAIRMENTS: { id: SymptomImpairment; label: string }[] = [
  { id: 'none', label: 'No routine impact' },
  { id: 'noticeable', label: 'Noticeable impact' },
  { id: 'limited-routine', label: 'Limited my routine' },
]

export const PREGNANCY_TEST_RESULTS: { id: PregnancyTestResult; label: string }[] = [
  { id: 'not-taken', label: "Didn't take a test" },
  { id: 'positive', label: 'Positive' },
  { id: 'negative', label: 'Negative' },
  { id: 'faint', label: 'Faint line' },
]

export const DIGESTION_EVENTS: { id: DigestionEvent; label: string }[] = [
  { id: 'nausea', label: 'Nausea' },
  { id: 'bloating', label: 'Bloating' },
  { id: 'constipation', label: 'Constipation' },
  { id: 'diarrhea', label: 'Diarrhea' },
  { id: 'gas', label: 'Gas' },
  { id: 'indigestion', label: 'Indigestion' },
  { id: 'appetite-low', label: 'Low appetite' },
  { id: 'appetite-high', label: 'Strong appetite' },
]

export const ACTIVITY_EVENTS: { id: ActivityEvent; label: string }[] = [
  { id: 'no-exercise', label: "Didn't exercise" },
  { id: 'walking', label: 'Walking' },
  { id: 'running', label: 'Running' },
  { id: 'strength', label: 'Strength training' },
  { id: 'yoga', label: 'Yoga' },
  { id: 'cycling', label: 'Cycling' },
  { id: 'swimming', label: 'Swimming' },
  { id: 'aerobics-dance', label: 'Aerobics & dancing' },
  { id: 'team-sports', label: 'Team sports' },
  { id: 'stretching', label: 'Stretching' },
]

export const LIFESTYLE_EVENTS: { id: LifestyleEvent; label: string }[] = [
  { id: 'travel', label: 'Travel' },
  { id: 'stress', label: 'Stress' },
  { id: 'meditation', label: 'Meditation' },
  { id: 'journaling', label: 'Journaling' },
  { id: 'kegel-exercises', label: 'Kegel exercises' },
  { id: 'breathing-exercises', label: 'Breathing exercises' },
  { id: 'illness-injury', label: 'Illness or injury' },
  { id: 'alcohol', label: 'Alcohol' },
  { id: 'caffeine', label: 'Caffeine' },
  { id: 'social-time', label: 'Social time' },
  { id: 'time-outdoors', label: 'Time outdoors' },
]

export interface TrackerGroup {
  id: string
  label: string
  description: string
  tone: 'rose' | 'teal' | 'sun' | 'violet'
  items: readonly string[]
}

/**
 * Original, extensible event catalog. Combined with the typed trackers above,
 * Lunara ships more than 80 loggable signals with its own labels, ordering and
 * artwork.
 */
export const TRACKER_GROUPS: TrackerGroup[] = [
  {
    id: 'sleep',
    label: 'Sleep',
    description: 'Quality, timing, and interruptions',
    tone: 'violet',
    items: [
      'Restful sleep',
      'Light sleep',
      'Interrupted sleep',
      'Trouble falling asleep',
      'Woke too early',
      'Vivid dreams',
      'Nap',
      'Late bedtime',
    ],
  },
  {
    id: 'contraception',
    label: 'Contraception',
    description: 'Private adherence notes',
    tone: 'rose',
    items: [
      'Pill taken',
      'Pill missed',
      'Patch changed',
      'Ring changed',
      'Injection',
      'Implant check',
      'IUD check',
      'Condom used',
      'Emergency contraception',
    ],
  },
  {
    id: 'care',
    label: 'Care & medication',
    description: 'What helped you feel better',
    tone: 'violet',
    items: [
      'Pain relief',
      'Medication taken',
      'Medication missed',
      'Medication taken late',
      'Prescription medication',
      'Supplement',
      'Prenatal vitamin',
      'Heating pad',
      'Massage',
      'Therapy',
      'Medical appointment',
    ],
  },
]

/** Symptoms surfaced more prominently in perimenopause mode. */
export const PERI_SYMPTOMS = [
  'Hot flashes',
  'Night sweats',
  'Brain fog',
  'Joint pain',
  'Insomnia',
  'Mood swings',
] as const
