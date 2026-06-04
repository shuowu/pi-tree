import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import type { Book } from "@pi-reader/shared";
import { fetchBooks } from "../api";
import { useUser } from "../UserContext";
import { BookOpen, LogOut } from "lucide-react";
import { BookCover } from "./BookCover";
import "./Library.css";

export function Library() {
  const navigate = useNavigate();
  const { displayName, clearUser } = useUser();
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
        <h1><BookOpen size={28} strokeWidth={1.5} /> <span>Pi Reader</span></h1>
        <p>AI-assisted reading with tree-structured conversations</p>
        {displayName && (
          <div className="library-user-bar">
            <span className="library-user-pill">
              <span className="library-user-avatar">
                {displayName.charAt(0).toUpperCase()}
              </span>
              {displayName}
            </span>
            <button
              className="library-switch-user"
              onClick={clearUser}
              title="Switch user"
            >
              <LogOut size={14} />
              Switch User
            </button>
          </div>
        )}
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
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
