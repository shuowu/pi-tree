import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import type { Book } from "@pi-reader/shared";
import { fetchBooks } from "../api";
import { useUser } from "../UserContext";
import { BookOpen, LogOut, Plus } from "lucide-react";
import { BookCover } from "./BookCover";
import { AddBookModal } from "./AddBookModal";
import "./Library.css";

export function Library() {
  const navigate = useNavigate();
  const { displayName, clearUser } = useUser();
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchBooks();
      setBooks(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load books");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const selectBook = (book: Book) => {
    navigate(`/book/${book.id}`);
  };

  return (
    <div className="library">
      <header className="library-header">
        <div className="library-header-left">
          <h1><BookOpen size={24} strokeWidth={1.5} /> <span>Pi Reader</span></h1>
        </div>
        <div className="library-header-right">
          <button
            className="library-add-btn"
            onClick={() => setShowAddModal(true)}
          >
            <Plus size={16} strokeWidth={2} />
            Add Book
          </button>
          {displayName && (
            <div className="library-user-menu">
              <button className="library-user-pill" onClick={clearUser} title="Switch user">
                <span className="library-user-avatar">
                  {displayName.charAt(0).toUpperCase()}
                </span>
                {displayName}
                <LogOut size={14} />
              </button>
            </div>
          )}
        </div>
      </header>

      {loading && (
        <div className="library-grid">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton-card">
              <div className="skeleton-cover" />
              <div className="skeleton-info">
                <div className="skeleton-title" />
                <div className="skeleton-author" />
                <div className="skeleton-badges">
                  <div className="skeleton-badge" />
                  <div className="skeleton-badge" />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="library-error">
          <p>{error}</p>
          <button onClick={load}>Retry</button>
        </div>
      )}

      {!loading && !error && (
        <div className="library-grid">

          {books.map((book) => (
            <div
              key={book.id}
              className="book-card"
              onClick={() => selectBook(book)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === "Enter" && selectBook(book)}
            >
              <BookCover
                bookId={book.id}
                title={book.title}
                author={book.author}
                hasCover={book.hasCover}
                size="md"
              />
              <div className="book-card-info">
                <div className="book-card-title">{book.title}</div>
                <div className="book-card-author">
                  {book.author}, {book.year}
                </div>
                <div className="book-card-badges">
                  {book.hasMarkdown && (
                    <span className="badge badge-green">Converted</span>
                  )}
                  {book.hasOutline && (
                    <span className="badge badge-amber">Outline</span>
                  )}
                  {book.source === "upload" && (
                    <span className="badge badge-blue">Uploaded</span>
                  )}
                  {book.status === "failed" && (
                    <span className="badge badge-red">Failed</span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {showAddModal && (
        <AddBookModal
          onClose={() => setShowAddModal(false)}
          onSuccess={() => { setShowAddModal(false); load(); }}
        />
      )}
    </div>
  );
}
