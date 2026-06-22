import { createRequire } from "node:module";

const req = createRequire(import.meta.url);
const rootPkg = req("../../../package.json");

/** Version string read from the root package.json. */
export const VERSION: string = rootPkg.version ?? "0.0.0";
