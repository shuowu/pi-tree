import type { SourceService, AgentTaskService } from "@pi-tree/plugin-sdk";
import { join } from "node:path";
import { existsSync, readdirSync, readFileSync, unlinkSync } from "node:fs";

export interface ProcessOptions {
  /** When true, redo all phases from scratch (delete cached outputs). Default: false (incremental). */
  force?: boolean;
}

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
  options?: ProcessOptions,
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
  private agentTask: AgentTaskService | null = null;
  private dataPath: string | null = null;
  private conceptsEnabledTypes = new Set<string>();

  /** Called once at bootstrap to inject the source service */
  setSourceService(sources: SourceService): void {
    this.sourcesService = sources;
  }

  /** Called once at bootstrap to inject services needed for post-processing */
  setPostProcessingServices(agentTask: AgentTaskService, dataPath: string): void {
    this.agentTask = agentTask;
    this.dataPath = dataPath;
  }

  /** Register source types that have concept extraction enabled */
  enableConcepts(sourceType: string): void {
    this.conceptsEnabledTypes.add(sourceType);
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
  async enqueue(sourceId: string, options?: ProcessOptions): Promise<Job | null> {
    // Don't enqueue if already in progress
    const existing = this.jobs.get(sourceId);
    if (existing && (existing.status === "pending" || existing.status === "processing")) {
      return existing;
    }

    const source = await this.sourcesService?.get(sourceId);
    if (!source) return null;

    const processor = this.processors.get(source.type);
    const conceptsOnly = !processor && this.conceptsEnabledTypes.has(source.type);
    if (!processor && !conceptsOnly) return null;

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
    if (processor) {
      this.runJob(job, processor, source.type, options);
    } else {
      this.runConceptOnlyJob(job, source.type, options);
    }
    return job;
  }

  private async runJob(job: Job, processor: SourceProcessor, sourceType: string, options?: ProcessOptions): Promise<void> {
    job.status = "processing";
    job.step = "processing";
    job.progress = 10;
    try {
      await processor(job.sourceId, (step, progress) => {
        job.step = step;
        // Cap plugin progress at 85 to leave room for post-processing
        job.progress = Math.min(progress, 85);
      }, options);

      // --- Post-processing: concept extraction ---
      if (this.conceptsEnabledTypes.has(sourceType)) {
        await this.runConceptExtraction(job, sourceType, options);
      }

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

  /** Run concept extraction without a processor (for YouTube, Paper, etc.) */
  private async runConceptOnlyJob(job: Job, sourceType: string, options?: ProcessOptions): Promise<void> {
    job.status = "processing";
    job.step = "extracting concepts";
    job.progress = 10;
    try {
      await this.runConceptExtraction(job, sourceType, options);
      job.status = "completed";
      job.step = "done";
      job.progress = 100;
      job.completedAt = new Date().toISOString();
      console.log(`[job-queue] Completed concept extraction: ${job.sourceId}`);
    } catch (err) {
      job.status = "failed";
      job.step = "error";
      job.error = err instanceof Error ? err.message : String(err);
      job.completedAt = new Date().toISOString();
      console.error(`[job-queue] Failed concept extraction: ${job.sourceId}`, err);
    }
  }

  /**
   * Generic concept extraction — runs after any processor if the source type
   * has `concepts: true` in its manifest.
   */
  private async runConceptExtraction(job: Job, sourceType: string, options?: ProcessOptions): Promise<void> {
    if (!this.agentTask || !this.dataPath) return;

    const sourceId = job.sourceId;
    const sourceDir = join(this.dataPath, "sources", sourceId);
    const conceptsPath = join(sourceDir, "analysis", "concepts.json");
    const force = options?.force ?? false;

    // Delete existing concepts.json if force reprocessing
    if (force && existsSync(conceptsPath)) {
      try { unlinkSync(conceptsPath); } catch { /* ignore */ }
    }

    // Skip if concepts.json already exists
    if (existsSync(conceptsPath)) return;

    // Build source-type-aware content instructions
    const contentInstructions = this.buildExtractionInstructions(sourceId, sourceDir, sourceType);
    if (!contentInstructions) return;

    job.step = "extracting concepts";
    job.progress = 90;

    try {
      // Collect existing concept terms from other sources for normalization
      const existingConceptsBlock = this.collectExistingConcepts(sourceId);

      await this.agentTask.run({
        sourceId,
        mode: "concept-extraction",
        message: [
          `Extract key concepts and relations from this source.`,
          ``,
          contentInstructions,
          ``,
          `Then write the extracted concepts to ${sourceId}/analysis/concepts.json`,
          `Output ONLY valid JSON — no markdown fences, no commentary.`,
          existingConceptsBlock,
        ].join("\n"),
      });
    } catch (err) {
      // Concept extraction failure is non-fatal
      console.error(`[job-queue] Concept extraction failed for ${sourceId}, source is still usable:`, err);
    }
  }

  /** Build extraction instructions based on available content per source type */
  private buildExtractionInstructions(sourceId: string, sourceDir: string, sourceType: string): string | null {
    const outlinePath = join(sourceDir, "analysis", "outline.md");
    const summaryPath = join(sourceDir, "analysis", "summary.md");

    // Prefer outline/summary if they exist (books)
    if (existsSync(outlinePath) || existsSync(summaryPath)) {
      return [
        `Read these files:`,
        existsSync(outlinePath) ? `- ${sourceId}/analysis/outline.md` : null,
        existsSync(summaryPath) ? `- ${sourceId}/analysis/summary.md` : null,
      ].filter(Boolean).join("\n");
    }

    // YouTube: use transcript
    if (sourceType === "youtube") {
      const transcriptPath = join(sourceDir, "transcript.json");
      if (!existsSync(transcriptPath)) return null;
      return [
        `This is a YouTube video. Use the get_youtube_transcript tool with source_id "${sourceId}" to read the transcript.`,
        `Extract concepts from the video content.`,
      ].join("\n");
    }

    // Paper: use paper tools
    if (sourceType === "paper") {
      return [
        `This is an academic paper. Use the read_paper tool with source_id "${sourceId}" to read the paper content.`,
        `If that fails, use get_paper_info to at least get the abstract.`,
        `Extract concepts from the paper content.`,
      ].join("\n");
    }

    // Unknown type without outline/summary — skip
    return null;
  }

  /** Collect existing concept terms from other sources for normalization */
  private collectExistingConcepts(sourceId: string): string {
    if (!this.dataPath) return "";
    const sourcesDir = join(this.dataPath, "sources");
    if (!existsSync(sourcesDir)) return "";

    const existingTerms: string[] = [];
    for (const dir of readdirSync(sourcesDir, { withFileTypes: true })) {
      if (!dir.isDirectory() || dir.name === sourceId) continue;
      const otherConceptsPath = join(sourcesDir, dir.name, "analysis", "concepts.json");
      if (!existsSync(otherConceptsPath)) continue;
      try {
        const data = JSON.parse(readFileSync(otherConceptsPath, "utf-8"));
        if (Array.isArray(data.concepts)) {
          for (const c of data.concepts) {
            if (c.term && !existingTerms.includes(c.term)) {
              existingTerms.push(c.term);
            }
          }
        }
      } catch {
        // Skip malformed concepts.json files
      }
    }

    if (existingTerms.length === 0) return "";
    return [
      ``,
      `EXISTING CONCEPTS in the library (reuse these exact terms when they match):`,
      ...existingTerms.map((t) => `- ${t}`),
    ].join("\n");
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
