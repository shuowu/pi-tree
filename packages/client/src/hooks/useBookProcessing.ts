import { useCallback, useEffect, useState } from "react";
import type { Book } from "@pi-tree/shared";
import { processBook, fetchJobStatus, type Job } from "../api";

export function useBookProcessing(book: Book) {
  const [currentBook, setCurrentBook] = useState<Book>(book);
  const [prevBook, setPrevBook] = useState<Book>(book);
  const [currentJob, setCurrentJob] = useState<Job | null>(null);

  if (book.id !== prevBook.id || book.status !== prevBook.status) {
    setPrevBook(book);
    setCurrentBook(book);
  }

  useEffect(() => {
    if (currentBook.status === "processing" || currentBook.status === "pending") {
      fetchJobStatus(currentBook.id).then(setCurrentJob);
    }
  }, [currentBook.status, currentBook.id]);

  useEffect(() => {
    if (currentBook.status !== "processing" && currentBook.status !== "pending") return;

    const timer = setInterval(async () => {
      try {
        const job = await fetchJobStatus(currentBook.id);
        if (job) {
          setCurrentJob(job);
          if (job.status === "completed") {
            clearInterval(timer);
            const bookRes = await fetch(`/api/library/books/${currentBook.id}`);
            if (bookRes.ok) {
              const updatedBook = await bookRes.json();
              setCurrentBook(updatedBook);
              window.location.reload();
            }
          } else if (job.status === "failed") {
            clearInterval(timer);
            const bookRes = await fetch(`/api/library/books/${currentBook.id}`);
            if (bookRes.ok) {
              const updatedBook = await bookRes.json();
              setCurrentBook(updatedBook);
            }
          }
        }
      } catch (err) {
        console.error("Polling error:", err);
      }
    }, 2000);

    return () => clearInterval(timer);
  }, [currentBook.status, currentBook.id]);

  const handleProcessBook = async () => {
    try {
      await processBook(currentBook.id);
      setCurrentBook((prev) => ({ ...prev, status: "processing" }));
      const job = await fetchJobStatus(currentBook.id);
      if (job) setCurrentJob(job);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  const handleReprocessBook = useCallback(async () => {
    if (!confirm("Are you sure you want to re-process this book? This will regenerate the outline, table of contents, and summary. It runs in the background and takes 30-60 seconds.")) return;
    try {
      await processBook(currentBook.id);
      setCurrentBook((prev) => ({ ...prev, status: "processing" }));
      const job = await fetchJobStatus(currentBook.id);
      if (job) setCurrentJob(job);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  }, [currentBook.id]);

  return {
    currentBook,
    currentJob,
    handleProcessBook,
    handleReprocessBook,
  };
}
