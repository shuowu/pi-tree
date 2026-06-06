import { useCallback, useState } from "react";
import type { DictEntry } from "../components/DictionaryPanel";
import { streamLookup, saveGlossary } from "../api";

export function useDictionary(
  userId: string | null,
  bookId: string,
  rightTab: "dict" | "book",
  setRightPanelOpen: (open: boolean) => void,
  setRightTab: (tab: "dict" | "book") => void,
) {
  const [dictEntries, setDictEntries] = useState<DictEntry[]>([]);
  const [quickLookupId, setQuickLookupId] = useState<string | null>(null);

  const handleDefine = useCallback(
    (term: string, context?: string) => {
      if (!userId) return;

      const entryId = `dict-${Date.now()}`;
      const newEntry: DictEntry = {
        id: entryId,
        term,
        definition: "",
        streaming: true,
        timestamp: new Date().toISOString(),
      };

      setDictEntries((prev) => [...prev, newEntry]);
      setRightPanelOpen(true);

      // If on Book tab, show floating mini-card instead of switching tabs
      if (rightTab === "book") {
        setQuickLookupId(entryId);
      } else {
        setRightTab("dict");
      }

      streamLookup(userId, bookId, term, (token) => {
        setDictEntries((prev) =>
          prev.map((e) =>
            e.id === entryId ? { ...e, definition: e.definition + token } : e,
          ),
        );
      }, context)
        .then((fullDef) => {
          setDictEntries((prev) =>
            prev.map((e) =>
              e.id === entryId
                ? { ...e, definition: fullDef || e.definition, streaming: false }
                : e,
            ),
          );
          // Auto-save to glossary
          if (userId) {
            saveGlossary(userId, bookId, term, fullDef).catch(() => {});
          }
        })
        .catch(() => {
          setDictEntries((prev) =>
            prev.map((e) =>
              e.id === entryId
                ? { ...e, definition: "Lookup failed.", streaming: false }
                : e,
            ),
          );
        });
    },
    [userId, bookId, rightTab, setRightPanelOpen, setRightTab],
  );


  const handleDictRemove = useCallback((id: string) => {
    setDictEntries((prev) => prev.filter((e) => e.id !== id));
  }, []);

  return {
    dictEntries,
    setDictEntries,
    quickLookupId,
    setQuickLookupId,
    handleDefine,
    handleDictRemove,
  };
}
