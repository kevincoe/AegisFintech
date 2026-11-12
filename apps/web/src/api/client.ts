import type { CurrencyCode } from '@aegis/shared';

export interface LedgerEntryItem {
  id: string;
  accountId: string;
  accountNumber: string;
  accountLabel: string;
  direction: 'DEBIT' | 'CREDIT';
  amountCents: number;
  currency: CurrencyCode;
  balanceAfterCents: number;
}

export interface LedgerReceiptData {
  transactionId: string;
  category: string;
  description: string;
  createdAt: string;
  lockOrderApplied: string[];
  entries: LedgerEntryItem[];
}

export interface XRayEventLog {
  id: string;
  timestamp: string;
  endpoint: string;
  statusCode: number;
  idempotencyKey?: string;
  replayed?: boolean;
  requestPayload?: unknown;
  ledgerReceipt?: LedgerReceiptData | null;
  errorMessage?: string;
}

let authToken: string | null = localStorage.getItem('aegis_auth_token');
let xrayLogs: XRayEventLog[] = [];
const xraySubscribers = new Set<() => void>();

export function setAuthToken(token: string | null): void {
  authToken = token;
  if (token) {
    localStorage.setItem('aegis_auth_token', token);
  } else {
    localStorage.removeItem('aegis_auth_token');
  }
}

export function getAuthToken(): string | null {
  return authToken;
}

export function getXRayLogs(): XRayEventLog[] {
  return xrayLogs;
}

export function recordXRayLog(entry: Omit<XRayEventLog, 'id' | 'timestamp'>): void {
  const fullEntry: XRayEventLog = {
    ...entry,
    id: crypto.randomUUID(),
    timestamp: new Date().toLocaleTimeString(),
  };
  xrayLogs = [fullEntry, ...xrayLogs].slice(0, 25);
  for (const sub of xraySubscribers) {
    sub();
  }
}

export function subscribeXRayLogs(cb: () => void): () => void {
  xraySubscribers.add(cb);
  return () => {
    xraySubscribers.delete(cb);
  };
}

export function generateIdempotencyKey(prefix = 'ui'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function apiRequest<T>(
  path: string,
  options?: {
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
    body?: unknown;
    idempotencyKey?: string;
  }
): Promise<T> {
  const method = options?.method ?? 'GET';
  const headers: Record<string, string> = {};

  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }
  if (options?.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (options?.idempotencyKey) {
    headers['Idempotency-Key'] = options.idempotencyKey;
  }

  const response = await fetch(path, {
    method,
    headers,
    credentials: 'include',
    body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const data = await response.json().catch(() => ({}));

  if (method !== 'GET') {
    recordXRayLog({
      endpoint: `${method} ${path}`,
      statusCode: response.status,
      idempotencyKey: options?.idempotencyKey ?? data?.idempotency?.key,
      replayed: data?.idempotency?.replayed,
      requestPayload: options?.body,
      ledgerReceipt: data?.ledgerReceipt ?? null,
      errorMessage: !response.ok ? data?.error?.message ?? 'Request failed' : undefined,
    });
  }

  if (!response.ok) {
    const err = new Error(data?.error?.message ?? `HTTP Error ${response.status}`) as Error & {
      code?: string;
      statusCode?: number;
    };
    err.code = data?.error?.code;
    err.statusCode = response.status;
    throw err;
  }

  return data as T;
}
