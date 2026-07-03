function getPricingApiUrl(): string {
  const url = process.env.NARRATOR_PRICING_API_URL;
  if (!url) {
    throw new Error(
      'NARRATOR_PRICING_API_URL environment variable is required. Set it in .env.local (local dev) or fly secrets (deploy).'
    );
  }
  return url;
}

const TIMEOUT_MS = 60_000;

export class CloudDriveBackendError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = 'CloudDriveBackendError';
    this.status = status;
    this.code = code;
  }
}

interface SuccessEnvelope<T> {
  success: true;
  data: T;
}

interface ErrorEnvelope {
  success: false;
  error: {
    code: string;
    message: string;
    retryable?: boolean;
    details?: unknown;
  };
}

type Envelope<T> = SuccessEnvelope<T> | ErrorEnvelope;

function authToken(): string {
  return process.env.PRICING_BFF_AUTH_TOKEN || '';
}

function isErrorEnvelope(value: unknown): value is ErrorEnvelope {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { success?: unknown }).success === false &&
    typeof (value as { error?: unknown }).error === 'object'
  );
}

function buildUrl(path: string, query?: Record<string, string | number | undefined>): string {
  const url = new URL(path, getPricingApiUrl());
  for (const [key, value] of Object.entries(query || {})) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

async function callCloudDrive<T>(
  appKey: string,
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  options: {
    body?: unknown;
    query?: Record<string, string | number | undefined>;
  } = {}
): Promise<T> {
  const bearer = authToken();
  if (!bearer) {
    throw new CloudDriveBackendError(
      'PRICING_BFF_AUTH_TOKEN env not set - web cannot authenticate to backend.',
      503,
      'BFF_AUTH_TOKEN_MISSING'
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let status = 0;
  let payload: unknown;
  try {
    const init: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${bearer}`,
        'X-Web-App-Key': appKey,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    };
    if (options.body !== undefined) {
      init.body = JSON.stringify(options.body);
    }

    const res = await fetch(buildUrl(path, options.query), init);
    status = res.status;
    payload = await res.json().catch(() => ({}));
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError';
    throw new CloudDriveBackendError(
      error instanceof Error ? error.message : 'backend cloud-drive call failed',
      aborted ? 504 : 502,
      aborted ? 'BFF_UPSTREAM_TIMEOUT' : 'BFF_UPSTREAM_UNREACHABLE'
    );
  } finally {
    clearTimeout(timeout);
  }

  if (status >= 200 && status < 300 && payload && typeof payload === 'object') {
    const envelope = payload as Envelope<T>;
    if (envelope.success === true) return envelope.data;
  }

  if (isErrorEnvelope(payload)) {
    throw new CloudDriveBackendError(
      payload.error.message || payload.error.code || `HTTP ${status}`,
      status,
      payload.error.code || 'UNKNOWN'
    );
  }

  throw new CloudDriveBackendError(`Backend returned HTTP ${status}`, status, 'UNKNOWN');
}

export function getCloudDriveFiles(
  appKey: string,
  query: Record<string, string | number | undefined>
) {
  return callCloudDrive(appKey, 'GET', '/cloud-drive/files', { query });
}

export function getCloudDriveStorage(appKey: string) {
  return callCloudDrive(appKey, 'GET', '/cloud-drive/storage-usage');
}

export function createCloudDriveUploadUrl(appKey: string, body: unknown) {
  return callCloudDrive(appKey, 'POST', '/cloud-drive/upload-url', { body });
}

export function confirmCloudDriveUpload(appKey: string, body: unknown) {
  return callCloudDrive(appKey, 'POST', '/cloud-drive/upload-callback', { body });
}

export function createCloudDriveDownloadUrl(appKey: string, fileId: string) {
  return callCloudDrive(appKey, 'POST', '/cloud-drive/download-url', {
    body: { file_id: fileId },
  });
}

export function deleteCloudDriveFile(appKey: string, fileId: string) {
  return callCloudDrive(
    appKey,
    'DELETE',
    `/cloud-drive/files/${encodeURIComponent(fileId)}`
  );
}

export function batchDeleteCloudDriveFiles(appKey: string, fileIds: string[]) {
  return callCloudDrive(appKey, 'POST', '/cloud-drive/files/batch-delete', {
    body: { file_ids: fileIds },
  });
}

export function createCloudDriveTransfer(appKey: string, body: unknown) {
  return callCloudDrive(appKey, 'POST', '/cloud-drive/transfer', { body });
}

export function listCloudDriveTransfers(
  appKey: string,
  query: Record<string, string | number | undefined>
) {
  return callCloudDrive(appKey, 'GET', '/cloud-drive/transfer', { query });
}

export function batchDeleteCloudDriveTransfers(appKey: string, fileIds: string[]) {
  return callCloudDrive(appKey, 'POST', '/cloud-drive/transfer/batch-delete', {
    body: { file_ids: fileIds },
  });
}
