import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { mkdirSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Mock BookIngestionService before importing anything that uses it
const mockProcessBookWithJob = vi.fn().mockResolvedValue(undefined);

vi.mock("../book-ingestion.js", () => {
  return {
    BookIngestionService: class {
      processBookWithJob = mockProcessBookWithJob;
    },
  };
});

const TEST_ROOT = mkdtempSync(join(tmpdir(), "job-queue-test-"));
vi.stubEnv("DATA_PATH", TEST_ROOT);

const { JobQueueService } = await import("../job-queue.js");
const { resetDb, getDb, backgroundJobs } = await import("../../db/index.js");

afterAll(() => {
  resetDb();
  vi.unstubAllEnvs();
  try {
    rmSync(TEST_ROOT, { recursive: true, force: true });
  } catch {}
});

function freshService() {
  // Reset the singleton so each test gets a clean instance
  (JobQueueService as any).instance = null;
  return JobQueueService.getInstance();
}

describe("JobQueueService", () => {
  beforeEach(() => {
    // Clear all jobs from DB between tests
    const db = getDb();
    db.delete(backgroundJobs).run();
    (JobQueueService as any).instance = null;
  });

  // 1. Singleton
  describe("getInstance", () => {
    it("returns the same instance on repeated calls", () => {
      const a = JobQueueService.getInstance();
      const b = JobQueueService.getInstance();
      expect(a).toBe(b);
    });

    it("returns a new instance after resetting", () => {
      const a = JobQueueService.getInstance();
      (JobQueueService as any).instance = null;
      const b = JobQueueService.getInstance();
      expect(a).not.toBe(b);
    });
  });

  // 2. createJob
  describe("createJob", () => {
    it("returns a job with pending status and correct sourceId", async () => {
      const svc = freshService();
      const job = await svc.createJob("src-1");

      expect(job.id).toContain("src-1");
      expect(job.sourceId).toBe("src-1");
      expect(job.status).toBe("pending");
      expect(job.progress).toBe(0);
      expect(job.step).toBe("queued");
      expect(job.createdAt).toBeTruthy();
      expect(job.updatedAt).toBeTruthy();
    });
  });

  // 3-4. getJob
  describe("getJob", () => {
    it("returns the job by ID", async () => {
      const svc = freshService();
      const created = await svc.createJob("src-get");
      const found = svc.getJob(created.id);

      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
      expect(found!.sourceId).toBe("src-get");
    });

    it("returns null for a missing ID", () => {
      const svc = freshService();
      expect(svc.getJob("nonexistent-id")).toBeNull();
    });
  });

  // 5-6. getLatestJobForSource (maps to the "getJobBySourceId" requirement)
  describe("getLatestJobForSource", () => {
    it("finds a job by sourceId", async () => {
      const svc = freshService();
      await svc.createJob("src-find");

      const found = svc.getLatestJobForSource("src-find");
      expect(found).not.toBeNull();
      expect(found!.sourceId).toBe("src-find");
    });

    it("returns null for an unknown sourceId", () => {
      const svc = freshService();
      expect(svc.getLatestJobForSource("no-such-source")).toBeNull();
    });
  });

  // 7. getAllJobs
  describe("getAllJobs", () => {
    it("returns all created jobs", async () => {
      const svc = freshService();
      await svc.createJob("src-a");
      await svc.createJob("src-b");

      const all = svc.getAllJobs();
      expect(all).toHaveLength(2);
      const sourceIds = all.map((j: any) => j.sourceId).sort();
      expect(sourceIds).toEqual(["src-a", "src-b"]);
    });

    it("returns empty array when no jobs exist", () => {
      const svc = freshService();
      expect(svc.getAllJobs()).toHaveLength(0);
    });
  });

  // 8. updateProgress
  describe("updateProgress", () => {
    it("updates step and progress percentage", async () => {
      const svc = freshService();
      const job = await svc.createJob("src-progress");

      svc.updateProgress(job.id, "parsing", 42);

      const updated = svc.getJob(job.id)!;
      expect(updated.step).toBe("parsing");
      expect(updated.progress).toBe(42);
    });
  });

  // 9. completeJob — simulate via DB update (the processNextJob flow does this)
  describe("job completion via processNextJob", () => {
    it("completes a job (status completed after processing)", async () => {
      const svc = freshService();
      const job = await svc.createJob("src-complete");

      // Give the async triggerQueue a tick to process
      await vi.waitFor(() => {
        const j = svc.getJob(job.id)!;
        expect(j.status).toBe("completed");
      }, { timeout: 2000 });

      const completed = svc.getJob(job.id)!;
      expect(completed.status).toBe("completed");
      expect(completed.step).toBe("finished");
      expect(completed.progress).toBe(100);
    });
  });

  // 10. failJob — make the mock throw to trigger failure path
  describe("job failure via processNextJob", () => {
    it("sets status to failed with error message when processing throws", async () => {
      mockProcessBookWithJob.mockRejectedValueOnce(new Error("parse error"));

      const svc = freshService();
      const job = await svc.createJob("src-fail");

      await vi.waitFor(() => {
        const j = svc.getJob(job.id)!;
        expect(j.status).toBe("failed");
      }, { timeout: 2000 });

      const failed = svc.getJob(job.id)!;
      expect(failed.status).toBe("failed");
      expect(failed.error).toBe("parse error");
    });
  });

  // 11. cancelJob — there's no cancelJob method, so we test that
  // manually updating status works through the DB directly,
  // verifying the Job interface supports it.
  describe("job cancellation (manual status update)", () => {
    it("can mark a job as cancelled via direct DB update", async () => {
      const svc = freshService();
      const job = await svc.createJob("src-cancel");

      // Wait for processing to complete first
      await vi.waitFor(() => {
        const j = svc.getJob(job.id)!;
        expect(["completed", "failed", "pending"]).toContain(j.status);
      }, { timeout: 2000 });

      // Simulate cancellation via DB (no dedicated cancelJob method exists)
      const { eq } = await import("drizzle-orm");
      const db = getDb();
      db.update(backgroundJobs)
        .set({ status: "cancelled" as any, step: "cancelled", updatedAt: new Date().toISOString() })
        .where(eq(backgroundJobs.id, job.id))
        .run();

      const cancelled = svc.getJob(job.id)!;
      expect(cancelled.status).toBe("cancelled");
      expect(cancelled.step).toBe("cancelled");
    });
  });
});
