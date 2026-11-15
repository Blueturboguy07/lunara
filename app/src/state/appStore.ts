import { create } from 'zustand'
import type { Tab } from '../components/TabBar'

export type TrackerFocus = 'flow' | 'symptoms' | 'intimacy'

interface AppState {
  tab: Tab
  setTab: (t: Tab) => void
  /** Date the log sheet is open for, or null when closed. */
  sheetDate: string | null
  /** Optional tracker section requested by a contextual quick action. */
  sheetFocus: TrackerFocus | null
  openSheet: (date: string, focus?: TrackerFocus) => void
  closeSheet: () => void
  calendarOpen: boolean
  setCalendarOpen: (open: boolean) => void
  assistantOpen: boolean
  setAssistantOpen: (open: boolean) => void
  /**
   * "Use my own AI key" on the gate's plan screen (blind test round 2, M2): Lunara AI
   * opens on the key entry. Nothing is saved until the person saves a key.
   */
  aiKeyEntry: boolean
  openAiKeyEntry: () => void
  setAiKeyEntry: (open: boolean) => void
  reportOpen: boolean
  setReportOpen: (open: boolean) => void
  cycleReportOpen: boolean
  setCycleReportOpen: (open: boolean) => void
  pregnancyDetailOpen: boolean
  setPregnancyDetailOpen: (open: boolean) => void
  perimenopauseOpen: boolean
  setPerimenopauseOpen: (open: boolean) => void
  ttcDetailOpen: boolean
  setTtcDetailOpen: (open: boolean) => void
  trackerCustomizeOpen: boolean
  setTrackerCustomizeOpen: (open: boolean) => void
  locked: boolean
  setLocked: (locked: boolean) => void
  articleSlug: string | null
  setArticleSlug: (slug: string | null) => void
}

export const useApp = create<AppState>((set) => ({
  tab: 'today',
  setTab: (tab) => set({ tab }),
  sheetDate: null,
  sheetFocus: null,
  openSheet: (sheetDate, sheetFocus) => set({ sheetDate, sheetFocus: sheetFocus ?? null }),
  closeSheet: () => set({ sheetDate: null, sheetFocus: null }),
  calendarOpen: false,
  setCalendarOpen: (calendarOpen) => set({ calendarOpen }),
  assistantOpen: false,
  setAssistantOpen: (assistantOpen) => set({ assistantOpen }),
  aiKeyEntry: false,
  openAiKeyEntry: () => set({ assistantOpen: true, aiKeyEntry: true }),
  setAiKeyEntry: (aiKeyEntry) => set({ aiKeyEntry }),
  reportOpen: false,
  setReportOpen: (reportOpen) => set({ reportOpen }),
  cycleReportOpen: false,
  setCycleReportOpen: (cycleReportOpen) => set({ cycleReportOpen }),
  pregnancyDetailOpen: false,
  setPregnancyDetailOpen: (pregnancyDetailOpen) => set({ pregnancyDetailOpen }),
  perimenopauseOpen: false,
  setPerimenopauseOpen: (perimenopauseOpen) => set({ perimenopauseOpen }),
  ttcDetailOpen: false,
  setTtcDetailOpen: (ttcDetailOpen) => set({ ttcDetailOpen }),
  trackerCustomizeOpen: false,
  setTrackerCustomizeOpen: (trackerCustomizeOpen) => set({ trackerCustomizeOpen }),
  locked: false,
  setLocked: (locked) => set({ locked }),
  articleSlug: null,
  setArticleSlug: (articleSlug) => set({ articleSlug }),
}))
