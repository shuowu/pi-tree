import { useCallback, useState } from "react";
import type { DictEntry } from "../components/DictionaryPanel";
import { streamLookup } from "../api";

export function useDictionary(
  userId: string | null,
  sourceId: string,
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

      // Always show the floating quick-card popup — don't open the right panel.
      // Users can click "View in Dictionary →" in the popup to open the full panel.
      setQuickLookupId(entryId);

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
    [userId, sourceId],
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
