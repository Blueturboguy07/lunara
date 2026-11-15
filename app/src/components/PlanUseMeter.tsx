import { planUseFrom, publikStatusLine, type PublikUsage } from '../lib/publikApi'

interface PlanUseMeterProps {
  usage: PublikUsage | null
  className?: string
  /** The words before publik answered. */
  placeholder?: string
}

/**
 * AI use as a share, with a bar (blind test round 2, M1). Never an amount of money.
 *   plan:    "62% of your plan used · resets Monday", the bar shows the share used;
 *   prepaid: "80% left", the bar shows the share left (prepaid use has no reset day);
 *   free:    "60% of your free use left", the bar shows the share left.
 * Without a share: "Plan active", "No publik plan yet" and the like, with no bar.
 */
export function PlanUseMeter({ usage, className = '', placeholder = 'Checking your publik plan…' }: PlanUseMeterProps) {
  if (!usage) return <p className={`plan-use-line ${className}`.trim()}>{placeholder}</p>
  const use = planUseFrom(usage)
  const bar =
    use?.kind === 'plan' && use.usedPercent !== null
      ? { value: use.usedPercent, label: 'Share of your publik plan used' }
      : (use?.kind === 'prepaid' || use?.kind === 'free') && use.leftPercent !== null
        ? { value: use.leftPercent, label: use.kind === 'free' ? 'Share of your free use left' : 'Share of your prepaid use left' }
        : null
  return (
    <div className={`plan-use ${className}`.trim()}>
      <p className="plan-use-line">{publikStatusLine(usage)}</p>
      {bar && (
        <div
          className="progress-track plan-use-track"
          role="progressbar"
          aria-label={bar.label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={bar.value}
        >
          <span style={{ width: `${bar.value}%` }} />
        </div>
      )}
    </div>
  )
}
