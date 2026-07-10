/* eslint-disable react-refresh/only-export-components */
import { useEffect, useState } from "react";
import { useParams, useNavigate, useOutletContext, Outlet } from "react-router";
import type { Source } from "@pi-tree/shared";
import { fetchSource } from "../api";
import { useUser } from "../UserContext";


/**
 * Layout route for /source/:sourceId/*.
 *
 * Resolves sourceId from URL params, fetches the Source object, and renders
 * child routes via <Outlet> with the source passed as context.
 */
export function SourceLayout() {
  const { sourceId } = useParams<{ sourceId: string }>();
  const { userId } = useUser();
  const navigate = useNavigate();
  const [source, setSource] = useState<Source | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sourceId || !userId) {
      navigate("/", { replace: true });
      return;
    }

    setError(null);

    let cancelled = false;
    (async () => {
      try {
        const s = await fetchSource(sourceId);
        if (!cancelled) setSource(s);
      } catch {
        if (!cancelled) setError(`Source "${sourceId}" not found`);
      }
    })();
    return () => { cancelled = true; };
  }, [sourceId, userId, navigate]);

  if (error) {
    return (
      <div style={{ padding: "2rem", textAlign: "center" }}>
        <p>{error}</p>
        <button onClick={() => navigate("/")}>Back to Library</button>
      </div>
    );
  }

  // Guard in render, not an effect: the layout stays mounted across source
  // param changes, and child effects run before parent effects — rendering
  // the Outlet with a stale source lets children act on the wrong source
  // (e.g. Reader replace-navigates back to the old source's sessions page)
  if (!source || source.id !== sourceId) {
    return (
      <div style={{ padding: "2rem", textAlign: "center", opacity: 0.5 }}>
        Loading…
      </div>
    );
  }

  return <Outlet context={{ source }} />;
}

/** Hook for child routes to access the Source loaded by SourceLayout. */
export function useSource(): Source {
  return useOutletContext<{ source: Source }>().source;
}
