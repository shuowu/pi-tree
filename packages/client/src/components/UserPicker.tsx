import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { UserInfo } from "@pi-reader/shared";
import { fetchUsers } from "../api";
import { useUser } from "../UserContext";
import { BookOpen } from "lucide-react";
import "./UserPicker.css";

export function UserPicker() {
  const { setUser } = useUser();
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create form state
  const [newId, setNewId] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const data = await fetchUsers();
        setUsers(data);
      } catch {
        // No users yet — that's fine
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleSelect = useCallback(
    async (user: UserInfo) => {
      await setUser(user.id, user.displayName);
    },
    [setUser],
  );

  const handleCreate = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      const id = newId.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
      const name = newDisplayName.trim() || undefined;
      if (!id) return;

      setCreating(true);
      setError(null);
      try {
        await setUser(id, name);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to create user");
        setCreating(false);
      }
    },
    [newId, newDisplayName, setUser],
  );

  return (
    <div className="user-picker">
      <header className="user-picker-header">
        <h1>
          <BookOpen size={28} strokeWidth={1.5} /> <span>Pi Reader</span>
        </h1>
        <p>Who's reading?</p>
      </header>

      <div className="user-picker-content">
        {loading ? (
          <div className="user-picker-loading">Loading users…</div>
        ) : (
          <>
            {users.length > 0 && (
              <>
                <div className="user-picker-section-title">
                  Existing Users
                </div>
                <div className="user-list">
                  {users.map((user) => (
                    <div
                      key={user.id}
                      className="user-card"
                      onClick={() => handleSelect(user)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) =>
                        e.key === "Enter" && handleSelect(user)
                      }
                    >
                      <div className="user-card-avatar">
                        {user.displayName.charAt(0).toUpperCase()}
                      </div>
                      <div className="user-card-info">
                        <div className="user-card-name">
                          {user.displayName}
                        </div>
                        <div className="user-card-id">{user.id}</div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="user-picker-divider">or create new</div>
              </>
            )}

            <form className="user-create-form" onSubmit={handleCreate}>
              <label>
                Username (slug)
                <input
                  type="text"
                  value={newId}
                  onChange={(e) => setNewId(e.target.value)}
                  placeholder="e.g. alice"
                  pattern="[a-z0-9_-]+"
                  required
                  autoFocus={users.length === 0}
                />
              </label>
              <label>
                Display Name <span className="user-form-optional">(optional)</span>
                <input
                  type="text"
                  value={newDisplayName}
                  onChange={(e) => setNewDisplayName(e.target.value)}
                  placeholder={`e.g. Alice Chen`}
                />
              </label>
              <button
                type="submit"
                className="user-create-btn"
                disabled={creating || !newId.trim()}
              >
                {creating ? "Creating…" : "Get Started"}
              </button>
            </form>

            {error && <div className="user-picker-error">{error}</div>}
          </>
        )}
      </div>
    </div>
  );
}
