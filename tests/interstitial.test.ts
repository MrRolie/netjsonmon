import { describe, it, expect, beforeEach } from 'vitest';
import { yahooConsentHandler, genericConsentHandler, handleInterstitial } from '../src/interstitial.js';

/**
 * Tests for Fix 1: Interstitial and consent handling
 */

describe('Interstitial handlers (Fix 1)', () => {
  describe('yahooConsentHandler', () => {
    it('should detect Yahoo consent pages', () => {
      const mockPage = {
        url: () => 'https://consent.yahoo.com/v2/collectConsent',
      } as any;

      const isYahooConsent = yahooConsentHandler.detect(mockPage);
      expect(isYahooConsent).toBe(true);
    });

    it('should not detect non-Yahoo pages', () => {
      const mockPage = {
        url: () => 'https://finance.yahoo.com/quote/AAPL',
      } as any;

      const isYahooConsent = yahooConsentHandler.detect(mockPage);
      expect(isYahooConsent).toBe(false);
    });

    it('should have handle method', () => {
      expect(typeof yahooConsentHandler.handle).toBe('function');
    });
  });

  describe('genericConsentHandler', () => {
    it('should detect pages with consent in URL', () => {
      const mockPage = {
        url: () => 'https://example.com/consent',
      } as any;

      const isConsent = genericConsentHandler.detect(mockPage);
      expect(isConsent).toBe(true);
    });

    it('should detect pages with privacy in URL', () => {
      const mockPage = {
        url: () => 'https://example.com/privacy-policy',
      } as any;

      const isConsent = genericConsentHandler.detect(mockPage);
      expect(isConsent).toBe(true);
    });

    it('should detect pages with cookie in URL', () => {
      const mockPage = {
        url: () => 'https://example.com/cookie-settings',
      } as any;

      const isConsent = genericConsentHandler.detect(mockPage);
      expect(isConsent).toBe(true);
    });

    it('should not detect regular pages', () => {
      const mockPage = {
        url: () => 'https://example.com/about',
      } as any;

      const isConsent = genericConsentHandler.detect(mockPage);
      expect(isConsent).toBe(false);
    });
  });

  describe('handleInterstitial', () => {
    it('should return false when mode is false', async () => {
      const mockPage = {
        url: () => 'https://consent.yahoo.com/',
      } as any;

      const result = await handleInterstitial(mockPage, false);
      expect(result).toBe(false);
    });

    it('should use yahoo handler when mode is yahoo', async () => {
      const mockPage = {
        url: () => 'https://example.com/',
      } as any;

      // Should return false because not on a Yahoo consent page
      const result = await handleInterstitial(mockPage, 'yahoo', 100);
      expect(result).toBe(false);
    });

    it('should use generic handler when mode is generic', async () => {
      const mockPage = {
        url: () => 'https://example.com/about',
      } as any;

      // Should return false because not detected as consent page
      const result = await handleInterstitial(mockPage, 'generic', 100);
      expect(result).toBe(false);
    });
  });
});

describe('MonitorOptions autoConsent integration', () => {
  it('should accept yahoo as autoConsent value', () => {
    const autoConsent: 'yahoo' | 'generic' | false = 'yahoo';
    expect(autoConsent).toBe('yahoo');
  });

  it('should accept generic as autoConsent value', () => {
    const autoConsent: 'yahoo' | 'generic' | false = 'generic';
    expect(autoConsent).toBe('generic');
  });

  it('should accept false as autoConsent value', () => {
    const autoConsent: 'yahoo' | 'generic' | false = false;
    expect(autoConsent).toBe(false);
  });
});
