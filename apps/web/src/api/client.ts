import type { PlantId } from "@pbs-cmms/shared";
import type {
  AssetDashboardResponse,
  AssetRecord,
  AirLeakSyncResult,
  AirLeakSyncSettings,
  AuthSession,
  ClaimWorkOrderInput,
  CreateSparePartInput,
  CreateWorkOrderInput,
  DashboardSummary,
  DeleteWorkOrderInput,
  GuestTrackingLink,
  GuestWorkOrderSubmission,
  GuestWorkOrderTracking,
  IssueCategory,
  Machine,
  MachineImportResult,
  MachineImportRow,
  MasterData,
  NotificationRecord,
  AssignPmTemplateInput,
  PmChecklistTemplate,
  PmDashboardResponse,
  PmPlan,
  PmScheduleDetail,
  SavePmResultInput,
  SavePmTemplateInput,
  SubmitPmScheduleInput,
  TvWorkOrder,
  PublicRequesterWorkOrder,
  Section,
  SpareAdjustmentInput,
  SpareImportInput,
  SpareImportResult,
  SpareInventoryResponse,
  SpareIssueInput,
  SparePart,
  SparePartDetail,
  SpareQrLookupResult,
  SpareSyncSettings,
  SpareSyncResult,
  StockMovementDetail,
  UpdateSpareSyncSettingsInput,
  UpdateAssetInput,
  UpdateAirLeakSyncSettingsInput,
  UpdatePmPlanInput,
  UpdateWorkOrderInput,
  UpdateWorkOrderStatusInput,
  UpdateWorkOrderSyncSettingsInput,
  User,
  WorkOrder,
  WorkOrderActivity,
  WorkOrderAttachment,
  WorkOrderDetail,
  WorkOrderDepartment,
  WorkOrderSyncResult,
  WorkOrderSyncSettings
} from "@pbs-cmms/shared";

const API_BASE = import.meta.env.VITE_API_URL ?? "";
const authTokenKey = "pbs-cmms-auth-token-v1";
export const authSessionEndedEvent = "cmms:auth-session-ended";

export function selectedPlant(): PlantId | "all" {
  const access = sessionStorage.getItem("cmms-user-plant-access");
  if (localStorage.getItem(authTokenKey) && (access === "port-klang" || access === "sendayan")) return access;
  if (window.location.pathname === "/requester") {
    return new URLSearchParams(window.location.search).get("plant") === "sendayan" ? "sendayan" : "port-klang";
  }
  const guestPlant = null;
  const stored = guestPlant || sessionStorage.getItem("cmms-selected-plant") || "port-klang";
  if (stored === "all") return ["/reports", "/performance"].includes(window.location.pathname) ? "all" : sessionStorage.getItem("cmms-operational-plant") === "sendayan" ? "sendayan" : "port-klang";
  return stored === "sendayan" ? "sendayan" : "port-klang";
}
export function setSelectedPlant(plant: PlantId | "all") {
  sessionStorage.setItem("cmms-selected-plant", plant);
  if (plant !== "all") sessionStorage.setItem("cmms-operational-plant", plant);
}

export const liveEventsUrl = `${API_BASE}/api/events`;
export function guestLiveEventsUrl(id: string, token: string) {
  return `${API_BASE}/api/requester/work-orders/${encodeURIComponent(id)}/events?token=${encodeURIComponent(token)}`;
}

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); this.name = "ApiError"; }
}

