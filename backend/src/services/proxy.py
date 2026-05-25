"""
Reverse-proxy helpers: URL rewriting + tracker injection.
Ported from ux-tracker/server.js (rewriteHtml, rewriteCssUrls, buildInterceptorScript).
"""
import re
from pathlib import Path
from urllib.parse import urlencode, urlparse, quote

import httpx
from fastapi import Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response, StreamingResponse

from models.site import Site

# ---------------------------------------------------------------------------
# Tracker template — loaded once at import time
# ---------------------------------------------------------------------------
_TRACKER_JS_PATH = Path(__file__).parent.parent / "static" / "tracker.js"
_TRACKER_TEMPLATE: str = ""


def _tracker_template() -> str:
    global _TRACKER_TEMPLATE
    if not _TRACKER_TEMPLATE:
        _TRACKER_TEMPLATE = _TRACKER_JS_PATH.read_text()
    return _TRACKER_TEMPLATE


# ---------------------------------------------------------------------------
# Client-side interceptor (injected at top of <head>)
# Ports buildInterceptorScript() from server.js verbatim.
# __PROXY_BASE__ and __BARE_HOST__ are substituted at request time.
# ---------------------------------------------------------------------------
_INTERCEPTOR_TEMPLATE = r"""<script data-ux-interceptor="true">(function(){
var P="__PROXY_BASE__",B="__BARE_HOST__";
function sameHost(h){return h.replace(/^www\./,"")===B;}
function rw(url){
  if(!url||typeof url!=="string"||url.length===0) return url;
  if(url.indexOf(P)===0) return url;
  var c=url.charAt(0);
  if(c==="#"||c==="?") return url;
  if(/^(data|blob|javascript|mailto|tel|about):/.test(url)) return url;
  try{
    if(/^https?:\/\//.test(url)){
      var u=new URL(url);
      if(sameHost(u.host))return P+u.pathname+u.search+u.hash;
      // URL points to proxy origin but path not yet under proxy base — rewrite it
      if(u.origin===location.origin&&u.pathname.indexOf(P)!==0)return P+u.pathname+u.search+u.hash;
      return url;
    }
    if(url.indexOf("//")===0){var u2=new URL("https:"+url);if(sameHost(u2.host))return P+u2.pathname+u2.search+u2.hash;return url;}
  }catch(e){return url;}
  if(c==="/"&&url.charAt(1)!=="/") return P+url;
  return url;
}
var _f=window.fetch;
window.fetch=function(input,init){
  if(typeof input==="string") input=rw(input);
  else if(input instanceof Request){try{input=new Request(rw(input.url),input);}catch(e){}}
  return _f.call(this,input,init);
};
var _xo=XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open=function(method,url){
  if(typeof url==="string") arguments[1]=rw(url);
  return _xo.apply(this,arguments);
};
var _sa=Element.prototype.setAttribute;
Element.prototype.setAttribute=function(name,value){
  if(typeof value==="string"){
    var n=name.toLowerCase();
    if(n==="href"||n==="src"||n==="action"||n==="data-src"||n==="poster"){value=rw(value);}
    else if(n==="srcset"){value=value.replace(/([^,\s]+)/g,function(u){return rw(u.trim());});}
  }
  return _sa.call(this,name,value);
};
function safePatch(proto,prop){
  try{
    var d=Object.getOwnPropertyDescriptor(proto,prop);
    if(!d||!d.set) return;
    var oSet=d.set,oGet=d.get;
    Object.defineProperty(proto,prop,{
      get:oGet,
      set:function(v){
        if(typeof v==="string"&&v.length>1){
          var c0=v.charAt(0);
          if((c0==="/"&&v.charAt(1)!=="/")||/^https?:\/\//.test(v)) v=rw(v);
        }
        return oSet.call(this,v);
      },
      configurable:true,enumerable:d.enumerable
    });
  }catch(e){}
}
safePatch(HTMLImageElement.prototype,"src");
safePatch(HTMLScriptElement.prototype,"src");
safePatch(HTMLLinkElement.prototype,"href");
safePatch(HTMLSourceElement.prototype,"src");
// Rewrite url() values in CSS properties set from JavaScript
// e.g. element.style.backgroundImage = "url('/images/...')"
var _ssp=CSSStyleDeclaration.prototype.setProperty;
CSSStyleDeclaration.prototype.setProperty=function(prop,val,prio){
  if(typeof val==="string"&&val.indexOf("url(")!==-1)
    val=val.replace(/url\(\s*(['"]?)([^'")\s]+)\1\s*\)/gi,function(m,q,u){return"url("+q+rw(u)+q+")";});
  return _ssp.call(this,prop,val,prio);
};
function safeStylePatch(prop){
  try{
    var d=Object.getOwnPropertyDescriptor(CSSStyleDeclaration.prototype,prop);
    if(!d||!d.set) return;
    var oSet=d.set,oGet=d.get;
    Object.defineProperty(CSSStyleDeclaration.prototype,prop,{
      get:oGet,
      set:function(v){
        if(typeof v==="string"&&v.indexOf("url(")!==-1)
          v=v.replace(/url\(\s*(['"]?)([^'")\s]+)\1\s*\)/gi,function(m,q,u){return"url("+q+rw(u)+q+")";});
        return oSet.call(this,v);
      },
      configurable:true,enumerable:d.enumerable
    });
  }catch(e){}
}
safeStylePatch("backgroundImage");
safeStylePatch("background");
safeStylePatch("borderImage");
safeStylePatch("maskImage");
safeStylePatch("cssText");
var _wo=window.open;
window.open=function(url){if(typeof url==="string")arguments[0]=rw(url);return _wo.apply(this,arguments);};
var _ps=history.pushState,_rs=history.replaceState;
// Normalize URL immediately so JS routers (Next.js, React Router) see the site's
// own path (e.g. "/") instead of the proxy-prefixed path (e.g. "/site/abc123/").
// This must happen before any framework code runs.
(function(){
  var p=location.pathname;
  if(p.indexOf(P)===0){
    var clean=p.slice(P.length)||"/";
    try{_rs.call(history,history.state,"",clean+location.search+location.hash);}catch(e){}
  }
})();
// Patch pushState/replaceState: keep URLs clean for the router, but re-add the
// proxy prefix for absolute same-host URLs so server requests still work.
function _patchHistUrl(url){
  if(typeof url!=="string") return url;
  if(/^https?:\/\//.test(url)) return rw(url);
  return url; // leave root-relative paths clean — fetch/XHR interceptors handle requests
}
history.pushState=function(s,t,url){
  arguments[2]=_patchHistUrl(url);
  return _ps.apply(this,arguments);
};
history.replaceState=function(s,t,url){
  arguments[2]=_patchHistUrl(url);
  return _rs.apply(this,arguments);
};
window.__ux_rewrite=rw;
window.__ux_fetch=_f;
})();</script>"""

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)

