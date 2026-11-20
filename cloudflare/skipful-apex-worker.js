// Cloudflare Worker for the bare domain skipful.com (route: skipful.com/*).
// - skipful.com/research/...  -> served from the research pages on guides.skipful.com (GitHub Pages)
// - everything else           -> 301 to the same path on www.skipful.com (the WeWeb app)
// www.skipful.com is untouched: it stays DNS-only to WeWeb's hosting.

const RESEARCH_ORIGIN = 'https://guides.skipful.com';
const APP_ORIGIN = 'https://www.skipful.com';

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/research') {
      return Response.redirect(`https://${url.host}/research/${url.search}`, 301);
    }

    if (url.pathname.startsWith('/research/')) {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
      }
      const upstream = await fetch(RESEARCH_ORIGIN + url.pathname + url.search, {
        method: request.method,
        headers: { 'User-Agent': request.headers.get('User-Agent') || 'skipful-research-proxy', Accept: request.headers.get('Accept') || '*/*' },
        cf: { cacheEverything: true, cacheTtl: 600 },
        redirect: 'manual',
      });

      // GitHub Pages redirects /research/foo to /research/foo/ on its own host; keep visitors on skipful.com.
      if (upstream.status >= 300 && upstream.status < 400) {
        const loc = upstream.headers.get('Location') || '';
        const next = new URL(loc, RESEARCH_ORIGIN);
        if (next.host === new URL(RESEARCH_ORIGIN).host) {
          return Response.redirect(`https://${url.host}${next.pathname}${next.search}`, upstream.status === 302 ? 302 : 301);
        }
        return upstream;
      }

      const headers = new Headers(upstream.headers);
      for (const h of ['x-github-request-id', 'x-served-by', 'x-cache', 'x-cache-hits', 'x-timer', 'x-fastly-request-id', 'via']) headers.delete(h);
      headers.set('Cache-Control', 'public, max-age=600');
      return new Response(upstream.body, { status: upstream.status, headers });
    }

    // Everything else on the bare domain goes to the app, keeping the path and query.
    return Response.redirect(APP_ORIGIN + url.pathname + url.search, 301);
  },
};