async function request<T>(path: string, options: RequestInit = {}, notifySessionEnded = true): Promise<T> {
  const token = localStorage.getItem(authTokenKey);
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: "include",
    cache: options.cache ?? "no-store",
    headers: {
      ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      "X-CMMS-Plant": selectedPlant(),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers
    }
  });

  } catch {
    throw new Error(navigator.onLine ? "Can’t reach the server. Please try again in a moment." : "You’re offline. Reconnect and try again.");
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    if (response.status === 401 && token && notifySessionEnded) {
      localStorage.removeItem(authTokenKey);
      sessionStorage.removeItem("cmms-user-plant-access");
      window.dispatchEvent(new Event(authSessionEndedEvent));
    }
    throw new ApiError(body?.error || (response.status >= 500 ? "The server couldn’t complete this request. Please try again." : response.status === 401 ? "Your session has expired. Please sign in again." : response.status === 403 ? "You don’t have permission to perform this action." : response.status === 404 ? "This record is unavailable or may have been removed." : `Request failed (${response.status}). Please try again.`), response.status);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export function mediaUrl(url: string) {
  if (url.startsWith("http") || !API_BASE) {
    return url;
  }

  return `${API_BASE}${url}`;
}

export const api = {
  createPmPlan: (input: UpdatePmPlanInput) => request<PmPlan>("/api/pm/plans", { method: "POST", body: JSON.stringify(input) }),
  health: () => request<{ ok: boolean; service: string; timestamp: string }>("/api/health"),
  login: async (username: string, password: string) => {
    const session = await request<AuthSession>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password })
    });
    localStorage.setItem(authTokenKey, session.token);
    sessionStorage.setItem("cmms-user-plant-access", session.user.plantAccess);
    setSelectedPlant(session.user.plantAccess === "both" ? "port-klang" : session.user.plantAccess);
    return session.user;
  },
  me: async () => { const user = await request<User>("/api/auth/me"); sessionStorage.setItem("cmms-user-plant-access", user.plantAccess); if (user.plantAccess !== "both") setSelectedPlant(user.plantAccess); return user; },
  restoreSession: async () => {
    const hadBearerToken = Boolean(localStorage.getItem(authTokenKey));
    try {
      const user = await request<User>("/api/auth/me", {}, false);
      sessionStorage.setItem("cmms-user-plant-access", user.plantAccess);
      if (user.plantAccess !== "both") setSelectedPlant(user.plantAccess);
      return user;
    } catch (error) {
      // A browser/PWA update can leave the long-lived HttpOnly cookie intact
      // while its local bearer copy is stale. Retry once with cookie auth only.
      if (!(error instanceof ApiError) || error.status !== 401 || !hadBearerToken) throw error;
      localStorage.removeItem(authTokenKey);
      sessionStorage.removeItem("cmms-user-plant-access");
      const user = await request<User>("/api/auth/me", {}, false);
      sessionStorage.setItem("cmms-user-plant-access", user.plantAccess);
      if (user.plantAccess !== "both") setSelectedPlant(user.plantAccess);
      return user;
    }
  },
  hasSession: () => Boolean(localStorage.getItem(authTokenKey)),
  clearSession: () => { void request<void>("/api/auth/logout", { method: "POST" }).catch(() => {}); localStorage.removeItem(authTokenKey); sessionStorage.removeItem("cmms-user-plant-access"); },
  users: () => request<User[]>(window.location.pathname === "/users" ? "/api/users?manage=1" : "/api/users"),
  usersByRole: (role: User["role"]) => request<User[]>(`/api/users?role=${role}`),
  createUser: (input: { actorId: string; username: string; password: string; name: string; role: User["role"]; department: string; title: string; plantAccess?: User["plantAccess"] }) =>
    request<User>("/api/users", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  updateUser: (id: string, input: { actorId: string; username: string; password?: string; name: string; role: User["role"]; department: string; title: string; plantAccess?: User["plantAccess"] }) =>
    request<User>(`/api/users/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input)
    }),
  removeUser: (id: string, actorId: string) =>
    request<void>(`/api/users/${id}`, {
      method: "DELETE",
      body: JSON.stringify({ actorId })
    }),
  endUserSessions: (id: string, actorId: string) =>
    request<{ ended: number }>(`/api/users/${id}/sessions`, {
      method: "DELETE",
      body: JSON.stringify({ actorId })
    }),
  uploadUserAvatar: (id: string, file: File) => {
    const formData = new FormData();
    formData.append("avatar", file);

    return request<User>(`/api/users/${id}/avatar`, {
      method: "POST",
      body: formData
    });
  },
  dashboardSummary: () => request<DashboardSummary>("/api/dashboard-summary"),
  publicConfig: () => request<{ requesterUrl: string }>("/api/system/public-config"),
  assetDashboard: () => request<AssetDashboardResponse>("/api/assets"),
  updateAsset: (id: string, input: UpdateAssetInput) =>
    request<AssetRecord>(`/api/assets/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input)
    }),
  masterData: () => request<MasterData>("/api/master-data"),
  createSection: (input: { actorId: string; department: WorkOrderDepartment; name: string; active?: boolean }) =>
    request<Section>("/api/master-data/sections", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  updateSection: (id: string, input: { actorId: string; department: WorkOrderDepartment; name: string; active?: boolean }) =>
    request<Section>(`/api/master-data/sections/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input)
    }),
  createMachine: (input: { actorId: string; department: WorkOrderDepartment; sectionId: string; area: string; name: string; active?: boolean }) =>
    request<Machine>("/api/master-data/machines", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  importMachines: (input: { actorId: string; rows: MachineImportRow[] }) =>
    request<MachineImportResult>("/api/master-data/machines/import", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  updateMachine: (id: string, input: { actorId: string; department: WorkOrderDepartment; sectionId: string; area: string; name: string; active?: boolean }) =>
    request<Machine>(`/api/master-data/machines/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input)
    }),
  createIssueCategory: (input: { actorId: string; department: WorkOrderDepartment; name: string; active?: boolean }) =>
    request<IssueCategory>("/api/master-data/issue-categories", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  updateIssueCategory: (id: string, input: { actorId: string; department: WorkOrderDepartment; name: string; active?: boolean }) =>
    request<IssueCategory>(`/api/master-data/issue-categories/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input)
    }),
  pmDashboard: (actorId: string, year: number) =>
    request<PmDashboardResponse>(`/api/pm/dashboard?actorId=${encodeURIComponent(actorId)}&year=${year}`),
  pmTemplates: () => request<PmChecklistTemplate[]>("/api/pm/templates"),
  pmSchedule: (id: string, actorId: string) =>
    request<PmScheduleDetail>(`/api/pm/schedules/${id}?actorId=${encodeURIComponent(actorId)}`),
  startPmSchedule: (id: string, actorId: string) =>
    request<PmScheduleDetail>(`/api/pm/schedules/${id}/start`, {
      method: "POST",
      body: JSON.stringify({ actorId })
    }),
  savePmResult: (scheduleId: string, input: SavePmResultInput) =>
    request<PmScheduleDetail>(`/api/pm/schedules/${scheduleId}/results/${input.itemId}`, {
      method: "PUT",
      body: JSON.stringify(input)
    }),
  uploadPmProof: (scheduleId: string, itemId: string, actorId: string, file: File) => {
    const formData = new FormData();
    formData.append("actorId", actorId);
    formData.append("photo", file);
    return request<PmScheduleDetail>(`/api/pm/schedules/${scheduleId}/results/${itemId}/photos`, {
      method: "POST",
      body: formData
    });
  },
  deletePmProof: (photoId: string, actorId: string) =>
    request<PmScheduleDetail>(`/api/pm/photos/${photoId}`, {
      method: "DELETE",
      body: JSON.stringify({ actorId })
    }),
  submitPmSchedule: (id: string, input: SubmitPmScheduleInput) =>
    request<PmScheduleDetail>(`/api/pm/schedules/${id}/submit`, {
      method: "POST",
      body: JSON.stringify(input)
    }),
  verifyPmSchedule: (id: string, actorId: string) =>
    request<PmScheduleDetail>(`/api/pm/schedules/${id}/verify`, {
      method: "POST",
      body: JSON.stringify({ actorId })
    }),
  createPmTemplate: (input: SavePmTemplateInput) =>
    request<PmChecklistTemplate>("/api/pm/templates", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  updatePmTemplate: (id: string, input: SavePmTemplateInput) =>
    request<PmChecklistTemplate>(`/api/pm/templates/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input)
    }),
  assignPmTemplate: (planId: string, input: AssignPmTemplateInput) =>
    request<PmPlan>(`/api/pm/plans/${planId}/template`, {
      method: "PATCH",
      body: JSON.stringify(input)
    }),
  updatePmPlan: (planId: string, input: UpdatePmPlanInput) =>
    request<PmPlan>(`/api/pm/plans/${planId}`, {
      method: "PATCH",
      body: JSON.stringify(input)
    }),
  spareInventory: () => request<SpareInventoryResponse>("/api/spare-parts"),
  createSparePart: (input: CreateSparePartInput) =>
    request<SparePart>("/api/spare-parts", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  spareMovementsForActor: (actorId: string) =>
    request<StockMovementDetail[]>(`/api/spare-parts/history/by-actor?actorId=${encodeURIComponent(actorId)}`),
  sparePart: (itemNo: string) => request<SparePartDetail>(`/api/spare-parts/${encodeURIComponent(itemNo)}`),
  sparePartMovements: (itemNo: string) =>
    request<StockMovementDetail[]>(`/api/spare-parts/${encodeURIComponent(itemNo)}/movements`),
  lookupSpareQr: (value: string) => request<SpareQrLookupResult>(`/api/spare-parts/qr/lookup?value=${encodeURIComponent(value)}`),
  spareSyncSettings: () => request<SpareSyncSettings>("/api/spare-parts/sync/settings"),
  updateSpareSyncSettings: (input: UpdateSpareSyncSettingsInput) =>
    request<SpareSyncSettings>("/api/spare-parts/sync/settings", {
      method: "PATCH",
      body: JSON.stringify(input)
    }),
  importSpareParts: (input: SpareImportInput) =>
    request<SpareImportResult>("/api/spare-parts/import", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  pullSparePartsFromSheet: (actorId: string) =>
    request<SpareSyncResult>("/api/spare-parts/sync/pull", {
      method: "POST",
      body: JSON.stringify({ actorId })
    }),
  retrySpareSync: (actorId: string) =>
    request<SpareSyncResult>("/api/spare-parts/sync/retry", {
      method: "POST",
      body: JSON.stringify({ actorId })
    }),
  issueSparePart: (itemNo: string, input: SpareIssueInput) =>
    request<StockMovementDetail>(`/api/spare-parts/${encodeURIComponent(itemNo)}/issue`, {
      method: "POST",
      body: JSON.stringify(input)
    }),
  adjustSparePart: (itemNo: string, input: SpareAdjustmentInput) =>
    request<StockMovementDetail>(`/api/spare-parts/${encodeURIComponent(itemNo)}/adjust`, {
      method: "POST",
      body: JSON.stringify(input)
    }),
  workOrders: () => request<WorkOrder[]>("/api/work-orders"),
  tvWorkOrders: () => request<TvWorkOrder[]>("/api/tv/work-orders"),
  workOrderSyncSettings: () => request<WorkOrderSyncSettings>("/api/work-orders/sync/settings"),
  updateWorkOrderSyncSettings: (input: UpdateWorkOrderSyncSettingsInput) =>
    request<WorkOrderSyncSettings>("/api/work-orders/sync/settings", {
      method: "PATCH",
      body: JSON.stringify(input)
    }),
  retryWorkOrderSync: (actorId: string) =>
    request<WorkOrderSyncResult>("/api/work-orders/sync/retry", {
      method: "POST",
      body: JSON.stringify({ actorId })
    }),
  airLeakSyncSettings: () => request<AirLeakSyncSettings>("/api/integrations/air-leaks/settings"),
  updateAirLeakSyncSettings: (input: UpdateAirLeakSyncSettingsInput) =>
    request<AirLeakSyncSettings>("/api/integrations/air-leaks/settings", {
      method: "PATCH",
      body: JSON.stringify(input)
    }),
  retryAirLeakSync: (actorId: string) =>
    request<AirLeakSyncResult>("/api/integrations/air-leaks/retry", {
      method: "POST",
      body: JSON.stringify({ actorId })
    }),
  requesterWorkOrders: () => request<PublicRequesterWorkOrder[]>("/api/requester/work-orders"),
  createRequesterWorkOrder: async (input: Omit<CreateWorkOrderInput, "requesterId">) => {
    const submission = await request<GuestWorkOrderSubmission>("/api/requester/work-orders", {
      method: "POST",
      body: JSON.stringify(input)
    });
    sessionStorage.setItem(`cmms-guest-upload:${submission.workOrder.id}`, new URL(submission.tracking.path, window.location.origin).searchParams.get("token") || "");
    return submission;
  },
  guestWorkOrderTracking: (id: string, token: string) =>
    request<GuestWorkOrderTracking>(`/api/requester/work-orders/${encodeURIComponent(id)}/tracking?token=${encodeURIComponent(token)}`),
  verifyGuestWorkOrder: (id: string, token: string, status: "closed" | "returned", note: string) =>
    request<GuestWorkOrderTracking>(`/api/requester/work-orders/${encodeURIComponent(id)}/verification`, {
      method: "POST",
      body: JSON.stringify({ token, status, note })
    }),
  updateGuestDowntimeReason: (id: string, token: string, reason: string) =>
    request<GuestWorkOrderTracking>(`/api/requester/work-orders/${encodeURIComponent(id)}/downtime-reason`, {
      method: "PATCH",
      body: JSON.stringify({ token, reason })
    }),
  guestTrackingLink: (id: string) => request<GuestTrackingLink>(`/api/work-orders/${encodeURIComponent(id)}/guest-link`),
  workOrder: (id: string) => request<WorkOrderDetail>(`/api/work-orders/${id}`),
  createWorkOrder: (input: CreateWorkOrderInput) =>
    request<WorkOrder>("/api/work-orders", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  updateWorkOrder: (id: string, input: UpdateWorkOrderInput) =>
    request<WorkOrder>(`/api/work-orders/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input)
    }),
  updateWorkOrderStatus: (id: string, input: UpdateWorkOrderStatusInput) =>
    request<WorkOrder>(`/api/work-orders/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify(input)
    }),
  updateWorkOrderDowntimeReason: (id: string, reason: string) =>
    request<WorkOrder>(`/api/work-orders/${id}/downtime-reason`, {
      method: "PATCH",
      body: JSON.stringify({ reason })
    }),
  claimWorkOrder: (id: string, input: ClaimWorkOrderInput) =>
    request<WorkOrder>(`/api/work-orders/${id}/claim`, {
      method: "PATCH",
      body: JSON.stringify(input)
    }),
  assignWorkOrder: (id: string, assignedToId: string, actorId: string, note?: string) =>
    request<WorkOrder>(`/api/work-orders/${id}/assign`, {
      method: "PATCH",
      body: JSON.stringify({ assignedToId, actorId, note })
    }),
  deleteWorkOrder: (id: string, input: DeleteWorkOrderInput) =>
    request<WorkOrder>(`/api/work-orders/${id}`, {
      method: "DELETE",
      body: JSON.stringify(input)
    }),
  addComment: (id: string, actorId: string, message: string) =>
    request<WorkOrderActivity>(`/api/work-orders/${id}/comments`, {
      method: "POST",
      body: JSON.stringify({ actorId, message })
    }),
  uploadAttachments: (
    id: string,
    uploadedBy: string,
    kind: WorkOrderAttachment["kind"],
    files: FileList | File[]
  ) => {
    const formData = new FormData();
    formData.append("uploadedBy", uploadedBy);
    formData.append("kind", kind);

    Array.from(files).forEach((file) => {
      formData.append("attachments", file);
    });

    return request<WorkOrderAttachment[]>(`/api/work-orders/${id}/attachments`, {
      method: "POST",
      body: formData
    });
  },
  uploadRequesterAttachments: (id: string, files: FileList | File[]) => {
    const formData = new FormData();
    formData.append("token", sessionStorage.getItem(`cmms-guest-upload:${id}`) || "");
    Array.from(files).forEach((file) => {
      formData.append("attachments", file);
    });

    return request<WorkOrderAttachment[]>(`/api/requester/work-orders/${id}/attachments`, {
      method: "POST",
      body: formData
    });
  },
  notifications: (userId: string) => request<NotificationRecord[]>(`/api/notifications?userId=${userId}`),
  markNotificationRead: (id: string) =>
    request<void>(`/api/notifications/${id}/read`, {
      method: "PATCH"
    }),
  markAllNotificationsRead: (userId: string) =>
    request<void>("/api/notifications/read-all", {
      method: "PATCH",
      body: JSON.stringify({ userId })
    }),
  pushConfig: () => request<{ enabled: boolean; publicKey: string | null }>("/api/push/config"),
  savePushSubscription: (subscription: PushSubscriptionJSON) =>
    request<{ ok: true }>("/api/push/subscriptions", {
      method: "POST",
      body: JSON.stringify(subscription)
    }),
  removePushSubscription: (endpoint: string) =>
    request<void>("/api/push/subscriptions", {
      method: "DELETE",
      body: JSON.stringify({ endpoint })
    }),
  testPushNotification: () =>
    request<{ sent: number; failed: number }>("/api/push/test", {
      method: "POST"
    })
};