PASS_REQUEST_HEADERS = frozenset({
    "accept-language", "cookie", "authorization",
    "cache-control", "range", "if-range",
})

# Headers we strip when forwarding the upstream response. Note: content-encoding
# and content-length are handled per-branch below — they must NOT be forwarded
# for the rewrite branches (we re-encode), but for streaming pass-through we
# rely on transfer-encoding: chunked instead of content-length so we strip both.
SKIP_RESPONSE_HEADERS = frozenset({
    "content-security-policy", "content-security-policy-report-only",
    "x-frame-options", "strict-transport-security", "x-xss-protection",
    "x-content-type-options", "transfer-encoding", "content-length",
    "cross-origin-opener-policy", "cross-origin-embedder-policy",
    "cross-origin-resource-policy", "permissions-policy", "feature-policy",
    # httpx auto-decompresses, so the upstream encoding header is meaningless
    # to forward. aiter_bytes() also returns already-decoded bytes.
    "content-encoding",
})


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _host_variants(host: str) -> list[str]:
    bare = re.sub(r"^www\.", "", host)
    return [host, bare] if host.startswith("www.") else [host, "www." + host]


def _build_interceptor(proxy_base: str, origin: str) -> str:
    host = urlparse(origin).netloc
    bare = re.sub(r"^www\.", "", host)
    return (
        _INTERCEPTOR_TEMPLATE
        .replace("__PROXY_BASE__", proxy_base)
        .replace("__BARE_HOST__", bare)
    )


