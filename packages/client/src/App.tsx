import { Routes, Route, Navigate } from "react-router";
import { Library } from "./components/Library";
import { ReaderRoute } from "./components/ReaderRoute";
import "./App.css";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Library />} />
      <Route path="/book/:bookId" element={<ReaderRoute />} />
      {/* Catch-all: redirect to library */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
