import { fileURLToPath } from "node:url";
import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig, type Plugin } from "vite-plus";

/** The Cloudflare plugin copies `.dev.vars` into the build for `vite preview`; release artifacts must not carry it. */
const withoutDevelopmentSecrets = (): Plugin => ({
  name: "sketch-wireframe-without-development-secrets",
  apply: "build",
  enforce: "post",
  generateBundle: {
    order: "post",
    handler(_options, bundle) {
      for (const name of Object.keys(bundle)) {
        if (/^\.(?:dev\.vars|env)(?:\.|$)/.test(name.split(/[\\/]/).at(-1) ?? ""))
          delete bundle[name];
      }
    },
  },
});

const dsl = fileURLToPath(new URL("./src/shared/dsl.ts", import.meta.url));

/**
 * The judgments of the code, in one list. `pre-push` and `verify` both run exactly these.
 * `build` is deliberately not a judgment: it reads what the list has already read.
 */
const JUDGMENTS = ["check:types", "check:lint", "test", "check:effect"] as const;

export default defineConfig({
  // Example configs (bundled into the Worker for get_example) import the DSL by its public name.
  resolve: { alias: { "sketch-wireframe": dsl } },
  fmt: { ignorePatterns: ["docs/**", "vendor/**", "migrations/**", "pnpm-lock.yaml"] },
  lint: {
    ignorePatterns: ["vendor/**", "scripts/**"],
    options: { typeAware: true, typeCheck: true },
    rules: { "no-var": "error", "typescript/no-explicit-any": "error" },
  },
  test: { include: ["src/**/*.test.ts"] },
  staged: { "*": "vp check --fix --no-error-on-unmatched-pattern" },
  run: {
    cache: { scripts: false },
    tasks: {
      dev: { command: "vp dev", cache: false },
      build: { command: "vp build", cache: false },
      "check:scripts": { command: "tsc --noEmit -p tsconfig.scripts.json", cache: false },
      "check:types": {
        command: [
          "tsc --noEmit -p src/web",
          "tsc --noEmit -p src/worker",
          "tsc --noEmit -p src/worker/test",
          "tsc --noEmit -p src/shared",
          "tsc --noEmit -p src/verify",
          "vp run check:scripts",
        ],
        cache: false,
      },
      "check:lint": { command: "vp lint", cache: false },
      test: { command: "vp test", cache: false },
      "check:effect": {
        command: "effect-scan . --strict --output gate-json --evidence data/effect-evidence",
        cache: false,
      },
      "db:migrate": { command: "node scripts/db-local.mjs migrate", cache: false },
      // Operator command, never part of the gate: needs the remote database's id and the operator's login.
      "db:migrate:remote": { command: "node scripts/db-remote.mjs", cache: false },
      // Operator command: drives a real Chrome against a running sketch (needs `vp dev` or a deployed URL).
      verify: { command: "node scripts/verify.ts", cache: false },
      // Operator command, never part of the gate (needs the operator's credential and the network): re-checks every
      // published sketch against this checkout, so a schema/validator/engine change cannot break a link a client holds.
      audit: { command: "node scripts/do.ts audit", cache: false },
      "pre-commit": { command: "vp staged", cache: false },
      "pre-push": { command: JUDGMENTS.map((task) => `vp run ${task}`), cache: false },
      ci: { dependsOn: [...JUDGMENTS], command: "vp build", cache: false },
      deploy: {
        command: [
          "vp run ci",
          "vp run audit",
          "vp run db:migrate:remote",
          "cf deploy --secrets-file data/prod-secrets.json",
        ],
        cache: false,
      },
    },
  },
  plugins: process.env.VITEST ? [] : [cloudflare(), withoutDevelopmentSecrets()],
});
