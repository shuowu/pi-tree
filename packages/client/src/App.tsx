import { useState, useEffect, useCallback } from "react";
import { Routes, Route, Navigate } from "react-router";
import { UserProvider, useUser } from "./UserContext";
import { StreamProvider } from "./StreamContext";
import { ThemeProvider } from "./ThemeContext";
import { UserPicker } from "./components/UserPicker";
import { HomePage } from "./components/HomePage";
import { Library } from "./components/Library";
import { BookLayout } from "./components/BookLayout";
import { Reader } from "./components/Reader";
import { SessionsPage } from "./components/SessionsPage";
import { SpotlightSearch } from "./components/SpotlightSearch";
import { AddBookModal } from "./components/AddBookModal";
import { FeedManagerModal } from "./components/FeedManagerModal";
import { SettingsModal } from "./components/SettingsModal";
import "./App.css";

function AppRoutes() {
  const { userId } = useUser();
  const [spotlightOpen, setSpotlightOpen] = useState(false);
  const [addSourceOpen, setAddSourceOpen] = useState(false);
  const [feedManagerOpen, setFeedManagerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const openSpotlight = useCallback(() => setSpotlightOpen(true), []);
  const closeSpotlight = useCallback(() => setSpotlightOpen(false), []);

  // Global Cmd+K / Ctrl+K shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSpotlightOpen((prev) => !prev);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  if (!userId) {
    return <UserPicker />;
  }

  return (
    <>
      <Routes>
        <Route path="/" element={<HomePage onOpenSpotlight={openSpotlight} />} />
        <Route path="/library" element={<Library />} />
        <Route path="/source/:sourceId" element={<BookLayout />}>
          <Route index element={<Reader />} />
          <Route path="sessions" element={<SessionsPage />} />
        </Route>
        {/* Catch-all: redirect to home */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <SpotlightSearch
        userId={userId}
        isOpen={spotlightOpen}
        onClose={closeSpotlight}
        onAddSource={() => setAddSourceOpen(true)}
        onManageFeeds={() => setFeedManagerOpen(true)}
        onSettings={() => setSettingsOpen(true)}
      />
      {addSourceOpen && (
        <AddBookModal
          onClose={() => setAddSourceOpen(false)}
          onSuccess={() => setAddSourceOpen(false)}
        />
      )}
      {feedManagerOpen && (
        <FeedManagerModal onClose={() => setFeedManagerOpen(false)} />
      )}
      {settingsOpen && (
        <SettingsModal onClose={() => setSettingsOpen(false)} />
      )}
    </>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <UserProvider>
        <StreamProvider>
          <AppRoutes />
        </StreamProvider>
      </UserProvider>
    </ThemeProvider>
  );
}
