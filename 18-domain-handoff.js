// Run before app loaders. Transfer codes live only in the fragment, never an HTTP URL.
(function () {
    'use strict';
    var script = document.currentScript, api = script.dataset.api, source = script.dataset.source;
    var url = new URL(location.href), queryCode = url.searchParams.has('handoff');
    var hash = new URLSearchParams(url.hash.slice(1)), packed = hash.get('handoff'), payload = null, trusted = false;
    if (!packed && !queryCode) return;
    window.eupoiiaHandoffPending = true;
    try { trusted = new URL(document.referrer).origin === source && source !== location.origin; } catch (e) {}
    try {
        if (!packed || packed.length > 8192 || !/^[A-Za-z0-9_-]+$/.test(packed)) throw new Error();
        var bytes = Uint8Array.from(atob(packed.replace(/-/g, '+').replace(/_/g, '/')), function (c) { return c.charCodeAt(0); });
        payload = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes));
        if (!payload || Array.isArray(payload) || payload.v !== 1 || payload.type !== 'eupoiia-domain' ||
            Object.keys(payload).some(function (k) { return !['v','type','tab','theme','fragment','code'].includes(k); }) ||
            (Object.hasOwn(payload,'tab') && (typeof payload.tab !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(payload.tab))) ||
            (Object.hasOwn(payload,'theme') && (typeof payload.theme !== 'string' || !['light','dark'].includes(payload.theme))) ||
            typeof payload.fragment !== 'string' || payload.fragment.length > 4096 || (payload.fragment && payload.fragment[0] !== '#') ||
            (Object.hasOwn(payload,'code') && (typeof payload.code !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(payload.code)))) throw new Error();
    } catch (e) { payload = null; }
    url.searchParams.delete('handoff');
    if (packed) url.hash = trusted && payload ? payload.fragment : '';
    // Strip even invalid input immediately, before network requests, app loading or sharing.
    history.replaceState(null, '', url.pathname + url.search + url.hash);
    function failed() { window.eupoiiaHandoffFailed = true; }
    window.eupoiiaHandoff = Promise.resolve().then(function () {
        if (!trusted || !payload) { failed(); return; }
        var existing = /(?:^|; )cgi_session=[A-Za-z0-9_-]+/.test(document.cookie);
        if (!existing && payload.tab && !sessionStorage.getItem('cgi_tab')) sessionStorage.setItem('cgi_tab',payload.tab);
        if (payload.theme && !localStorage.getItem('sh-theme')) {
            localStorage.setItem('sh-theme',payload.theme); document.documentElement.dataset.theme = payload.theme;
        }
        if (existing || !payload.code || new URLSearchParams(location.hash.slice(1)).has('email') || new URLSearchParams(location.search).has('login')) return;
        var controller = new AbortController(), timer = setTimeout(function () { controller.abort(); }, 10000);
        return fetch(api + '/auth/handoff/redeem', {method:'POST',body:new URLSearchParams({code:payload.code}),signal:controller.signal,credentials:'omit',referrerPolicy:'no-referrer'})
            .then(function (r) { if (!r.ok) throw new Error(); return r.json(); })
            .then(function (answer) {
                if (!/^[A-Za-z0-9_-]{43}$/.test(answer.token)) throw new Error();
                document.cookie = 'cgi_session=' + answer.token + '; Path=/; Max-Age=2592000; SameSite=Lax' + (location.protocol === 'https:' ? '; Secure' : '');
                if (!document.cookie.includes('cgi_session=' + answer.token)) throw new Error();
            }).finally(function () { clearTimeout(timer); });
    }).catch(failed);
})();
