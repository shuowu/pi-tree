import { Hono } from "hono";
import { getJobQueue } from "../services/job-queue.js";

const jobs = new Hono();

/** GET /api/jobs — list all jobs (most recent first) */
jobs.get("/", (c) => {
  const queue = getJobQueue();
  return c.json({ jobs: queue.getAllJobs() });
});

/** GET /api/jobs/:sourceId — get job status for a source */
jobs.get("/:sourceId", (c) => {
  const queue = getJobQueue();
  const job = queue.getJob(c.req.param("sourceId"));
  if (!job) return c.json(null);
  return c.json(job);
});

/** POST /api/jobs/:sourceId/process — manually trigger processing
 *  ?force=true  → hard reprocess (redo all phases from scratch)
 *  default      → incremental (only run phases with missing output)
 */
jobs.post("/:sourceId/process", (c) => {
  const queue = getJobQueue();
  const force = c.req.query("force") === "true";
  const job = queue.enqueue(c.req.param("sourceId"), { force });
  if (!job) return c.json({ error: "No processor available for this source type" }, 400);
  return c.json(job);
});

export { jobs as jobRoutes };
