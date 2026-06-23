import type { SourceService } from "@pi-tree/plugin-sdk";

export interface Job {
  id: string;
  sourceId: string;
  sourceTitle: string;
  sourceAuthor: string;
  status: "pending" | "processing" | "completed" | "failed";
  progress: number;
  step: string;
  error?: string | null;
  createdAt: string;
  completedAt?: string;
}

export type SourceProcessor = (
  sourceId: string,
  onProgress?: (step: string, progress: number) => void,
) => Promise<void>;

let instance: JobQueue | null = null;

export function getJobQueue(): JobQueue {
  if (!instance) instance = new JobQueue();
  return instance;
}

export class JobQueue {
  private jobs = new Map<string, Job>();
  private processors = new Map<string, SourceProcessor>();
  private sourcesService: SourceService | null = null;

  /** Called once at bootstrap to inject the source service */
  setSourceService(sources: SourceService): void {
    this.sourcesService = sources;
  }

  /** Plugins call this to register a processor for a source type */
  registerProcessor(sourceType: string, processor: SourceProcessor): void {
    this.processors.set(sourceType, processor);
    console.log(`[job-queue] Registered processor for "${sourceType}"`);
  }

  /** Check if a processor exists for a source type */
  hasProcessor(sourceType: string): boolean {
    return this.processors.has(sourceType);
  }

  /** Enqueue processing for a source. Returns the job immediately, runs async. */
  enqueue(sourceId: string): Job | null {
    // Don't enqueue if already in progress
    const existing = this.jobs.get(sourceId);
    if (existing && (existing.status === "pending" || existing.status === "processing")) {
      return existing;
    }

    const source = this.sourcesService?.get(sourceId);
    if (!source) return null;

    const processor = this.processors.get(source.type);
    if (!processor) return null;

    const job: Job = {
      id: `job-${Date.now()}-${sourceId}`,
      sourceId,
      sourceTitle: source.title,
      sourceAuthor: source.author,
      status: "pending",
      progress: 0,
      step: "queued",
      createdAt: new Date().toISOString(),
    };
    this.jobs.set(sourceId, job);

    // Run async — don't await
    this.runJob(job, processor);
    return job;
  }

  private async runJob(job: Job, processor: SourceProcessor): Promise<void> {
    job.status = "processing";
    job.step = "processing";
    job.progress = 10;
    try {
      await processor(job.sourceId, (step, progress) => {
        job.step = step;
        job.progress = progress;
      });
      job.status = "completed";
      job.step = "done";
      job.progress = 100;
      job.completedAt = new Date().toISOString();
      console.log(`[job-queue] Completed: ${job.sourceId}`);
    } catch (err) {
      job.status = "failed";
      job.step = "error";
      job.error = err instanceof Error ? err.message : String(err);
      job.completedAt = new Date().toISOString();
      console.error(`[job-queue] Failed: ${job.sourceId}`, err);
    }
  }

  getJob(sourceId: string): Job | null {
    return this.jobs.get(sourceId) ?? null;
  }

  getAllJobs(): Job[] {
    return Array.from(this.jobs.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }
}
