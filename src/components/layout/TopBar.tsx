"use client";

import { useEffect, useRef, useState } from 'react';
import { Bell, Wifi, Copy, ExternalLink, LogOut, Check, Menu, Wallet, AlertCircle } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/lib/hooks/use-auth-store';
import { useWalletBalance } from '@/lib/hooks/use-wallet-balance';
import { shortAddress } from '@/lib/utils';
import { env } from '@/lib/env';
import { useTranslations } from 'next-intl';

interface TopBarProps {
  onMenuClick: () => void;
}

export function TopBar({ onMenuClick }: TopBarProps) {
  const network = env.stellarNetwork;
  const { address, logout, displayName } = useAuthStore();
  const { balances, loading: balancesLoading, error: balancesError } = useWalletBalance(address);
  const t = useTranslations('navigation');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    if (open) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [open]);

  const handleCopy = async () => {
    if (!address) return;
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDisconnect = () => {
    logout();
    router.push("/auth/login");
  };

  const explorerUrl =
    network === "mainnet"
      ? `https://stellar.expert/explorer/public/account/${address}`
      : `https://stellar.expert/explorer/testnet/account/${address}`;

  return (
    <header className="h-14 bg-white border-b border-gray-100 flex items-center justify-between px-6 flex-shrink-0">
      {/* Hamburger — only visible on mobile */}
      <button
        onClick={onMenuClick}
        className="md:hidden p-2 rounded-xl text-gray-500 hover:bg-gray-50 hover:text-gray-900 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
        aria-label="Toggle sidebar"
      >
        <Menu className="w-5 h-5" />
      </button>
      <div className="hidden md:block" />
      <div className="flex items-center gap-3">
        {address && (
          <div
            className="hidden items-center gap-2 rounded-xl bg-gray-50 px-3 py-1.5 text-xs sm:flex"
            title={balancesError ?? 'Live wallet balance'}
          >
            <Wallet className="h-3.5 w-3.5 text-gray-400" />
            {balancesLoading ? (
              <span className="text-gray-400">Loading balance...</span>
            ) : balancesError ? (
              <span className="inline-flex items-center gap-1 text-red-500">
                <AlertCircle className="h-3.5 w-3.5" /> Balance unavailable
              </span>
            ) : (
              <span className="font-medium text-gray-700">
                {Number(balances?.usdc ?? 0).toFixed(2)} USDC
                <span className="mx-1 text-gray-300">|</span>
                {Number(balances?.xlm ?? 0).toFixed(2)} XLM
              </span>
            )}
          </div>
        )}
        {/* Network badge */}
        <span
          role="status"
          aria-label={`Connected to Stellar ${network === "mainnet" ? "Mainnet" : "Testnet"}`}
          className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-lg ${
            network === "mainnet"
              ? "bg-green-50 text-green-700"
              : "bg-amber-50 text-amber-700"
          }`}
        >
          <Wifi className="w-3 h-3" />
          {network === 'mainnet' ? t('mainnet') : t('testnet')}
        </span>

        {/* Notifications */}
        <Link
          href="/notifications"
          className="relative p-2 rounded-xl text-gray-500 hover:bg-gray-50 hover:text-gray-900 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
          aria-label="Notifications"
        >
          <Bell className="w-4.5 h-4.5" />
          <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-red-500" />
        </Link>

        {/* Wallet address dropdown */}
        {address && (
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-haspopup="true"
              aria-controls="wallet-dropdown"
              className="inline-flex items-center gap-1.5 text-xs font-mono font-medium px-3 py-1.5 rounded-xl bg-gray-50 hover:bg-gray-100 text-gray-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
            >
              {displayName || shortAddress(address)}
            </button>

            {open && (
              <div id="wallet-dropdown" className="absolute right-0 mt-1.5 w-52 bg-white border border-gray-100 rounded-xl shadow-lg py-1 z-50">
                <button
                  onClick={handleCopy}
                  className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs text-gray-700 hover:bg-gray-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-inset"
                >
                  {copied ? (
                    <Check className="w-3.5 h-3.5 text-green-500" />
                  ) : (
                    <Copy className="w-3.5 h-3.5 text-gray-400" />
                  )}
                  {copied ? t('copied') : t('copyAddress')}
                </button>

                <a
                  href="/dashboard/settings"
                  onClick={() => setOpen(false)}
                  className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  <Wallet className="w-3.5 h-3.5 text-gray-400" />
                  Profile & settings
                </a>

                <a
                  href={explorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setOpen(false)}
                  className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs text-gray-700 hover:bg-gray-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-inset"
                  aria-label="View on Stellar Expert (opens in new tab)"
                >
                  <ExternalLink className="w-3.5 h-3.5 text-gray-400" />
                  {t('viewOnStellarExpert')}
                </a>

                <div className="border-t border-gray-50 my-1" />

                <button
                  onClick={handleDisconnect}
                  className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs text-red-600 hover:bg-red-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-inset"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  {t('disconnectWallet')}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
