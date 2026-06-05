import { getDb, backgroundJobs, books } from "../db/index.js";
import { eq, and, or, desc } from "drizzle-orm";
import { BookIngestionService } from "./book-ingestion.js";

export type JobStatus = "pending" | "processing" | "completed" | "failed";

export interface Job {
  id: string;
  bookId: string;
  status: JobStatus;
  progress: number;
  step: string;
  error?: string | null;
  createdAt: string;
  updatedAt: string;
}

export class JobQueueService {
  private static instance: JobQueueService | null = null;
  private isProcessing = false;
  private ingestionService: BookIngestionService;

  private constructor() {
    this.ingestionService = new BookIngestionService();
    // Automatically trigger resumption of orphaned jobs on startup
    this.resumeOrphanedJobs().catch((err) => {
      console.error("[job-queue] Failed to resume orphaned jobs:", err);
    });
  }

  static getInstance(): JobQueueService {
    if (!JobQueueService.instance) {
      JobQueueService.instance = new JobQueueService();
    }
    return JobQueueService.instance;
  }

  /**
   * Reset any jobs stuck in 'processing' back to 'pending' on startup (server crash recovery)
   */
  private async resumeOrphanedJobs(): Promise<void> {
    const db = getDb();
    const now = new Date().toISOString();

    const orphaned = db
      .select()
      .from(backgroundJobs)
      .where(eq(backgroundJobs.status, "processing"))
      .all();

    if (orphaned.length > 0) {
      console.log(`[job-queue] Found ${orphaned.length} processing jobs orphaned by server restart. Resetting to pending.`);
      for (const job of orphaned) {
        db.update(backgroundJobs)
          .set({ status: "pending", step: "queued", progress: 0, updatedAt: now })
          .where(eq(backgroundJobs.id, job.id))
          .run();
      }
      this.triggerQueue();
    }
  }

  /**
   * Create a new job in the queue
   */
  async createJob(bookId: string): Promise<Job> {
    const db = getDb();
    const jobId = `${bookId}-${Date.now()}`;
    const now = new Date().toISOString();

    const newJob = {
      id: jobId,
      bookId,
      status: "pending" as JobStatus,
      progress: 0,
      step: "queued",
      createdAt: now,
      updatedAt: now,
      error: null,
    };

    db.insert(backgroundJobs).values(newJob).run();
    console.log(`[job-queue] Job ${jobId} created for book ${bookId}`);

    // Trigger processing
    this.triggerQueue();

    return newJob;
  }

  /**
   * Update progress for a running job
   */
  updateProgress(jobId: string, step: string, progress: number): void {
    const db = getDb();
    const now = new Date().toISOString();

    db.update(backgroundJobs)
      .set({ step, progress, updatedAt: now })
      .where(eq(backgroundJobs.id, jobId))
      .run();

    console.log(`[job-queue] Job ${jobId} -> Step: ${step} (${progress}%)`);
  }

  /**
   * Retrieve a specific job by ID
   */
  getJob(jobId: string): Job | null {
    const db = getDb();
    const row = db.select().from(backgroundJobs).where(eq(backgroundJobs.id, jobId)).get();
    return (row as Job) || null;
  }

  /**
   * Retrieve the latest active or completed job for a book
   */
  getLatestJobForBook(bookId: string): Job | null {
    const db = getDb();
    const row = db
      .select()
      .from(backgroundJobs)
      .where(eq(backgroundJobs.bookId, bookId))
      .orderBy(desc(backgroundJobs.createdAt))
      .limit(1)
      .get();
    return (row as Job) || null;
  }

  /**
   * Retrieve all jobs, ordered by updatedAt desc
   */
  getAllJobs(limit: number = 20): Job[] {
    const db = getDb();
    const rows = db
      .select()
      .from(backgroundJobs)
      .orderBy(desc(backgroundJobs.updatedAt))
      .limit(limit)
      .all();
    return (rows as Job[]) || [];
  }

  /**
   * Trigger queue execution (non-blocking)
   */
  triggerQueue(): void {
    if (this.isProcessing) return;
    this.processNextJob().catch((err) => {
      console.error("[job-queue] Error in processNextJob:", err);
      this.isProcessing = false;
    });
  }

  private async processNextJob(): Promise<void> {
    const db = getDb();
    const now = () => new Date().toISOString();

    // Get first pending job
    const nextJob = db
      .select()
      .from(backgroundJobs)
      .where(eq(backgroundJobs.status, "pending"))
      .orderBy(backgroundJobs.createdAt)
      .limit(1)
      .get();

    if (!nextJob) {
      this.isProcessing = false;
      return;
    }

    this.isProcessing = true;
    const jobId = nextJob.id;
    const bookId = nextJob.bookId;

    try {
      // Mark job as processing
      db.update(backgroundJobs)
        .set({ status: "processing", step: "starting", progress: 5, updatedAt: now() })
        .where(eq(backgroundJobs.id, jobId))
        .run();

      // Trigger the actual book processing
      await this.ingestionService.processBookWithJob(bookId, jobId, this);

      // Mark job as completed
      db.update(backgroundJobs)
        .set({ status: "completed", step: "finished", progress: 100, updatedAt: now() })
        .where(eq(backgroundJobs.id, jobId))
        .run();

      console.log(`[job-queue] Job ${jobId} successfully completed!`);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[job-queue] Job ${jobId} failed:`, errorMsg);

      db.update(backgroundJobs)
        .set({ status: "failed", step: "failed", error: errorMsg, updatedAt: now() })
        .where(eq(backgroundJobs.id, jobId))
        .run();
    } finally {
      // Process next in queue
      this.isProcessing = false;
      this.triggerQueue();
    }
  }
}