def _inject_tracker(
    html: str,
    site_id: str,
    proxy_base: str,
    target_origin: str,
    api_base: str,
    tasks: list[dict] | None = None,
    no_tasks_mode: bool = False,
) -> str:
    import json as _json
    tasks_json = _json.dumps(tasks or []).replace("</script>", "<\\/script>")
    script = (
        _tracker_template()
        .replace("__UX_SITE_ID__", site_id)
        .replace("__UX_API_BASE__", api_base)
        .replace("__UX_TARGET_ORIGIN__", target_origin)
        .replace("__UX_PROXY_BASE__", proxy_base)
        .replace("__UX_TASKS__", tasks_json)
        .replace("__UX_NOTASKS__", "true" if no_tasks_mode else "false")
    )
    tag = f'<script data-ux-tracker="true">{script}</script>'
    if "</body>" in html:
        return html.replace("</body>", tag + "</body>", 1)
    if "</html>" in html:
        return html.replace("</html>", tag + "</html>", 1)
    return html + tag


# ---------------------------------------------------------------------------
# HTML rewriting — ports rewriteHtml() from server.js
# ---------------------------------------------------------------------------
def rewrite_html(html: str, origin: str, proxy_base: str) -> str:
    host = urlparse(origin).netloc
    variants = _host_variants(host)

    # 1. Remove <base> tags
    html = re.sub(r"<base\s[^>]*>", "", html, flags=re.IGNORECASE)

    # 2. Inject interceptor at top of <head>
    interceptor = _build_interceptor(proxy_base, origin)
    if re.search(r"<head[\s>]", html, re.IGNORECASE):
        html = re.sub(
            r"(<head(?:\s[^>]*)?>)",
            lambda m: m.group(1) + interceptor,
            html, count=1, flags=re.IGNORECASE,
        )
    elif re.search(r"<html[\s>]", html, re.IGNORECASE):
        html = re.sub(
            r"(<html(?:\s[^>]*)?>)",
            lambda m: m.group(1) + "<head>" + interceptor + "</head>",
            html, count=1, flags=re.IGNORECASE,
        )
    else:
        html = interceptor + html

    # 3. Rewrite absolute URLs for each host variant
    _ATTRS = r"href|src|action|poster|data-src|data-href|data-url|data-lazy-src|data-original|data-bg|data-background|data-lazy|content"
    for h in variants:
        esc = re.escape(h)
        html = re.sub(
            rf'({_ATTRS})=(["\'])https?://{esc}(/[^"\']*)\2',
            rf"\1=\2{proxy_base}\3\2",
            html, flags=re.IGNORECASE,
        )
        html = re.sub(
            rf'({_ATTRS})=(["\'])//{esc}(/[^"\']*)\2',
            rf"\1=\2{proxy_base}\3\2",
            html, flags=re.IGNORECASE,
        )

    # 4. Rewrite root-relative URLs
    def _rw_root(m: re.Match) -> str:
        attr, quote, path = m.group(1), m.group(2), m.group(3)
        if path.startswith(proxy_base):
            return m.group(0)
        return f"{attr}={quote}{proxy_base}{path}{quote}"

    html = re.sub(
        rf'({_ATTRS})=(["\'])(\/(?!\/)[^"\']*)\2',
        _rw_root, html, flags=re.IGNORECASE,
    )

    # 4b. Strip loading="lazy" so images load immediately (iframe scroll ≠ page scroll)
    html = re.sub(r'\s+loading=(["\']?)lazy\1', "", html, flags=re.IGNORECASE)
    html = re.sub(r'\s+decoding=(["\']?)async\1', "", html, flags=re.IGNORECASE)

    # 4c. Unwrap <noscript> img fallbacks used by JS lazy loaders
    html = re.sub(
        r'<noscript[^>]*>(\s*<img[^>]+>)\s*</noscript>',
        lambda m: m.group(1),
        html, flags=re.IGNORECASE,
    )

    # 5. Rewrite srcset
    def _rw_srcset(m: re.Match) -> str:
        parts = []
        for entry in m.group(1).split(","):
            tokens = entry.strip().split()
            if tokens:
                url = tokens[0]
                for h in variants:
                    if h in url:
                        try:
                            p = urlparse("https:" + url if url.startswith("//") else url)
                            url = proxy_base + p.path + (("?" + p.query) if p.query else "")
                        except Exception:
                            pass
                        break
                if url.startswith("/") and not url.startswith("//") and not url.startswith(proxy_base):
                    url = proxy_base + url
                tokens[0] = url
            parts.append(" ".join(tokens))
        return f'srcset="{", ".join(parts)}"'

    html = re.sub(r"""srcset=["']([^"']+)["']""", _rw_srcset, html, flags=re.IGNORECASE)

    # 6. Inline style url() — absolute
    def _rw_style_abs(m: re.Match) -> str:
        try:
            p = urlparse(m.group(1))
            if p.netloc in variants:
                return f'url("{proxy_base}{p.path}{("?" + p.query) if p.query else ""}")'
        except Exception:
            pass
        return m.group(0)

    html = re.sub(
        r"""url\(\s*["']?(https?://[^)"'\s]+)["']?\s*\)""",
        _rw_style_abs, html, flags=re.IGNORECASE,
    )

    # Root-relative url()
    def _rw_style_root(m: re.Match) -> str:
        p = m.group(1)
        return m.group(0) if p.startswith(proxy_base) else f'url("{proxy_base}{p}")'

    html = re.sub(
        r"""url\(\s*["']?(/[^/)"'\s][^)"'\s]*)["']?\s*\)""",
        _rw_style_root, html, flags=re.IGNORECASE,
    )

    # 7. Strip integrity and crossorigin attributes (SRI hashes break rewritten CSS/JS)
    html = re.sub(r'\s+integrity=(?:"[^"]*"|\'[^\']*\')', "", html, flags=re.IGNORECASE)
    html = re.sub(r'\s+crossorigin=(?:"[^"]*"|\'[^\']*\'|[^\s>]+)', "", html, flags=re.IGNORECASE)

    # 8. Rewrite inline style attributes containing url()
    def _rw_inline_style(m: re.Match) -> str:
        quote = m.group(1)
        val = m.group(2)
        val = re.sub(
            r"""url\(\s*["']?(https?://[^)"'\s]+)["']?\s*\)""",
            _rw_style_abs, val, flags=re.IGNORECASE,
        )
        val = re.sub(
            r"""url\(\s*["']?(/[^/)"'\s][^)"'\s]*)["']?\s*\)""",
            _rw_style_root, val, flags=re.IGNORECASE,
        )
        return f"style={quote}{val}{quote}"

    html = re.sub(
        r"""style=(["'])([^"']*url\([^"']*\)[^"']*)\1""",
        _rw_inline_style, html, flags=re.IGNORECASE,
    )

    # 10. Meta refresh
    def _rw_meta(m: re.Match) -> str:
        prefix, q, url = m.group(1), m.group(2), m.group(3)
        for h in variants:
            if h in url:
                try:
                    p = urlparse("https:" + url if url.startswith("//") else url)
                    return prefix + q + proxy_base + p.path + (("?" + p.query) if p.query else "")
                except Exception:
                    pass
        if url.startswith("/") and not url.startswith("//"):
            return prefix + q + proxy_base + url
        return m.group(0)

    html = re.sub(
        r"""(<meta[^>]*content=["']\d+;\s*url=)(["']?)([^"'>]+)""",
        _rw_meta, html, flags=re.IGNORECASE,
    )

    return html


