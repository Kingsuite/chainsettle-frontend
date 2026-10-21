import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PUBLIC_PATHS = ['/auth/login'];

function createCsp(nonce: string) {
  const apiOrigin = new URL(
    process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/api/v1',
  ).origin;
  const rpcOrigin = new URL(process.env.NEXT_PUBLIC_STELLAR_RPC_URL!).origin;
  const network = process.env.NEXT_PUBLIC_STELLAR_NETWORK ?? 'testnet';
  const horizonOrigin = new URL(
    process.env.NEXT_PUBLIC_HORIZON_URL ??
      (network === 'mainnet'
        ? 'https://horizon.stellar.org'
        : 'https://horizon-testnet.stellar.org'),
  ).origin;
  const ipfsOrigin = new URL(
    process.env.NEXT_PUBLIC_IPFS_GATEWAY ?? 'https://ipfs.io/ipfs/',
  ).origin;

  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    `connect-src 'self' ${apiOrigin} ${rpcOrigin} ${horizonOrigin}`,
    `img-src 'self' data: ${ipfsOrigin}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isStaticAsset =
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/public/') ||
    pathname.includes('favicon') ||
    /\.[^/]+$/.test(pathname);
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
  const csp = createCsp(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('Content-Security-Policy', csp);

  const next = () => {
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    response.headers.set('Content-Security-Policy', csp);
    return response;
  };

  // Allow public paths through
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return next();
  }

  // Check for JWT token in cookie or Authorization header
  const token = request.cookies.get('chainsetttle_token')?.value;

  if (!token && !pathname.startsWith('/auth') && !isStaticAsset) {
    const loginUrl = new URL('/auth/login', request.url);
    loginUrl.searchParams.set('callbackUrl', `${pathname}${request.nextUrl.search}`);
    const response = NextResponse.redirect(loginUrl);
    response.headers.set('Content-Security-Policy', csp);
    return response;
  }

  return next();
}

export const config = {
  matcher: ['/:path*'],
};
