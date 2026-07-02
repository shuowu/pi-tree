import { useState, useEffect, useCallback } from "react";
import { Routes, Route, Navigate, useNavigate } from "react-router";
import { UserProvider, useUser } from "./UserContext";
import { StreamProvider } from "./StreamContext";
import { ThemeProvider } from "./ThemeContext";
import { UserPicker } from "./components/UserPicker";
import { HomePage } from "./components/HomePage";
import { Library } from "./components/Library";
import { SourceLayout } from "./components/SourceLayout";
import { Reader } from "./components/Reader";
import { SessionsPage } from "./components/SessionsPage";
import { UsageDashboard } from "./components/UsageDashboard";
import { MemosPage } from "./components/MemosPage";
import { SpotlightSearch } from "./components/SpotlightSearch";
import { AddSourceModal } from "./components/AddSourceModal";
import { SettingsModal } from "./components/SettingsModal";
import "./App.css";

function AppRoutes() {
  const { userId } = useUser();
  const [spotlightOpen, setSpotlightOpen] = useState(false);
  const navigate = useNavigate();
  const [addSourceOpen, setAddSourceOpen] = useState(false);

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
        <Route path="/source/:sourceId" element={<SourceLayout />}>
          <Route index element={<Reader />} />
          <Route path="sessions" element={<SessionsPage />} />
        </Route>
        <Route path="/usage" element={<UsageDashboard />} />
        <Route path="/memos" element={<MemosPage />} />
        {/* Catch-all: redirect to home */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <SpotlightSearch
        userId={userId}
        isOpen={spotlightOpen}
        onClose={closeSpotlight}
        onAddSource={() => setAddSourceOpen(true)}
        onSettings={() => setSettingsOpen(true)}
      />
      {addSourceOpen && (
        <AddSourceModal
          onClose={() => setAddSourceOpen(false)}
          onSuccess={() => { setAddSourceOpen(false); navigate("/library"); }}
        />
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