# ---------------------------------------------------------------------------
# CSS rewriting — ports rewriteCssUrls() from server.js
# ---------------------------------------------------------------------------
def rewrite_css(css: str, origin: str, proxy_base: str) -> str:
    host = urlparse(origin).netloc
    variants = _host_variants(host)

    def _abs(m: re.Match) -> str:
        try:
            p = urlparse(m.group(1))
            if p.netloc in variants:
                return f'url("{proxy_base}{p.path}{("?" + p.query) if p.query else ""}")'
        except Exception:
            pass
        return m.group(0)

    css = re.sub(r"""url\(\s*["']?(https?://[^)"'\s]+)["']?\s*\)""", _abs, css, flags=re.IGNORECASE)

    def _proto_rel(m: re.Match) -> str:
        url = m.group(1)
        for h in variants:
            if url.startswith(f"//{h}"):
                return f'url("{proxy_base}{url[len(h) + 2:]}")'
        return m.group(0)

    css = re.sub(r"""url\(\s*["']?(\/\/[^)"'\s]+)["']?\s*\)""", _proto_rel, css, flags=re.IGNORECASE)

    def _root_rel(m: re.Match) -> str:
        p = m.group(1)
        return m.group(0) if p.startswith(proxy_base) else f'url("{proxy_base}{p}")'

    css = re.sub(r"""url\(\s*["']?(/[^/)"'\s][^)"'\s]*)["']?\s*\)""", _root_rel, css, flags=re.IGNORECASE)

    def _import(m: re.Match) -> str:
        url = m.group(1)
        for h in variants:
            if h in url:
                try:
                    p = urlparse("https:" + url if url.startswith("//") else url)
                    return f'@import "{proxy_base}{p.path}{("?" + p.query) if p.query else ""}"'
                except Exception:
                    pass
        if url.startswith("/") and not url.startswith("//") and not url.startswith(proxy_base):
            return f'@import "{proxy_base}{url}"'
        return m.group(0)

    css = re.sub(r"""@import\s+["']([^"']+)["']""", _import, css, flags=re.IGNORECASE)

    return css


