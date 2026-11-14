import 'server-only';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Health files: encryption and storage (Plans/Health-Forms.md, tech-lead review 2026-11-12). Server only.
 *
 * Every file is encrypted here before it leaves the site, so the storage zone only ever holds ciphertext:
 *   - a fresh 32-byte data key per file encrypts the bytes (AES-256-GCM);
 *   - the data key is wrapped with the master key (AES-256-GCM) and kept on the document's row;
 *   - the object's name is the AAD of both, so ciphertext moved under another name fails to open.
 * Decrypt buffers and verifies the tag before returning a byte (files are small; a streaming decrypt would release
 * unauthenticated plaintext).
 *
 * Storage is a private Bunny zone with NO pull zone (no public URL exists). Nothing here is shared with
 * lib/bunny-storage.ts, whose zone is public. In production a missing key or zone throws on first use; the
 * in-memory adapter and the development key exist only outside production.
 *
 * Env: HEALTH_FILES_KEYS ("1:<base64 32 bytes>,2:…", the highest version encrypts), HEALTH_BUNNY_ZONE,
 * HEALTH_BUNNY_PASSWORD (the zone's password), HEALTH_BUNNY_HOST (e.g. ny.storage.bunnycdn.com).
 */

const isProduction = () => process.env.NODE_ENV === 'production';

/** Not a secret: local development and tests only, refused in production. */
const DEV_KEY = Buffer.alloc(32, 7);

export function parseKeyring(raw: string | undefined): Map<number, Buffer> {
  const ring = new Map<number, Buffer>();
  for (const part of (raw ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
    const at = part.indexOf(':');
    const version = Number(part.slice(0, at));
    const key = Buffer.from(part.slice(at + 1), 'base64');
    if (at < 1 || !Number.isInteger(version) || version < 1 || key.length !== 32) throw new Error('HEALTH_FILES_KEYS is malformed: expected "1:<base64 of 32 bytes>".');
    ring.set(version, key);
  }
  return ring;
}

function keyring(): Map<number, Buffer> {
  const ring = parseKeyring(process.env.HEALTH_FILES_KEYS);
  if (ring.size === 0) {
    // The development key only ever protects the in-memory store: with a real zone configured a real key is required.
    if (isProduction() || bunnyConfig()) throw new Error('HEALTH_FILES_KEYS is not set: health files cannot be read or written.');
    ring.set(1, DEV_KEY);
  }
  for (const key of ring.values()) if ((isProduction() || bunnyConfig()) && key.equals(DEV_KEY)) throw new Error('HEALTH_FILES_KEYS holds the development key.');
  return ring;
}

/** Uploads are switched on: always outside production, and in production only with the key and the zone set. */
export function healthFilesConfigured(): boolean {
  if (!isProduction()) return true;
  try {
    return parseKeyring(process.env.HEALTH_FILES_KEYS).size > 0 && !!bunnyConfig();
  } catch {
    return false;
  }
}

export interface SealedFile {
  /** What goes to storage: version byte, 12-byte IV, 16-byte tag, ciphertext. */
  blob: Buffer;
  keyVersion: number;
  /** base64 of IV | tag | wrapped data key: kept on the row. */
  wrappedKey: string;
}

const BLOB_VERSION = 1;

export function sealHealthFile(objectPath: string, plain: Uint8Array, ring: Map<number, Buffer> = keyring()): SealedFile {
  const keyVersion = Math.max(...ring.keys());
  const master = ring.get(keyVersion)!;
  const aad = Buffer.from(objectPath, 'utf8');
  const dataKey = randomBytes(32);

  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', dataKey, iv);
  c.setAAD(aad);
  const body = Buffer.concat([c.update(plain), c.final()]);
  const blob = Buffer.concat([Buffer.from([BLOB_VERSION]), iv, c.getAuthTag(), body]);

  const wiv = randomBytes(12);
  const w = createCipheriv('aes-256-gcm', master, wiv);
  w.setAAD(aad);
  const wrapped = Buffer.concat([w.update(dataKey), w.final()]);
  return { blob, keyVersion, wrappedKey: Buffer.concat([wiv, w.getAuthTag(), wrapped]).toString('base64') };
}

/** Opens a sealed file. Throws on any mismatch (wrong key, wrong name, a changed byte): never a partial file. */
export function openHealthFile(objectPath: string, blob: Uint8Array, keyVersion: number, wrappedKey: string, ring: Map<number, Buffer> = keyring()): Buffer {
  const master = ring.get(keyVersion);
  if (!master) throw new Error(`No health-file key version ${keyVersion}.`);
  const aad = Buffer.from(objectPath, 'utf8');
  const wk = Buffer.from(wrappedKey, 'base64');
  const b = Buffer.from(blob);
  if (wk.length !== 12 + 16 + 32 || b.length < 1 + 12 + 16 || b[0] !== BLOB_VERSION) throw new Error('Health file is damaged.');

  const w = createDecipheriv('aes-256-gcm', master, wk.subarray(0, 12));
  w.setAAD(aad);
  w.setAuthTag(wk.subarray(12, 28));
  const dataKey = Buffer.concat([w.update(wk.subarray(28)), w.final()]);

  const d = createDecipheriv('aes-256-gcm', dataKey, b.subarray(1, 13));
  d.setAAD(aad);
  d.setAuthTag(b.subarray(13, 29));
  return Buffer.concat([d.update(b.subarray(29)), d.final()]);
}

export interface HealthStorage {
  put(path: string, blob: Uint8Array): Promise<void>;
  /** null when the object does not exist. */
  get(path: string): Promise<Buffer | null>;
  /** A missing object is a success. */
  delete(path: string): Promise<void>;
}

function bunnyConfig(): { zone: string; password: string; host: string } | null {
  const zone = (process.env.HEALTH_BUNNY_ZONE ?? '').trim();
  const password = (process.env.HEALTH_BUNNY_PASSWORD ?? '').trim();
  const host = (process.env.HEALTH_BUNNY_HOST ?? '').trim();
  return zone && password && host ? { zone, password, host } : null;
}

function bunnyStorage(cfg: { zone: string; password: string; host: string }): HealthStorage {
  const url = (path: string) => `https://${cfg.host}/${cfg.zone}/${encodeURIComponent(path)}`;
  const headers = { AccessKey: cfg.password };
  // The zone password never follows a redirect, and a stalled storage call never holds a request open.
  const fetch = (input: string, init: RequestInit) => globalThis.fetch(input, { ...init, redirect: 'error', signal: AbortSignal.timeout(20_000) });
  return {
    async put(path, blob) {
      const res = await fetch(url(path), { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/octet-stream' }, body: Buffer.from(blob), cache: 'no-store' });
      if (!res.ok) throw new Error(`Health storage refused the upload (${res.status}).`);
    },
    async get(path) {
      const res = await fetch(url(path), { headers, cache: 'no-store' });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`Health storage refused the read (${res.status}).`);
      return Buffer.from(await res.arrayBuffer());
    },
    async delete(path) {
      const res = await fetch(url(path), { method: 'DELETE', headers, cache: 'no-store' });
      if (!res.ok && res.status !== 404) throw new Error(`Health storage refused the delete (${res.status}).`);
    }
  };
}

/** Development and tests: files live in this process and are gone when it restarts. */
export function memoryHealthStorage(store: Map<string, Buffer> = new Map()): HealthStorage & { store: Map<string, Buffer> } {
  return {
    store,
    async put(path, blob) {
      store.set(path, Buffer.from(blob));
    },
    async get(path) {
      return store.get(path) ?? null;
    },
    async delete(path) {
      store.delete(path);
    }
  };
}

const devStore = (globalThis as { __healthDevStore?: Map<string, Buffer> }).__healthDevStore ?? new Map<string, Buffer>();
(globalThis as { __healthDevStore?: Map<string, Buffer> }).__healthDevStore = devStore;

/** The storage this deployment uses. In production the zone must be configured: never a silent fallback. */
export function healthStorage(): HealthStorage {
  const cfg = bunnyConfig();
  if (cfg) return bunnyStorage(cfg);
  if (isProduction()) throw new Error('HEALTH_BUNNY_ZONE / HEALTH_BUNNY_PASSWORD / HEALTH_BUNNY_HOST are not set: health files cannot be stored.');
  return memoryHealthStorage(devStore);
}
