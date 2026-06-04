import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router";
import type { Book } from "@pi-reader/shared";
import { fetchBook } from "../api";
import { Reader } from "./Reader";

/**
 * Route wrapper that resolves bookId from URL params,
 * fetches the Book object, and renders the Reader.
 */
export function ReaderRoute() {
  const { bookId } = useParams<{ bookId: string }>();
  const navigate = useNavigate();
  const [book, setBook] = useState<Book | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!bookId) {
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
  }, [bookId, navigate]);

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

  return <Reader book={book} />;
}
