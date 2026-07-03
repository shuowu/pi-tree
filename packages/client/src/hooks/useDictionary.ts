import { useCallback, useState } from "react";
import type { DictEntry } from "../components/DictionaryPanel";
import { streamLookup } from "../api";

export function useDictionary(
  userId: string | null,
  sourceId: string,
) {
  const [dictEntries, setDictEntries] = useState<DictEntry[]>([]);
  /** Stack of quick-lookup card IDs (most recent last) */
  const [quickLookupStack, setQuickLookupStack] = useState<string[]>([]);

  /** Clear all entries — call when session changes */
  const clearEntries = useCallback(() => {
    setDictEntries([]);
    setQuickLookupStack([]);
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

      // Push onto the quick-lookup stack so multiple popups coexist
      setQuickLookupStack((prev) => [...prev, entryId]);

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
        .catch((err) => {
          setDictEntries((prev) =>
            prev.map((e) =>
              e.id === entryId
                ? { ...e, definition: err?.message || "Lookup failed.", streaming: false }
                : e,
            ),
          );
        });
    },
    [userId, sourceId],
  );


  const handleDictRemove = useCallback((id: string) => {
    setDictEntries((prev) => prev.filter((e) => e.id !== id));
    setQuickLookupStack((prev) => prev.filter((eid) => eid !== id));
  }, []);

  /** Dismiss a single card from the quick-lookup stack */
  const dismissQuickCard = useCallback((id: string) => {
    setQuickLookupStack((prev) => prev.filter((eid) => eid !== id));
  }, []);

  /** Dismiss all quick-lookup cards (e.g. when opening the Dictionary tab) */
  const dismissAllQuickCards = useCallback(() => {
    setQuickLookupStack([]);
  }, []);

  return {
    dictEntries,
    setDictEntries,
    clearEntries,
    quickLookupStack,
    handleDefine,
    handleDictRemove,
    dismissQuickCard,
    dismissAllQuickCards,
  };
}
