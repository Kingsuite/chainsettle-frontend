/**
 * lib/utils/proof-url.ts
 *
 * Milestone proof hashes are free text submitted on-chain by a counterparty,
 * so they must be treated as untrusted before being rendered as a link.
 */

export const DEFAULT_IPFS_GATEWAY = 'https://ipfs.io/ipfs/';

// CIDv0 (base58btc, 46 chars starting with "Qm") or CIDv1 (base32, "bafy…"/"bafk…")
const CID_PATTERN = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|baf[ky][a-z2-7]{50,})$/;
// Optional path after the CID, e.g. "ipfs://<cid>/invoice.pdf" (no "." or ".." segments)
const IPFS_PATH_PATTERN = /^(\/(?!\.{1,2}(\/|$))[A-Za-z0-9._~\-]+)*\/?$/;

function gatewayUrl(gateway: string, cidAndPath: string): string | null {
  const slash = cidAndPath.indexOf('/');
  const cid = slash === -1 ? cidAndPath : cidAndPath.slice(0, slash);
  const path = slash === -1 ? '' : cidAndPath.slice(slash);
  if (!CID_PATTERN.test(cid) || !IPFS_PATH_PATTERN.test(path)) return null;

  const base = gateway.endsWith('/') ? gateway : `${gateway}/`;
  return `${base}${cid}${path}`;
}

/**
 * Turn a milestone proof hash into a URL that is safe to use as an `href`.
 *
 * - `ipfs://<cid>[/path]` → gateway URL
 * - a bare CID (`Qm…` / `bafy…`) → gateway URL
 * - an `https://` URL → kept as is
 * - anything else (`javascript:`, `data:`, `vbscript:`, `http:`, free text) → `null`
 */
export function toSafeProofUrl(
  proofHash: string,
  gateway: string = DEFAULT_IPFS_GATEWAY,
): string | null {
  const value = proofHash.trim();
  if (!value) return null;

  if (value.toLowerCase().startsWith('ipfs://')) {
    return gatewayUrl(gateway, value.slice('ipfs://'.length));
  }

  if (CID_PATTERN.test(value)) {
    return gatewayUrl(gateway, value);
  }

  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}
