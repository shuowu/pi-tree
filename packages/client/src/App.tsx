import { useCallback, useState } from "react";
import type { Book } from "@pi-reader/shared";
import { Library } from "./components/Library";
import { Reader } from "./components/Reader";
import "./App.css";

const STORAGE_KEY = "pi-reader:active-book";

function loadSavedBook(): Book | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : null;
  } catch {
    return null;
  }
}

export default function App() {
  const [activeBook, setActiveBook] = useState<Book | null>(loadSavedBook);

  const selectBook = useCallback((book: Book) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(book));
    setActiveBook(book);
  }, []);

  const goBack = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setActiveBook(null);
  }, []);

  if (activeBook) {
    return <Reader book={activeBook} onBack={goBack} />;
  }

  return <Library onSelectBook={selectBook} />;
}
