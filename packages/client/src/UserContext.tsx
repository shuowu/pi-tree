import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { createUser } from "./api";

const LS_USER_ID = "pi-reader-user-id";
const LS_DISPLAY_NAME = "pi-reader-display-name";

interface UserContextValue {
  userId: string | null;
  displayName: string | null;
  setUser: (id: string, displayName?: string) => Promise<void>;
  clearUser: () => void;
}

const UserContext = createContext<UserContextValue | null>(null);

export function UserProvider({ children }: { children: ReactNode }) {
  const [userId, setUserId] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);

  // Read from localStorage on mount
  useEffect(() => {
    const storedId = localStorage.getItem(LS_USER_ID);
    const storedName = localStorage.getItem(LS_DISPLAY_NAME);
    if (storedId && storedName) {
      setUserId(storedId);
      setDisplayName(storedName);
    }
    setInitialized(true);
  }, []);

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

  // Don't render children until we've checked localStorage
  if (!initialized) return null;

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
