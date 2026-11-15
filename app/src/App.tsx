import { App as NativeApp } from '@capacitor/app'
import type { PluginListenerHandle } from '@capacitor/core'
import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { AssistantScreen } from './components/AssistantScreen'
import { CalendarScreen } from './components/CalendarScreen'
import { DoctorReport } from './components/DoctorReport'
import { LogSheet } from './components/LogSheet'
import { PinLock } from './components/PinLock'
import { askPlanAfterOnboarding, RequirePublik } from './components/PublikGate'
import { TabBar } from './components/TabBar'
import { ensureHealthProfile, getHealthProfile, getSetting, SK } from './db/schema'
import { resolvePregnancyDating } from './engine/pregnancyDating'
import { ArticleScreen } from './screens/ArticleScreen'
import { Graphs } from './screens/Graphs'
import { Insights } from './screens/Insights'
import { Onboarding } from './screens/Onboarding'
import { Settings } from './screens/Settings'
import { Today } from './screens/Today'
import { isNative } from './native/runtime'
import {
  CycleReportScreen,
  PerimenopauseScreen,
  PregnancyDetailScreen,
  TrackerCustomizeScreen,
  TtcDetailScreen,
} from './screens/healthFeatures'
import { useApp } from './state/appStore'

export default function App() {
  const {
    tab,
    setTab,
    sheetDate,
    sheetFocus,
    closeSheet,
    calendarOpen,
    assistantOpen,
    setAssistantOpen,
    reportOpen,
    cycleReportOpen,
    setCycleReportOpen,
    pregnancyDetailOpen,
    setPregnancyDetailOpen,
    perimenopauseOpen,
    setPerimenopauseOpen,
    ttcDetailOpen,
    setTtcDetailOpen,
    trackerCustomizeOpen,
    setTrackerCustomizeOpen,
    locked,
    setLocked,
    articleSlug,
    setArticleSlug,
  } = useApp()

  const [ready, setReady] = useState(false)
  const [onboarded, setOnboarded] = useState(false)

  useEffect(() => {
    // Persist legacy/fresh-install profile state outside Dexie's read-only
    // liveQuery context. getHealthProfile remains safe to call reactively.
    void ensureHealthProfile().catch((error: unknown) => {
      console.error('[Lunara startup] Could not persist the health profile migration.', error)
    })
  }, [])

  const flags = useLiveQuery(async () => {
    const [ob, pin, legacyPregnancyLmp, profile] = await Promise.all([
      getSetting(SK.onboarded),
      getSetting(SK.pinHash),
      getSetting(SK.pregnancyLMP),
      getHealthProfile(),
    ])
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
    return { ob: ob === '1', hasPin: !!pin, pregnancyDating }
  }, [])

  useEffect(() => {
    if (flags === undefined) return
    setOnboarded(flags.ob)
    if (flags.hasPin) setLocked(true)
    setReady(true)
  }, [flags, setLocked])

  useEffect(() => {
    if (!isNative) return
    let listener: PluginListenerHandle | undefined
    void NativeApp.addListener('appStateChange', async ({ isActive }) => {
      if (!isActive && (await getSetting(SK.pinHash))) setLocked(true)
    }).then((handle) => {
      listener = handle
    })
    return () => {
      void listener?.remove()
    }
  }, [setLocked])


  if (!ready) return <div className="page page-loading" role="status" aria-label="Loading Lunara" />
  if (!onboarded)
    return (
      <Onboarding
        onDone={() => {
          setOnboarded(true)
          // Required mode: the age is known now, so an adult sees the plan screen (lib/publik.ts).
          askPlanAfterOnboarding()
        }}
      />
    )
  if (locked) return <PinLock />

  return (
    <>
      <main>
        {tab === 'today' && <Today />}
        {tab === 'insights' && <Insights />}
        {tab === 'graphs' && <Graphs />}
        {tab === 'settings' && <Settings />}
      </main>
      <TabBar active={tab} onChange={setTab} />

      {sheetDate && (
        <LogSheet date={sheetDate} initialFocus={sheetFocus ?? undefined} onClose={closeSheet} />
      )}
      {calendarOpen && <CalendarScreen />}
      {assistantOpen && (
        // Optional gate mode: Sign in with publik first ("Not now" closes Lunara AI).
        <RequirePublik onCancel={() => setAssistantOpen(false)}>
          <AssistantScreen />
        </RequirePublik>
      )}
      {reportOpen && <DoctorReport />}
      {cycleReportOpen && <CycleReportScreen onBack={() => setCycleReportOpen(false)} />}
      {pregnancyDetailOpen && flags?.pregnancyDating && (
        <PregnancyDetailScreen
          dating={flags.pregnancyDating}
          onBack={() => setPregnancyDetailOpen(false)}
        />
      )}
      {perimenopauseOpen && <PerimenopauseScreen onBack={() => setPerimenopauseOpen(false)} />}
      {ttcDetailOpen && <TtcDetailScreen onBack={() => setTtcDetailOpen(false)} />}
      {trackerCustomizeOpen && (
        <TrackerCustomizeScreen onBack={() => setTrackerCustomizeOpen(false)} />
      )}
      {articleSlug && <ArticleScreen slug={articleSlug} onClose={() => setArticleSlug(null)} />}
    </>
  )
}
