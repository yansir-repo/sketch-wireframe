/**
 * Cloudflare Access, checked again inside the Worker. Access already gates the hostname at the
 * edge; this verifies the `Cf-Access-Jwt-Assertion` it forwards, so a request that reaches the Worker
 * some other way (a preview URL, a misconfigured route) cannot read the operator pages.
 */
import { Clock, Context, Data, Effect, Layer, Option, Ref, Schema } from "effect";

export class AccessDenied extends Data.TaggedError("AccessDenied")<{ readonly reason: string }> {}

export type AccessConfig = {
  /** e.g. `nosunthx.cloudflareaccess.com` */
  readonly teamDomain: string;
  /** The Access application's audience tag. */
  readonly audience: string;
};

export class AccessVerifier extends Context.Service<
  AccessVerifier,
  {
    /**
     * A person's email, or a service token's Client ID (`common_name`) when the request came in with
     * a Cloudflare Access service token — that token has an empty `sub` and no `email`, which is what
     * makes it usable by a machine (the upload CLI, a health poll) with no browser session.
     */
    readonly verify: (
      token: string,
    ) => Effect.Effect<{ readonly email: string; readonly service: string }, AccessDenied>;
  }
>()("sketch-wireframe/AccessVerifier") {}

const Jwk = Schema.Struct({
  kid: Schema.String,
  kty: Schema.String,
  n: Schema.String,
  e: Schema.String,
});
const Certs = Schema.Struct({ keys: Schema.Array(Jwk) });
const Header = Schema.Struct({ kid: Schema.String, alg: Schema.Literal("RS256") });
const Claims = Schema.Struct({
  aud: Schema.Union([Schema.String, Schema.Array(Schema.String)]),
  iss: Schema.String,
  exp: Schema.Number,
  email: Schema.optionalKey(Schema.String),
  common_name: Schema.optionalKey(Schema.String),
});

const decodeCerts = Schema.decodeUnknownOption(Certs);
const decodeHeader = Schema.decodeUnknownOption(Schema.fromJsonString(Header));
const decodeClaims = Schema.decodeUnknownOption(Schema.fromJsonString(Claims));

const base64UrlBytes = (part: string): Uint8Array<ArrayBuffer> => {
  const b64 = part.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (part.length % 4)) % 4);
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
};
const base64UrlText = (part: string) => new TextDecoder().decode(base64UrlBytes(part));

const CERT_TTL_MS = 60 * 60 * 1000;

/**
 * Certificates outlive a request: the Worker builds its services per request (see index.ts), so the
 * cache sits at module level. It holds plain data, never a pending promise, so sharing it across
 * concurrent requests is safe.
 */
const certCache = Ref.makeUnsafe<{ keys: ReadonlyArray<typeof Jwk.Type>; at: number } | null>(null);
const deny = (reason: string) => Effect.fail(new AccessDenied({ reason }));

export const AccessVerifierLive = (config: AccessConfig): Layer.Layer<AccessVerifier> =>
  Layer.sync(AccessVerifier, () => {
    const cache = certCache;

    const keys = (refresh: boolean) =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        const cached = yield* Ref.get(cache);
        if (cached && !refresh && now - cached.at < CERT_TTL_MS) return cached.keys;
        const body = yield* Effect.tryPromise({
          try: () =>
            fetch(`https://${config.teamDomain}/cdn-cgi/access/certs`).then(
              (r) => r.json() as Promise<unknown>,
            ),
          catch: () => new AccessDenied({ reason: "Access 证书获取失败" }),
        });
        const certs = decodeCerts(body);
        if (Option.isNone(certs)) return yield* deny("Access 证书格式无法识别");
        yield* Ref.set(cache, { keys: certs.value.keys, at: now });
        return certs.value.keys;
      });

    const verify = (token: string) =>
      Effect.gen(function* () {
        const [h, p, s] = token.split(".");
        if (!h || !p || !s) return yield* deny("JWT 格式错误");
        const header = decodeHeader(base64UrlText(h));
        const claims = decodeClaims(base64UrlText(p));
        if (Option.isNone(header) || Option.isNone(claims)) return yield* deny("JWT 内容无法解析");
        const c = claims.value;
        const audiences = typeof c.aud === "string" ? [c.aud] : c.aud;
        if (!audiences.includes(config.audience)) return yield* deny("JWT 不属于本应用");
        if (c.iss !== `https://${config.teamDomain}`) return yield* deny("JWT 签发方不符");
        if (c.exp * 1000 <= (yield* Clock.currentTimeMillis)) return yield* deny("JWT 已过期");
        // A key rotation shows up as an unknown kid: refresh the certs once before giving up.
        let jwk = (yield* keys(false)).find((k) => k.kid === header.value.kid);
        if (!jwk) jwk = (yield* keys(true)).find((k) => k.kid === header.value.kid);
        if (!jwk) return yield* deny("JWT 签名密钥未知");
        const key = jwk;
        const valid = yield* Effect.tryPromise({
          try: () =>
            crypto.subtle
              .importKey(
                "jwk",
                { kty: key.kty, n: key.n, e: key.e },
                { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
                false,
                ["verify"],
              )
              .then((k) =>
                crypto.subtle.verify(
                  "RSASSA-PKCS1-v1_5",
                  k,
                  base64UrlBytes(s),
                  new TextEncoder().encode(`${h}.${p}`),
                ),
              ),
          catch: () => new AccessDenied({ reason: "JWT 签名校验出错" }),
        });
        if (!valid) return yield* deny("JWT 签名无效");
        return { email: c.email ?? "", service: c.common_name ?? "" };
      });

    return { verify };
  });
