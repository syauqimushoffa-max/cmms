import type { NotificationRecord } from "@pbs-cmms/shared";

type NotificationListener = (notification: NotificationRecord) => void | Promise<void>;

const listeners = new Set<NotificationListener>();

export function onNotificationCreated(listener: NotificationListener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitNotificationCreated(notification: NotificationRecord) {
  for (const listener of listeners) {
    Promise.resolve(listener(notification)).catch((error) => {
      console.error("Unable to deliver notification event.", error);
    });
  }
}
