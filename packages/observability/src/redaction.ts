const REDACTED = '[REDACTED]';
const DEFAULT_PREVIEW_LIMIT = 160;
const sensitiveKeyPattern = /authorization|cookie|credential|password|secret|token/i;

export type SafeAuditAttributeValue = string | number | boolean | null;

export function clipPreview(value: string, maxLength = DEFAULT_PREVIEW_LIMIT): string {
  const normalized = value.trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(maxLength - 3, 0)).trimEnd()}...`;
}

function sanitizeStructuredValue(
  value: unknown,
  keyName?: string,
  maxLength = DEFAULT_PREVIEW_LIMIT,
): unknown {
  if (keyName != null && sensitiveKeyPattern.test(keyName)) {
    return REDACTED;
  }

  if (value == null) {
    return null;
  }

  if (typeof value === 'string') {
    return clipPreview(value, maxLength);
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeStructuredValue(entry, undefined, maxLength));
  }

  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        sanitizeStructuredValue(entryValue, entryKey, maxLength),
      ]),
    );
  }

  return clipPreview(String(value), maxLength);
}

function sanitizeUnknownValue(
  value: unknown,
  keyName?: string,
  maxLength = DEFAULT_PREVIEW_LIMIT,
): SafeAuditAttributeValue {
  const sanitized = sanitizeStructuredValue(value, keyName, maxLength);

  if (
    sanitized == null ||
    typeof sanitized === 'string' ||
    typeof sanitized === 'number' ||
    typeof sanitized === 'boolean'
  ) {
    return sanitized ?? null;
  }

  try {
    return clipPreview(JSON.stringify(sanitized), maxLength);
  } catch {
    return clipPreview(String(sanitized), maxLength);
  }
}

export function redactAuditAttributes(
  attributes: Record<string, unknown>,
  options: {
    maxLength?: number;
  } = {},
): Record<string, SafeAuditAttributeValue> {
  const maxLength = options.maxLength ?? DEFAULT_PREVIEW_LIMIT;

  return Object.fromEntries(
    Object.entries(attributes).map(([key, value]) => [
      key,
      sanitizeUnknownValue(value, key, maxLength),
    ]),
  );
}

