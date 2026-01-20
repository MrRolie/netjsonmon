/**
 * Core types for netjsonmon
 */

export interface MonitorOptions {
  url: string;
  headless: boolean;
  monitorMs: number;
  timeoutMs: number;
  outDir: string;
  includeRegex?: string;
  excludeRegex?: string;
  maxBodyBytes: number;
  inlineBodyBytes: number;
  maxCaptures: number;
  captureAllJson: boolean;
  flow?: string;
  saveHar: boolean;
  userAgent?: string;
  autoConsent: 'yahoo' | 'generic' | false;
  storageState?: string;
  saveStorageState: boolean;
}

export interface CaptureRecord {
  timestamp: string;
  url: string;
  status: number;
  method: string;
  requestHeaders: Record<string, string>;
  responseHeaders: Record<string, string>;
  contentType: string;
  payloadSize: number;
  bodyAvailable: boolean;
  truncated: boolean;
  omittedReason?: OmittedReason;
  bodyPath?: string;
  inlineBody?: any;
  bodyHash: string;
  jsonParseSuccess: boolean;
  parseError?: string;
}

export type OmittedReason =
  | 'maxBodyBytes'
  | 'unavailable'
  | 'nonJson'
  | 'parseError'
  | 'filtered'
  | 'emptyBody';

export interface RunMetadata {
  runId: string;
  startedAt: string;
  url: string;
  options: MonitorOptions;
}

export type FlowFunction = (page: any) => Promise<void>;
