import { useCallback, useEffect, useState } from "react";
import type { Source } from "@pi-tree/shared";
import { processSource, fetchJobStatus, type Job } from "../api";

export function useSourceProcessing(source: Source) {
  const [currentSource, setCurrentSource] = useState<Source>(source);
  const [prevSource, setPrevSource] = useState<Source>(source);
  const [currentJob, setCurrentJob] = useState<Job | null>(null);

  if (source.id !== prevSource.id || source.status !== prevSource.status) {
    setPrevSource(source);
    setCurrentSource(source);
  }

  useEffect(() => {
    if (currentSource.status === "processing" || currentSource.status === "pending") {
      fetchJobStatus(currentSource.id).then(setCurrentJob);
    }
  }, [currentSource.status, currentSource.id]);

  useEffect(() => {
    if (currentSource.status !== "processing" && currentSource.status !== "pending") return;

    const timer = setInterval(async () => {
      try {
        const job = await fetchJobStatus(currentSource.id);
        if (job) {
          setCurrentJob(job);
          if (job.status === "completed") {
            clearInterval(timer);
            const sourceRes = await fetch(`/api/library/sources/${currentSource.id}`);
            if (sourceRes.ok) {
              const updatedSource = await sourceRes.json();
              setCurrentSource(updatedSource);
              window.location.reload();
            }
          } else if (job.status === "failed") {
            clearInterval(timer);
            const sourceRes = await fetch(`/api/library/sources/${currentSource.id}`);
            if (sourceRes.ok) {
              const updatedSource = await sourceRes.json();
              setCurrentSource(updatedSource);
            }
          }
        }
      } catch (err) {
        console.error("Polling error:", err);
      }
    }, 2000);

    return () => clearInterval(timer);
  }, [currentSource.status, currentSource.id]);

  const handleProcessSource = async () => {
    try {
      await processSource(currentSource.id);
      setCurrentSource((prev) => ({ ...prev, status: "processing" }));
      const job = await fetchJobStatus(currentSource.id);
      if (job) setCurrentJob(job);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  const handleReprocessSource = useCallback(async () => {
    if (!confirm("Are you sure you want to re-process this source? This will regenerate the outline, table of contents, and summary. It runs in the background and takes 30-60 seconds.")) return;
    try {
      await processSource(currentSource.id);
      setCurrentSource((prev) => ({ ...prev, status: "processing" }));
      const job = await fetchJobStatus(currentSource.id);
      if (job) setCurrentJob(job);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  }, [currentSource.id]);

  return {
    currentSource,
    currentJob,
    handleProcessSource,
    handleReprocessSource,
  };
}
