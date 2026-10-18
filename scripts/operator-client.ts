/**
 * The operator token from a terminal, used by `do.ts`: `ADMIN_TOKEN` from the
 * environment first, then `.dev.vars` (gitignored). It is sent as `Authorization: Bearer`.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);

const devVar = (name: string): string => {
  if (process.env[name]) return process.env[name]!;
  const file = path.join(root, ".dev.vars");
  if (!existsSync(file)) return "";
  const line = readFileSync(file, "utf8")
    .split("\n")
    .find((l) => l.startsWith(`${name}=`));
  return line
    ? line
        .slice(name.length + 1)
        .replace(/^["']|["']$/g, "")
        .trim()
    : "";
};

/** Headers for the operator surface; exits with a usage error when there is no token. */
export const operatorHeaders = (): Record<string, string> => {
  const token = devVar("ADMIN_TOKEN");
  if (token) return { authorization: `Bearer ${token}` };
  console.error("ADMIN_TOKEN is not set (environment or .dev.vars).");
  process.exit(2);
};
