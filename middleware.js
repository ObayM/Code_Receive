import { NextResponse } from 'next/server';
import logger from './lib/logger';

export function middleware(request) {
    const { method, nextUrl, ip, headers } = request;
    const userAgent = headers.get('user-agent') || '-';

    // Log the incoming request
    logger.info({
        method,
        path: nextUrl.pathname,
        query: Object.fromEntries(nextUrl.searchParams),
        ip: ip || headers.get('x-forwarded-for') || 'unknown',
        ua: userAgent
    }, `[HTTP] ${method} ${nextUrl.pathname}`);

    return NextResponse.next();
}

export const config = {
    matcher: [
        /*
         * Match all request paths except for the ones starting with:
         * - _next/static (static files)
         * - _next/image (image optimization files)
         * - favicon.ico (favicon file)
         */
        '/((?!_next/static|_next/image|favicon.ico).*)',
    ],
};
