import { Routes, Route, Navigate } from "react-router";
import { UserProvider, useUser } from "./UserContext";
import { StreamProvider } from "./StreamContext";
import { UserPicker } from "./components/UserPicker";
import { Library } from "./components/Library";
import { BookLayout } from "./components/BookLayout";
import { Reader } from "./components/Reader";
import { SessionsPage } from "./components/SessionsPage";
import "./App.css";

function AppRoutes() {
  const { userId } = useUser();

  if (!userId) {
    return <UserPicker />;
  }

  return (
    <Routes>
      <Route path="/" element={<Library />} />
      <Route path="/source/:sourceId" element={<BookLayout />}>
        <Route index element={<Reader />} />
        <Route path="sessions" element={<SessionsPage />} />
      </Route>
      {/* Catch-all: redirect to library */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <UserProvider>
      <StreamProvider>
        <AppRoutes />
      </StreamProvider>
    </UserProvider>
  );
}
