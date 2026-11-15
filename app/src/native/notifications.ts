import {
  LocalNotifications,
  type LocalNotificationSchema,
} from '@capacitor/local-notifications'
import type { PluginListenerHandle } from '@capacitor/core'
import {
  materializeReminderRequests,
  type MaterializedReminderRequest,
  type MaterializeReminderOptions,
  type ReminderPermission,
  type ReminderPlan,
} from '../engine/reminders'
import { APP_NAME } from '../lib/appName'
import { isNative } from './runtime'

const DAILY_REMINDER_ID = 10_001
const CHANNEL_ID = 'lunara-gentle-reminders'
const REMINDER_ACTION_TYPE = 'lunara-local-reminder'
const REMINDER_ENGINE_MARKER = 'lunara-reminder-engine-v1'
const IOS_PENDING_REQUEST_LIMIT = 64

async function ensureChannel(): Promise<void> {
  await LocalNotifications.createChannel({
    id: CHANNEL_ID,
    name: 'Gentle reminders',
    description: 'Private, generic reminders from Lunara',
    importance: 3,
    visibility: 0,
    vibration: true,
  }).catch(() => undefined)
}

export async function notificationPermission(
  request = false,
): Promise<ReminderPermission> {
  if (!isNative) return 'not-requested'
  const current = await LocalNotifications.checkPermissions()
  if (current.display === 'granted') return 'granted'
  if (!request) return current.display === 'denied' ? 'denied' : 'not-requested'
  const next = await LocalNotifications.requestPermissions()
  return next.display === 'granted' ? 'granted' : 'denied'
}

export async function scheduleDailyReminder(time: string): Promise<void> {
  if (!isNative) return

  const [hour, minute] = time.split(':').map(Number)
  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    throw new Error('Reminder time must use HH:MM.')
  }

  const permission = await notificationPermission(true)
  if (permission !== 'granted') throw new Error('Notification permission was not granted.')

  await ensureChannel()
  await cancelDailyReminder()
  const notification: LocalNotificationSchema = {
    id: DAILY_REMINDER_ID,
    title: APP_NAME,
    body: 'A gentle moment to check in with yourself.',
    channelId: CHANNEL_ID,
    schedule: {
      on: { hour, minute },
      repeats: true,
      allowWhileIdle: true,
    },
    extra: { route: 'today' },
  }
  await LocalNotifications.schedule({ notifications: [notification] })
}

export async function cancelDailyReminder(): Promise<void> {
  if (!isNative) return
  await LocalNotifications.cancel({ notifications: [{ id: DAILY_REMINDER_ID }] })
}

export async function pendingDailyReminder(): Promise<boolean> {
  if (!isNative) return false
  const pending = await LocalNotifications.getPending()
  return pending.notifications.some((n) => n.id === DAILY_REMINDER_ID)
}

/**
 * Register privacy-safe actions. The caller owns persistence: after receiving
 * an action it should update the matching occurrence record and call
 * syncReminderPlans again.
 */
async function registerReminderActions(): Promise<void> {
  await LocalNotifications.registerActionTypes({
    types: [
      {
        id: REMINDER_ACTION_TYPE,
        iosHiddenPreviewsBodyPlaceholder: 'Open Lunara to view this reminder.',
        actions: [
          { id: 'complete', title: 'Done' },
          { id: 'snooze', title: 'Snooze 15 min' },
        ],
      },
    ],
  })
}

function nativeNotification(request: MaterializedReminderRequest): LocalNotificationSchema {
  return {
    id: request.id,
    title: request.title,
    body: request.body,
    channelId: CHANNEL_ID,
    actionTypeId: REMINDER_ACTION_TYPE,
    schedule: {
      at: new Date(request.fireAt),
      allowWhileIdle: true,
    },
    extra: {
      manager: REMINDER_ENGINE_MARKER,
      reminderId: request.reminderId,
      occurrenceKey: request.occurrenceKey,
      kind: request.kind,
      route: request.route,
      state: request.state,
    },
  }
}

export async function cancelMaterializedReminders(): Promise<void> {
  if (!isNative) return
  const pending = await LocalNotifications.getPending()
  const managed = pending.notifications
    .filter((notification) => notification.extra?.manager === REMINDER_ENGINE_MARKER)
    .map(({ id }) => ({ id }))
  if (managed.length) await LocalNotifications.cancel({ notifications: managed })
}

/**
 * Replace the currently pending v1 reminder-engine requests. Existing legacy
 * daily reminders are intentionally left alone so this API is backwards
 * compatible while Settings migrates to ReminderPlan records.
 */
export async function scheduleMaterializedReminders(
  requests: MaterializedReminderRequest[],
): Promise<void> {
  if (!isNative) return
  const permission = await notificationPermission(false)
  if (permission !== 'granted') throw new Error('Notification permission is not granted.')
  await ensureChannel()
  await registerReminderActions()
  await cancelMaterializedReminders()
  const bounded = requests.slice(0, IOS_PENDING_REQUEST_LIMIT)
  if (bounded.length) {
    await LocalNotifications.schedule({
      notifications: bounded.map(nativeNotification),
    })
  }
}

export async function syncReminderPlans(
  plans: ReminderPlan[],
  options: MaterializeReminderOptions,
): Promise<MaterializedReminderRequest[]> {
  const requests = materializeReminderRequests(plans, {
    ...options,
    limit: Math.min(IOS_PENDING_REQUEST_LIMIT, options.limit ?? IOS_PENDING_REQUEST_LIMIT),
  })
  await scheduleMaterializedReminders(requests)
  return requests
}

export interface NativeReminderAction {
  action: 'open' | 'complete' | 'snooze'
  reminderId: string
  occurrenceKey: string
  route: string
}

export async function listenForReminderActions(
  listener: (action: NativeReminderAction) => void,
): Promise<PluginListenerHandle | undefined> {
  if (!isNative) return undefined
  return LocalNotifications.addListener('localNotificationActionPerformed', (event) => {
    const extra = event.notification.extra
    if (extra?.manager !== REMINDER_ENGINE_MARKER) return
    listener({
      action:
        event.actionId === 'complete'
          ? 'complete'
          : event.actionId === 'snooze'
            ? 'snooze'
            : 'open',
      reminderId: String(extra.reminderId ?? ''),
      occurrenceKey: String(extra.occurrenceKey ?? ''),
      route: String(extra.route ?? 'today'),
    })
  })
}
