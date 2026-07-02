import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router';
import { marked } from 'marked';
import type { Source } from '@pi-tree/shared';
import {
  StickyNote, Pin, Trash2, ChevronDown, ChevronRight,
  Edit3, Plus, Search, X, ExternalLink, MessageSquare,
} from 'lucide-react';
import { Breadcrumb } from '@pi-tree/ui';
import {
  fetchMemos, searchMemos, updateMemo, deleteMemo, appendMemo, createMemo, fetchSources,
} from '../api.js';
import type { Memo } from '../api.js';
import { useUser } from '../UserContext.js';
import { Home } from 'lucide-react';
import './MemosPage.css';

export function MemosPage() {
  const navigate = useNavigate();
  const { userId } = useUser();

  const [memos, setMemos] = useState<Memo[]>([]);
  const [loading, setLoading] = useState(true);
  const [sources, setSources] = useState<Source[]>([]);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSourceId, setSelectedSourceId] = useState<string>('');
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [pinnedOnly, setPinnedOnly] = useState(false);

  // Expanded / editing / appending
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [appendingId, setAppendingId] = useState<number | null>(null);
  const [appendContent, setAppendContent] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  // New memo form
  const [showNewForm, setShowNewForm] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [newTags, setNewTags] = useState('');

  // Debounced search
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const panelToggles = useMemo(() => [
    { id: 'home', icon: <Home size={16} />, label: 'Home', active: false, onClick: () => navigate('/') },
  ], []);

  // Load sources for the dropdown
  useEffect(() => {
    fetchSources().then(setSources).catch(() => setSources([]));
  }, []);

  // Load memos
  const loadMemos = useCallback(async (search?: string) => {
    if (!userId) return;
    setLoading(true);
    try {
      let data: Memo[];
      if (search && search.trim()) {
        data = await searchMemos(userId, search.trim());
      } else {
        data = await fetchMemos(userId);
      }
      setMemos(data);
    } catch (err) {
      console.error('Failed to load memos:', err);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  // Initial load + listen for external memo changes
  useEffect(() => {
    loadMemos();
    const handler = () => { loadMemos(); };
    window.addEventListener('pi-tree:memos-changed', handler);
    return () => window.removeEventListener('pi-tree:memos-changed', handler);
  }, [loadMemos]);

  // Debounced search effect — skip on mount (initial load handled above)
  const isInitialMount = useRef(true);
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      loadMemos(searchQuery);
    }, 200);
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [searchQuery, loadMemos]);

  // Derive source name map
  const sourceNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of sources) {
      map.set(s.id, s.title);
    }
    return map;
  }, [sources]);

  // Extract unique tags from memos
  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    for (const m of memos) {
      for (const t of m.tags) tagSet.add(t);
    }
    return Array.from(tagSet).sort();
  }, [memos]);

  // Extract unique source IDs that have memos
  const memoSourceIds = useMemo(() => {
    const ids = new Set<string>();
    for (const m of memos) {
      if (m.sourceId) ids.add(m.sourceId);
    }
    return Array.from(ids);
  }, [memos]);

  // Filter memos
  const filteredMemos = useMemo(() => {
    let result = memos;
    if (selectedSourceId) {
      result = result.filter(m => m.sourceId === selectedSourceId);
    }
    if (selectedTags.size > 0) {
      result = result.filter(m => m.tags.some(t => selectedTags.has(t)));
    }
    if (pinnedOnly) {
      result = result.filter(m => m.pinned);
    }
    return result;
  }, [memos, selectedSourceId, selectedTags, pinnedOnly]);

  // Split into pinned and recent
  const pinnedMemos = useMemo(
    () => filteredMemos.filter(m => m.pinned).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    [filteredMemos],
  );
  const recentMemos = useMemo(
    () => filteredMemos.filter(m => !m.pinned).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    [filteredMemos],
  );

  // Handlers
  const handleTogglePin = async (memo: Memo) => {
    if (!userId) return;
    try {
      const updated = await updateMemo(userId, memo.id, { pinned: !memo.pinned });
      setMemos(prev => prev.map(m => m.id === memo.id ? updated : m));
    } catch (err) {
      console.error('Failed to toggle pin:', err);
    }
  };

  const handleDelete = async (memoId: number) => {
    if (!userId) return;
    try {
      await deleteMemo(userId, memoId);
      setMemos(prev => prev.filter(m => m.id !== memoId));
      setConfirmDeleteId(null);
    } catch (err) {
      console.error('Failed to delete memo:', err);
    }
  };

  const handleStartEdit = (memo: Memo) => {
    setEditingId(memo.id);
    setEditTitle(memo.title);
    setEditContent(memo.content);
  };

  const handleSaveEdit = async (memoId: number) => {
    if (!userId) return;
    try {
      const updated = await updateMemo(userId, memoId, { title: editTitle, content: editContent });
      setMemos(prev => prev.map(m => m.id === memoId ? updated : m));
      setEditingId(null);
    } catch (err) {
      console.error('Failed to save memo:', err);
    }
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditTitle('');
    setEditContent('');
  };

  const handleAppend = async (memo: Memo) => {
    if (!userId || !appendContent.trim()) return;
    try {
      const updated = await appendMemo(userId, memo.id, appendContent.trim(), memo.sourceId ?? undefined);
      setMemos(prev => prev.map(m => m.id === memo.id ? updated : m));
      setAppendingId(null);
      setAppendContent('');
    } catch (err) {
      console.error('Failed to append:', err);
    }
  };

  const handleCreateMemo = async () => {
    if (!userId || !newTitle.trim()) return;
    try {
      const tags = newTags.split(',').map(t => t.trim()).filter(Boolean);
      const memo = await createMemo(userId, {
        title: newTitle.trim(),
        content: newContent.trim(),
        origin: 'manual',
        tags,
      });
      setMemos(prev => [memo, ...prev]);
      setShowNewForm(false);
      setNewTitle('');
      setNewContent('');
      setNewTags('');
    } catch (err) {
      console.error('Failed to create memo:', err);
    }
  };

  const toggleTag = (tag: string) => {
    setSelectedTags(prev => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  };

  const relativeTime = (dateStr: string) => {
    const now = Date.now();
    const then = new Date(dateStr).getTime();
    const diff = now - then;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(dateStr).toLocaleDateString();
  };

  return (
    <div className="memos-page">
      <Breadcrumb
        items={[]}
        onNavigate={() => {}}
        bookTitle="Memos"
        isScoped={false}
        panelToggles={panelToggles}
      />

      <div className="memos-page-content">
        {/* Header with title + new memo button */}
        <div className="memos-page-header">
          <h2 className="memos-page-title">Memos</h2>
          <button className="memos-page-new-btn" onClick={() => setShowNewForm(true)}>
            <Plus size={16} /> New Memo
          </button>
        </div>

        {/* New memo form */}
        {showNewForm && (
          <div className="memos-new-form">
            <input
              className="memos-new-input"
              type="text"
              placeholder="Title"
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              autoFocus
            />
            <textarea
              className="memos-new-textarea"
              placeholder="Write your memo in markdown…"
              value={newContent}
              onChange={e => setNewContent(e.target.value)}
              rows={4}
            />
            <input
              className="memos-new-input"
              type="text"
              placeholder="Tags (comma-separated)"
              value={newTags}
              onChange={e => setNewTags(e.target.value)}
            />
            <div className="memos-new-actions">
              <button className="memos-btn-primary" onClick={handleCreateMemo} disabled={!newTitle.trim()}>
                Save
              </button>
              <button className="memos-btn-secondary" onClick={() => { setShowNewForm(false); setNewTitle(''); setNewContent(''); setNewTags(''); }}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Filter bar */}
        <div className="memos-filter-bar">
          <div className="memos-search-wrapper">
            <Search size={14} className="memos-search-icon" />
            <input
              className="memos-search-input"
              type="text"
              placeholder="Search…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button className="memos-search-clear" onClick={() => setSearchQuery('')}>
                <X size={12} />
              </button>
            )}
          </div>

          <select
            className="memos-source-select"
            value={selectedSourceId}
            onChange={e => setSelectedSourceId(e.target.value)}
          >
            <option value="">All Sources</option>
            {memoSourceIds.map(sid => (
              <option key={sid} value={sid}>{sourceNameMap.get(sid) || sid}</option>
            ))}
          </select>

          <button
            className={`memos-pin-toggle ${pinnedOnly ? 'active' : ''}`}
            onClick={() => setPinnedOnly(!pinnedOnly)}
            title="Show pinned only"
          >
            <Pin size={14} />
          </button>
        </div>

        {/* Tag filter pills */}
        {allTags.length > 0 && (
          <div className="memos-tag-filters">
            {allTags.map(tag => (
              <button
                key={tag}
                className={`memos-tag-pill ${selectedTags.has(tag) ? 'active' : ''}`}
                onClick={() => toggleTag(tag)}
              >
                {tag}
              </button>
            ))}
            {selectedTags.size > 0 && (
              <button className="memos-tag-clear" onClick={() => setSelectedTags(new Set())}>
                <X size={12} /> Clear
              </button>
            )}
          </div>
        )}

        {/* Content */}
        {loading ? (
          <div className="memos-page-loading">Loading memos…</div>
        ) : filteredMemos.length === 0 ? (
          <div className="memos-page-empty">
            <StickyNote size={48} strokeWidth={1.2} />
            <h3>No memos yet</h3>
            <p>Save insights from conversations with /memo, the Save button, or create one manually above.</p>
          </div>
        ) : (
          <>
            {/* Pinned section */}
            {pinnedMemos.length > 0 && (
              <section className="memos-section">
                <h3 className="memos-section-title">
                  <Pin size={14} /> Pinned
                  <span className="memos-section-count">{pinnedMemos.length}</span>
                </h3>
                <div className="memos-grid">
                  {pinnedMemos.map(memo => (
                    <PageMemoCard
                      key={memo.id}
                      memo={memo}
                      isExpanded={expandedId === memo.id}
                      isEditing={editingId === memo.id}
                      isAppending={appendingId === memo.id}
                      isConfirmingDelete={confirmDeleteId === memo.id}
                      editTitle={editTitle}
                      editContent={editContent}
                      appendContent={appendContent}
                      sourceNameMap={sourceNameMap}
                      relativeTime={relativeTime}
                      onToggleExpand={() => setExpandedId(expandedId === memo.id ? null : memo.id)}
                      onTogglePin={() => handleTogglePin(memo)}
                      onDelete={() => {
                        if (confirmDeleteId === memo.id) {
                          handleDelete(memo.id);
                        } else {
                          setConfirmDeleteId(memo.id);
                          setTimeout(() => setConfirmDeleteId(prev => prev === memo.id ? null : prev), 3000);
                        }
                      }}
                      onStartEdit={() => handleStartEdit(memo)}
                      onSaveEdit={() => handleSaveEdit(memo.id)}
                      onCancelEdit={handleCancelEdit}
                      onEditTitleChange={setEditTitle}
                      onEditContentChange={setEditContent}
                      onStartAppend={() => { setAppendingId(memo.id); setAppendContent(''); }}
                      onCancelAppend={() => { setAppendingId(null); setAppendContent(''); }}
                      onSubmitAppend={() => handleAppend(memo)}
                      onAppendContentChange={setAppendContent}
                      onNavigateToSource={() => memo.sourceId && navigate(`/source/${memo.sourceId}`)}
                      onNavigateToSession={memo.sourceId && memo.sessionId ? () => {
                        let url = `/source/${memo.sourceId}?session=${memo.sessionId}`;
                        if (memo.nodeId) url += `&node=${memo.nodeId}`;
                        navigate(url);
                      } : undefined}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Recent section */}
            {recentMemos.length > 0 && (
              <section className="memos-section">
                <h3 className="memos-section-title">
                  <StickyNote size={14} /> Recent
                  <span className="memos-section-count">{recentMemos.length}</span>
                </h3>
                <div className="memos-grid">
                  {recentMemos.map(memo => (
                    <PageMemoCard
                      key={memo.id}
                      memo={memo}
                      isExpanded={expandedId === memo.id}
                      isEditing={editingId === memo.id}
                      isAppending={appendingId === memo.id}
                      isConfirmingDelete={confirmDeleteId === memo.id}
                      editTitle={editTitle}
                      editContent={editContent}
                      appendContent={appendContent}
                      sourceNameMap={sourceNameMap}
                      relativeTime={relativeTime}
                      onToggleExpand={() => setExpandedId(expandedId === memo.id ? null : memo.id)}
                      onTogglePin={() => handleTogglePin(memo)}
                      onDelete={() => {
                        if (confirmDeleteId === memo.id) {
                          handleDelete(memo.id);
                        } else {
                          setConfirmDeleteId(memo.id);
                          setTimeout(() => setConfirmDeleteId(prev => prev === memo.id ? null : prev), 3000);
                        }
                      }}
                      onStartEdit={() => handleStartEdit(memo)}
                      onSaveEdit={() => handleSaveEdit(memo.id)}
                      onCancelEdit={handleCancelEdit}
                      onEditTitleChange={setEditTitle}
                      onEditContentChange={setEditContent}
                      onStartAppend={() => { setAppendingId(memo.id); setAppendContent(''); }}
                      onCancelAppend={() => { setAppendingId(null); setAppendContent(''); }}
                      onSubmitAppend={() => handleAppend(memo)}
                      onAppendContentChange={setAppendContent}
                      onNavigateToSource={() => memo.sourceId && navigate(`/source/${memo.sourceId}`)}
                      onNavigateToSession={memo.sourceId && memo.sessionId ? () => {
                        let url = `/source/${memo.sourceId}?session=${memo.sessionId}`;
                        if (memo.nodeId) url += `&node=${memo.nodeId}`;
                        navigate(url);
                      } : undefined}
                    />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}


/* ─── Enhanced Memo Card for the standalone page ─── */

interface PageMemoCardProps {
  memo: Memo;
  isExpanded: boolean;
  isEditing: boolean;
  isAppending: boolean;
  isConfirmingDelete: boolean;
  editTitle: string;
  editContent: string;
  appendContent: string;
  sourceNameMap: Map<string, string>;
  relativeTime: (dateStr: string) => string;
  onToggleExpand: () => void;
  onTogglePin: () => void;
  onDelete: () => void;
  onStartEdit: () => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onEditTitleChange: (v: string) => void;
  onEditContentChange: (v: string) => void;
  onStartAppend: () => void;
  onCancelAppend: () => void;
  onSubmitAppend: () => void;
  onAppendContentChange: (v: string) => void;
  onNavigateToSource: () => void;
  onNavigateToSession?: () => void;
}

function PageMemoCard({
  memo,
  isExpanded,
  isEditing,
  isAppending,
  isConfirmingDelete,
  editTitle,
  editContent,
  appendContent,
  sourceNameMap,
  relativeTime,
  onToggleExpand,
  onTogglePin,
  onDelete,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onEditTitleChange,
  onEditContentChange,
  onStartAppend,
  onCancelAppend,
  onSubmitAppend,
  onAppendContentChange,
  onNavigateToSource,
  onNavigateToSession,
}: PageMemoCardProps) {
  const html = isExpanded && !isEditing ? (marked.parse(memo.content) as string) : '';
  const preview = memo.content.length > 140
    ? memo.content.slice(0, 140) + '…'
    : memo.content;

  return (
    <div className={`mp-card ${memo.pinned ? 'mp-card-pinned' : ''}`}>
      {/* Header */}
      <div className="mp-card-header">
        {isEditing ? (
          <input
            className="mp-card-edit-title"
            type="text"
            value={editTitle}
            onChange={e => onEditTitleChange(e.target.value)}
            autoFocus
          />
        ) : (
          <button className="mp-card-expand" onClick={onToggleExpand}>
            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <span className="mp-card-title">{memo.title || 'Untitled'}</span>
          </button>
        )}
        <div className="mp-card-actions">
          {isExpanded && !isEditing && (
            <button className="mp-card-action" onClick={onStartEdit} title="Edit">
              <Edit3 size={12} />
            </button>
          )}
          <button
            className={`mp-card-action ${memo.pinned ? 'mp-card-action-active' : ''}`}
            onClick={onTogglePin}
            title={memo.pinned ? 'Unpin' : 'Pin'}
          >
            <Pin size={12} />
          </button>
          <button
            className={`mp-card-action ${isConfirmingDelete ? 'mp-card-action-danger' : ''}`}
            onClick={onDelete}
            title={isConfirmingDelete ? 'Click again to confirm' : 'Delete'}
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {/* Meta */}
      <div className="mp-card-meta">
        {memo.sourceId && (
          <button className="mp-card-source-badge" onClick={onNavigateToSource} title="Go to source">
            {sourceNameMap.get(memo.sourceId) || memo.sourceId}
            <ExternalLink size={10} />
          </button>
        )}
        {memo.sessionId && onNavigateToSession && (
          <button className="mp-card-source-badge" onClick={onNavigateToSession} title="Go to session">
            <MessageSquare size={10} /> Session
            <ExternalLink size={10} />
          </button>
        )}
        <span className="mp-card-origin">{memo.origin}</span>
        <span className="mp-card-time">{relativeTime(memo.updatedAt)}</span>
      </div>

      {/* Tags */}
      {memo.tags.length > 0 && (
        <div className="mp-card-tags">
          {memo.tags.map(t => (
            <span key={t} className="mp-card-tag">{t}</span>
          ))}
        </div>
      )}

      {/* Body */}
      {isEditing ? (
        <div className="mp-card-edit-body">
          <textarea
            className="mp-card-edit-textarea"
            value={editContent}
            onChange={e => onEditContentChange(e.target.value)}
            rows={6}
          />
          <div className="mp-card-edit-actions">
            <button className="memos-btn-primary" onClick={onSaveEdit}>Save</button>
            <button className="memos-btn-secondary" onClick={onCancelEdit}>Cancel</button>
          </div>
        </div>
      ) : isExpanded ? (
        <div className="mp-card-body" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <p className="mp-card-preview">{preview}</p>
      )}

      {/* Append area */}
      {isExpanded && !isEditing && (
        <>
          {isAppending ? (
            <div className="mp-card-append">
              <textarea
                className="mp-card-append-textarea"
                placeholder="Add to this memo…"
                value={appendContent}
                onChange={e => onAppendContentChange(e.target.value)}
                rows={3}
                autoFocus
              />
              <div className="mp-card-edit-actions">
                <button className="memos-btn-primary" onClick={onSubmitAppend} disabled={!appendContent.trim()}>
                  Append
                </button>
                <button className="memos-btn-secondary" onClick={onCancelAppend}>Cancel</button>
              </div>
            </div>
          ) : (
            <button className="mp-card-append-btn" onClick={onStartAppend}>
              <Plus size={12} /> Add to this memo
            </button>
          )}
        </>
      )}
    </div>
  );
}
