import { useState } from "react";
import type { Book } from "@pi-reader/shared";
import { Library } from "./components/Library";
import { Reader } from "./components/Reader";
import "./App.css";

export default function App() {
  const [activeBook, setActiveBook] = useState<Book | null>(null);

  if (activeBook) {
    return (
      <Reader
        book={activeBook}
        onBack={() => setActiveBook(null)}
      />
    );
  }

  return <Library onSelectBook={setActiveBook} />;
}
