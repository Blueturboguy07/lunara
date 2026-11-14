/** Original educational content — never diagnostic, always estimative language. */
export interface Article {
  slug: string
  title: string
  category: string
  minutes: number
  body: string[]
}

export const ARTICLES: Article[] = [
  {
    slug: 'cycle-phases',
    title: 'The four phases of your cycle, in plain words',
    category: 'Cycle basics',
    minutes: 3,
    body: [
      'Your cycle starts on the first day of your period. During the menstrual phase the uterine lining sheds — for most people this lasts three to seven days.',
      'The follicular phase overlaps and follows: rising estrogen matures a follicle in the ovary, and energy often climbs with it.',
      'Ovulation is the release of an egg, typically midway through the cycle — but "typically" hides huge variation. The egg lives about a day; sperm can wait up to five, which is why the fertile window opens well before ovulation itself.',
      'The luteal phase runs from ovulation to the next period and is the most consistent stretch, commonly near 14 days. Progesterone dominates here, and so do many premenstrual symptoms.',
      'Knowing which phase you are in explains a lot — and logging is how Lunara learns your version of it, not the textbook one.',
    ],
  },
  {
    slug: 'normal-variation',
    title: 'Only 13% of cycles are actually 28 days',
    category: 'Cycle basics',
    minutes: 2,
    body: [
      'A study of more than 600,000 cycles found that just 13% were exactly 28 days long. The textbook number is a median, not a norm.',
      'Cycles between 21 and 35 days are widely considered within the usual range, and your own length can drift with age, stress, travel, illness, and body-weight changes.',
      'That is why Lunara shows an uncertainty band around predictions and never pretends to day-perfect accuracy — anyone who does is guessing with confidence.',
      'A change worth mentioning to a clinician: periods that stop for months, cycles persistently shorter than 21 days or longer than 35, or bleeding between periods.',
    ],
  },
  {
    slug: 'cramps-toolkit',
    title: 'A practical toolkit for cramps',
    category: 'Symptoms',
    minutes: 3,
    body: [
      'Menstrual cramps come from prostaglandins — compounds that make the uterus contract to shed its lining. More prostaglandins usually means stronger cramps.',
      'Heat genuinely helps: a heating pad or warm bath relaxes the muscle. Gentle movement — a walk, light stretching — often does more than staying still.',
      'Over-the-counter anti-inflammatories work best when started early, at the first sign rather than at peak pain. Ask a pharmacist or clinician what suits you.',
      'Log your cramps in Lunara: seeing that they arrive, say, the day before flow starts turns dread into a plan.',
      'Cramps that derail your life, resist medication, or worsen over time deserve a medical conversation — severe pain is common, but it is not something you owe anyone.',
    ],
  },
  {
    slug: 'fertile-window',
    title: 'How the fertile window really works',
    category: 'Fertility',
    minutes: 3,
    body: [
      'Pregnancy is possible on roughly six days per cycle: the five days before ovulation and the day of ovulation itself. Sperm survive several days; the egg does not.',
      'The hard part is knowing when ovulation happens. Calendar math gives an estimate; ovulation tests (which detect the LH surge about a day or two before release) and basal body temperature (which rises about half a degree after) sharpen it.',
      'Lunara combines what you log: with test results and temperatures, the estimate anchors to your body instead of the calendar.',
      'Estimates are estimates. Do not use any app — this one included — as contraception. If avoiding pregnancy matters to you, use a method designed for it.',
    ],
  },
  {
    slug: 'bbt-how-to',
    title: 'Basal body temperature without the confusion',
    category: 'Fertility',
    minutes: 2,
    body: [
      'Basal body temperature is your temperature at complete rest. After ovulation it rises roughly 0.3–0.5 °C and stays up until the next period.',
      'The catch: the rise confirms ovulation after the fact. It cannot predict it. Its value is in mapping your pattern across cycles.',
      'For readable data, measure at the same time every morning, before getting up, after at least a few hours of sleep, with a two-decimal thermometer.',
      'Log it in Lunara and the chart draws itself — look for the sustained shift, not any single reading. Alcohol, illness, and short sleep all nudge the numbers.',
    ],
  },
  {
    slug: 'peri-what-is',
    title: 'Perimenopause: the transition nobody briefed you on',
    category: 'Perimenopause',
    minutes: 3,
    body: [
      'Perimenopause is the years-long runway to menopause, often starting in the mid-40s, sometimes earlier. Hormones do not decline smoothly — they oscillate, and symptoms follow.',
      'The classic early sign is cycle irregularity: a persistent difference of seven days or more between consecutive cycles is a common marker of the transition.',
      'Hot flashes, night sweats, sleep trouble, mood swings, and brain fog are frequent companions. They are real, physiological, and worth tracking — patterns you can show a clinician get taken more seriously than vibes.',
      'Lunara’s perimenopause mode scores how often transition-associated symptoms appear in your logs and watches cycle variability for you.',
      'Effective treatments exist, from lifestyle changes to hormone therapy. A clinician who dismisses persistent symptoms is a clinician worth replacing.',
    ],
  },
  {
    slug: 'pregnancy-trimesters',
    title: 'The three trimesters at a glance',
    category: 'Pregnancy',
    minutes: 2,
    body: [
      'Pregnancy is counted from the first day of your last period — about 40 weeks in total, though full term spans weeks 37 to 42.',
      'The first trimester (through week 12) is the most eventful biologically: organs form, and fatigue and nausea peak while nothing shows.',
      'The second (weeks 13–27) is usually the easiest stretch — energy returns, movement becomes noticeable, and the anatomy scan lands around week 20.',
      'The third is growth and preparation: the lungs mature last, and the body rehearses with practice contractions.',
      'Lunara tracks your week and due date on-device. Prenatal care is irreplaceable — the app is a companion, not a substitute.',
    ],
  },
  {
    slug: 'why-local',
    title: 'How local-first keeps you in control',
    category: 'Privacy',
    minutes: 2,
    body: [
      'Period-app data has been shared with advertisers, handed to analytics firms, and subpoenaed in court. This is not hypothetical; it is documented history.',
      'Lunara’s default is architectural: your logs live in your phone’s app storage, and there is no Lunara-hosted database of your health data. Your data stays on this phone unless you turn on AI chat or encrypted backup.',
      'Optional backup sends an encrypted snapshot to a relay only after you enable it. The recovery code stays with you, so the relay stores an unreadable blob rather than plain health history.',
      'AI chat is separately opt-in, and it sends data off this phone. Before the first message, Lunara shows what goes to which provider, and nothing is sent until you agree. Each message sends your message, the earlier messages in that chat and only the tracker categories you tick.',
      'The code is open source under AGPL-3.0, so none of this requires trust. Read it, build it, verify it.',
    ],
  },
]

export function articleBySlug(slug: string): Article | undefined {
  return ARTICLES.find((a) => a.slug === slug)
}
