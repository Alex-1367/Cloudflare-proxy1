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
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Max-Age': '86400',
            'X-Request-ID': requestId,
        };

        // Handle CORS preflight
        if (method === 'OPTIONS') {
            console.log(`[${requestId}] [CORS] Preflight response sent`);
            return new Response(null, { status: 204, headers: corsHeaders });
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
            if (!targetUrl.includes('statusm.me')) {
                console.log(`[${requestId}] [PROXY] BLOCKED - Only statusm.me allowed: ${targetUrl.substring(0, 80)}`);
                return new Response(JSON.stringify({
                    success: false,
                    error: 'Only statusm.me domain is allowed',
                    requestId
                }), {
                    status: 403,
                    headers: { 'Content-Type': 'application/json', ...corsHeaders }
                });
            }

            try {
                console.log(`[${requestId}] [PROXY] Fetching: ${targetUrl.substring(0, 80)}...`);

                const response = await fetch(targetUrl, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
                        'Accept-Language': 'en-US,en;q=0.9',
                        'Referer': 'https://statusm.me/',
                        'Origin': 'https://statusm.me',
                    }
                });

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