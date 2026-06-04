import { Routes, Route, Navigate } from "react-router";
import { UserProvider, useUser } from "./UserContext";
import { UserPicker } from "./components/UserPicker";
import { Library } from "./components/Library";
import { ReaderRoute } from "./components/ReaderRoute";
import "./App.css";

function AppRoutes() {
  const { userId } = useUser();

  if (!userId) {
    return <UserPicker />;
  }

  return (
    <Routes>
      <Route path="/" element={<Library />} />
      <Route path="/book/:bookId" element={<ReaderRoute />} />
      {/* Catch-all: redirect to library */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <UserProvider>
      <AppRoutes />
    </UserProvider>
  );
}
