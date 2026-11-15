import { planUseFrom, publikStatusLine, type PublikUsage } from '../lib/publikApi'

interface PlanUseMeterProps {
  usage: PublikUsage | null
  className?: string
  /** The words before publik answered. */
  placeholder?: string
}

/**
 * AI use as a percent of the publik plan limit, with a bar when publik gives a
 * limit ("62% of your plan used · resets Monday"). Without a limit: "Plan
 * active" or "Plan limit reached", with no number. Never an amount of money.
 */
export function PlanUseMeter({ usage, className = '', placeholder = 'Checking your publik plan…' }: PlanUseMeterProps) {
  if (!usage) return <p className={`plan-use-line ${className}`.trim()}>{placeholder}</p>
  const percent = planUseFrom(usage)?.usedPercent ?? null
  return (
    <div className={`plan-use ${className}`.trim()}>
      <p className="plan-use-line">{publikStatusLine(usage)}</p>
      {percent !== null && (
        <div
          className="progress-track plan-use-track"
          role="progressbar"
          aria-label="Share of your publik plan used"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
        >
          <span style={{ width: `${percent}%` }} />
        </div>
      )}
    </div>
  )
}
