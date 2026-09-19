import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { User, WorkOrder } from "@pbs-cmms/shared";
import { api, ApiError, authSessionEndedEvent } from "../api/client";
import { useLiveRefresh } from "../hooks/useLiveRefresh";

interface UserContextValue {
  users: User[];
  currentUser: User | null;
  loadingUsers: boolean;
  isAuthenticated: boolean;
  login: (username: string, password: string) => Promise<User>;
  logout: () => void;
  setCurrentUserId: (id: string) => void;
  refreshUsers: () => Promise<void>;
  workOrders: WorkOrder[];
  workOrdersReady: boolean;
  refreshWorkOrders: () => Promise<WorkOrder[]>;
}

const UserContext = createContext<UserContextValue | null>(null);
const sessionUserKey = "pbs-cmms-auth-user-id-v2";

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [sessionError, setSessionError] = useState("");
  const [users, setUsers] = useState<User[]>([]);
  const [currentUserId, setCurrentUserIdState] = useState(() => localStorage.getItem(sessionUserKey) || "");
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [workOrdersReady, setWorkOrdersReady] = useState(false);
  const workOrdersRequestRef = useRef<Promise<WorkOrder[]> | null>(null);

  async function refreshUsers() {
    const nextUsers = await api.users();
    setUsers(nextUsers);
  }

  function clearLocalSession() {
    localStorage.removeItem(sessionUserKey);
    setCurrentUserIdState("");
    setUsers([]);
    setWorkOrders([]);
    setWorkOrdersReady(false);
  }

  async function restoreCurrentSession() {
    const user = await api.restoreSession();
    setCurrentUserId(user.id);
    setUsers([user]);
    await refreshUsers();
    return user;
  }

  function setCurrentUserId(id: string) {
    localStorage.setItem(sessionUserKey, id);
    setCurrentUserIdState(id);
  }

  async function login(username: string, password: string) {
    const user = await api.login(username, password);
    setCurrentUserId(user.id);
    setUsers((current) => {
      const exists = current.some((item) => item.id === user.id);
      return exists ? current.map((item) => (item.id === user.id ? user : item)) : [user, ...current];
    });
    await refreshUsers();
    return user;
  }

  function logout() {
    api.clearSession();
    localStorage.removeItem(sessionUserKey);
    setCurrentUserIdState("");
  }

  async function refreshWorkOrders() {
    if (workOrdersRequestRef.current) return workOrdersRequestRef.current;

    const request = api.workOrders()
      .then((nextWorkOrders) => {
        setWorkOrders(nextWorkOrders);
        setWorkOrdersReady(true);
        return nextWorkOrders;
      })
      .finally(() => {
        workOrdersRequestRef.current = null;
      });
    workOrdersRequestRef.current = request;
    return request;
  }

  useEffect(() => {
    const recoverOrEndLocalSession = () => {
      void restoreCurrentSession().catch((error) => {
        if (error instanceof ApiError && error.status === 401) clearLocalSession();
      });
    };
    window.addEventListener(authSessionEndedEvent, recoverOrEndLocalSession);
    return () => window.removeEventListener(authSessionEndedEvent, recoverOrEndLocalSession);
  }, []);

  useEffect(() => {
    // Always ask the server to restore the session. The HttpOnly cookie can
    // remain valid even if a PWA/browser update has removed localStorage.
    void restoreCurrentSession()
      .then(() => {
        setLoadingUsers(false);
      })
      .catch((error) => {
        if (!(error instanceof ApiError) || error.status !== 401) {
          setSessionError("Couldn’t connect to your account. Your session has been kept. Try again when the server is available.");
          setLoadingUsers(false);
          return;
        }
        clearLocalSession();
        setLoadingUsers(false);
      });
  }, []);

  const currentUser = useMemo(() => {
    return users.find((user) => user.id === currentUserId) || null;
  }, [currentUserId, users]);
  const isAuthenticated = Boolean(currentUser);

  useEffect(() => {
    if (!currentUser) {
      setWorkOrders([]);
      setWorkOrdersReady(false);
      return;
    }

    setWorkOrdersReady(false);
    void refreshWorkOrders().catch(console.error);
    const interval = window.setInterval(() => void refreshWorkOrders().catch(console.error), currentUser.role === "technician" ? 2000 : 10000);
    const refreshNow = () => void refreshWorkOrders().catch(console.error);
    window.addEventListener("focus", refreshNow);
    window.addEventListener("online", refreshNow);
    document.addEventListener("visibilitychange", refreshNow);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshNow);
      window.removeEventListener("online", refreshNow);
      document.removeEventListener("visibilitychange", refreshNow);
    };
  }, [currentUser?.id, currentUser?.role]);

  useLiveRefresh(["work-orders"], async () => { await refreshWorkOrders(); }, { enabled: Boolean(currentUser), fallbackMs: 5000 });
  useLiveRefresh(["users"], async () => {
    await api.me();
    await refreshUsers();
  }, { enabled: Boolean(currentUser), fallbackMs: 30000 });

  const value = useMemo<UserContextValue>(
    () => ({ users, currentUser, loadingUsers, isAuthenticated, login, logout, setCurrentUserId, refreshUsers, workOrders, workOrdersReady, refreshWorkOrders }),
    [users, currentUser, loadingUsers, isAuthenticated, workOrders, workOrdersReady]
  );

  if (sessionError) return <main className="ux-recovery" role="alert"><h1>Connection interrupted</h1><p>{sessionError}</p><button className="primary-action" type="button" onClick={() => window.location.reload()}>Try again</button></main>;

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}

export function useCurrentUser() {
  const context = useContext(UserContext);
  if (!context) {
    throw new Error("useCurrentUser must be used inside UserProvider");
  }

  return context;
}
