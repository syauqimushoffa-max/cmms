import type { User } from "@pbs-cmms/shared";

export function formatDateTime(value: string | null) {
  if (!value) {
    return "Not set";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

export function formatDate(value: string | null) {
  if (!value) {
    return "Not set";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium"
  }).format(new Date(value));
}

export function formatShortDate(value = new Date()) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "2-digit",
    month: "short"
  }).format(value);
}

export function formatLongDisplayDate(value = new Date()) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long"
  }).format(value);
}

export function userName(users: User[], id: string | null) {
  if (!id) {
    return "Unassigned";
  }

  return users.find((user) => user.id === id)?.name || id;
}

export function formatDuration(start: string | null, end: string | null = new Date().toISOString()) {
  if (!start) {
    return "Not started";
  }

  const startTime = new Date(start).getTime();
  const endTime = end ? new Date(end).getTime() : Date.now();
  const totalMinutes = Math.max(0, Math.round((endTime - startTime) / 60000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) {
    return `${days}d ${hours}h`;
  }

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  return `${minutes}m`;
}

export function formatMinutes(totalMinutes: number | null) {
  if (totalMinutes === null) return "Not reported";
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function formatLiveDuration(start: string | null, end: string | null = new Date().toISOString()) {
  if (!start) {
    return "0m 00s";
  }

  const startTime = new Date(start).getTime();
  const endTime = end ? new Date(end).getTime() : Date.now();
  const totalSeconds = Math.max(0, Math.floor((endTime - startTime) / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const paddedSeconds = String(seconds).padStart(2, "0");

  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m ${paddedSeconds}s`;
  }

  if (hours > 0) {
    return `${hours}h ${minutes}m ${paddedSeconds}s`;
  }

  return `${minutes}m ${paddedSeconds}s`;
}
