/**
 * The operator surface's one gate: `Authorization: Bearer <ADMIN_TOKEN>`, checked once before any
 * `/admin/*` route runs. Handlers never ask who is acting.
 */
import { Context, Effect, Layer } from "effect";

const digest = (text: string) =>
  Effect.promise(() => crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));

export class OperatorGate extends Context.Service<
  OperatorGate,
  { readonly allows: (authorization: string | undefined) => Effect.Effect<boolean> }
>()("design-order/OperatorGate") {}

/** An unset or empty token admits nobody. Both sides are hashed so the comparison is length-blind and leaks nothing about the token's own bytes. */
export const OperatorGateLive = (token: string | undefined): Layer.Layer<OperatorGate> =>
  Layer.succeed(OperatorGate, {
    allows: (authorization) =>
      Effect.gen(function* () {
        const expected = token?.trim() ?? "";
        const given = /^Bearer (.+)$/.exec(authorization ?? "")?.[1] ?? "";
        if (expected === "" || given === "") return false;
        const [a, b] = yield* Effect.all([digest(expected), digest(given)]);
        const x = new Uint8Array(a);
        const y = new Uint8Array(b);
        return x.reduce((diff, byte, i) => diff | (byte ^ y[i]!), 0) === 0;
      }),
  });
