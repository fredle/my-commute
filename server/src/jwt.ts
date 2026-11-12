// ES256 JSON Web Tokens, as Apple wants for APNs and the Maps Server API.
import { createPrivateKey, sign, type KeyObject } from "node:crypto";

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

/** Accepts the .p8 file's contents, with or without real newlines (env vars often lose them). */
export function loadP8(pem: string): KeyObject {
  const text = pem.includes("\\n") ? pem.replace(/\\n/g, "\n") : pem;
  return createPrivateKey(text);
}

export function es256(header: Record<string, unknown>, payload: Record<string, unknown>, key: KeyObject): string {
  const body = `${base64url(JSON.stringify({ alg: "ES256", ...header }))}.${base64url(JSON.stringify(payload))}`;
  const signature = sign("sha256", Buffer.from(body), { key, dsaEncoding: "ieee-p1363" });
  return `${body}.${base64url(signature)}`;
}

/** A token that is reused until it is `maxAgeSeconds` old. */
export function cachedToken(make: () => string, maxAgeSeconds: number): () => string {
  let token = "";
  let made = 0;
  return () => {
    const now = Date.now();
    if (!token || now - made > maxAgeSeconds * 1000) {
      token = make();
      made = now;
    }
    return token;
  };
}
