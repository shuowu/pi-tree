/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { AddSourceModal } from "./components/AddSourceModal";

/**
 * App-wide add-source affordance. One modal instance lives here so any
 * surface (header, reader toolbar, spotlight, empty states) can open it,
 * with a single success behavior: navigate to the created source, or to
 * the library for forms that don't report one (e.g. news feed config).
 */
const AddSourceContext = createContext<{ openAddSource: () => void }>({
  openAddSource: () => {},
});

export function AddSourceProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const openAddSource = useCallback(() => setOpen(true), []);

  return (
    <AddSourceContext.Provider value={{ openAddSource }}>
      {children}
      {open && (
        <AddSourceModal
          onClose={() => setOpen(false)}
          onSuccess={(source) => {
            setOpen(false);
            navigate(source?.id ? `/source/${source.id}` : "/library");
          }}
        />
      )}
    </AddSourceContext.Provider>
  );
}

export function useAddSource() {
  return useContext(AddSourceContext);
}
