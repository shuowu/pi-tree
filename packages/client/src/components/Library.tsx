import { useEffect, useState } from "react";
import type { Book } from "@pi-reader/shared";
import { fetchBooks } from "../api";
import "./Library.css";

interface LibraryProps {
  onSelectBook: (book: Book) => void;
}

export function Library({ onSelectBook }: LibraryProps) {
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

  return (
    <div className="library">
      <header className="library-header">
        <h1>📖 <span>Pi Reader</span></h1>
        <p>AI-assisted reading with tree-structured conversations</p>
      </header>

      {loading && (
        <div className="library-grid">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton-card">
              <div className="skeleton-title" />
              <div className="skeleton-author" />
              <div className="skeleton-badges">
                <div className="skeleton-badge" />
                <div className="skeleton-badge" />
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
              onClick={() => onSelectBook(book)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === "Enter" && onSelectBook(book)}
            >
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
          ))}
        </div>
      )}
    </div>
  );
}
