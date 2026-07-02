import { useState, useEffect, useCallback, useRef } from 'react';
import { marked } from 'marked';
import { StickyNote, Pin, Trash2, ChevronDown, ChevronRight, Edit3, Plus, X, Check } from 'lucide-react';
import { fetchMemos, updateMemo, deleteMemo, appendMemo } from '../api';
import type { Memo } from '../api';
import './MemosPanel.css';

interface MemosPanelProps {
  sourceId: string;
  userId: string;
  sessionId?: number;
  onNavigateToNode?: (nodeId: string) => void;
}

export function MemosPanel({ sourceId, userId, onNavigateToNode }: MemosPanelProps) {
  const [memos, setMemos] = useState<Memo[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  // Inline editing state
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');

  // Append state
  const [appendingId, setAppendingId] = useState<number | null>(null);
  const [appendContent, setAppendContent] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await fetchMemos(userId, { sourceId });
      setMemos(data);
    } catch (err) {
      console.error('Failed to load memos:', err);
    } finally {
      setLoading(false);
    }
  }, [userId, sourceId]);

  useEffect(() => {
    load();
  }, [load]);

  // Expose reload so parent components can trigger a refresh
  // (e.g. after creating a memo via slash command)
  useEffect(() => {
    const handler = () => { load(); };
    window.addEventListener('pi-tree:memos-changed', handler);
    return () => window.removeEventListener('pi-tree:memos-changed', handler);
  }, [load]);

  const handleTogglePin = async (memo: Memo) => {
    try {
      const updated = await updateMemo(userId, memo.id, { pinned: !memo.pinned });
      setMemos(prev => prev.map(m => m.id === memo.id ? updated : m));
    } catch (err) {
      console.error('Failed to toggle pin:', err);
    }
  };

  const handleDelete = async (memoId: number) => {
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
    // Close append if open
    setAppendingId(null);
    setAppendContent('');
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditTitle('');
    setEditContent('');
  };

  const handleSaveEdit = async (memoId: number) => {
    try {
      const updated = await updateMemo(userId, memoId, { title: editTitle, content: editContent });
      setMemos(prev => prev.map(m => m.id === memoId ? updated : m));
      setEditingId(null);
      setEditTitle('');
      setEditContent('');
    } catch (err) {
      console.error('Failed to update memo:', err);
    }
  };

  const handleStartAppend = (memoId: number) => {
    setAppendingId(memoId);
    setAppendContent('');
    // Close editing if open
    setEditingId(null);
    setEditTitle('');
    setEditContent('');
  };

  const handleCancelAppend = () => {
    setAppendingId(null);
    setAppendContent('');
  };

  const handleSubmitAppend = async (memoId: number) => {
    if (!appendContent.trim()) return;
    try {
      const updated = await appendMemo(userId, memoId, appendContent, sourceId);
      setMemos(prev => prev.map(m => m.id === memoId ? updated : m));
      setAppendingId(null);
      setAppendContent('');
    } catch (err) {
      console.error('Failed to append to memo:', err);
    }
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

  if (loading) {
    return <div className="memos-empty">Loading…</div>;
  }

  if (memos.length === 0) {
    return (
      <div className="memos-empty">
        <StickyNote size={28} strokeWidth={1.5} className="memos-empty-icon" />
        <p>No memos yet</p>
        <p className="memos-empty-hint">
          Save insights from conversations with /memo or the Save button
        </p>
      </div>
    );
  }

  // Sort: pinned first, then by date
  const sorted = [...memos].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  return (
    <div className="memos-panel">
      {sorted.map(memo => (
        <MemoCard
          key={memo.id}
          memo={memo}
          isExpanded={expandedId === memo.id}
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
          isConfirmingDelete={confirmDeleteId === memo.id}
          onNavigateToNode={onNavigateToNode}
          relativeTime={relativeTime}
          // Inline editing
          isEditing={editingId === memo.id}
          editTitle={editTitle}
          editContent={editContent}
          onEditTitleChange={setEditTitle}
          onEditContentChange={setEditContent}
          onStartEdit={() => handleStartEdit(memo)}
          onCancelEdit={handleCancelEdit}
          onSaveEdit={() => handleSaveEdit(memo.id)}
          // Append
          isAppending={appendingId === memo.id}
          appendContent={appendContent}
          onAppendContentChange={setAppendContent}
          onStartAppend={() => handleStartAppend(memo.id)}
          onCancelAppend={handleCancelAppend}
          onSubmitAppend={() => handleSubmitAppend(memo.id)}
        />
      ))}
    </div>
  );
}

