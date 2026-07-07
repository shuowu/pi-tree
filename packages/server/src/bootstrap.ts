import { join, dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { app, mountSpaFallback } from "./app.js";
import { getMcpBridge } from "./services/mcp-bridge.js";
import { initAgentRegistry, getAgentRegistry } from "./services/agent-registry.js";
import { setExtensionServices } from "./agents/context.js";
import { getDb, sources, userSessions, users } from "./db/index.js";
import { SourceServiceImpl } from "./services/source-service.js";
import { SessionServiceImpl } from "./services/session-service.js";
import { UserServiceImpl } from "./services/user-service.js";
import { getJobQueue } from "./services/job-queue.js";
import { jobRoutes } from "./routes/jobs.js";
import { AgentTaskServiceImpl } from "./services/agent-task.js";
import { MemoService } from "./services/memo-service.js";
import { CursorServiceImpl } from "./services/cursor-service.js";
import { contentCursors } from "./db/schema.js";
import { DiscoverRegistry } from "./services/discover/registry.js";
import { RouterDestinationRegistry } from "./services/destination-registry.js";
import type { DiscoverProvider, RouterDestination } from "@pi-tree/plugin-sdk";

/**
 * Resolve core plugin directories by finding their installed package locations.
 * Each plugin is an npm workspace package — we resolve its `package.json` to get
 * the absolute directory path.
 */
function resolveCorePluginDirs(): string[] {
  const req = createRequire(import.meta.url);
  const pluginPackages = [
    "pi-tree-book",
    "pi-tree-news",
    "pi-tree-paper",
    "pi-tree-youtube",
    "pi-tree-mcp",
  ];
  return pluginPackages.flatMap((pkg) => {
    try {
      return [dirname(req.resolve(`${pkg}/package.json`))];
    } catch {
      return []; // Plugin not installed — skip silently
    }
  });
}

export interface BootstrapConfig {
  /** Data directory (sessions, DB, library, etc.) */
  dataPath: string;
  /** Directory containing profiles/ (skills are now bundled in extensions) — defaults to import.meta.dirname equivalent */
  coreDir?: string;
  /** Whether to skip RSS crawl scheduling (e.g. for testing) */
  skipRssCron?: boolean;
}

export interface BootstrapResult {
  /** The Hono app instance — use with serve() or app.fetch() */
  app: typeof app;
  /** Cleanup function — disconnects MCP, clears intervals */
  cleanup: () => Promise<void>;
}




export async function bootstrap(config: BootstrapConfig): Promise<BootstrapResult> {
  const { dataPath } = config;
  // Use provided coreDir or fall back — but the caller MUST provide it
  // since import.meta.dirname doesn't work across packages
  const coreDir = config.coreDir ?? import.meta.dirname;

  // Set DATA_PATH so other modules (config.ts, db, etc.) can read it
  process.env.DATA_PATH = dataPath;

  // Initialize MCP bridge — connects to external MCP servers if mcp.json exists.
  // This must happen before extension services are set, so extensions can access
  // discovered MCP tools during registration.
  const mcpBridge = getMcpBridge();
  const mcpConfigPath = join(dataPath, "mcp.json");
  await mcpBridge.connectAll(mcpConfigPath);

  // Create typed services — shared between extension DI and plugin routes
  const sourceService = new SourceServiceImpl(getDb, sources);
  const sessionService = new SessionServiceImpl(getDb, userSessions, users);
  const userService = new UserServiceImpl(getDb, users);
  const cursorService = new CursorServiceImpl(getDb, contentCursors);

  // Initialize job queue
  const jobQueue = getJobQueue();
  jobQueue.setSourceService(sourceService);

  // Agent task service — runs headless Pi sessions for plugins
  const agentTask = new AgentTaskServiceImpl();
  jobQueue.setPostProcessingServices(agentTask, dataPath);

  // Populate extension services — extensions access server capabilities through
  // this locator instead of importing server internals directly.
  setExtensionServices({
    // Typed service layer (preferred for extensions)
    sources: sourceService,
    sessions: sessionService,
    users: userService,
    // Lazy getter — initAgentRegistry() hasn't been called yet at this point.
    // Extensions only call getProfiles() at tool-execution time, not registration time,
    // so this is safe.
    registry: {
      getProfiles: () => {
        const reg = getAgentRegistry();
        const raw = reg.getProfiles();
        const mapped = new Map<string, { name: string; label: string; description?: string; sourceType?: string; skills: string[]; extensions: string[] }>();
        for (const [key, profile] of raw) {
          mapped.set(key, {
            name: key,
            label: profile.label,
            ...(profile.description ? { description: profile.description } : {}),
            ...(profile.sourceType ? { sourceType: profile.sourceType } : {}),
            skills: profile.skills,
            extensions: profile.extensions,
          });
        }
        return mapped;
      },
      getSourceTypes: () => {
        const reg = getAgentRegistry();
        return reg.getSourceTypes().map((st) => ({
          key: st.key,
          label: st.label,
          mentionKeyword: st.mentionKeyword,
          fixedSourceId: st.fixedSourceId,
          defaultMode: st.defaultMode,
          sessionModes: st.sessionModes,
          sessionStrategy: st.sessionStrategy,
          askAfterHours: st.askAfterHours,
          staleAfterHours: st.staleAfterHours,
          routingContextFile: st.routingContextFile,
          routingContextLabel: st.routingContextLabel,
        }));
      },
      resolveProfile: (sourceType: string, mode?: string, sessionContext?: any) => {
        const reg = getAgentRegistry();
        return reg.resolveProfile(sourceType, mode, sessionContext);
      },
    },
    config: {
      jinaApiKey: process.env.JINA_API_KEY,
    },
    getPluginDataDir: (pluginName: string) => {
      const dir = join(dataPath, "plugins", pluginName);
      mkdirSync(dir, { recursive: true });
      return dir;
    },
    getSourceDataDir: (sourceId: string) => {
      const dir = join(dataPath, "sources", sourceId);
      mkdirSync(dir, { recursive: true });
      return dir;
    },
    ...(mcpBridge.hasServers() ? { mcpBridge } : {}),
    dataPath,
    memos: MemoService.getInstance(),
    cursors: cursorService,
    // Raw DB access (backward compat, power users)
    db: getDb,
    schema: { sources, userSessions, users },
  });

  // Initialize the agent registry — discovers skills, extensions, and validates profiles.
  // Must happen after extension services are set.
  initAgentRegistry({
    coreDir,
    dataDir: dataPath,
    corePluginDirs: resolveCorePluginDirs(),
    skillsPath: process.env.SKILLS_PATH,
    extensionsPath: process.env.EXTENSIONS_PATH,
  });

  // Register built-in router destinations (features, not sources).
  RouterDestinationRegistry.getInstance().register({
    id: "discover",
    label: "Discover",
    description:
      "Recommends NEW books, papers, and feeds (not already in the library) based on the user's reading. Route here for suggestion/recommendation requests — 'suggest new books', 'what should I read next', 'any new papers in my area', 'feeds to follow', 'discover something new' — in any language.",
    url: "/discover?run=1",
    sourceTypeFilter: true,
  });

  // Mount plugin-registered routes
  const registry = getAgentRegistry();

  // Register source types that have concept extraction enabled
  for (const st of registry.getSourceTypes()) {
    if (st.concepts) {
      jobQueue.enableConcepts(st.key);
    }
  }
  const pluginRoutes = registry.getPluginRoutes();
  const pluginCleanups: (() => void)[] = [];

  for (const route of pluginRoutes) {
    try {
      const mod = await import(route.routesPath);
      const setupFn = mod.setup ?? mod.default;
      if (typeof setupFn === "function") {
        const result = setupFn({
          dataDir: join(dataPath, "plugins", route.name),
          dataPath,
          sources: sourceService,
          sessions: sessionService,
          users: userService,
          registry: {
            getProfiles: () => getAgentRegistry().getProfiles(),
            getSourceTypes: () => getAgentRegistry().getSourceTypes(),
            resolveProfile: (sourceType: string, mode?: string, sessionContext?: any) =>
              getAgentRegistry().resolveProfile(sourceType, mode, sessionContext),
          },
          config: { jinaApiKey: process.env.JINA_API_KEY },
          jobQueue,
          agentTask,
          discover: {
            registerProvider: (provider: DiscoverProvider) => DiscoverRegistry.getInstance().register(provider),
          },
          router: {
            registerDestination: (dest: RouterDestination) => RouterDestinationRegistry.getInstance().register(dest),
          },
        });
        const routes = result.routes ?? result;
        app.route(route.prefix, routes);
        if (result.cleanup) pluginCleanups.push(result.cleanup);
        console.log(`[bootstrap] Mounted plugin routes: ${route.name} → ${route.prefix}`);
      }
    } catch (err) {
      console.error(`[bootstrap] Failed to mount plugin routes for ${route.name}:`, err);
    }
  }

  // Mount job queue API routes
  app.route("/api/jobs", jobRoutes);

  // Mount SPA fallback AFTER all plugin routes — Hono matches in registration
  // order, so the wildcard must come last to avoid swallowing /api/news/* etc.
  await mountSpaFallback();

  // Cleanup function
  async function cleanup() {
    for (const fn of pluginCleanups) fn();
    await mcpBridge.disconnectAll();
  }

  return { app, cleanup };
}
