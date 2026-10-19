/**
 * lib/stellar/contract.ts
 *
 * Builds Soroban transactions for each ChainSettle contract function,
 * gets them signed by Freighter, and submits them to the network.
 *
 * Flow for every write operation:
 *   1. Build the transaction (TransactionBuilder + Contract.call)
 *   2. Simulate it (get the resource footprint from the RPC)
 *   3. Assemble the final transaction with the simulation result
 *   4. Sign via Freighter
 *   5. Submit to Soroban RPC
 *   6. Poll for confirmation
 */

import {
  Networks,
  rpc,
  Contract,
  TransactionBuilder,
  BASE_FEE,
  nativeToScVal,
  scValToNative,
  xdr,
  Address,
} from '@stellar/stellar-sdk';
import { signTx } from './freighter';

const RPC_URL = process.env.NEXT_PUBLIC_STELLAR_RPC_URL!;
const CONTRACT_ID = process.env.NEXT_PUBLIC_CONTRACT_ID!;
const NETWORK = process.env.NEXT_PUBLIC_STELLAR_NETWORK ?? 'testnet';

const NETWORK_PASSPHRASE =
  NETWORK === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;

// Singleton RPC client
let rpcClient: rpc.Server;
function getRpc(): rpc.Server {
  if (!rpcClient) {
    rpcClient = new rpc.Server(RPC_URL, { allowHttp: true });
  }
  return rpcClient;
}

// ----------------------------------------------------------------
// Core helpers
// ----------------------------------------------------------------

/** Build, simulate, assemble, sign, and submit a contract call */
async function invokeContract(
  callerAddress: string,
  method: string,
  args: xdr.ScVal[],
): Promise<string> {
  const rpcClient = getRpc();
  const contract = new Contract(CONTRACT_ID);

  // Fetch the caller's account sequence number
  const account = await rpcClient.getAccount(callerAddress);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();

  // Simulate to get resource footprint
  const simulation = await rpcClient.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(simulation)) {
    throw new Error(`Simulation error: ${simulation.error}`);
  }

  // Assemble the final transaction with the simulation resource data
  const assembled = rpc.assembleTransaction(tx, simulation).build();

  // Sign with Freighter
  const signedXdr = await signTx(assembled.toXDR(), NETWORK_PASSPHRASE);

  // Submit
  const response = await rpcClient.sendTransaction(
    new (await import('@stellar/stellar-sdk')).Transaction(
      signedXdr,
      NETWORK_PASSPHRASE,
    ),
  );

  if (response.status === 'ERROR') {
    throw new Error(`Submission error: ${response.errorResult?.toXDR()}`);
  }

  // Poll until confirmed
  return await waitForConfirmation(response.hash);
}

/** Poll the RPC until the transaction is confirmed or fails */
async function waitForConfirmation(txHash: string): Promise<string> {
  const rpcClient = getRpc();
  let attempts = 0;

  while (attempts < 20) {
    await new Promise((r) => setTimeout(r, 2000));
    const result = await rpcClient.getTransaction(txHash);

    if (result.status === rpc.Api.GetTransactionStatus.SUCCESS) {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('chainsettle:transaction-complete'));
      }
      return txHash;
    }

    if (result.status === rpc.Api.GetTransactionStatus.FAILED) {
      throw new Error(`Transaction failed: ${txHash}`);
    }

    attempts++;
  }

  throw new Error(`Transaction not confirmed after ${attempts} attempts: ${txHash}`);
}

