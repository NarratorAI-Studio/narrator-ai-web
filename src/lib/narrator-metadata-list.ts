export interface NarratorMetadataListPayload {
  items?: unknown[];
  total?: unknown;
  [key: string]: unknown;
}

export function unwrapMetadataListPayload(
  upstream: unknown
): NarratorMetadataListPayload {
  if (typeof upstream !== 'object' || upstream === null) return {};
  const maybeData = (upstream as { data?: unknown }).data;
  if (typeof maybeData === 'object' && maybeData !== null) {
    return maybeData as NarratorMetadataListPayload;
  }
  return upstream as NarratorMetadataListPayload;
}

export function parsePositiveInt(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
}

export function filterMetadataPlaceholderItems(
  items: unknown[],
  idKey: string
): unknown[] {
  return items.filter(item => {
    if (typeof item !== 'object' || item === null) return true;
    const row = item as Record<string, unknown>;
    return row.name !== '自定义' && row[idKey] !== 'else';
  });
}

