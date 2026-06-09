import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
import { createUser } from "./api";

const LS_USER_ID = "pi-tree-user-id";
const LS_DISPLAY_NAME = "pi-tree-display-name";

interface UserContextValue {
  userId: string | null;
  displayName: string | null;
  setUser: (id: string, displayName?: string) => Promise<void>;
  clearUser: () => void;
}

const UserContext = createContext<UserContextValue | null>(null);

/* eslint-disable react-refresh/only-export-components */

export function UserProvider({ children }: { children: ReactNode }) {
  const [userId, setUserId] = useState<string | null>(() => {
    const storedId = localStorage.getItem(LS_USER_ID);
    if (storedId) return storedId;
    const oldId = localStorage.getItem("pi-reader-user-id");
    if (oldId) {
      localStorage.setItem(LS_USER_ID, oldId);
      return oldId;
    }
    return null;
  });

  const [displayName, setDisplayName] = useState<string | null>(() => {
    const storedName = localStorage.getItem(LS_DISPLAY_NAME);
    if (storedName) return storedName;
    const oldName = localStorage.getItem("pi-reader-display-name");
    if (oldName) {
      localStorage.setItem(LS_DISPLAY_NAME, oldName);
      return oldName;
    }
    return null;
  });

  const setUser = useCallback(async (id: string, name?: string) => {
    const display = name || id;
    localStorage.setItem(LS_USER_ID, id);
    localStorage.setItem(LS_DISPLAY_NAME, display);
    setUserId(id);
    setDisplayName(display);

    // Ensure user exists on the server (idempotent)
    try {
      await createUser(id, name);
    } catch {
      // User may already exist — that's fine
    }
  }, []);

  const clearUser = useCallback(() => {
    localStorage.removeItem(LS_USER_ID);
    localStorage.removeItem(LS_DISPLAY_NAME);
    setUserId(null);
    setDisplayName(null);
  }, []);

  return (
    <UserContext.Provider value={{ userId, displayName, setUser, clearUser }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser(): UserContextValue {
  const ctx = useContext(UserContext);
  if (!ctx) {
    throw new Error("useUser must be used within a UserProvider");
  }
  return ctx;
}
