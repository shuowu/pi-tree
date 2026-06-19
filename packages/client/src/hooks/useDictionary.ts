import { useCallback, useState } from "react";
import type { DictEntry } from "../components/DictionaryPanel";
import { streamLookup } from "../api";

export function useDictionary(
  userId: string | null,
  sourceId: string,
  rightTab: "dict" | "content",
  setRightPanelOpen: (open: boolean) => void,
  setRightTab: (tab: "dict" | "content") => void,
) {
  const [dictEntries, setDictEntries] = useState<DictEntry[]>([]);
  const [quickLookupId, setQuickLookupId] = useState<string | null>(null);

  /** Clear all entries — call when session changes */
  const clearEntries = useCallback(() => {
    setDictEntries([]);
    setQuickLookupId(null);
  }, []);

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

      // If on content tab, show floating mini-card instead of switching tabs
      if (rightTab === "content") {
        setQuickLookupId(entryId);
      } else {
        setRightTab("dict");
      }

      streamLookup(userId, sourceId, term, (token) => {
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
    [userId, sourceId, rightTab, setRightPanelOpen, setRightTab],
  );


  const handleDictRemove = useCallback((id: string) => {
    setDictEntries((prev) => prev.filter((e) => e.id !== id));
  }, []);

  return {
    dictEntries,
    setDictEntries,
    clearEntries,
    quickLookupId,
    setQuickLookupId,
    handleDefine,
    handleDictRemove,
  };
}
