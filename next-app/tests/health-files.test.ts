import { describe, it, expect, afterEach, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { healthFilesConfigured, healthStorage, memoryHealthStorage, openHealthFile, parseKeyring, sealHealthFile } from '../src/lib/health-files';

/** Health files: encryption and storage selection (Plans/Health-Forms.md). */
const ring = () => new Map([[1, randomBytes(32)]]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('a scout’s health form, page one')]);

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('sealHealthFile / openHealthFile', () => {
  it('Opened_IsTheUploadedBytes', () => {
    const r = ring();
    const s = sealHealthFile('obj-1', JPEG, r);
    expect(openHealthFile('obj-1', s.blob, s.keyVersion, s.wrappedKey, r).equals(JPEG)).toBe(true);
  });

  it('StoredObject_IsCiphertext_NotTheUploadedBytes', () => {
    const s = sealHealthFile('obj-1', JPEG, ring());
    expect([s.blob.includes(JPEG.subarray(0, 4)), s.blob.includes(Buffer.from('health form'))]).toEqual([false, false]);
  });

  it('SameFile_SealedTwice_IsDifferentCiphertext', () => {
    const r = ring();
    expect(sealHealthFile('obj-1', JPEG, r).blob.equals(sealHealthFile('obj-1', JPEG, r).blob)).toBe(false);
  });

  it('Decrypt_FailsClosed_OnTamperedCiphertext', () => {
    const r = ring();
    const s = sealHealthFile('obj-1', JPEG, r);
    s.blob[s.blob.length - 1] ^= 1;
    expect(() => openHealthFile('obj-1', s.blob, s.keyVersion, s.wrappedKey, r)).toThrow();
  });

  it('Decrypt_Refuses_CiphertextMovedToAnotherObject', () => {
    const r = ring();
    const s = sealHealthFile('obj-1', JPEG, r);
    expect(() => openHealthFile('obj-2', s.blob, s.keyVersion, s.wrappedKey, r)).toThrow();
  });

  it('Decrypt_Refuses_AnotherFilesWrappedKey', () => {
    const r = ring();
    const a = sealHealthFile('obj-1', JPEG, r);
    const b = sealHealthFile('obj-1', JPEG, r);
    expect(() => openHealthFile('obj-1', a.blob, a.keyVersion, b.wrappedKey, r)).toThrow();
  });

  it('Decrypt_Refuses_TheWrongMasterKey', () => {
    const s = sealHealthFile('obj-1', JPEG, ring());
    expect(() => openHealthFile('obj-1', s.blob, s.keyVersion, s.wrappedKey, ring())).toThrow();
  });

  it('Decrypt_Refuses_AnUnknownKeyVersion', () => {
    const r = ring();
    const s = sealHealthFile('obj-1', JPEG, r);
    expect(() => openHealthFile('obj-1', s.blob, 9, s.wrappedKey, r)).toThrow(/key version 9/);
  });

  it('Seal_UsesTheNewestKey_AndOlderFilesStillOpen', () => {
    const old = randomBytes(32);
    const before = sealHealthFile('obj-1', JPEG, new Map([[1, old]]));
    const both = new Map([[1, old], [2, randomBytes(32)]]);
    expect([sealHealthFile('obj-2', JPEG, both).keyVersion, openHealthFile('obj-1', before.blob, 1, before.wrappedKey, both).equals(JPEG)]).toEqual([2, true]);
  });
});

describe('parseKeyring', () => {
  it('Reads_VersionedBase64Keys', () => {
    const k = randomBytes(32);
    expect(parseKeyring(`1:${k.toString('base64')}`).get(1)?.equals(k)).toBe(true);
  });

  it('Refuses_AShortKey', () => {
    expect(() => parseKeyring(`1:${randomBytes(16).toString('base64')}`)).toThrow(/malformed/);
  });

  it('Unset_IsAnEmptyRing', () => {
    expect(parseKeyring(undefined).size).toBe(0);
  });
});

describe('production', () => {
  it('ProductionWithoutBunnyEnv_Throws_NeverFallsBackToMemory', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('HEALTH_BUNNY_ZONE', '');
    expect(() => healthStorage()).toThrow(/not set/);
  });

  it('ProductionWithoutKey_Throws_OnSeal', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('HEALTH_FILES_KEYS', '');
    expect(() => sealHealthFile('obj-1', JPEG)).toThrow(/HEALTH_FILES_KEYS/);
  });

  it('DevelopmentKey_IsRefused_OnceARealZoneIsConfigured', () => {
    vi.stubEnv('HEALTH_FILES_KEYS', '');
    vi.stubEnv('HEALTH_BUNNY_ZONE', 'zone');
    vi.stubEnv('HEALTH_BUNNY_PASSWORD', 'pw');
    vi.stubEnv('HEALTH_BUNNY_HOST', 'ny.storage.bunnycdn.com');
    expect(() => sealHealthFile('obj-1', JPEG)).toThrow(/HEALTH_FILES_KEYS/);
  });

  it('ProductionWithoutEnv_IsNotConfigured', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('HEALTH_FILES_KEYS', '');
    expect(healthFilesConfigured()).toBe(false);
  });

  it('ProductionWithKeyAndZone_IsConfigured', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('HEALTH_FILES_KEYS', `1:${randomBytes(32).toString('base64')}`);
    vi.stubEnv('HEALTH_BUNNY_ZONE', 'zone');
    vi.stubEnv('HEALTH_BUNNY_PASSWORD', 'pw');
    vi.stubEnv('HEALTH_BUNNY_HOST', 'ny.storage.bunnycdn.com');
    expect(healthFilesConfigured()).toBe(true);
  });
});

describe('memoryHealthStorage', () => {
  it('Delete_OfAMissingObject_IsASuccess', async () => {
    await expect(memoryHealthStorage().delete('nope')).resolves.toBeUndefined();
  });

  it('Get_OfAMissingObject_IsNull', async () => {
    expect(await memoryHealthStorage().get('nope')).toBeNull();
  });
});
