import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState } from 'react'
import {
  DEFAULT_TRACKER_ORDER,
  TRACKER_CATALOG,
  TRACKER_CUSTOMIZATION_KEY,
  normalizeTrackerCustomization,
  type TrackerCustomization,
} from '../content/trackerCatalog'
import { getSetting, setSetting } from '../db/schema'
import { ArrowIcon } from '../components/ArrowIcon'
import '../styles/health.css'

export interface TrackerCustomizeScreenProps {
  onBack: () => void
}

const DEFAULT_CUSTOMIZATION: TrackerCustomization = {
  order: DEFAULT_TRACKER_ORDER,
  hidden: [],
}

export function TrackerCustomizeScreen({ onBack }: TrackerCustomizeScreenProps) {
  const stored = useLiveQuery(
    async () => (await getSetting(TRACKER_CUSTOMIZATION_KEY)) ?? '',
    [],
    '',
  )
  const [customization, setCustomization] =
    useState<TrackerCustomization>(DEFAULT_CUSTOMIZATION)
  const [loadedValue, setLoadedValue] = useState<string | null>(null)

  useEffect(() => {
    if (stored === loadedValue) return
    if (!stored) {
      setCustomization(DEFAULT_CUSTOMIZATION)
    } else {
      try {
        setCustomization(normalizeTrackerCustomization(JSON.parse(stored)))
      } catch {
        setCustomization(DEFAULT_CUSTOMIZATION)
      }
    }
    setLoadedValue(stored)
  }, [loadedValue, stored])

  const sections = useMemo(() => {
    const byId = new Map(TRACKER_CATALOG.map((section) => [section.id, section]))
    return customization.order.flatMap((id) => {
      const section = byId.get(id)
      return section ? [section] : []
    })
  }, [customization.order])
  const visibleCount = sections.length - customization.hidden.length

  function move(id: string, direction: -1 | 1) {
    const index = customization.order.indexOf(id)
    const destination = index + direction
    if (index < 0 || destination < 0 || destination >= customization.order.length) return
    const order = [...customization.order]
    ;[order[index], order[destination]] = [order[destination], order[index]]
    setCustomization((current) => ({ ...current, order }))
  }

  function toggle(id: string) {
    const isHidden = customization.hidden.includes(id)
    if (!isHidden && visibleCount <= 1) return
    setCustomization((current) => ({
      ...current,
      hidden: isHidden
        ? current.hidden.filter((hiddenId) => hiddenId !== id)
        : [...current.hidden, id],
    }))
  }

  async function save() {
    await setSetting(TRACKER_CUSTOMIZATION_KEY, JSON.stringify(customization))
    onBack()
  }

  return (
    <div className="health-overlay">
      <header className="health-topbar">
        <button className="health-icon-button" onClick={onBack} aria-label="Close without saving">
          ‹
        </button>
        <div className="health-topbar-title">Customize tracking</div>
        <span />
      </header>

      <div className="health-scroll">
        <main className="health-canvas">
          <section className="health-hero">
            <div className="health-kicker">Your daily log</div>
            <h1 className="health-display">Keep only what matters.</h1>
            <p className="health-lede" style={{ marginTop: 12 }}>
              Reorder sections and hide the ones you do not use. Existing entries are never
              deleted.
            </p>
          </section>

          <section className="health-panel">
            <div className="health-section-head" style={{ paddingTop: 0 }}>
              <h2>Tracker sections</h2>
              <span>{visibleCount} visible</span>
            </div>
            <div style={{ marginTop: 6 }}>
              {sections.map((section, index) => {
                const visible = !customization.hidden.includes(section.id)
                return (
                  <div className="health-sort-row" key={section.id}>
                    <div className="health-sort-copy">
                      <strong>{section.label}</strong>
                      <span>
                        {section.description} · {section.itemCount}{' '}
                        {section.itemCount === 1 ? 'item' : 'items'}
                      </span>
                    </div>
                    <div className="health-sort-actions">
                      <button
                        className="health-sort-button"
                        disabled={index === 0}
                        onClick={() => move(section.id, -1)}
                        aria-label={`Move ${section.label} up`}
                      >
                        <ArrowIcon direction="up" />
                      </button>
                      <button
                        className="health-sort-button"
                        disabled={index === sections.length - 1}
                        onClick={() => move(section.id, 1)}
                        aria-label={`Move ${section.label} down`}
                      >
                        <ArrowIcon direction="down" />
                      </button>
                      <button
                        className="health-toggle"
                        aria-pressed={visible}
                        disabled={visible && visibleCount <= 1}
                        onClick={() => toggle(section.id)}
                        aria-label={`${visible ? 'Hide' : 'Show'} ${section.label}`}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </section>

          <p className="health-note">
            Hiding changes the log-sheet layout only. Historical data, reports, patterns, imports,
            and exports keep all entries.
          </p>

          <button className="health-action" onClick={() => void save()}>
            Save tracker layout
          </button>
          <button
            className="health-action secondary"
            onClick={() => setCustomization(DEFAULT_CUSTOMIZATION)}
          >
            Restore default order
          </button>
        </main>
      </div>
    </div>
  )
}
