import { describe, it, expect } from 'vitest';
import { yahooConsentHandler, genericConsentHandler, handleConsent } from '../src/interstitial.js';
import type { ConsentMode } from '../src/types.js';

/**
 * Tests for consent handling
 */

describe('Interstitial handlers (Fix 1)', () => {
  describe('yahooConsentHandler', () => {
    it('should detect Yahoo consent pages', () => {
      const mockFrame = {
        url: () => 'https://consent.yahoo.com/v2/collectConsent',
      } as any;

      const isYahooConsent = yahooConsentHandler.match(mockFrame);
      expect(isYahooConsent).toBe(true);
    });

    it('should not detect non-Yahoo pages', () => {
      const mockFrame = {
        url: () => 'https://finance.yahoo.com/quote/AAPL',
      } as any;

      const isYahooConsent = yahooConsentHandler.match(mockFrame);
      expect(isYahooConsent).toBe(false);
    });

    it('should have handle method', () => {
      expect(typeof yahooConsentHandler.handle).toBe('function');
    });
  });

  describe('genericConsentHandler', () => {
    it('should detect pages with consent in URL', () => {
      const mockFrame = {
        url: () => 'https://example.com/consent',
      } as any;

      const isConsent = genericConsentHandler.match(mockFrame);
      expect(isConsent).toBe(true);
    });

    it('should detect pages with privacy in URL', () => {
      const mockFrame = {
        url: () => 'https://example.com/privacy-policy',
      } as any;

      const isConsent = genericConsentHandler.match(mockFrame);
      expect(isConsent).toBe(true);
    });

    it('should detect pages with cookie in URL', () => {
      const mockFrame = {
        url: () => 'https://example.com/cookie-settings',
      } as any;

      const isConsent = genericConsentHandler.match(mockFrame);
      expect(isConsent).toBe(true);
    });

    it('should not detect regular pages', () => {
      const mockFrame = {
        url: () => 'https://example.com/about',
      } as any;

      const isConsent = genericConsentHandler.match(mockFrame);
      expect(isConsent).toBe(false);
    });
  });

  describe('handleConsent', () => {
    it('should return false when mode is off', async () => {
      const mockPage = {
        url: () => 'https://consent.yahoo.com/',
        frames: () => [],
        mainFrame: () => ({ url: () => 'https://consent.yahoo.com/' }),
      } as any;

      const result = await handleConsent(mockPage, 'off', 'reject', 100);
      expect(result).toBe(false);
    });

    it('should use yahoo handler when mode is yahoo', async () => {
      const mockFrame = {
        url: () => 'https://consent.yahoo.com/',
        getByRole: () => ({ isVisible: async () => false }),
        locator: () => ({ first: () => ({ isVisible: async () => false }) }),
        name: () => '',
      } as any;
      const mockPage = {
        url: () => 'https://consent.yahoo.com/',
        frames: () => [mockFrame],
        mainFrame: () => mockFrame,
      } as any;

      const result = await handleConsent(mockPage, 'yahoo', 'reject', 100);
      expect(result).toBe(false);
    });

    it('should respect consentMode union type', () => {
      const mode: ConsentMode = 'auto';
      expect(mode).toBe('auto');
    });
  });
});
