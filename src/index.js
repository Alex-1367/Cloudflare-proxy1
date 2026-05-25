// prus-api4 - Cloudflare Worker Proxy for statusm.me

// Allowed origins (only these domains can use this proxy)
const ALLOWED_ORIGINS = [
    'https://prus-api3.burgas275.workers.dev',      // Main image cache worker
    'https://prus-api2.burgas275.workers.dev',      // Your main API
    'https://admin.imbcargo-montenegro.com',        // Admin panel
    'http://localhost:4200',                         // Local Angular dev
    'http://localhost:8787',                         // Local worker dev
    'http://localhost:8080',                         // Local Node.js proxy
    'http://127.0.0.1:4200',
    'http://127.0.0.1:8787',
    'http://127.0.0.1:5500'
];

// Helper: Check if request is from local development
function isLocalRequest(host) {
    return host?.includes('localhost') ||
        host?.includes('127.0.0.1') ||
        host === 'localhost:8787' ||
        host === '127.0.0.1:8787' ||
        host === 'localhost:4200' ||
        host === '127.0.0.1:4200' ||
        host === 'localhost:8080' ||
        host === 'localhost:5500' ||
        host === '127.0.0.1:5500' ||
        host === '127.0.0.1:8080';
}

// Helper: Check if origin is allowed
function isAllowedOrigin(origin, host) {
    return ALLOWED_ORIGINS.includes(origin) || isLocalRequest(host) || origin === null;
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const method = request.method;
        const requestId = crypto.randomUUID().slice(0, 8);
        const origin = request.headers.get('Origin');
        const host = request.headers.get('Host');

        console.log(`[${requestId}] ========== NEW REQUEST ==========`);
        console.log(`[${requestId}] METHOD: ${method}`);
        console.log(`[${requestId}] URL: ${url.toString()}`);
        console.log(`[${requestId}] PATHNAME: ${url.pathname}`);
        console.log(`[${requestId}] ORIGIN: ${origin || 'none'}`);
        console.log(`[${requestId}] HOST: ${host}`);
        console.log(`[${requestId}] QUERY PARAMS:`, Object.fromEntries(url.searchParams));

        // CORS check
        const isLocal = isLocalRequest(host);
        const allowedOrigin = isAllowedOrigin(origin, host);

        console.log(`[${requestId}] [CORS] Origin: ${origin}, Host: ${host}, isLocal: ${isLocal}, Allowed: ${allowedOrigin}`);
        console.log(`[${requestId}] [REQUEST] ${method} ${url.pathname}`);

        // Block unauthorized origins (except OPTIONS)
        if (!allowedOrigin && !isLocal && origin !== null && method !== 'OPTIONS') {
            console.log(`[${requestId}] [CORS] BLOCKED - Origin not allowed: ${origin}`);
            return new Response(JSON.stringify({
                success: false,
                error: 'Unauthorized',
                message: 'Access from this origin is not allowed',
                requestId,
            }), {
                status: 403,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': origin || '*',
                    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type',
                },
            });
        }

        // Dynamic CORS headers
        const corsHeaders = {
            'Access-Control-Allow-Origin': allowedOrigin && origin ? origin : '*',
            'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, User-Agent, Cache-Control, Accept, Accept-Language, Accept-Encoding, Connection, Upgrade-Insecure-Requests, Sec-Fetch-Dest, Sec-Fetch-Mode, Sec-Fetch-Site, Sec-Fetch-User',
            'Access-Control-Max-Age': '86400',
            'X-Request-ID': requestId,
        };

        // Handle CORS preflight
        if (method === 'OPTIONS') {
            console.log(`[${requestId}] [CORS] Preflight response sent`);
            return new Response(null, {
                status: 204,
                headers: {
                    'Access-Control-Allow-Origin': allowedOrigin && origin ? origin : '*',
                    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type, User-Agent, Cache-Control, Accept, Accept-Language, Accept-Encoding, Connection, Upgrade-Insecure-Requests, Sec-Fetch-Dest, Sec-Fetch-Mode, Sec-Fetch-Site, Sec-Fetch-User',
                    'Access-Control-Max-Age': '86400',
                }
            });
        }

        // Health check endpoint (public - no CORS restriction needed)
        if (url.pathname === '/health') {
            return new Response(JSON.stringify({
                success: true,
                status: 'healthy',
                worker: 'prus-api4',
                timestamp: new Date().toISOString(),
                requestId
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json', ...corsHeaders }
            });
        }

        // Root endpoint (public info)
        if (url.pathname === '/') {
            return new Response(JSON.stringify({
                name: 'prus-api4',
                allowedOrigins: ALLOWED_ORIGINS,
                endpoints: {
                    health: 'GET /health',
                    proxy: 'GET /proxy?url=https://statusm.me/...'
                },
                requestId
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json', ...corsHeaders }
            });
        }

        // Proxy endpoint (restricted by CORS)
        if (url.pathname === '/proxy') {
            // Additional check: Only allow GET method
            if (method !== 'GET') {
                return new Response(JSON.stringify({
                    success: false,
                    error: 'Method not allowed. Use GET.',
                    requestId
                }), {
                    status: 405,
                    headers: { 'Content-Type': 'application/json', ...corsHeaders }
                });
            }

            const targetUrl = url.searchParams.get('url');

            if (!targetUrl) {
                return new Response(JSON.stringify({
                    success: false,
                    error: 'Missing url parameter',
                    requestId
                }), {
                    status: 400,
                    headers: { 'Content-Type': 'application/json', ...corsHeaders }
                });
            }

            // Security: Only allow statusm.me domain
            const allowedDomains = ['statusm.me', 'picsum.photos', 'localhost'];
            const isAllowed = allowedDomains.some(domain => targetUrl.includes(domain));
            if (!isAllowed) {
                console.log(`[${requestId}] [PROXY] BLOCKED - Only statusm.me allowed: ${targetUrl.substring(0, 80)}`);
                return new Response(JSON.stringify({
                    success: false,
                    error: 'Only statusm.me domain is allowed for production images. Test domains: picsum.photos',
                    allowedDomains: allowedDomains,
                    requestId
                }), {
                    status: 403,
                    headers: { 'Content-Type': 'application/json', ...corsHeaders }
                });
            }

            // ADD THIS: Cookie storage for session persistence
            // Store cookies between requests (simple in-memory for this worker instance)
            if (!globalThis._cookieJar) {
                globalThis._cookieJar = '';
            }

            try {
                console.log(`[${requestId}] [PROXY] Fetching: ${targetUrl.substring(0, 80)}...`);

                // UPDATED: Better browser-like headers with cookie support
                const response = await fetch(targetUrl, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                        'Accept-Language': 'en-US,en;q=0.9,ru;q=0.8',
                        'Accept-Encoding': 'gzip, deflate, br',
                        'Referer': 'https://www.google.com/',
                        'Origin': 'https://statusm.me',
                        'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
                        'Sec-Ch-Ua-Mobile': '?0',
                        'Sec-Ch-Ua-Platform': '"Windows"',
                        'Sec-Fetch-Dest': 'document',
                        'Sec-Fetch-Mode': 'navigate',
                        'Sec-Fetch-Site': 'none',
                        'Sec-Fetch-User': '?1',
                        'Upgrade-Insecure-Requests': '1',
                        'Cache-Control': 'max-age=0',
                        'Cookie': globalThis._cookieJar,  // ADD THIS: Send stored cookies
                    }
                });

                // ADD THIS: Save cookies from response for future requests
                const setCookie = response.headers.get('set-cookie');
                if (setCookie) {
                    const cookieValue = setCookie.split(';')[0];
                    globalThis._cookieJar = cookieValue;
                    console.log(`[${requestId}] [PROXY] Cookie saved: ${cookieValue.substring(0, 50)}...`);
                }

                if (!response.ok) {
                    console.log(`[${requestId}] [PROXY] Failed: HTTP ${response.status}`);
                    return new Response(JSON.stringify({
                        success: false,
                        error: `HTTP ${response.status}`,
                        requestId
                    }), {
                        status: response.status,
                        headers: { 'Content-Type': 'application/json', ...corsHeaders }
                    });
                }

                const contentType = response.headers.get('Content-Type') || 'image/jpeg';

                // For HTML responses, log first 200 chars for debugging
                if (contentType.includes('text/html')) {
                    const text = await response.text();
                    // Check if it's a Cloudflare challenge page
                    if (text.includes('cf-browser-verification') || text.includes('challenge') || text.includes('__cf_chl')) {
                        console.log(`[${requestId}] [PROXY] CLOUDFLARE CHALLENGE DETECTED!`);
                        return new Response(JSON.stringify({
                            success: false,
                            error: 'Cloudflare challenge detected - statusm.me is blocking this proxy',
                            requestId
                        }), {
                            status: 403,
                            headers: { 'Content-Type': 'application/json', ...corsHeaders }
                        });
                    }
                    return new Response(text, {
                        status: 200,
                        headers: {
                            'Content-Type': contentType,
                            'Cache-Control': 'public, max-age=86400',
                            'X-Cache-Source': 'prus-api4',
                            ...corsHeaders,
                        }
                    });
                }

                const imageData = await response.arrayBuffer();

                console.log(`[${requestId}] [PROXY] Success: ${imageData.byteLength} bytes (${contentType})`);

                return new Response(imageData, {
                    status: 200,
                    headers: {
                        'Content-Type': contentType,
                        'Cache-Control': 'public, max-age=86400',
                        'X-Cache-Source': 'prus-api4',
                        ...corsHeaders,
                    }
                });

            } catch (error) {
                console.error(`[${requestId}] [PROXY] Error: ${error.message}`);
                return new Response(JSON.stringify({
                    success: false,
                    error: error.message,
                    requestId
                }), {
                    status: 500,
                    headers: { 'Content-Type': 'application/json', ...corsHeaders }
                });
            }
        }

        // Diagnostic endpoint - shows why requests fail
        if (url.pathname === '/proxy/diagnostic' && method === 'GET') {
            const targetUrl = url.searchParams.get('url');

            if (!targetUrl) {
                return new Response(JSON.stringify({
                    success: false,
                    error: 'Missing url parameter',
                    usage: '/proxy/diagnostic?url=https://example.com/image.jpg'
                }), { status: 400, headers: corsHeaders });
            }

            const diagnostics = {
                requestId,
                timestamp: new Date().toISOString(),
                targetUrl: targetUrl,
                checks: {
                    urlFormat: {
                        passed: true,
                        message: 'URL parameter provided'
                    },
                    domainCheck: {
                        passed: targetUrl.includes('statusm.me') || targetUrl.includes('picsum.photos'),
                        message: targetUrl.includes('statusm.me') ? 'Domain allowed (statusm.me)' :
                            (targetUrl.includes('picsum.photos') ? 'Domain allowed (picsum.photos - test only)' :
                                'Domain not allowed - only statusm.me for production, picsum.photos for testing'),
                        allowedDomains: ['statusm.me', 'picsum.photos']
                    },
                    methodCheck: {
                        passed: method === 'GET',
                        message: method === 'GET' ? 'GET method allowed' : `Method ${method} not allowed`
                    },
                    corsCheck: {
                        origin: origin,
                        isAllowed: allowedOrigin,
                        message: allowedOrigin ? 'CORS allowed' : 'CORS would block this request'
                    }
                },
                suggestedFix: null
            };

            if (!diagnostics.checks.domainCheck.passed) {
                diagnostics.suggestedFix = 'Use a statusm.me URL or update allowedDomains in worker code';
            }

            return new Response(JSON.stringify(diagnostics, null, 2), {
                status: 200,
                headers: { 'Content-Type': 'application/json', ...corsHeaders }
            });
        }

        // 404 for any other path
        return new Response(JSON.stringify({
            success: false,
            error: 'Not Found',
            requestId
        }), {
            status: 404,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
    }
};