# ---------------------------------------------------------------------------
# Combined rewrite+inject — run in a threadpool so the event loop stays free
# while these CPU-bound regex passes execute on large HTML documents.
# ---------------------------------------------------------------------------
def _rewrite_html_and_inject(
    html: str,
    origin: str,
    proxy_base: str,
    site_id: str,
    api_base: str,
    tasks: list[dict] | None,
    no_tasks_mode: bool,
) -> str:
    html = rewrite_html(html, origin, proxy_base)
    return _inject_tracker(
        html, site_id, proxy_base, origin, api_base,
        tasks=tasks, no_tasks_mode=no_tasks_mode,
    )


# ---------------------------------------------------------------------------
# Main proxy entry point
# ---------------------------------------------------------------------------
async def handle_proxy_request(
    site: Site,
    path: str,
    request: Request,
    api_base: str,
    client: httpx.AsyncClient,
    tasks: list[dict] | None = None,
    no_tasks_mode: bool = False,
) -> Response:
    proxy_base = f"/site/{site.slug}"

    # Strip internal ?notasks param before forwarding
    params = dict(request.query_params)
    params.pop("notasks", None)
    qs = ("?" + urlencode(params, quote_via=quote)) if params else ""

    target_url = site.target_url.rstrip("/") + "/" + path.lstrip("/") + qs

    # Determine request type from Accept header to set correct sec-fetch-dest
    req_accept = request.headers.get("accept", "")
    if "text/html" in req_accept:
        fetch_dest, fetch_mode = "document", "navigate"
    elif "image/" in req_accept:
        fetch_dest, fetch_mode = "image", "no-cors"
    elif "text/css" in req_accept:
        fetch_dest, fetch_mode = "style", "no-cors"
    elif "application/javascript" in req_accept or "text/javascript" in req_accept:
        fetch_dest, fetch_mode = "script", "no-cors"
    else:
        fetch_dest, fetch_mode = "empty", "cors"

    # Build forwarded headers
    fwd: dict[str, str] = {
        "user-agent": BROWSER_UA,
        "accept": request.headers.get("accept", "text/html,application/xhtml+xml,*/*;q=0.8"),
        "accept-language": request.headers.get("accept-language", "en-US,en;q=0.9"),
        "connection": "keep-alive",
        "referer": site.target_url.rstrip("/") + "/",
        "sec-fetch-dest": fetch_dest,
        "sec-fetch-mode": fetch_mode,
        "sec-fetch-site": "same-origin",
    }
    for h in PASS_REQUEST_HEADERS:
        if h in request.headers:
            fwd[h] = request.headers[h]

    body = await request.body() if request.method in ("POST", "PUT", "PATCH") else None
    if body and "content-type" in request.headers:
        fwd["content-type"] = request.headers["content-type"]

    # Open a streaming send so we can decide whether to buffer-and-rewrite
    # or pass straight through without ever materialising the body in memory.
    try:
        req = client.build_request(
            method=request.method,
            url=target_url,
            headers=fwd,
            content=body,
        )
        upstream = await client.send(req, stream=True)
    except httpx.TimeoutException:
        return Response(content=b"", status_code=504)
    except httpx.RequestError:
        return Response(content=b"", status_code=502)

    content_type = upstream.headers.get("content-type", "")
    is_html = "text/html" in content_type
    is_css = "text/css" in content_type

    # Strip unwanted response headers up front; both branches need this.
    resp_headers: dict[str, str] = {
        k: v for k, v in upstream.headers.items()
        if k.lower() not in SKIP_RESPONSE_HEADERS
    }

    # --- HTML / CSS: buffer, rewrite, return ----------------------------------
    if is_html or is_css:
        try:
            raw = await upstream.aread()
        finally:
            await upstream.aclose()

        final_origin = f"{upstream.url.scheme}://{upstream.url.host}"
        # httpx.Response.encoding is None for some responses; fall back to utf-8.
        text = raw.decode(upstream.encoding or "utf-8", errors="replace")

        if is_html:
            rewritten = await run_in_threadpool(
                _rewrite_html_and_inject,
                text, final_origin, proxy_base,
                site.id, api_base, tasks, no_tasks_mode,
            )
            media_type = "text/html; charset=utf-8"
        else:
            rewritten = await run_in_threadpool(
                rewrite_css, text, final_origin, proxy_base,
            )
            media_type = "text/css; charset=utf-8"

        # Drop upstream content-type; we set our own with explicit charset.
        body_headers = {
            k: v for k, v in resp_headers.items() if k.lower() != "content-type"
        }
        return Response(
            content=rewritten.encode("utf-8"),
            status_code=upstream.status_code,
            headers=body_headers,
            media_type=media_type,
        )

    # --- Everything else: stream straight through -----------------------------
    # This is the big win for heavy pages. Images, JS bundles, fonts, videos,
    # JSON payloads, etc. start flowing to the tester's browser as soon as the
    # first chunk arrives from upstream — no full-body buffering.
    async def body_iter():
        try:
            async for chunk in upstream.aiter_bytes():
                yield chunk
        finally:
            await upstream.aclose()

    return StreamingResponse(
        body_iter(),
        status_code=upstream.status_code,
        headers=resp_headers,
        media_type=content_type or None,
    )