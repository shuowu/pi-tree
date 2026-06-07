import { useEffect, useState } from "react";
import { useParams, useNavigate, useOutletContext, Outlet } from "react-router";
import type { Book } from "@pi-books/shared";
import { fetchBook } from "../api";
import { useUser } from "../UserContext";

/**
 * Layout route for /book/:bookId/*.
 *
 * Resolves bookId from URL params, fetches the Book object, and renders
 * child routes via <Outlet> with the book passed as context.
 */
export function BookLayout() {
  const { bookId } = useParams<{ bookId: string }>();
  const { userId } = useUser();
  const navigate = useNavigate();
  const [book, setBook] = useState<Book | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!bookId || !userId) {
      navigate("/", { replace: true });
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const b = await fetchBook(bookId);
        if (!cancelled) setBook(b);
      } catch {
        if (!cancelled) setError(`Book "${bookId}" not found`);
      }
    })();
    return () => { cancelled = true; };
  }, [bookId, userId, navigate]);

  if (error) {
    return (
      <div style={{ padding: "2rem", textAlign: "center" }}>
        <p>{error}</p>
        <button onClick={() => navigate("/")}>Back to Library</button>
      </div>
    );
  }

  if (!book) {
    return (
      <div style={{ padding: "2rem", textAlign: "center", opacity: 0.5 }}>
        Loading…
      </div>
    );
  }

  return <Outlet context={{ book }} />;
}

/** Hook for child routes to access the Book loaded by BookLayout. */
export function useBook(): Book {
  return useOutletContext<{ book: Book }>().book;
}