/** Read-only simulation — no signing, no submission */
async function simulateCall(method: string, args: xdr.ScVal[]): Promise<any> {
  const rpcClient = getRpc();
  const contract = new Contract(CONTRACT_ID);

  // Use a dummy account for simulation
  const dummyKeypair = (await import('@stellar/stellar-sdk')).Keypair.random();
  const dummyAccount = {
    accountId: () => dummyKeypair.publicKey(),
    sequenceNumber: () => '0',
    incrementSequenceNumber: () => {},
  } as any;

  const tx = new TransactionBuilder(dummyAccount, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();

  const simulation = await rpcClient.simulateTransaction(tx);

  if (rpc.Api.isSimulationError(simulation)) {
    throw new Error(`Read error: ${simulation.error}`);
  }

  if (rpc.Api.isSimulationSuccess(simulation) && simulation.result) {
    return scValToNative(simulation.result.retval);
  }

  return null;
}

// ----------------------------------------------------------------
// Contract write functions
// ----------------------------------------------------------------

/**
 * create_shipment — locks USDC in escrow and initialises the shipment.
 * The buyer must have approved the USDC spend first (SAC approve tx).
 */
export async function createShipment(params: {
  callerAddress: string;
  shipmentId: string;
  supplier: string;
  logistics: string;
  arbiter: string;
  tokenAddress: string;
  totalAmount: bigint;
  milestones: Array<{ name: string; paymentPercent: number }>;
}): Promise<string> {
  const milestonesScVal = xdr.ScVal.scvVec(
    params.milestones.map((m) =>
      xdr.ScVal.scvMap([
        new xdr.ScMapEntry({
          key: nativeToScVal('name', { type: 'symbol' }),
          val: nativeToScVal(m.name, { type: 'string' }),
        }),
        new xdr.ScMapEntry({
          key: nativeToScVal('payment_percent', { type: 'symbol' }),
          val: nativeToScVal(m.paymentPercent, { type: 'u32' }),
        }),
        new xdr.ScMapEntry({
          key: nativeToScVal('proof_hash', { type: 'symbol' }),
          val: nativeToScVal('', { type: 'string' }),
        }),
        new xdr.ScMapEntry({
          key: nativeToScVal('status', { type: 'symbol' }),
          val: xdr.ScVal.scvVec([nativeToScVal('Pending', { type: 'symbol' })]),
        }),
      ]),
    ),
  );

  return invokeContract(params.callerAddress, 'create_shipment', [
    nativeToScVal(params.shipmentId, { type: 'string' }),
    new Address(params.callerAddress).toScVal(),
    new Address(params.supplier).toScVal(),
    new Address(params.logistics).toScVal(),
    new Address(params.arbiter).toScVal(),
    new Address(params.tokenAddress).toScVal(),
    nativeToScVal(params.totalAmount, { type: 'i128' }),
    milestonesScVal,
  ]);
}

/** submit_proof — supplier or logistics submits an IPFS proof hash */
export async function submitProof(params: {
  callerAddress: string;
  shipmentId: string;
  milestoneIndex: number;
  proofHash: string;
}): Promise<string> {
  return invokeContract(params.callerAddress, 'submit_proof', [
    new Address(params.callerAddress).toScVal(),
    nativeToScVal(params.shipmentId, { type: 'string' }),
    nativeToScVal(params.milestoneIndex, { type: 'u32' }),
    nativeToScVal(params.proofHash, { type: 'string' }),
  ]);
}

/** confirm_milestone — buyer confirms a submitted proof, releases payment */
export async function confirmMilestone(params: {
  callerAddress: string;
  shipmentId: string;
  milestoneIndex: number;
}): Promise<string> {
  return invokeContract(params.callerAddress, 'confirm_milestone', [
    new Address(params.callerAddress).toScVal(),
    nativeToScVal(params.shipmentId, { type: 'string' }),
    nativeToScVal(params.milestoneIndex, { type: 'u32' }),
  ]);
}

/** raise_dispute — buyer disputes a submitted proof */
export async function raiseDispute(params: {
  callerAddress: string;
  shipmentId: string;
  milestoneIndex: number;
}): Promise<string> {
  return invokeContract(params.callerAddress, 'raise_dispute', [
    new Address(params.callerAddress).toScVal(),
    nativeToScVal(params.shipmentId, { type: 'string' }),
    nativeToScVal(params.milestoneIndex, { type: 'u32' }),
  ]);
}

/** resolve_dispute — arbiter approves or rejects a disputed milestone */
export async function resolveDispute(params: {
  callerAddress: string;
  shipmentId: string;
  milestoneIndex: number;
  approve: boolean;
}): Promise<string> {
  return invokeContract(params.callerAddress, 'resolve_dispute', [
    new Address(params.callerAddress).toScVal(),
    nativeToScVal(params.shipmentId, { type: 'string' }),
    nativeToScVal(params.milestoneIndex, { type: 'u32' }),
    nativeToScVal(params.approve, { type: 'bool' }),
  ]);
}

/** cancel_shipment — buyer cancels before any milestones confirmed */
export async function cancelShipment(params: {
  callerAddress: string;
  shipmentId: string;
}): Promise<string> {
  return invokeContract(params.callerAddress, 'cancel_shipment', [
    new Address(params.callerAddress).toScVal(),
    nativeToScVal(params.shipmentId, { type: 'string' }),
  ]);
}

// ----------------------------------------------------------------
// Contract read functions
// ----------------------------------------------------------------

/** get_shipment — fetch full shipment state from chain */
export async function getShipmentOnChain(shipmentId: string) {
  return simulateCall('get_shipment', [
    nativeToScVal(shipmentId, { type: 'string' }),
  ]);
}

/** get_escrow_balance — amount still locked in escrow */
export async function getEscrowBalance(shipmentId: string): Promise<bigint> {
  const result = await simulateCall('get_escrow_balance', [
    nativeToScVal(shipmentId, { type: 'string' }),
  ]);
  return BigInt(result ?? 0);
}
