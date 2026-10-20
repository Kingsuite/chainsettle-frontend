/**
 * lib/proof-hash.ts
 *
 * Client-side SHA-256 hashing of proof documents (e.g. a bill of lading PDF).
 * The file is read locally with the File API and hashed with WebCrypto —
 * it is never uploaded anywhere.
 */

/** Largest document we will hash in the browser */
export const MAX_PROOF_FILE_BYTES = 50 * 1024 * 1024; // 50 MB

const READ_CHUNK_BYTES = 4 * 1024 * 1024; // 4 MB

export type HashPhase = 'reading' | 'computing';

export interface FileHashResult {
  hash: string; // lowercase hex SHA-256 digest
  fileName: string;
  size: number;
}

/** Format a byte count for display: 1536 → "1.5 KB" */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Compute the SHA-256 hex digest of a file entirely in the browser.
 * The file is read in chunks so progress can be reported for large files.
 */
export async function hashFile(
  file: File,
  onProgress?: (phase: HashPhase, percent: number) => void,
): Promise<FileHashResult> {
  const bytes = new Uint8Array(file.size);
  let offset = 0;

  onProgress?.('reading', 0);
  while (offset < file.size) {
    const chunk = await file.slice(offset, offset + READ_CHUNK_BYTES).arrayBuffer();
    bytes.set(new Uint8Array(chunk), offset);
    offset += chunk.byteLength;
    onProgress?.('reading', Math.round((offset / file.size) * 100));
  }

  onProgress?.('computing', 100);
  const digest = await crypto.subtle.digest('SHA-256', bytes);

  return { hash: toHex(digest), fileName: file.name, size: file.size };
}

/** Normalise a stored proof hash for comparison with a computed hex digest */
export function normalizeProofHash(value: string): string {
  return value.trim().toLowerCase().replace(/^(sha-?256:|0x)/, '');
}

/** True when a proof hash looks like a SHA-256 hex digest (not an IPFS CID / URL) */
export function isSha256Hex(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(normalizeProofHash(value));
}
