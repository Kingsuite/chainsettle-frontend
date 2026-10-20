/**
 * lib/utils/index.ts
 * Formatting and utility helpers used across the UI
 */

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { format, formatDistanceToNow } from 'date-fns';
import type { MilestoneStatus, ShipmentStatus } from '@/types';

export { toSafeProofUrl } from './proof-url';

/** Merge Tailwind classes safely */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Shorten a Stellar address for display: GABC...XYZ */
export function shortAddress(address: string, chars = 4): string {
  if (!address) return '';
  return `${address.slice(0, chars + 1)}...${address.slice(-chars)}`;
}

/** Copy text to clipboard */
export async function copyToClipboard(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

/**
 * Convert stroops (i128 as string) to human-readable USDC.
 * USDC on Stellar has 7 decimal places.
 * @example stroopsToUsdc("10000000") → "1.00"
 */
export function stroopsToUsdc(stroops: string | bigint, decimals = 2): string {
  const value = BigInt(stroops);
  const whole = value / 10_000_000n;
  const fraction = (value % 10_000_000n).toString().padStart(7, '0');
  const display = `${whole}.${fraction}`;
  return parseFloat(display).toFixed(decimals);
}

/**
 * Convert human-readable USDC to stroops (bigint).
 * @example usdcToStroops("1.5") → 15000000n
 */
export function usdcToStroops(usdc: string): bigint {
  const [whole, fraction = ''] = usdc.split('.');
  const paddedFraction = fraction.padEnd(7, '0').slice(0, 7);
  return BigInt(whole) * 10_000_000n + BigInt(paddedFraction);
}

/** Format a date string to a readable format */
export function formatDate(date: string | null): string {
  if (!date) return '—';
  return format(new Date(date), 'MMM d, yyyy');
}

/** Format a date as "X ago" */
export function timeAgo(date: string | null): string {
  if (!date) return '—';
  return formatDistanceToNow(new Date(date), { addSuffix: true });
}

/** Get Tailwind badge class for shipment status */
export function shipmentStatusBadge(status: ShipmentStatus): string {
  const map: Record<ShipmentStatus, string> = {
    Active:    'badge-active',
    Completed: 'badge-completed',
    Cancelled: 'badge-cancelled',
  };
  return map[status] ?? 'badge';
}

/** Get Tailwind badge class for milestone status */
export function milestoneStatusBadge(status: MilestoneStatus): string {
  const map: Record<MilestoneStatus, string> = {
    Pending:         'badge-pending',
    ProofSubmitted:  'badge-submitted',
    Confirmed:       'badge-confirmed',
    Disputed:        'badge-disputed',
    Resolved:        'badge-resolved',
  };
  return map[status] ?? 'badge';
}

/** Human-readable milestone status label */
export function milestoneStatusLabel(status: MilestoneStatus): string {
  const map: Record<MilestoneStatus, string> = {
    Pending:         'Pending',
    ProofSubmitted:  'Proof submitted',
    Confirmed:       'Confirmed',
    Disputed:        'Disputed',
    Resolved:        'Resolved',
  };
  return map[status] ?? status;
}

/** Compute the progress percentage of a shipment (milestones confirmed) */
export function shipmentProgress(milestones: { status: MilestoneStatus }[]): number {
  if (!milestones.length) return 0;
  const done = milestones.filter(
    (m) => m.status === 'Confirmed' || m.status === 'Resolved',
  ).length;
  return Math.round((done / milestones.length) * 100);
}

/** Generate a unique shipment ID based on timestamp */
export function generateShipmentId(): string {
  const now = new Date();
  const date = format(now, 'yyyyMMdd');
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `SHIP-${date}-${rand}`;
}

/**
 * Derive the current user's role in a shipment by comparing their address
 * against the shipment's address fields.
 * @returns 'buyer' | 'supplier' | 'logistics' | 'arbiter' | 'observer'
 */
export function deriveUserRole(
  address: string | null,
  shipment: { buyerAddress: string; supplierAddress: string; logisticsAddress: string; arbiterAddress: string },
): string {
  if (!address) return 'observer';
  if (address === shipment.buyerAddress) return 'buyer';
  if (address === shipment.supplierAddress) return 'supplier';
  if (address === shipment.logisticsAddress) return 'logistics';
  if (address === shipment.arbiterAddress) return 'arbiter';
  return 'observer';
}

/**
 * Get styling configuration for a user role badge.
 * Returns Tailwind classes and label text.
 */
export function roleBadge(role: string): { className: string; label: string } {
  const config: Record<string, { className: string; label: string }> = {
    buyer:     { className: 'bg-blue-50 text-blue-700 ring-blue-600/20',     label: 'Buyer' },
    supplier:  { className: 'bg-green-50 text-green-700 ring-green-600/20',  label: 'Supplier' },
    logistics: { className: 'bg-orange-50 text-orange-700 ring-orange-600/20', label: 'Logistics' },
    arbiter:   { className: 'bg-purple-50 text-purple-700 ring-purple-600/20', label: 'Arbiter' },
    observer:  { className: 'bg-gray-50 text-gray-500 ring-gray-500/20',     label: 'Read-only' },
  };
  return config[role] ?? config.observer;
}
