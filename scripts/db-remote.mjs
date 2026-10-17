#!/usr/bin/env node
/**
 * Apply migrations to the remote D1 (operator command; the database id is the one in cloudflare.config.ts).
 *
 * Retries on an API error: the Cloudflare API intermittently answers this call with "403 … not authorized to
 * access this service" (seen twice on otherwise valid credentials; the next call succeeds). A migration that was
 * really refused fails every attempt and still fails the deploy. Remove the retry when `cf d1 migrations apply`
 * stops doing this.
 */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const id = /DB: bindings\.d1\(\{[^}]*id: "([0-9a-f-]{36})"/.exec(
  readFileSync(new URL("../cloudflare.config.ts", import.meta.url), "utf8"),
)?.[1];
if (!id) {
  console.error("db-remote: no D1 id in cloudflare.config.ts");
  process.exit(1);
}

const ATTEMPTS = 3;
for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
  const r = spawnSync("cf", ["d1", "migrations", "apply", id], { encoding: "utf8" });
  process.stdout.write(r.stdout ?? "");
  process.stderr.write(r.stderr ?? "");
  if (r.status === 0) process.exit(0);
  const transient = /APIError/.test(`${r.stdout}${r.stderr}`);
  if (!transient || attempt === ATTEMPTS) process.exit(r.status ?? 1);
  console.error(`db-remote: API error, retrying (${attempt}/${ATTEMPTS - 1})…`);
  await new Promise((done) => setTimeout(done, 4000 * attempt));
}