function MemoCard({
  memo,
  isExpanded,
  onToggleExpand,
  onTogglePin,
  onDelete,
  isConfirmingDelete,
  onNavigateToNode,
  relativeTime,
  // Editing props
  isEditing,
  editTitle,
  editContent,
  onEditTitleChange,
  onEditContentChange,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  // Append props
  isAppending,
  appendContent,
  onAppendContentChange,
  onStartAppend,
  onCancelAppend,
  onSubmitAppend,
}: {
  memo: Memo;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onTogglePin: () => void;
  onDelete: () => void;
  isConfirmingDelete: boolean;
  onNavigateToNode?: (nodeId: string) => void;
  relativeTime: (dateStr: string) => string;
  // Editing
  isEditing: boolean;
  editTitle: string;
  editContent: string;
  onEditTitleChange: (v: string) => void;
  onEditContentChange: (v: string) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  // Append
  isAppending: boolean;
  appendContent: string;
  onAppendContentChange: (v: string) => void;
  onStartAppend: () => void;
  onCancelAppend: () => void;
  onSubmitAppend: () => void;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const appendRef = useRef<HTMLTextAreaElement>(null);
  const html = isExpanded && !isEditing ? (marked.parse(memo.content) as string) : '';

  const preview = memo.content.length > 120
    ? memo.content.slice(0, 120) + '…'
    : memo.content;

  // Auto-focus append textarea when opening
  useEffect(() => {
    if (isAppending && appendRef.current) {
      appendRef.current.focus();
    }
  }, [isAppending]);

  return (
    <div className={`memo-card ${memo.pinned ? 'memo-card-pinned' : ''}`}>
      <div className="memo-card-header">
        <button className="memo-card-expand" onClick={onToggleExpand}>
          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          {isEditing ? (
            <input
              className="memo-card-edit-title"
              value={editTitle}
              onChange={(e) => onEditTitleChange(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              placeholder="Memo title"
            />
          ) : (
            <span className="memo-card-title">{memo.title || 'Untitled'}</span>
          )}
        </button>
        <div className="memo-card-actions">
          {isEditing ? (
            <>
              <button
                className="memo-card-action memo-card-action-save"
                onClick={onSaveEdit}
                title="Save"
              >
                <Check size={12} />
              </button>
              <button
                className="memo-card-action"
                onClick={onCancelEdit}
                title="Cancel"
              >
                <X size={12} />
              </button>
            </>
          ) : (
            <>
              {isExpanded && (
                <button
                  className="memo-card-action"
                  onClick={onStartEdit}
                  title="Edit"
                >
                  <Edit3 size={12} />
                </button>
              )}
              <button
                className="memo-card-action"
                onClick={onStartAppend}
                title="Append"
              >
                <Plus size={12} />
              </button>
              <button
                className={`memo-card-action ${memo.pinned ? 'memo-card-action-active' : ''}`}
                onClick={onTogglePin}
                title={memo.pinned ? 'Unpin' : 'Pin'}
              >
                <Pin size={12} />
              </button>
              <button
                className={`memo-card-action ${isConfirmingDelete ? 'memo-card-action-danger' : ''}`}
                onClick={onDelete}
                title={isConfirmingDelete ? 'Click again to confirm' : 'Delete'}
              >
                <Trash2 size={12} />
              </button>
            </>
          )}
        </div>
      </div>
      <div className="memo-card-meta">
        <span className="memo-card-origin">{memo.origin}</span>
        <span className="memo-card-time">{relativeTime(memo.createdAt)}</span>
      </div>
      {isEditing ? (
        <textarea
          className="memo-card-edit-content"
          value={editContent}
          onChange={(e) => onEditContentChange(e.target.value)}
          rows={6}
          placeholder="Memo content (markdown supported)"
        />
      ) : isExpanded ? (
        <div
          ref={bodyRef}
          className="memo-card-body"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <p className="memo-card-preview">{preview}</p>
      )}
      {isExpanded && !isEditing && memo.nodeId && onNavigateToNode && (
        <button
          className="memo-card-navigate"
          onClick={() => onNavigateToNode(memo.nodeId!)}
        >
          Go to conversation →
        </button>
      )}
      {isAppending && (
        <div className="memo-card-append">
          <textarea
            ref={appendRef}
            className="memo-card-append-input"
            value={appendContent}
            onChange={(e) => onAppendContentChange(e.target.value)}
            rows={3}
            placeholder="Append content…"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                onSubmitAppend();
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                onCancelAppend();
              }
            }}
          />
          <div className="memo-card-append-actions">
            <button className="memo-card-append-submit" onClick={onSubmitAppend}>
              <Check size={12} /> Add
            </button>
            <button className="memo-card-append-cancel" onClick={onCancelAppend}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
