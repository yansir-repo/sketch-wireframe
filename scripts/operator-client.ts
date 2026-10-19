/**
 * The operator token from a terminal (used by `do.ts`): `ADMIN_TOKEN` from the environment first, then the
 * `.dev.vars` of the **current directory** (a client project's repo keeps its own copy), then this repo's own
 * `.dev.vars` (gitignored). It is sent as `Authorization: Bearer`.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);

const devVar = (name: string): string => {
  if (process.env[name]) return process.env[name]!;
  for (const dir of [process.cwd(), root]) {
    const file = path.join(dir, ".dev.vars");
    if (!existsSync(file)) continue;
    const line = readFileSync(file, "utf8")
      .split("\n")
      .find((l) => l.startsWith(`${name}=`));
    if (line)
      return line
        .slice(name.length + 1)
        .replace(/^["']|["']$/g, "")
        .trim();
  }
  return "";
};

/** Headers for the operator surface; exits with a usage error when there is no token. */
export const operatorHeaders = (): Record<string, string> => {
  const token = devVar("ADMIN_TOKEN");
  if (token) return { authorization: `Bearer ${token}` };
  console.error("ADMIN_TOKEN is not set (environment, ./.dev.vars or this repo's .dev.vars).");
  process.exit(2);
};
