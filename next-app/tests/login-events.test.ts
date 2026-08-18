import { describe, it, expect } from 'vitest';
import { parseDeviceLabel } from '../src/lib/login-events';

/**
 * Recent Logins dashboard — device/browser label parsing
 * (Plans/Recent-Logins-Dashboard.md). Pure function, no DB — heuristic
 * User-Agent parsing, deliberately simple (no new dependency) since this is
 * a display convenience, not a security signal.
 */
describe('parseDeviceLabel', () => {
  it('ReturnsUnknownDevice_ForANullUserAgent', () => {
    expect(parseDeviceLabel(null)).toBe('Unknown device');
  });

  it('ReturnsUnknownDevice_ForAnEmptyUserAgent', () => {
    expect(parseDeviceLabel('')).toBe('Unknown device');
  });

  it('IdentifiesIphoneSafari', () => {
    const ua =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
    expect(parseDeviceLabel(ua)).toBe('iPhone - Safari');
  });

  it('IdentifiesIphoneChrome_AsCriOS', () => {
    const ua =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1';
    expect(parseDeviceLabel(ua)).toBe('iPhone - Chrome');
  });

  it('IdentifiesAndroidChrome', () => {
    const ua =
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
    expect(parseDeviceLabel(ua)).toBe('Android - Chrome');
  });

  it('IdentifiesMacSafari', () => {
    const ua =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
    expect(parseDeviceLabel(ua)).toBe('Mac - Safari');
  });

  it('IdentifiesMacChrome', () => {
    const ua =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
    expect(parseDeviceLabel(ua)).toBe('Mac - Chrome');
  });

  it('IdentifiesWindowsEdge', () => {
    const ua =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.2592.68';
    expect(parseDeviceLabel(ua)).toBe('Windows - Edge');
  });

  it('IdentifiesWindowsFirefox', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0';
    expect(parseDeviceLabel(ua)).toBe('Windows - Firefox');
  });

  it('FallsBackToDeviceOnly_WhenTheBrowserCannotBeIdentified', () => {
    expect(parseDeviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) SomeWeirdBot/1.0')).toBe('Windows');
  });

  it('ReturnsUnknownDevice_ForACompletelyUnrecognizedString', () => {
    expect(parseDeviceLabel('curl/8.4.0')).toBe('Unknown device');
  });

  it('FallsBackToDeviceOnly_ForAnInAppWebViewThatCarriesSafariWithNoVersionToken', () => {
    // qa-lead review, 2026-08-17: an in-app browser (e.g. Facebook/Instagram
    // opening a link) commonly spoofs "Safari/604.1" for compatibility
    // without the "Version/" token real Safari always carries — must not be
    // mistaken for real Safari; the documented fallback is device-only.
    const ua =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari/604.1 [FBAN/FBIOS]';
    expect(parseDeviceLabel(ua)).toBe('iPhone');
  });
});
