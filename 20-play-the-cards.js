// Every page of the section runs this script; #game's data-mode says which page it is:
// - infinite: matchups as a feed of cards, one at a time. A card has two halves and its own buttons: swipe
//   left (or ←, or the left button) votes for the left one, right for the right one, up (or ↓, or Skip)
//   skips, and Draw (or = or space) is a tie. The next two are loaded ahead, and their tickets are kept in
//   localStorage, so the same pairs come back after a visit to the leaderboard.
// - daily: the Daily 10, the same cards with a progress bar, then the result in a modal.
// - pair: a shared card first, then the Daily 10 it came from, or infinite mode.
// - board, players, result: the tables, and a shared Daily 10 result.
// Players sign in with email or Bluesky. The first-party sign-in cookie stays out of public snapshots and
// persistent vote queues. Static pages send credentials in form bodies; older pages retain their headers.
// A signed-out tab has a per-tab id so its eligible votes can join the account when it signs in.
(async function () {
    'use strict';
    if (window.eupoiiaHandoff) await window.eupoiiaHandoff;
    var game = document.getElementById('game');
    if (window.eupoiiaHandoffFailed) {
        var prompt = document.createElement('p'); prompt.className = 'note'; prompt.textContent = 'Please sign in to continue.';
        game.before(prompt);
    }
    var api = game.dataset.api;
    var mode = game.dataset.mode;
    var query = new URLSearchParams(location.search);
    var early = window.cgiEarlyDeck;
    var day = query.get('d') || query.get('daily') || '';
    var seed = query.get('seed') || '';
    var staticMode = !!(game.dataset.staticBase && window.eupoiiaStatic), staticClient;

    var home = game.dataset.home;
    var publicHome = game.dataset.publicHome || new URL(home, location.href).href;
    function cookie(name, value, seconds) {
        document.cookie = name + '=' + value + '; Path=' + home + '; Max-Age=' + seconds + '; SameSite=Lax' +
            (location.protocol === 'https:' ? '; Secure' : '');
    }
    cookie('cgi_player', '', 0);  // the old anonymous cookie: gone
    function sessionToken() {
        var found = document.cookie.match(/(?:^|; )cgi_session=([A-Za-z0-9_-]+)/);
        return found ? found[1] : '';
    }
    var tab = (function () {
        if (early) return early.tab;
        var id = null;
        try { id = sessionStorage.getItem('cgi_tab'); } catch (e) { /* no storage: an id for this page only */ }
        if (!id) { id = crypto.randomUUID(); try { sessionStorage.setItem('cgi_tab', id); } catch (e) { /* kept in memory */ } }
        return id;
    })();

    function offline() {
        return '<p class="note">Couldn\'t reach the server. Reload the page to try again.</p>';
    }

    // Every request gives up after 10 s, so a hung connection can't freeze the page.
    function send(path, options) {
        var controller = new AbortController();
        var timer = setTimeout(function () { controller.abort(); }, 10000);
        options = Object.assign({ signal: controller.signal }, options);
        if (staticMode) {
            options.method = options.method || 'POST';
            var form = new URLSearchParams(options.body || '');
            if (!form.has('session')) form.set('session', tab);
            if (sessionToken()) form.set('auth', sessionToken());
            options.body = form;
        } else {
            var who = { 'X-Session': tab };
            if (sessionToken()) who['X-Auth'] = sessionToken();
            options.headers = Object.assign(who, options.headers);
        }
        return fetch(api + path, options).finally(function () { clearTimeout(timer); });
    }

    function get(path) {
        var request;
        if (staticMode && path === '/me') {
            request = send(path, { body: new URLSearchParams({context:'static', day:day || window.eupoiiaStatic.today(), seed:seed,
                p:query.get('p') || '', daily:mode === 'daily' || mode === 'pair' && day ? '1' : '',
                board:mode === 'players' ? query.get('board') || 'today' : ''}) });
        } else if (early && early.request && early.path === path) {
            request = early.request; early.request = null;
        } else request = send(path);
        return request.then(function (response) {
            if (!response.ok && response.status !== 400 && response.status !== 409 && response.status !== 429) throw new Error(response.status);
            return response.text();
        });
    }

    // Sharing copies a public URL immediately, preserving the tap's clipboard permission.
    function publicShare(form) {
        var target = new URL(form.kind === 'result' ? 'daily-10/' : 'pair/', publicHome);
        if (form.kind === 'result') {
            if (!form.p || !form.seed) throw new Error('Missing shared result');
            target.searchParams.set('d', form.day);
            target.searchParams.set('p', form.p);
            target.searchParams.set('seed', form.seed);
        } else {
            target.searchParams.set('p', form.p);
            if (form.daily) target.searchParams.set('daily', form.daily);
            if (form.seed) target.searchParams.set('seed', form.seed);
        }
        return target.href;
    }
    function legacyCopy(url) {
        var active = document.activeElement, x = window.scrollX, y = window.scrollY;
        var selection = window.getSelection(), ranges = [];
        if (selection) for (var i = 0; i < selection.rangeCount; i++) ranges.push(selection.getRangeAt(i).cloneRange());
        var field = document.createElement('textarea');
        field.value = url; field.readOnly = true; field.tabIndex = -1; field.setAttribute('aria-hidden', 'true');
        field.style.cssText = 'position:fixed;left:-10000px;top:0;width:1px;height:1px;font-size:16px;';
        document.body.appendChild(field);
        try {
            field.focus({ preventScroll: true }); field.select(); field.setSelectionRange(0, field.value.length);
            if (!document.execCommand('copy')) throw new Error('Copy refused');
        } finally {
            field.remove();
            if (active && active.isConnected) active.focus({ preventScroll: true });
            if (selection) { selection.removeAllRanges(); ranges.forEach(function (range) { selection.addRange(range); }); }
            window.scrollTo({ left: x, top: y, behavior: 'instant' });
        }
    }
    function copyNotice(where, message) {
        clearTimeout(where.copyTimer); where.textContent = message;
        where.copyTimer = setTimeout(function () { where.textContent = ''; }, 2500);
    }
    function shareLink(form, where) {
        var copied;
        try {
            var url = publicShare(form);
            try {
                copied = navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(url) : Promise.reject(new Error('Clipboard unavailable'));
            } catch (error) { copied = Promise.reject(error); }
            return Promise.resolve(copied).catch(function () { legacyCopy(url); })
                .then(function () { copyNotice(where, 'Link copied'); })
                .catch(function () { copyNotice(where, "Couldn't copy link. Try again."); });
        } catch (error) { copyNotice(where, "Couldn't copy link. Try again."); return Promise.resolve(); }
    }

    // Maths assets start only after a leaderboard has reached a painted frame.
    var mathsReady;
    function boardMath(root) {
        requestAnimationFrame(function () { requestAnimationFrame(function () {
            if (!root.querySelector('[data-tex]')) return;
            performance.mark('leaderboard-list-painted');
            if (!mathsReady) mathsReady = new Promise(function (resolve, reject) {
                performance.mark('leaderboard-maths-requested');
                var css = document.createElement('link'); css.rel = 'stylesheet'; css.href = home + 'katex/katex.min.css';
                document.head.appendChild(css);
                var script = document.createElement('script'); script.async = true; script.src = home + 'katex/katex.min.js';
                script.onload = resolve; script.onerror = reject; document.head.appendChild(script);
            });
            mathsReady.then(function () {
                root.querySelectorAll('[data-tex]').forEach(function (element) {
                    if (element.dataset.mathDone) return;
                    window.katex.render(element.dataset.tex, element, { displayMode: true, throwOnError: false });
                    element.dataset.mathDone = 'true';
                });
            }).catch(function () { /* The literal formula text remains readable if the asset is unavailable. */ });
        }); });
    }

    // One account state drives the header, mobile disclosure and result sign-in actions.
    var account = document.querySelector('.account'), signInRow = document.getElementById('sign-in-row');
    var accountMenu = document.querySelector('.account-menu'), accountPanel = document.getElementById('account-panel');
    var accountToggle = document.getElementById('account-toggle');
    var accountIcon = accountToggle && accountToggle.querySelector('svg') ? accountToggle.querySelector('svg').cloneNode(true) : null;
    var returningToAccount = !!new URLSearchParams(location.hash.slice(1)).get('email') || (!!query.get('login') && query.get('login') !== 'failed');
    var authState = returningToAccount ? 'redirect' : 'idle', currentPlayer = null, signInProviders = [], emailForm, nameForm, inboxBox, failedSignIn;
    var returnModal = null, deferredAuthResult = false, authEpoch = 0, accountRequest = 0, dismissedName = false;
    function menuOpen(open, focus) {
        if (!accountMenu) return;
        accountMenu.classList.toggle('is-open', open);
        if (accountToggle) accountToggle.setAttribute('aria-expanded', String(open));
        if (focus) {
            var first = accountPanel.querySelector('input:not([hidden]), [data-sign-in], .sign-out');
            if (first) first.focus();
        }
    }
    function publicName(player) {
        return player && player.name || '';  // the server always stores a name or a pseudonym
    }
    // Result HTML may have been generated before the account response arrived.  Only an
    // own completion gets this local identity; a shared result always keeps its owner's copy.
    function showScoreIdentity(card) {
        if (!card) return;
        // The marker distinguishes our local identity from any owner information in a shared result.
        var identity = card.querySelector('[data-score-identity]');
        if (!card.hasAttribute('data-shared-result')) {
            var explainer = card.querySelector('.score-explainer');
            if (explainer) explainer.textContent = 'Your score compares the odds when you voted with the Elo ratings at the end of the day. It can change until the day ends.';
        }
        if (card.hasAttribute('data-shared-result') || !currentPlayer) {
            if (identity) identity.remove();
            return;
        }
        if (!identity) {
            identity = document.createElement('p'); identity.className = 'score-identity';
            identity.dataset.scoreIdentity = '';
            card.insertBefore(identity, card.firstChild);
        }
        identity.replaceChildren();
        if (currentPlayer.avatar) {
            var avatar = document.createElement('img'); avatar.src = currentPlayer.avatar; avatar.alt = '';
            avatar.className = 'score-avatar'; avatar.referrerPolicy = 'no-referrer'; identity.append(avatar);
        } else if (accountIcon) {
            var fallback = accountIcon.cloneNode(true); fallback.classList.add('score-avatar'); identity.append(fallback);
        }
        var name = document.createElement('strong'); name.textContent = publicName(currentPlayer); name.title = publicName(currentPlayer);
        identity.append(name);
    }
    function refreshScoreIdentities() {
        document.querySelectorAll('.result-card').forEach(showScoreIdentity);
    }
    function authViews() {
        if (!accountMenu) return;
        accountMenu.dataset.authState = authState;
        var resultActions = document.querySelector('.modal:not([hidden]) [data-auth-actions]');
        document.querySelectorAll('[data-auth-actions]').forEach(function (actions) {
            actions.hidden = !!currentPlayer || authState !== 'idle';
        });
        if (signInRow) signInRow.hidden = !!currentPlayer || authState !== 'idle' || !signInRow.childNodes.length || !!resultActions;
        if (account) account.hidden = !currentPlayer;
        if (emailForm) emailForm.hidden = authState !== 'email';
        if (nameForm) nameForm.hidden = authState !== 'name';
        if (inboxBox) inboxBox.hidden = authState !== 'inbox';
        if (failedSignIn) failedSignIn.hidden = authState !== 'error';
    }
    function state(next) { authState = next; authViews(); }
    function broadcastAccount() {
        try { localStorage.setItem('cgi-auth-update', Date.now() + ':' + Math.random()); } catch (e) {}
    }
    function cookieValue(name) {
        var found = document.cookie.match(new RegExp('(?:^|; )' + name + '=([A-Za-z0-9_-]+)'));
        return found ? found[1] : '';
    }
    function emailBinding() {
        var value = cookieValue('cgi_email_binding');
        if (!value) {
            var bytes = new Uint8Array(32); crypto.getRandomValues(bytes);
            value = Array.from(bytes).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
        }
        cookie('cgi_email_binding', value, 30 * 60);
        return value;
    }
    function formField(form, labelText, id, type, max) {
        var label = document.createElement('label'); label.htmlFor = id; label.textContent = labelText;
        var input = document.createElement('input'); input.id = id; input.name = type === 'email' ? 'email' : 'name';
        input.type = type; input.required = true; input.maxLength = max; input.autocomplete = type === 'email' ? 'email' : 'name';
        form.append(label, input); return input;
    }
    function formButton(text, action, type) {
        var button = document.createElement('button'); button.type = type || 'button'; button.className = 'btn';
        button.textContent = text; if (action) button.addEventListener('click', action); return button;
    }
    function cancelSignIn(restore) {
        ++authEpoch;
        if (authState === 'name') dismissedName = true;
        state(currentPlayer ? 'account' : 'idle'); menuOpen(false);
        if ((restore !== false || deferredAuthResult) && returnModal && returnModal.querySelector('.result-card')) {
            returnModal.hidden = false; authViews();
            var first = returnModal.querySelector('[data-sign-in]') || returnModal.querySelector('.modal-box'); if (first) first.focus({ preventScroll: true });
        } else if (restore !== false && accountToggle && accountToggle.offsetParent) accountToggle.focus();
        returnModal = null; deferredAuthResult = false;
    }
    function hideResultForSignIn() {
        var dialog = document.querySelector('.modal:not([hidden])');
        if (dialog) { returnModal = dialog; deferredAuthResult = false; dialog.hidden = true; }
    }
    function showInbox(message) {
        if (!inboxBox) {
            inboxBox = document.createElement('div'); inboxBox.className = 'email-sign-in-form email-inbox';
            var note = document.createElement('p'); note.setAttribute('role', 'status'); inboxBox.append(note);
            inboxBox.append(formButton('Change email', function () { emailSignIn(); }),
                            formButton('Cancel', function () { cancelSignIn(); }));
            accountPanel.append(inboxBox);
        }
        inboxBox.querySelector('[role="status"]').textContent = message;
        state('inbox'); menuOpen(true);
    }
    function emailSignIn() {
        if (!signInProviders.some(function (p) { return p.name === 'email'; }) || !accountPanel) return;
        hideResultForSignIn();
        if (!emailForm) {
            emailForm = document.createElement('form'); emailForm.className = 'email-sign-in-form';
            var name = formField(emailForm, 'Name', 'signin-name', 'text', 40);
            var input = formField(emailForm, 'Email address', 'signin-email', 'email', 254);
            var submit = formButton('Send sign-in link', null, 'submit');
            var status = document.createElement('span'); status.setAttribute('role', 'status');
            emailForm.append(submit, formButton('Cancel', function () { cancelSignIn(); }), status);
            signInRow.insertAdjacentElement('afterend', emailForm);
            emailForm.addEventListener('submit', function (event) {
                event.preventDefault(); var epoch = ++authEpoch; submit.disabled = true; status.textContent = 'Sending…';
                var back = new URL(location.href); back.searchParams.delete('login'); back.hash = '';
                send('/auth/email/start', { method: 'POST', body: new URLSearchParams({ email: input.value, name: name.value.trim(),
                    binding: emailBinding(), session: tab, return: back.href }) })
                    .then(function (response) { if (!response.ok) throw new Error('email'); return response.json(); })
                    .then(function (answer) { if (epoch === authEpoch) showInbox(answer.message); })
                    .catch(function () { if (epoch === authEpoch) status.textContent = 'Use a name of 1–40 characters without a URL and a valid email address, then try again.'; })
                    .finally(function () { submit.disabled = false; });
            });
        }
        state('email'); menuOpen(true); emailForm.querySelector('input').focus();
    }
    function askName() {
        if (!accountPanel) return;
        hideResultForSignIn();
        if (!nameForm) {
            nameForm = document.createElement('form'); nameForm.className = 'email-sign-in-form name-sign-in-form';
            var input = formField(nameForm, 'Name', 'account-name', 'text', 40);
            var status = document.createElement('span'); status.setAttribute('role', 'status');
            var submit = formButton('Save name', null, 'submit');
            nameForm.append(submit, formButton('Cancel', function () { cancelSignIn(); }), status);
            accountPanel.append(nameForm);
            nameForm.addEventListener('submit', function (event) {
                event.preventDefault(); submit.disabled = true;
                send('/auth/name', { method: 'POST', body: new URLSearchParams({ name: input.value.trim() }) })
                    .then(function (response) { if (!response.ok) throw new Error('name'); return response.json(); })
                    .then(function () { broadcastAccount(); location.reload(); })
                    .catch(function () { status.textContent = 'Use a name of 1–40 characters without a URL.'; })
                    .finally(function () { submit.disabled = false; });
            });
        }
        state('name'); menuOpen(true); nameForm.querySelector('input').focus();
    }
    function signInLink(provider) {
        return api + '/auth/' + provider + '/start?session=' + encodeURIComponent(tab) + '&return=' + encodeURIComponent(location.href.split('?')[0] + location.search.replace(/[?&]login=[^&]*/, ''));
    }
    function blueskyButton(label) {
        var link = document.createElement('a'); link.className = 'btn sign-in-button bluesky-sign-in';
        link.dataset.signIn = 'bluesky'; link.href = signInLink('bluesky');
        var icon = document.createElement('img'); icon.src = home + 'bluesky-butterfly-white.svg';
        icon.alt = ''; icon.width = 20; icon.height = 20;
        var text = document.createElement('span'); text.textContent = label;
        link.append(icon, text); return link;
    }
    function retrySignIn() {
        if (!failedSignIn) return;
        var actions = failedSignIn.querySelector('.sign-in-actions'); actions.replaceChildren();
        if (signInProviders.some(function (p) { return p.name === 'email'; })) {
            var renew = formButton('Send a new link', emailSignIn); renew.classList.add('sign-in-button'); actions.append(renew);
        }
        if (signInProviders.some(function (p) { return p.name === 'bluesky'; })) actions.append(blueskyButton(failedSignIn.dataset.provider === 'bluesky' ? 'Try Bluesky sign-in again' : 'Sign in with Bluesky'));
    }
    var accountConfirmed = 0, displayCacheKey = 'cgi-account-display-v1';
    var defaultSignIn = [{name:'bluesky',label:'Bluesky'},{name:'email',label:'Email'}];
    function accountCredential(token) {
        return crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)).then(function (bytes) {
            return Array.from(new Uint8Array(bytes)).map(function (n) { return n.toString(16).padStart(2,'0'); }).join('');
        });
    }
    function cacheAccount(player, token) {
        if (!token || !player) { try { localStorage.removeItem(displayCacheKey); } catch (e) {} return; }
        // Public display fields only; a one-way fingerprint binds them to this cookie without storing it.
        var confirmed = accountConfirmed;
        var display = {name:player.name,handle:player.handle,provider:player.provider,avatar:player.avatar};
        accountCredential(token).then(function (stamp) {
            if (sessionToken() !== token || accountConfirmed !== confirmed) return;
            try { localStorage.setItem(displayCacheKey,JSON.stringify({credential:stamp,player:display})); } catch (e) {}
        }).catch(function () {});
    }
    function paintKnownAccount() {
        var token = sessionToken(), confirmed = accountConfirmed;
        showAccount({player:token ? {name:''} : null,sign_in:defaultSignIn}, true);  // the name arrives with /me
        if (!token) return;
        var candidates = [];
        [displayCacheKey,'eupoiia-public-account-v1'].forEach(function (key) {
            try { var value = JSON.parse(localStorage.getItem(key)); if (value) candidates.push(value); } catch (e) {}
        });
        accountCredential(token).then(function (stamp) {
            if (sessionToken() !== token || accountConfirmed !== confirmed) return;
            var cached = candidates.find(function (value) { return value.credential === stamp && value.player; });
            if (cached) showAccount({player:cached.player,sign_in:defaultSignIn}, true);
        }).catch(function () {});
    }
    function showAccount(me, provisional) {
        if (!account) return;
        var prior = currentPlayer; currentPlayer = me.player || null;
        account.replaceChildren(); if (signInRow) signInRow.replaceChildren(); signInProviders = me.sign_in || [];
        if (currentPlayer) {
            if (currentPlayer.avatar) {
                var img = document.createElement('img'); img.src = currentPlayer.avatar; img.alt = ''; img.className = 'avatar'; img.referrerPolicy = 'no-referrer'; account.append(img);
            }
            var who = document.createElement('span'); who.className = 'account-name'; who.textContent = publicName(currentPlayer) ? 'Signed in as ' + publicName(currentPlayer) : 'Signed in'; who.title = publicName(currentPlayer);
            account.append(who, formButton('Sign out', function () {}, 'button')); account.lastChild.className = 'sign-out';
            if (authState !== 'error') state('account');
            if (accountToggle) {
                accountToggle.replaceChildren(); accountToggle.setAttribute('aria-label', publicName(currentPlayer) ? 'Account: ' + publicName(currentPlayer) : 'Account');
                if (currentPlayer.avatar) {
                    var avatar = document.createElement('img'); avatar.src = currentPlayer.avatar; avatar.alt = ''; avatar.className = 'avatar'; avatar.referrerPolicy = 'no-referrer'; accountToggle.append(avatar);
                } else if (accountIcon) accountToggle.append(accountIcon.cloneNode(true));
                var label = document.createElement('span'); label.className = 'account-label';
                label.textContent = publicName(currentPlayer); label.title = publicName(currentPlayer); accountToggle.append(label);
            }
            if (!provisional && currentPlayer.needs_name && !dismissedName) askName();
        } else {
            if (!provisional && (prior || authState === 'redirect')) state('idle');
            if (accountToggle) {
                accountToggle.replaceChildren(); accountToggle.setAttribute('aria-label', 'Sign in');
                if (accountIcon) accountToggle.append(accountIcon.cloneNode(true));
                var label = document.createElement('span'); label.className = 'account-label'; label.textContent = 'Sign in'; accountToggle.append(label);
            }
            signInProviders.forEach(function (p) {
                if (p.name === 'bluesky') signInRow.append(blueskyButton('Sign in with Bluesky'));
                else if (p.name === 'email') {
                    var button = formButton('Sign in with email', null); button.className = 'btn sign-in-button email-sign-in';
                    button.dataset.signIn = 'email'; signInRow.append(button);
                } else if (p.name === 'x') {
                    var link = document.createElement('a'); link.className = 'sign-in-button'; link.href = signInLink('x'); link.textContent = 'Sign in with ' + p.label; signInRow.append(link);
                }
            });
        }
        refreshScoreIdentities(); retrySignIn(); authViews();
    }
    function loginFailure(message, provider) {
        if (!accountPanel) return;
        if (!failedSignIn) {
            failedSignIn = document.createElement('div'); failedSignIn.className = 'note account-error';
            var note = document.createElement('p'); note.setAttribute('role', 'status');
            var actions = document.createElement('div'); actions.className = 'sign-in-actions';
            failedSignIn.append(note, actions); accountPanel.append(failedSignIn);
        }
        failedSignIn.dataset.provider = provider || '';
        failedSignIn.querySelector('[role="status"]').textContent = message;
        state('error'); retrySignIn(); menuOpen(true);
    }
    function refreshAccount(reactive) {
        var request = ++accountRequest, prior = currentPlayer, requestToken = sessionToken();
        return get('/me').then(function (text) {
            if (request !== accountRequest) return;
            if (requestToken !== sessionToken()) return refreshAccount(reactive);
            var me = JSON.parse(text);
            if (!Object.prototype.hasOwnProperty.call(me,'player') || !Array.isArray(me.sign_in)) return;
            var next = me.player; accountConfirmed++;
            if (!next && requestToken) { cookie('cgi_session','',0); requestToken = ''; }
            showAccount(me); cacheAccount(next,requestToken);
            if (staticClient) {
                var priorDaily = staticClient.state();
                staticClient.identity(me).then(function () {
                    if (requestToken !== sessionToken()) return;
                    if (sharedActive && sharedOwner && Object.prototype.hasOwnProperty.call(me,'shared_result')) {
                        sharedFromAccount = true; applyShared(me.shared_result && me.shared_result.html,false);
                    }
                    var nextDaily = staticClient.state();
                    if (!deck || busy) return;
                    if ((mode === 'daily' || mode === 'pair' && day) &&
                        (nextDaily && (!priorDaily || priorDaily.seed !== nextDaily.seed || priorDaily.done !== nextDaily.done) ||
                         me.daily && me.daily.requested && (!priorDaily || priorDaily.seed !== me.daily.requested.seed))) load();
                    else if (top() && (me.voted || []).includes(top().dataset.pair)) load();
                });
            }
            if (reactive && ((prior && prior.handle) !== (next && next.handle) ||
                (prior && prior.name) !== (next && next.name) || (prior && prior.needs_name) !== (next && next.needs_name))) location.reload();
        }, function () {});
    }
    paintKnownAccount();
    if (query.get('login') === 'failed') loginFailure("Bluesky sign-in didn't finish. Try again.", 'bluesky');
    function exchangeCode(code) {
        return send('/auth/login', { method: 'POST', body: new URLSearchParams({ code: code }) })
            .then(function (r) { if (!r.ok) throw new Error('login'); return r.json(); })
            .then(function (answer) { cookie('cgi_session', answer.token, 30 * 24 * 3600); broadcastAccount(); });
    }
    var authenticated = (function () {
        var emailToken = new URLSearchParams(location.hash.slice(1)).get('email');
        if (emailToken) {
            history.replaceState(null, '', location.pathname + location.search);
            return send('/auth/email/redeem', { method: 'POST', body: new URLSearchParams({
                token: emailToken, binding: cookieValue('cgi_email_binding') }) })
                .then(function (response) {
                    return response.json().then(function (answer) {
                        if (!response.ok) {
                            var messages = {
                                used: 'This link was already used. Send a new one?',
                                expired: 'This link has expired. Send a new one?',
                                invalid: "This link isn't valid. Send a new one?"
                            };
                            loginFailure(messages[answer.error] || "This link couldn't be checked. Try again or send a new one.", 'email');
                            return null;
                        }
                        return answer;
                    });
                })
                .then(function (answer) { if (answer && !answer.already_signed_in) return exchangeCode(answer.code); })
                .catch(function () { loginFailure("This link couldn't be checked. Try again or send a new one.", 'email'); });
        }
        var code = query.get('login');
        if (!code) return Promise.resolve();
        query.delete('login');
        history.replaceState(null, '', location.pathname + (query.toString() ? '?' + query : '') + location.hash);
        if (code === 'failed') return Promise.resolve();
        return exchangeCode(code).catch(function () { loginFailure("Sign-in didn't finish. Try again."); });
    })();
    authenticated.then(function () { return refreshAccount(false); });
    window.addEventListener('storage', function (event) { if (event.key === 'cgi-auth-update') authenticated.then(function () { refreshAccount(true); }); });
    window.addEventListener('focus', function () { authenticated.then(function () { refreshAccount(true); }); });
    window.addEventListener('pageshow', function (event) { if (event.persisted && authState === 'redirect') { cancelSignIn(); refreshAccount(true); } });
    document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape' && ((accountMenu && accountMenu.classList.contains('is-open')) || ['email','name','inbox','error'].includes(authState))) {
            event.preventDefault(); event.stopImmediatePropagation(); cancelSignIn();
        } else if (event.key === 'ArrowDown' && accountToggle && event.target === accountToggle) {
            event.preventDefault(); menuOpen(true, true);
        }
    });
    document.addEventListener('click', function (event) {
        var prompt = event.target.closest('[data-sign-in]');
        if (accountToggle && accountToggle.contains(event.target)) {
            menuOpen(!accountMenu.classList.contains('is-open')); return;
        }
        if (accountMenu && accountMenu.classList.contains('is-open') && !accountMenu.contains(event.target) && !prompt) cancelSignIn(false);
        if (event.target.closest('.sign-out')) {
            send('/auth/logout', { method: 'POST' }).finally(function () { cookie('cgi_session', '', 0); broadcastAccount(); location.reload(); });
        }
        if (prompt) {
            event.preventDefault();
            if (prompt.dataset.signIn === 'email') emailSignIn();
            else if (prompt.dataset.signIn === 'bluesky') { hideResultForSignIn(); state('redirect'); location.href = signInLink('bluesky'); }
        }
    });

    if (staticMode) {
        var bootstrapNode = document.getElementById('cgi-static-bootstrap');
        staticClient = window.eupoiiaStatic.create({base:game.dataset.staticBase, fallback:game.dataset.staticFallback,
            bootstrap:bootstrapNode ? JSON.parse(bootstrapNode.textContent) : null, home:home, tab:tab, token:sessionToken, send:send,
            refresh:function () { refreshAccount(false); }, notice:staticNotice,
            saved:function (answer) {
                if (!deck) return;
                if (answer.counted_html) result.innerHTML = answer.counted_html;
                var state = staticClient.state();
                if (state && mode === 'daily') {
                    showProgress(state.done);
                    if (state.result_html) take(state.result_html);
                }
            },
            refused:function (answer) {
                if (answer.reason === 'seed_conflict' && deck) {
                    result.textContent = "You already started this day's Daily 10. Your original set is kept.";
                    sharedNotice("You already started this day's Daily 10. Continue with your original set.", 'Continue your Daily 10');
                    load();
                } else staticNotice(answer.message || "This vote couldn't be saved. Please try another card.");
            }});
    }
    function staticNotice(message) {
        var note = accountPanel.querySelector('.vote-error');
        if (!note) { note = document.createElement('p'); note.className = 'note vote-error'; note.setAttribute('role','status'); accountPanel.append(note); }
        note.textContent = message; menuOpen(true);
    }

    if (mode === 'board') {  // the People & groups table, or one contender's matches (?c=<id>)
        if (staticClient) {
            if (query.get('c')) staticClient.contender(query.get('c')).then(function (html) { game.innerHTML = html; boardMath(game); });
            else staticClient.board(game, false, ['person','group'].includes(query.get('kind')) ? query.get('kind') : 'all', boardMath);
            return;
        }
        get(query.get('c') ? '/contender?c=' + encodeURIComponent(query.get('c')) : '/leaderboard?page=' + encodeURIComponent(query.get('page') || '1'))
            .then(function (html) { game.innerHTML = html; boardMath(game); }, function () { game.innerHTML = offline(); });
        return;
    }
    if (mode === 'result') {  // Legacy static result pages now open the Daily 10 with the shared overlay.
        var legacy = new URL(home + 'daily-10/', location.href);
        if (day) legacy.searchParams.set('d', day);
        if (query.get('p')) legacy.searchParams.set('p', query.get('p'));
        if (seed) legacy.searchParams.set('seed', seed);
        legacy.hash = location.hash;
        location.replace(legacy.href); return;
    }
    if (mode === 'players') {  // the Players table: Today or All time
        var box = game.querySelector('.board-box'), boardRequest = 0;
        var showBoard = function (which) {
            game.querySelectorAll('[data-board]').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.board === which); });
            var request = ++boardRequest;
            if (staticClient) {
                if (showBoard.stop) showBoard.stop();
                showBoard.stop = staticClient.board(box,true,which,boardMath);
                return;
            }
            get('/players?board=' + which + '&page=' + encodeURIComponent(query.get('page') || '1') + '&day=' + encodeURIComponent(query.get('day') || ''))
                .then(function (html) { if (request === boardRequest) { box.innerHTML = html; boardMath(box); } },
                      function () { if (request === boardRequest) box.innerHTML = offline(); });
        };
        game.querySelectorAll('[data-board]').forEach(function (b) { b.addEventListener('click', function () { query.set('board', b.dataset.board); query.delete('page'); history.pushState(null, '', '?' + query); showBoard(b.dataset.board); }); });
        window.addEventListener('popstate', function () { query = new URLSearchParams(location.search); showBoard(query.get('board') === 'all' ? 'all' : 'today'); });
        if (staticClient) showBoard(query.get('board') === 'all' ? 'all' : 'today');
        else authenticated.then(function () { showBoard(query.get('board') === 'all' ? 'all' : 'today'); });
        return;
    }

    var deck = game.querySelector('.deck');
    var result = game.querySelector('.result');
    var modal = document.querySelector('.modal');
    var progress = game.querySelector('.progress');
    var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var KEEP = 'common-good-deck', HINTED = 'common-good-hinted';
    var sharedActive = false, deferredOwnResult = null, sharedFromAccount = false;
    var sharedOwner = mode === 'daily' ? query.get('p') : '';
    var busy = false;  // one vote at a time: a fast double gesture can't spend two tickets

    // localStorage can be missing or throw (a private window): then the page simply draws new pairs.
    function remember(key, value) { try { window.localStorage.setItem(key, value); } catch (e) { /* not kept */ } }
    function recall(key) { try { return window.localStorage.getItem(key); } catch (e) { return null; } }

    function cards() { return Array.prototype.slice.call(deck.querySelectorAll('.card:not(.leaving)')); }
    function top() { return cards()[0] || null; }
    function showPictures(card) {
        if (!card) return;
        card.querySelectorAll('.picture img').forEach(function (picture) {
            picture.fetchPriority = 'high'; picture.loading = 'eager';
        });
    }
    function keepDeck() {  // only infinite mode keeps its queue; a Daily 10 is kept by the service
        if (mode === 'infinite' && !staticClient) remember(KEEP, cards().map(function (card) { return card.dataset.token; }).join(','));
    }

    function showProgress(done) {
        progress.hidden = false;
        progress.querySelector('span').style.width = (done * 10) + '%';
        progress.querySelector('.progress-label').textContent = done + ' / 10 done';
    }

    function sharedNotice(message, label) {
        var card = modal.querySelector('[data-shared-result]');
        if (!card) return;
        var note = card.querySelector('.shared-notice');
        if (!note) { note = document.createElement('p'); note.className = 'note shared-notice'; card.insertBefore(note, card.querySelector('.actions')); }
        note.textContent = message;
        var play = card.querySelector('[data-play-shared]'); if (play && label) play.textContent = label;
    }
    // A shared score never becomes the recipient's completion or changes their progress to ten.
    function showShared(card) {
        sharedActive = true;
        modal.querySelector('.modal-body').innerHTML = '';
        modal.querySelector('.modal-body').appendChild(card);
        modal.hidden = ['email', 'name', 'inbox', 'error', 'redirect'].includes(authState);
        if (modal.hidden) { returnModal = modal; deferredAuthResult = true; }
        else modal.querySelector('.modal-box').focus({ preventScroll: true });
        authViews();
    }
    function applyShared(html, waiting) {
        if (!sharedActive || !sharedOwner) return;
        var fragment = document.createElement('div'); fragment.innerHTML = html || '';
        var shared = fragment.querySelector('[data-shared-result]');
        if (!shared) {
            shared = document.createElement('div'); shared.className = 'result-card'; shared.dataset.sharedResult = '';
            var note = document.createElement('p'); note.className = 'note'; note.textContent = waiting ? 'Loading this shared result…' : 'This shared result is unavailable.';
            var play = document.createElement('button'); play.className = 'btn'; play.dataset.playShared = ''; play.textContent = 'Play to find out your own score';
            shared.append(note,play);
        }
        showShared(shared);
    }
    function showResult(card) {
        if (sharedActive) {
            deferredOwnResult = card; showProgress(10);
            sharedNotice("You already finished this day's Daily 10. Continue to see your saved result.", 'See your Daily 10');
            if (!top()) deck.innerHTML = '<p class="note">Done for this day.</p>';
            return;
        }
        showScoreIdentity(card);
        modal.querySelector('.modal-body').innerHTML = '';
        modal.querySelector('.modal-body').appendChild(card);
        modal.hidden = ['email', 'name', 'inbox', 'error', 'redirect'].includes(authState);
        if (modal.hidden) { returnModal = modal; deferredAuthResult = true; }
        else modal.querySelector('.modal-box').focus({ preventScroll: true });
        authViews();
        showProgress(10);
        if (!top()) deck.innerHTML = '<p class="note">Done for this day.</p>';
    }

    // Add the cards in a fragment to the back of the deck, and show what it says was counted or refused, the
    // Daily 10's progress, or its result.
    function take(html) {
        var box = document.createElement('div');
        box.innerHTML = html;
        box.querySelectorAll('.card').forEach(function (card) { deck.appendChild(card); });
        showPictures(top());
        var message = box.querySelector('.note:not(.result-card .note)');
        var slow = box.querySelector('[data-slow]');
        var now = box.querySelector('.progress-now');
        var finished = box.querySelector('[data-finished]');
        if (message && !message.closest('.card')) result.innerHTML = message.innerHTML;
        if (now) { mode = 'daily'; day = now.dataset.day; seed = now.dataset.seed || seed; showProgress(Number(now.dataset.done)); }
        if (finished) { mode = 'daily'; day = finished.dataset.day; seed = finished.dataset.seed || seed; showResult(finished); return; }
        if (!top()) {
            if (slow) deck.innerHTML = slow.outerHTML;
            else if (staticClient) { var empty = document.createElement('p'); empty.className = 'note'; empty.textContent = message ? message.textContent : 'Saving your Daily 10 result…'; deck.replaceChildren(empty); }
            else deck.innerHTML = offline();
        }
        keepDeck();
    }

    function dropBallot(card, side) {  // the ballot on that side's button drops into its box
        var button = card && card.querySelector('[data-choice="' + side + '"]');
        if (reduced || !button) return;
        button.classList.remove('drop');
        void button.offsetWidth;  // restart the animation
        button.classList.add('drop');
    }

    // Vote 'a', 'b' or 'tie', or 'skip', on the top card (and only if `card`, when given, is still the top
    // one). Returns false if nothing was sent.
    function choose(choice, card, fromRelease) {
        card = card || top();
        if (!card || !card.querySelector('[data-choice]') || card !== top() || busy || !modal.hidden) return false;
        if (!fromRelease) clearGlow();  // keyboard/buttons reset feedback; a released swipe keeps its fade
        busy = true;
        var body = new URLSearchParams({ matchup: card.dataset.token });
        if (choice !== 'skip') body.set('choice', choice === 'tie' ? 'tie' : card.querySelector('.half-' + choice).dataset.qid);
        dropBallot(card, choice);
        // The card leaves (up for a skip or a draw, toward the chosen side for a vote) while the next one
        // comes up from below into its place (CSS: .card.leaving + .card). Reduced motion swaps in place.
        window.scrollTo({ top: 0, left: 0, behavior: 'instant' });  // back to the top: the next card starts under the header
        card.classList.add('leaving', 'leave-' + choice);
        showPictures(top());
        card.style.transform = '';
        setTimeout(function () { cardSizes.unobserve(card); card.remove(); }, reduced ? 0 : 360);
        keepDeck();
        if (staticClient) {
            Promise.all([staticClient.choose(choice, card), new Promise(function (resolve) { setTimeout(resolve, reduced ? 0 : 360); })])
                .then(function () { if (mode === 'pair') mode = day ? 'daily' : 'infinite'; return load(); })
                .catch(function () { staticNotice("This vote couldn't be kept. Please try again."); })
                .finally(function () { busy = false; });
            return true;
        }
        var token = card.dataset.token;
        send(choice === 'skip' ? '/skip' : '/vote', { method: 'POST', body: body, keepalive: true })
            .then(function (response) {
                // Refused (an expired or used ticket): ask for the deck again with that ticket first, so an
                // expired one comes back as a fresh ticket for the same pair and a used one is dropped.
                if (response.status === 400) return response.text().then(function (html) { take(html); return load(token); });
                if (!response.ok && response.status !== 429) throw new Error(response.status);
                return response.text().then(function (html) {
                    busy = false;  // before the next card shows, so a quick tap on it counts
                    take(html);
                    if (mode === 'pair') { mode = 'infinite'; return load(); }  // a shared card, then infinite mode
                });
            })
            .catch(function () { result.innerHTML = offline(); return load(token); })  // refill rather than let the deck run dry
            .then(function () { busy = false; });
        return true;
    }

    var staticLoad = 0;
    function load(first) {
        if (staticClient) {
            var request = ++staticLoad;
            return staticClient.load(mode,day,seed,query.get('p')).then(function (html) {
                if (request !== staticLoad) return;
                var current = staticClient.state();
                if (current && (mode === 'daily' || mode === 'pair' && day)) {
                    var changedSeed = seed && seed !== current.seed;
                    day = current.day; seed = current.seed;
                    if (changedSeed) {
                        if (mode === 'pair') mode = 'daily';
                        result.textContent = "You already started this day's Daily 10. Your original set is kept.";
                        sharedNotice("You already started this day's Daily 10. Continue with your original set.",'Continue your Daily 10');
                    }
                    showProgress(current.done);
                    if (!sharedActive && mode === 'daily') {
                        query.delete('p'); query.delete('daily'); query.set('d',day); query.set('seed',seed);
                        history.replaceState(null,'',home+'daily-10/?'+query+location.hash);
                    }
                }
                deck.innerHTML = ''; take(html); hint();
            }).catch(function () {  // say which thing failed: a link to a pair that doesn't exist, a day that is gone, or no connection
                if (top()) return;
                var note = document.createElement('p'); note.className = 'note';
                note.textContent = navigator.onLine === false ? "You're offline, and this page has no saved cards. Reconnect and reload."
                    : mode === 'pair' ? 'This link doesn’t lead to a matchup. Try Random or today’s Daily 10.'
                    : day && day !== window.eupoiiaStatic.today() ? 'That day’s Daily 10 isn’t available. Try Random or today’s Daily 10.'
                    : 'The Daily 10 didn’t load. Reload the page to try again.';
                deck.replaceChildren(note);
            });
        }
        var path;
        if (mode === 'daily') {
            path = '/daily?day=' + encodeURIComponent(day) + (seed ? '&seed=' + encodeURIComponent(seed) : '');
        } else if (mode === 'pair') {
            path = '/pair?p=' + encodeURIComponent(query.get('p') || '') + (day ? '&daily=' + encodeURIComponent(day) : '') + (seed ? '&seed=' + encodeURIComponent(seed) : '');
        } else {
            var keep = (first ? [first] : []).concat((recall(KEEP) || '').split(',')).filter(Boolean).slice(0, 3);
            path = '/deck?keep=' + encodeURIComponent(keep.join(','));
        }
        return get(path)
            .then(function (html) {
                var fragment = document.createElement('div'); fragment.innerHTML = html;
                var conflict = fragment.querySelector('[data-daily-conflict]');
                if (conflict && conflict.dataset.seed && seed !== conflict.dataset.seed) {
                    mode = 'daily'; seed = conflict.dataset.seed; day = conflict.dataset.day || day;
                    if (!sharedActive) {
                        query.delete('p'); query.delete('daily'); query.set('d', day); query.set('seed', seed);
                        history.replaceState(null, '', home + 'daily-10/?' + query + location.hash);
                    }
                    result.textContent = "You already started this day's Daily 10. Your original set is kept.";
                    sharedNotice("You already started this day's Daily 10. Continue with your original set.", 'Continue your Daily 10');
                    return load();
                }
                deck.innerHTML = ''; take(html); hint();
            }, function () { if (!top()) deck.innerHTML = offline(); });
    }

    // Once per browser: wiggle the card and drop a ballot on both sides, to show what the page does.
    function hint() {
        if (reduced || recall(HINTED) || !top()) return;
        remember(HINTED, '1');
        deck.classList.add('hint');
        setTimeout(function () { deck.classList.remove('hint'); }, 1000);
        setTimeout(function () { dropBallot(top(), 'a'); dropBallot(top(), 'b'); }, 300);
    }

    // Touch gestures must read through every visible scroll container before they may drag the card.
    // A mouse or trackpad is a deliberate desktop drag at every viewport size, including on a hybrid laptop.
    function visibleViewport() {
        var view = window.visualViewport;
        var top = view ? Math.max(0, view.offsetTop || 0) : 0;
        var bottom = Math.min(window.innerHeight, view ? (view.offsetTop || 0) + view.height : window.innerHeight);
        return { top: top, bottom: bottom, height: Math.max(0, bottom - top) };
    }
    function contentAtEnd(card) {
        var elements = [card].concat(Array.prototype.slice.call(card.querySelectorAll('*')));
        return elements.every(function (element) {
            if (!element.clientHeight || element.scrollHeight - element.clientHeight <= 2 || !element.getClientRects().length) return true;
            if (!/^(auto|scroll|overlay|hidden)$/.test(getComputedStyle(element).overflowY)) return true;
            return element.scrollHeight - element.clientHeight - Math.max(0, element.scrollTop) <= 2;
        });
    }
    function mayDrag(card) {
        var view = visibleViewport(), bottom = card.getBoundingClientRect().bottom;
        return bottom >= view.top && bottom <= view.bottom + 2 && contentAtEnd(card);
    }
    function sizeCard(card) {
        card.classList.toggle('scrollable', card.offsetHeight > visibleViewport().height - 32);
    }
    var cardSizes = new ResizeObserver(function (entries) {
        entries.forEach(function (entry) { sizeCard(entry.target); });
    });
    function watchCards() { cards().forEach(function (card) { sizeCard(card); cardSizes.observe(card); }); }
    new MutationObserver(watchCards).observe(deck, { childList: true });
    window.addEventListener('resize', watchCards);
    deck.addEventListener('toggle', function (event) {
        var card = event.target.closest('.card');
        if (card) { card.classList.toggle('expanded', !!card.querySelector('details[open]')); sizeCard(card); }
    }, true);

    // Capture only an actual drag; taps keep working on every button, summary and link.
    var drag = null, dragged = false;
    // Body-level fixed edges stay at the viewport while the card moves or clips its contents.
    var edgeGlows = {};
    ['left', 'right'].forEach(function (side) {
        var edge = document.createElement('div');
        edge.className = 'swipe-glow swipe-glow-' + side;
        edge.setAttribute('aria-hidden', 'true');
        edge.style.setProperty('--glow-strength', 0);
        document.body.appendChild(edge);
        edgeGlows[side] = edge;
    });
    var feedbackFrame = 0, glowRelease = 0;
    function clearGlow(fade) {
        cancelAnimationFrame(feedbackFrame); feedbackFrame = 0;
        clearTimeout(glowRelease); glowRelease = 0;
        ['left', 'right'].forEach(function (side) {
            var edge = edgeGlows[side];
            edge.classList.toggle('is-releasing', !!fade);
            if (fade) edge.style.opacity = '0';
            else { edge.style.opacity = ''; edge.style.setProperty('--glow-strength', 0); }
        });
        if (fade) glowRelease = setTimeout(function () { clearGlow(); }, 180);
    }
    function threshold(card) { return Math.max(80, card.offsetWidth * 0.28); }  // past this the vote commits
    function lean(card, dx, dy) {
        var sideways = Math.abs(dx) >= Math.abs(dy);
        var progress = sideways ? Math.min(Math.abs(dx) / threshold(card), 1) : 0;
        var strength = 1 - Math.pow(1 - progress, 2);
        edgeGlows.left.style.setProperty('--glow-strength', dx < 0 ? strength : 0);
        edgeGlows.right.style.setProperty('--glow-strength', dx > 0 ? strength : 0);
    }
    function scheduleFeedback() {
        if (feedbackFrame) return;
        feedbackFrame = requestAnimationFrame(function () {
            feedbackFrame = 0;
            if (!drag || drag.state !== 'dragging' || drag.card !== top()) return;
            drag.card.style.transform = reduced ? '' : 'translate(' + drag.dx + 'px, ' + Math.min(drag.dy, 0) + 'px) rotate(' + drag.dx / 25 + 'deg)';
            lean(drag.card, drag.dx, drag.dy);
        });
    }
    function aim(dx, dy, limit) {
        if (-dy > limit && -dy > Math.abs(dx)) return 'skip';
        if (dx > limit) return 'b';
        if (dx < -limit) return 'a';
        return '';
    }
    function readingText(target) {
        // A vertical pan in the prose is always reading, even after the card is armed.
        // Picture and control surfaces remain available for the intentional swipe-up shortcut.
        return !!target.closest('h3, .gist, .intro');
    }
    deck.addEventListener('pointerdown', function (event) {
        var card = top();
        if (!event.isPrimary || event.button !== 0) return;
        clearGlow();  // every fresh primary gesture starts with both viewport edges dark
        if (!card || busy || !card.contains(event.target)) return;
        var bounds = card.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) return;
        drag = { card: card, id: event.pointerId, x: event.clientX, y: event.clientY, dx: 0, dy: 0,
                 eligible: event.pointerType === 'mouse' || mayDrag(card),
                 reading: event.pointerType !== 'mouse' && readingText(event.target),
                 state: 'pending' };
        dragged = false;  // a press only becomes a drag once it moves; until then a tap stays a tap on its button
    });
    function moveDrag(x, y) {
        // A keyboard vote can retire a card while its original finger is still down.
        if (drag.card !== top()) { release({ pointerId: drag.id, type: 'pointercancel' }); return; }
        drag.dx = x - drag.x;
        drag.dy = y - drag.y;
        if (drag.state === 'scroll' || drag.state === 'blocked') return;
        if (drag.state === 'pending' && Math.hypot(drag.dx, drag.dy) >= 10) {
            if ((drag.dy > 0 || drag.reading) && Math.abs(drag.dy) >= Math.abs(drag.dx)) { drag.state = 'scroll'; return; }
            if (!drag.eligible) { drag.state = Math.abs(drag.dy) >= Math.abs(drag.dx) ? 'scroll' : 'blocked'; return; }
            drag.state = 'dragging';
            dragged = true;  // page scrolling is not a card drag and must not suppress its next tap
            drag.card.setPointerCapture(drag.id);
            drag.card.classList.add('dragging');
        }
        if (!dragged) return;
        scheduleFeedback();
    }
    deck.addEventListener('pointermove', function (event) {
        if (drag && event.pointerId === drag.id) moveDrag(event.clientX, event.clientY);
    });
    // Native vertical scrolling stays available until an eligible left/right/up gesture is chosen.
    // Safari needs a non-passive touch listener to cancel an upward page pan before it takes ownership.
    deck.addEventListener('touchmove', function (event) {
        if (drag && event.touches.length === 1) moveDrag(event.touches[0].clientX, event.touches[0].clientY);
        if (drag && drag.state === 'dragging' && event.cancelable) event.preventDefault();
    }, { passive: false });
    function release(event) {
        if (!drag || event.pointerId !== drag.id) return;
        var done = drag;
        drag = null;
        clearGlow(done.state === 'dragging');  // hold the last geometry while a released glow fades
        if (done.card.hasPointerCapture(done.id)) done.card.releasePointerCapture(done.id);
        if (done.state !== 'dragging') return;  // a tap: its click does the work
        done.card.classList.remove('dragging');
        var choice = event.type === 'pointerup' ? aim(done.dx, done.dy, threshold(done.card)) : '';
        if (!choice || !choose(choice, done.card, true)) {  // a short drag snaps back and casts nothing
            if (!reduced && done.card.style.transform) {
                done.card.classList.add('returning');
                clearTimeout(done.card.returningTimer);
                done.card.returningTimer = setTimeout(function () { done.card.classList.remove('returning'); }, 360);
            }
            done.card.style.transform = '';
        }
    }
    deck.addEventListener('touchstart', function (event) {
        if (drag && event.touches.length > 1) release({ pointerId: drag.id, type: 'pointercancel' });
        else if (drag && drag.state === 'pending') drag.eligible = drag.eligible && mayDrag(drag.card);
    }, { passive: true });
    deck.addEventListener('pointerup', release);
    deck.addEventListener('pointercancel', release);
    deck.addEventListener('lostpointercapture', function (event) {
        if (drag && event.target === drag.card) release(event);
    });
    deck.addEventListener('dragstart', function (event) { event.preventDefault(); });

    deck.addEventListener('click', function (event) {
        if (dragged) {
            dragged = false;
            if (event.detail !== 0) { event.preventDefault(); return; }  // suppress pointer clicks, preserve keyboard activation
        }
        var button = event.target.closest('[data-choice]');
        if (button) choose(button.dataset.choice, button.closest('.card'));
        var share = event.target.closest('.share');
        if (share) {
            var card = share.closest('.card'), note = card.querySelector('.share-note');
            shareLink({ kind: 'pair', p: card.dataset.pair, daily: card.dataset.day || '', seed: card.dataset.seed || '' }, note);
        }
        var past = event.target.closest('[data-continue]') && event.target.closest('[data-past]');
        if (past) {  // after a shared pair already voted on: on in the mode the service said
            mode = past.dataset.mode || 'infinite';
            day = past.dataset.day || '';
            load();
        }
    });

    function closeResult() {
        modal.hidden = true;
        if (sharedActive) {
            sharedActive = false; sharedOwner = '';
            query.delete('p'); query.set('d', day); if (seed) query.set('seed', seed);
            history.replaceState(null, '', location.pathname + '?' + query + location.hash);
            if (deferredOwnResult) { var own = deferredOwnResult; deferredOwnResult = null; showResult(own); }
            else { var first = top(); if (first) first.querySelector('[data-choice]').focus({ preventScroll: true }); }
            return;
        }
        location.href = game.dataset.home;
    }
    document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape' && !modal.hidden) closeResult();
    });
    document.addEventListener('click', function (event) {  // the result modal and its buttons
        if (event.target.closest('.modal-close, [data-play-shared]') || event.target === modal) closeResult();
        var shareResult = event.target.closest('[data-share-result]');
        if (shareResult) {
            var owner = shareResult.closest('.result-card');
            shareLink({ kind: 'result', day: owner.dataset.day, p: owner.dataset.handle, seed: owner.dataset.seed }, shareResult.parentNode.querySelector('.copied'));
        }
    });

    var KEYS = { ArrowLeft: 'a', ArrowRight: 'b', ArrowDown: 'skip', '=': 'tie', ' ': 'tie' };
    document.addEventListener('keydown', function (event) {
        var choice = KEYS[event.key];
        if (!choice || event.metaKey || event.ctrlKey || event.altKey || event.repeat || event.isComposing) return;
        if (event.target.closest('.account-menu') || (accountMenu && accountMenu.classList.contains('is-open'))) return;
        if (event.target.closest('input, textarea, select, [contenteditable], details')) return;  // typing, or reading an intro
        if (event.key === ' ' && event.target.closest('button, a')) return;  // Space presses a focused button
        event.preventDefault();
        choose(choice);
    });

    function startCards() {
        if (!sharedOwner) return load();
        if (staticClient) {
            sharedActive = true; applyShared(null,true);
            staticClient.shared(day,sharedOwner,seed).then(function (html) { if (!sharedFromAccount) applyShared(html,!html); });
            return load();
        }
        var path = '/result?day=' + encodeURIComponent(day) + '&p=' + encodeURIComponent(sharedOwner) + (seed ? '&seed=' + encodeURIComponent(seed) : '');
        var sharedRequest = staticClient ? staticClient.shared(day,sharedOwner,seed) : send(path).then(function (response) { return response.text(); });
        return sharedRequest.then(function (html) {
            var fragment = document.createElement('div'); fragment.innerHTML = html;
            var shared = fragment.querySelector('[data-shared-result]');
            if (shared) {
                day = shared.dataset.day || day; seed = shared.dataset.seed || seed; showShared(shared);
            } else {
                var missing = document.createElement('div'); missing.className = 'result-card'; missing.dataset.sharedResult = '';
                var message = document.createElement('p'); message.className = 'note'; message.textContent = 'This shared result is unavailable.';
                var play = document.createElement('button'); play.className = 'btn'; play.dataset.playShared = ''; play.textContent = 'Play to find out your own score';
                missing.append(message, play); showShared(missing);
            }
            return load();
        }).catch(function () { if (!staticClient) result.innerHTML = offline(); return load(); });
    }
    if (staticClient) startCards();
    else authenticated.then(startCards);
})();
