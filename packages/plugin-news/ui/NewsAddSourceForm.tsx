import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AddSourceFormProps } from "@pi-tree/ui";

interface Feed {
  id: string;
  name: string;
  url: string;
  tags: string[];
}

// ---------------------------------------------------------------------------
// Tag Input — chips + clickable palette of existing tags
// ---------------------------------------------------------------------------

interface TagInputProps {
  value: string[];
  onChange: (tags: string[]) => void;
  allTags: string[];
  placeholder?: string;
}

function TagInput({ value, onChange, allTags, placeholder }: TagInputProps) {
  const [inputValue, setInputValue] = useState("");

  const toggleTag = useCallback((tag: string) => {
    if (value.includes(tag)) {
      onChange(value.filter(t => t !== tag));
    } else {
      onChange([...value, tag]);
    }
  }, [value, onChange]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      const tag = inputValue.trim().toLowerCase();
      if (tag && !value.includes(tag)) {
        onChange([...value, tag]);
      }
      setInputValue("");
    } else if (e.key === "Backspace" && !inputValue && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  }, [inputValue, value, onChange]);

  // Suggested tags = existing tags not already selected
  const suggestions = useMemo(() =>
    allTags.filter(t => !value.includes(t)),
    [allTags, value]
  );

  return (
    <div className="tag-input-wrapper">
      {/* Selected tags as removable chips */}
      <div className="tag-input-chips">
        {value.map(tag => (
          <button
            key={tag}
            type="button"
            className="tag-chip tag-chip--active"
            onClick={() => toggleTag(tag)}
            title="Click to remove"
          >
            {tag}
            <span className="tag-chip-x">×</span>
          </button>
        ))}
        <input
          className="tag-input-inline"
          value={inputValue}
          onChange={e => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={value.length === 0 ? (placeholder ?? "Add tags…") : ""}
        />
      </div>

      {/* Tag palette — existing tags to click */}
      {suggestions.length > 0 && (
        <div className="tag-palette">
          {suggestions.map(tag => (
            <button
              key={tag}
              type="button"
              className="tag-chip tag-chip--suggestion"
              onClick={() => toggleTag(tag)}
              title="Click to add"
            >
              + {tag}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editable Feed Item
// ---------------------------------------------------------------------------

interface FeedItemProps {
  feed: Feed;
  allTags: string[];
  onUpdate: (id: string, updates: Partial<Pick<Feed, "name" | "url" | "tags">>) => Promise<void>;
  onRemove: (id: string) => void;
}

function FeedItem({ feed, allTags, onUpdate, onRemove }: FeedItemProps) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(feed.name);
  const [url, setUrl] = useState(feed.url);
  const [editTags, setEditTags] = useState<string[]>(feed.tags);
  const [saving, setSaving] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  // Sync with prop changes
  useEffect(() => {
    if (!editing) {
      setName(feed.name);
      setUrl(feed.url);
      setEditTags([...feed.tags]);
    }
  }, [feed, editing]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    await onUpdate(feed.id, { name: name.trim(), url: url.trim(), tags: editTags });
    setSaving(false);
    setEditing(false);
  }, [feed.id, name, url, editTags, onUpdate]);

  const handleCancel = useCallback(() => {
    setName(feed.name);
    setUrl(feed.url);
    setEditTags([...feed.tags]);
    setEditing(false);
  }, [feed]);

  const startEdit = useCallback(() => {
    setEditing(true);
    setTimeout(() => nameRef.current?.focus(), 0);
  }, []);

  if (editing) {
    return (
      <div className="feed-item feed-item--editing">
        <div className="feed-item-edit-fields">
          <input
            ref={nameRef}
            className="feed-edit-input"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Feed name"
          />
          <input
            className="feed-edit-input feed-edit-input--url"
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="RSS URL"
          />
          <TagInput
            value={editTags}
            onChange={setEditTags}
            allTags={allTags}
            placeholder="Type a tag and press Enter"
          />
        </div>
        <div className="feed-edit-actions">
          <button className="feed-edit-cancel" onClick={handleCancel}>Cancel</button>
          <button className="feed-edit-save" onClick={handleSave} disabled={saving || !name.trim() || !url.trim()}>
            {saving ? "…" : "Save"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="feed-item" onClick={startEdit} title="Click to edit">
      <div className="feed-item-info">
        <span className="feed-item-name">{feed.name}</span>
        <span className="feed-item-url">{feed.url}</span>
        {feed.tags.length > 0 && (
          <span className="feed-item-tags">
            {feed.tags.map(t => (
              <span key={t} className="feed-tag">{t}</span>
            ))}
          </span>
        )}
      </div>
      <button
        className="feed-item-remove"
        onClick={e => { e.stopPropagation(); onRemove(feed.id); }}
        title="Remove feed"
      >
        ×
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Form
// ---------------------------------------------------------------------------

export function NewsAddSourceForm({ onSuccess, onError }: AddSourceFormProps) {
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  // Add-feed form state
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [newTags, setNewTags] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);

  const fetchFeeds = useCallback(async () => {
    try {
      const res = await fetch("/api/news/feeds");
      if (!res.ok) throw new Error("Failed to load feeds");
      const data = await res.json();
      setFeeds(data);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to load feeds");
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => { fetchFeeds(); }, [fetchFeeds]);

  // Collect all unique tags across feeds
  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    feeds.forEach(f => f.tags.forEach(t => tagSet.add(t)));
    return [...tagSet].sort();
  }, [feeds]);

  // Filter feeds by search
  const filtered = useMemo(() => {
    if (!search.trim()) return feeds;
    const q = search.toLowerCase();
    return feeds.filter(f =>
      f.name.toLowerCase().includes(q) ||
      f.url.toLowerCase().includes(q) ||
      f.tags.some(t => t.toLowerCase().includes(q))
    );
  }, [feeds, search]);

  const handleAdd = useCallback(async () => {
    if (!newName.trim() || !newUrl.trim()) return;
    setAdding(true);
    try {
      const id = newName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

      const res = await fetch("/api/news/feeds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, name: newName.trim(), url: newUrl.trim(), tags: newTags }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Add failed" }));
        throw new Error(data.error || "Add failed");
      }

      setNewName("");
      setNewUrl("");
      setNewTags([]);
      setShowAdd(false);
      await fetchFeeds();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to add feed");
    } finally {
      setAdding(false);
    }
  }, [newName, newUrl, newTags, fetchFeeds, onError]);

  const handleUpdate = useCallback(async (id: string, updates: Partial<Pick<Feed, "name" | "url" | "tags">>) => {
    try {
      const res = await fetch(`/api/news/feeds/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Update failed" }));
        throw new Error(data.error || "Update failed");
      }
      await fetchFeeds();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to update feed");
    }
  }, [fetchFeeds, onError]);

  const handleRemove = useCallback(async (feedId: string) => {
    try {
      const res = await fetch(`/api/news/feeds/${feedId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      setFeeds(prev => prev.filter(f => f.id !== feedId));
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to remove feed");
    }
  }, [onError]);

  if (loading) {
    return <div className="add-source-info"><p>Loading feeds…</p></div>;
  }

  return (
    <>
      {/* Search */}
      <div className="feed-search">
        <input
          className="feed-search-input"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by name, URL, or tag…"
        />
        {search && (
          <span className="feed-search-count">{filtered.length} / {feeds.length}</span>
        )}
      </div>

      {/* Feed list */}
      <div className="feed-list">
        {filtered.length === 0 ? (
          <div className="feed-empty">
            {feeds.length === 0 ? "No feeds configured yet." : "No feeds match your search."}
          </div>
        ) : (
          filtered.map(feed => (
            <FeedItem
              key={feed.id}
              feed={feed}
              allTags={allTags}
              onUpdate={handleUpdate}
              onRemove={handleRemove}
            />
          ))
        )}
      </div>

      {/* Add feed form */}
      {showAdd ? (
        <div className="feed-add-form">
          <div className="add-source-field">
            <label htmlFor="feed-name">Feed Name</label>
            <input
              id="feed-name"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="e.g. Hacker News"
              autoFocus
            />
          </div>
          <div className="add-source-field">
            <label htmlFor="feed-url">RSS URL</label>
            <input
              id="feed-url"
              value={newUrl}
              onChange={e => setNewUrl(e.target.value)}
              placeholder="https://example.com/rss"
            />
          </div>
          <div className="add-source-field">
            <label>Tags</label>
            <TagInput
              value={newTags}
              onChange={setNewTags}
              allTags={allTags}
              placeholder="Type a tag and press Enter"
            />
          </div>
          <div className="feed-add-actions">
            <button className="feed-add-cancel" onClick={() => setShowAdd(false)}>Cancel</button>
            <button
              className="feed-add-confirm"
              disabled={!newName.trim() || !newUrl.trim() || adding}
              onClick={handleAdd}
            >
              {adding ? "Adding…" : "Add Feed"}
            </button>
          </div>
        </div>
      ) : (
        <button className="feed-add-btn" onClick={() => setShowAdd(true)}>
          + Add Feed
        </button>
      )}

      {/* Tip */}
      <div className="feed-tip">
        💡 Tags let you filter news by topic — e.g. ask the AI
        <em>&ldquo;what's new in ai?&rdquo;</em> to see only feeds tagged <strong>ai</strong>.
      </div>

      {/* Done */}
      <div className="add-source-actions">
        {/* No source arg: news is a singleton dashboard, stay in the library */}
        <button className="add-source-submit" onClick={() => onSuccess()}>
          Done
        </button>
      </div>
    </>
  );
}
