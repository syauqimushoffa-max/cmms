import webpush, { type PushSubscription } from "web-push";
import type { NotificationRecord } from "@pbs-cmms/shared";
import {
  deletePushSubscription,
  getUser,
  listPushSubscriptionUserIds,
  listPushSubscriptions,
  type StoredPushSubscription
} from "./db.js";
import { onNotificationCreated } from "./notification-events.js";

let publicKey = "";
let privateKey = "";
let enabled = false;

function asWebPushSubscription(subscription: StoredPushSubscription): PushSubscription {
  return {
    endpoint: subscription.endpoint,
    expirationTime: subscription.expirationTime,
    keys: {
      p256dh: subscription.p256dh,
      auth: subscription.auth
    }
  };
}

export function webPushConfig() {
  return {
    enabled,
    publicKey: enabled ? publicKey : null
  };
}

export async function sendPushToUser(
  userId: string,
  notification: Pick<NotificationRecord, "title" | "body" | "workOrderId">
) {
  if (!enabled) return { sent: 0, failed: 0 };

  const subscriptions = listPushSubscriptions(userId);
  const user = getUser(userId);
  let sent = 0;
  let failed = 0;
  const payload = JSON.stringify({
    title: notification.title,
    body: notification.body,
    url: user.role === "requester"
      ? (notification.title.toLowerCase().includes("ready for verification") ? "/requester?view=verify" : "/requester")
      : notification.workOrderId ? `/work-orders/${encodeURIComponent(notification.workOrderId)}` : "/",
    tag: notification.workOrderId ? `work-order-${notification.workOrderId}` : "pbs-cmms",
    icon: "/icons/cmms-icon.svg",
    badge: "/icons/cmms-icon.svg"
  });

  await Promise.all(subscriptions.map(async (subscription) => {
    try {
      await webpush.sendNotification(asWebPushSubscription(subscription), payload, { TTL: 60 * 60 });
      sent += 1;
    } catch (error) {
      failed += 1;
      const statusCode = typeof error === "object" && error && "statusCode" in error
        ? Number(error.statusCode)
        : 0;
      if ([400, 401, 403, 404, 410].includes(statusCode)) {
        deletePushSubscription(subscription.endpoint, userId);
        return;
      }
      console.error(`Push delivery failed for user ${userId}.`, error);
    }
  }));

  return { sent, failed };
}

export async function sendPushToAllUsers(
  notification: Pick<NotificationRecord, "title" | "body" | "workOrderId">
) {
  const results = await Promise.all(
    listPushSubscriptionUserIds().map((userId) => sendPushToUser(userId, notification))
  );
  return results.reduce(
    (total, result) => ({ sent: total.sent + result.sent, failed: total.failed + result.failed }),
    { sent: 0, failed: 0 }
  );
}

export function initializeWebPush() {
  publicKey = process.env.VAPID_PUBLIC_KEY?.trim() || "";
  privateKey = process.env.VAPID_PRIVATE_KEY?.trim() || "";
  const subject = process.env.VAPID_SUBJECT?.trim() || "mailto:cmms@example.com";
  enabled = Boolean(publicKey && privateKey);

  if (!enabled) {
    console.info("Web Push is disabled. Configure VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY to enable it.");
    return;
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  onNotificationCreated(async (notification) => {
    await sendPushToUser(notification.userId, notification);
  });
  console.info("Web Push is enabled.");
}
