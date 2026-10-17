/**
 * Who is making this request, for the operator surface (`/admin/rpc`, `/mcp`). Cloudflare Access has
 * already gated the path at the edge; this reads the identity out of the JWT it forwards (verified again
 * in the Worker, see access.ts) so every operator action can say who did it.
 *
 * Two kinds of actor: a **person** (their Access email) and a **service token** (a machine credential:
 * no email, `common_name` = the token's Client ID). `cf dev` on localhost has no Access; there the actor
 * is `DEV_USER_EMAIL`, or nobody.
 */
import { Context, Effect, Layer } from "effect";
import { AccessVerifier } from "./access.ts";

export const isLocalHost = (host: string) => /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);

export type Actor =
  | { readonly kind: "person"; readonly email: string }
  | { readonly kind: "service"; readonly name: string };

/** How an actor is recorded: an email, or `service:<client id>`. */
export const actorLabel = (actor: Actor): string =>
  actor.kind === "person" ? actor.email : `service:${actor.name}`;

export class LocalUser extends Context.Service<LocalUser, { readonly email: string | null }>()(
  "sketch-wireframe/LocalUser",
) {}

/** `DEV_USER_EMAIL` is a declared secret, so production sets it to `none`; only an email counts. */
export const LocalUserLive = (email: string | undefined) => {
  const value = email?.trim().toLowerCase() ?? "";
  return Layer.succeed(LocalUser, { email: value.includes("@") ? value : null });
};

/** The actor behind this request, or null when there is no valid credential. */
export const currentActor = (headers: Readonly<Record<string, string | undefined>>) =>
  Effect.gen(function* () {
    if (isLocalHost(headers["host"] ?? "")) {
      const email = (yield* LocalUser).email;
      return email ? ({ kind: "person", email } as const) : null;
    }
    const token = headers["cf-access-jwt-assertion"];
    if (!token) return null;
    const verifier = yield* AccessVerifier;
    return yield* verifier.verify(token).pipe(
      Effect.map(({ email, service }): Actor | null => {
        const person = email.trim().toLowerCase();
        if (person) return { kind: "person", email: person };
        return service ? { kind: "service", name: service } : null;
      }),
      Effect.catchTag("AccessDenied", () => Effect.succeed(null)),
    );
  });
