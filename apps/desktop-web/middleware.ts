import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

function isAllowedHost(host: string | null): boolean {
  if (!host) return false;
  // Strip port if present
  const hostname = host.replace(/:\d+$/, '').toLowerCase();
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname === '::1'
  );
}

function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  try {
    const url = new URL(origin);
    const hostname = url.hostname.toLowerCase();
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '[::1]' ||
      hostname === '::1'
    );
  } catch {
    return false;
  }
}

export function middleware(request: NextRequest) {
  const host = request.headers.get('host');
  // Check Host header to protect against DNS rebinding
  if (host && !isAllowedHost(host)) {
    return new NextResponse('Forbidden: Invalid Host header', { status: 403 });
  }

  const { pathname } = request.nextUrl;
  const isApi = pathname.startsWith('/api/');

  if (isApi) {
    const method = request.method.toUpperCase();
    const isMutation = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(method);

    if (isMutation) {
      // Check Sec-Fetch-Site if provided
      const secFetchSite = request.headers.get('sec-fetch-site');
      if (secFetchSite === 'cross-site') {
        return new NextResponse('Forbidden: Cross-site request rejected', { status: 403 });
      }

      // Check Origin
      const origin = request.headers.get('origin');
      if (origin && !isAllowedOrigin(origin)) {
        return new NextResponse('Forbidden: Cross-origin request rejected', { status: 403 });
      }

      // If Origin is not present, check Referer
      const referer = request.headers.get('referer');
      if (!origin && referer && !isAllowedOrigin(referer)) {
        return new NextResponse('Forbidden: Cross-origin referer rejected', { status: 403 });
      }

      // For JSON endpoints like /api/config, ensure content-type is strictly JSON
      if (pathname === '/api/config') {
        const contentType = request.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
          return new NextResponse('Bad Request: Content-Type must be application/json', { status: 400 });
        }
      }
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)']
};
