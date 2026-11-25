// Static snapshots supply every first frame. Only saving a choice and account state use the API.
(function () {
    'use strict';
    function stored(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch (e) { return fallback; } }
    function keep(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; } }
    function key(a, b) { return [a, b].sort().join('-'); }
    function nyDay() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
    function escape(value) { var e = document.createElement('span'); e.textContent = value == null ? '' : String(value); return e.innerHTML; }
    function read(url, patience) {
        var controller = new AbortController(), timer = setTimeout(function () { controller.abort(); }, patience || 1200);
        return fetch(url, { signal: controller.signal }).then(function (r) { if (!r.ok) throw new Error('static'); return r.json(); }).finally(function () { clearTimeout(timer); });
    }
    function create(options) {
        var base = options.base, fallback = options.fallback, memory = new Map(), bootstrap = options.bootstrap;
        var owner = null, identityVersion = 0, serverDaily = null, dailyData = null, dailyState = null;
        var pool = [], poolLoaded = false, template = '', selectedDay = '', selectedSeed = '', sharedPair = false;
        var seen = new Set(), paused = false, flushing = false, timer = null, meContext = {}, playerBoards = null;
        var QUEUE = 'eupoiia-vote-queue-v1', attempts = 0, boardUpdate = null;
        var pendingMemory = stored(QUEUE, []), memoryOnly = false, currentCredential = '';
        function credential(token) {
            if (!token) return Promise.resolve('');
            return crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)).then(function (bytes) {
                return Array.from(new Uint8Array(bytes)).map(function (n) { return n.toString(16).padStart(2, '0'); }).join('');
            });
        }
        function scope() { return owner ? owner.handle : options.tab; }
        function dailyKey(day) { return 'eupoiia-daily-' + day + '-' + scope(); }
        function seenKey() { return 'eupoiia-voted-pairs-v1-' + scope(); }
        function deckKey() { return 'eupoiia-deck-v1-' + scope(); }
        var cachedIdentity = stored('eupoiia-public-account-v1', null), initialToken = options.token();
        var identityBoot = credential(initialToken).then(function (stamp) {
            if (options.token() === initialToken) currentCredential = stamp;
            if (cachedIdentity && stamp && cachedIdentity.credential === stamp && options.token() === initialToken) owner = cachedIdentity.player;
            seen = new Set(stored(seenKey(), []));
            pool = stored(deckKey(), []);
        });
        var primary = read(base + 'manifest.json').then(function (manifest) { return { manifest: manifest, base: base }; })
            .catch(function (error) { if (bootstrap) return { manifest: bootstrap.manifest, base: fallback }; throw error; });
        primary.catch(function () {});
        // A bundle published today is immediately useful; a newer CDN generation is adopted for later reads.
        // A bundle from an earlier day has no card set for today and an old Today board, so the page waits
        // for the published manifest and keeps the bundle for when that can't be reached.
        var bundled = bootstrap && bootstrap.manifest ? { manifest: bootstrap.manifest, base: fallback } : null;
        var bundledToday = !!bundled && bundled.manifest.today === nyDay();
        var ready = bundledToday ? Promise.resolve(bundled) : primary;
        var current = bundledToday ? bundled : null, patient = null;
        primary.then(function (fresh) { current = fresh; }).catch(function () {});
        function published() {  // the published manifest; asked once more, with patience, if the quick read failed
            return primary.then(function (source) { if (source.base === base) return source; throw new Error('bundled'); }).catch(function () {
                if (!patient) patient = read(base + 'manifest.json', 8000).then(function (manifest) { return current = { manifest: manifest, base: base }; })
                    .catch(function (error) { patient = null; throw error; });
                return patient;
            });
        }
        function file(source, kind, day) {
            return kind === 'daily' || kind === 'results' ? source.manifest[kind][day] : source.manifest.files[kind];
        }
        function from(source, kind, day, patience) {
            var name = file(source, kind, day);
            if (!name) return Promise.reject(new Error('missing static day'));
            if (bootstrap && source.base === fallback && bootstrap.files && bootstrap.files[name]) return Promise.resolve(bootstrap.files[name]);
            var url = source.base + name;
            if (!memory.has(url)) memory.set(url, read(url, patience).catch(function (error) { memory.delete(url); throw error; }));
            return memory.get(url);
        }
        function data(kind, day) {
            return ready.then(function (initial) {
                var source = current || initial;
                // A day the bundle predates is listed only in the published manifest: wait for it, don't give up.
                var first = (file(source, kind, day) || source.base === base) ? from(source, kind, day)
                    : published().then(function (fresh) { return from(fresh, kind, day, 8000); });
                return first.catch(function () {
                    if (bootstrap) return from({ manifest: bootstrap.manifest, base: fallback }, kind, day);
                    throw new Error('snapshot unavailable');
                });
            });
        }
        function queue() { if (!memoryOnly) pendingMemory = stored(QUEUE, pendingMemory); return pendingMemory; }
        function saveQueue(items) { pendingMemory = items; memoryOnly = !keep(QUEUE, items); return !memoryOnly; }
        function remove(op) { saveQueue(queue().filter(function (item) { return item.op !== op; })); }
        function mark(a, b, originalScope) {
            var name = originalScope ? 'eupoiia-voted-pairs-v1-' + originalScope : seenKey();
            var values = !originalScope || originalScope === scope() ? seen : new Set(stored(name, []));
            values.add(key(a,b)); keep(name,Array.from(values).slice(-4000));
        }
        function pendingHere(item) {
            if (item.owner) return owner && item.owner === owner.handle;
            if (item.credential) return item.credential === currentCredential;
            return owner || item.session === options.tab;
        }
        function later(delay) { clearTimeout(timer); timer = setTimeout(function () { timer = null; flush(); }, delay); }
        function flush() {
            if (flushing || paused) return;
            flushing = true;
            var activeToken = options.token();
            credential(activeToken).then(function (stamp) {
            if (activeToken !== options.token()) { flushing = false; later(25); return; }
            var items = queue(), item = items.find(function (entry) {
                return entry.owner ? owner && entry.owner === owner.handle : !entry.credential || entry.credential === stamp;
            });
            if (!item) { flushing = false; return; }
            var version = identityVersion, body = new URLSearchParams(item.form);
            body.set('op', item.op); body.set('session', item.session);
            if (item.owner) body.set('owner', item.owner);
            options.send('/votes', { method: 'POST', body: body }).then(function (response) {
                return response.json().then(function (answer) {
                    if (answer.status === 'saved' || (answer.status === 'refused' && answer.reason === 'already_voted')) {
                        remove(item.op); attempts = 0;
                        if (version === identityVersion && (!item.owner || (owner && item.owner === owner.handle))) {
                            if (answer.daily) setDaily(answer.daily);
                            options.saved(answer, item);
                        } else options.refresh();
                    } else if (answer.reason === 'auth_required' || answer.reason === 'account_changed') {
                        paused = true; options.notice('Sign in again to save your waiting votes.');
                    } else if (answer.status === 'refused') {
                        remove(item.op);
                        if (version === identityVersion && (!item.owner || owner && item.owner === owner.handle)) {
                            if (answer.daily) setDaily(answer.daily);
                            options.refused(answer, item);
                        } else options.refresh();
                    } else {
                        attempts++; later(Math.min(60000, 1000 * Math.pow(2, Math.min(attempts, 6))) + Math.random() * 300);
                    }
                });
            }).catch(function () { attempts++; later(Math.min(60000, 1000 * Math.pow(2, Math.min(attempts, 6))) + Math.random() * 300); })
                .finally(function () { flushing = false; if (!timer && !paused && queue().length) later(25); });
            }).catch(function () { flushing = false; later(2000); });
        }
        function setDaily(state) {
            if (!state || !state.day) return;
            serverDaily = state;
            var saved = stored(dailyKey(state.day), {});
            var pending = queue().filter(function (item) { return pendingHere(item) && item.form.kind === 'daily' && item.form.day === state.day && item.form.seed === state.seed; })
                .map(function (item) { return key(item.form.a, item.form.b); });
            var voted = Array.from(new Set((state.voted || []).concat(pending)));
            dailyState = { day: state.day, seed: state.seed || saved.seed, voted: voted, done: Math.max(state.done || 0, voted.length),
                finished: state.finished, result_html: state.result_html || null,
                pairs: state.pairs || (saved.seed === state.seed ? saved.pairs : null) };
            if (state.seed) selectedSeed = state.seed;
            selectedDay = state.day; keep(dailyKey(state.day), dailyState);
        }
        function identity(me) {
            var token = options.token();
            return credential(token).then(function (stamp) {
            if (token !== options.token()) return false;
            currentCredential = stamp;
            var previous = owner && owner.handle, changed = previous !== (me.player && me.player.handle);
            owner = me.player || null; if (changed) identityVersion++;
            keep('eupoiia-public-account-v1', { player: owner, credential: stamp }); paused = false;
            if (changed) { seen = new Set(stored(seenKey(), [])); pool = stored(deckKey(), []); poolLoaded = false; serverDaily = null; dailyState = null; playerBoards = null; }
            meContext = me; playerBoards = me.player_boards || playerBoards;
            serverDaily = me.daily || null;
            if (owner) saveQueue(queue().map(function (item) { if (!item.owner && item.credential && item.credential === stamp) item.owner = owner.handle; return item; }));
            (me.voted || []).forEach(function (pair) { seen.add(pair); });
            keep(seenKey(), Array.from(seen));
            if (me.daily && me.daily.seed) setDaily(me.daily);
            if (me.board_key && owner) owner.board_key = me.board_key;
            if (boardUpdate) boardUpdate();
            flush(); return changed;
            });
        }
        function cardHtml(pair, kind, day, seed, position) {
            var box = document.createElement('div'); box.innerHTML = pair.html;
            var article = box.querySelector('.card');
            article.dataset.kind = kind || 'pool'; article.dataset.a = pair.a; article.dataset.b = pair.b;
            if (pair.proof) article.dataset.proof = pair.proof;
            if (day) { article.dataset.day = day; article.dataset.seed = seed; article.dataset.position = position; }
            return article.outerHTML;
        }
        function fillPool() {
            return data('deck_pool').then(function (value) {
                var have = new Set(pool.map(function (pair) { return key(pair.a, pair.b); }));
                value.pairs.forEach(function (pair) { if (!have.has(key(pair.a, pair.b))) { pool.push(pair); have.add(key(pair.a, pair.b)); } });
                poolLoaded = true; keep(deckKey(), pool.slice(-240));
            });
        }
        function randomCards() {
            return data('deck_first').then(function (value) {
                if (!pool.length) { pool = value.pairs.slice(); template = pool[0] && pool[0].html || ''; }
                function available() {
                    var pending = new Set(queue().filter(pendingHere).map(function (item) { return key(item.form.a, item.form.b); }));
                    return pool.filter(function (pair) { return !seen.has(key(pair.a, pair.b)) && !pending.has(key(pair.a, pair.b)); });
                }
                var replenished = available().length < 3 ? (poolLoaded ? read(base + 'manifest.json').then(function (m) { current = { manifest: m, base: base }; }).catch(function () {}) : Promise.resolve()).then(fillPool) : Promise.resolve();
                return replenished.then(function () {
                    keep(deckKey(), pool.slice(-240));
                    return available().slice(0, 3).map(function (pair) { return cardHtml(pair); }).join('') || '<p class="note">You have played this saved deck. More matchups will be ready when the connection returns.</p>';
                });
            });
        }
        function dailyCards(day, seed, preferred) {
            day = /^\d{4}-\d{2}-\d{2}$/.test(day || '') && day <= nyDay() ? day : nyDay();
            return data('daily', day).then(function (value) {
                dailyData = value; selectedDay = day;
                if (!template) template = Object.values(value.html)[0] || '';
                var saved = stored(dailyKey(day), {});
                var own = serverDaily && serverDaily.day === day && serverDaily.seed && serverDaily.done > 0 ? serverDaily : saved;
                if (own.seed && own.seed === saved.seed) {
                    own = Object.assign({},own,{voted:Array.from(new Set((own.voted || []).concat(saved.voted || []))),
                        pairs:own.pairs || saved.pairs,result_html:own.result_html || saved.result_html});
                    own.done = Math.max(own.done || 0,own.voted.length);
                }
                selectedSeed = own.done > 0 && own.seed ? own.seed : seed || own.seed || value.bank[Math.floor(Math.random() * value.bank.length)] || 'legacy';
                var pairs = value.orders[selectedSeed] || (own.seed === selectedSeed && own.pairs) || (saved.seed === selectedSeed && saved.pairs) ||
                    (serverDaily && serverDaily.seed === selectedSeed && serverDaily.pairs) ||
                    (serverDaily && serverDaily.requested && serverDaily.requested.seed === selectedSeed && serverDaily.requested.pairs);
                if (!pairs) throw new Error('unknown seed');
                dailyState = { day: day, seed: selectedSeed, voted: own.seed === selectedSeed ? own.voted || [] : [], done: own.seed === selectedSeed ? own.done || 0 : 0,
                    finished: own.seed === selectedSeed && own.finished, result_html: own.seed === selectedSeed ? own.result_html : null, pairs:pairs };
                keep(dailyKey(day), dailyState);
                if (dailyState.result_html) return dailyState.result_html;
                var done = new Set(dailyState.voted), remaining = pairs.map(function (pair, index) { return { pair: pair, index: index }; })
                    .filter(function (item) { return !done.has(key(item.pair[0], item.pair[1])); });
                var rotation = stored(dailyKey(day) + '-skips-' + selectedSeed, []);
                function priority(item) { var k = key(item.pair[0], item.pair[1]); if (preferred === k && (!seed || seed === selectedSeed)) return -1; var n = rotation.indexOf(k); return n < 0 ? 0 : n + 1; }
                remaining.sort(function (a, b) { return priority(a) - priority(b) || a.index - b.index; });
                var progress = '<div class="progress-now" hidden data-day="' + day + '" data-seed="' + escape(selectedSeed) + '" data-done="' + dailyState.done + '"></div>';
                return progress + remaining.slice(0, 3).map(function (item) {
                    var pair = item.pair, html = value.html[pair[0] + '-' + pair[1]] || renderPair(pair[0],pair[1],value.contenders);
                    return cardHtml({ a: pair[0], b: pair[1], html: html }, 'daily', day, selectedSeed, item.index);
                }).join('') + (!remaining.length ? '<p class="note">Saving your Daily 10 result…</p>' : '');
            });
        }
        function renderPair(a, b, records) {
            var box = document.createElement('div'); box.innerHTML = template;
            var article = box.querySelector('.card'); if (!article) throw new Error('no card template');
            article.dataset.token = 'static:' + a + '-' + b; article.dataset.pair = a + '-' + b; article.dataset.kind = 'link';
            article.dataset.a = a; article.dataset.b = b; delete article.dataset.proof; delete article.dataset.day; delete article.dataset.seed;
            [a, b].forEach(function (qid, index) {
                var c = records[qid], half = article.querySelector('.half-' + (index ? 'b' : 'a'));
                half.dataset.qid = qid; half.dataset.name = c.name;
                half.querySelector('h3').textContent = c.name; half.querySelector('.gist').textContent = c.description;
                var more = half.querySelector('.more-line'); more.innerHTML = '<details class="sec more"><summary><span><span class="when-closed">Read more</span><span class="when-open">Collapse</span></span><a class="source" target="_blank" rel="noopener"></a></summary><div class="intro"><p></p><p class="from"></p></div></details>';
                var source = more.querySelector('.source'); source.href = c.wikipedia_url; source.textContent = c.wikipedia_url.includes('wikipedia.org/') ? 'Wikipedia' : 'Website';
                more.querySelector('.intro > p').textContent = c.intro || c.description;
                more.querySelector('.from').textContent = 'From ' + new URL(c.wikipedia_url).hostname + (c.wikipedia_url.includes('wikipedia.org/') ? ', CC BY-SA' : '');
                var picture = half.querySelector('.picture'); if (picture) picture.remove();
                if (records[a].image_file && records[b].image_file) {
                    picture = document.createElement('a'); picture.className = 'picture'; picture.target = '_blank'; picture.rel = 'noopener'; picture.draggable = false;
                    picture.href = c.image_file.includes('/') ? c.wikipedia_url : 'https://en.wikipedia.org/wiki/File:' + encodeURIComponent(c.image_file);
                    var image = document.createElement('img'); image.alt = c.name; image.loading = 'lazy'; image.decoding = 'async'; image.draggable = false;
                    image.src = c.image_file.includes('/') ? options.home + c.image_file.split('/').pop() : 'https://en.wikipedia.org/wiki/Special:FilePath/' + encodeURIComponent(c.image_file) + '?width=400';
                    picture.append(image); half.prepend(picture);
                }
                article.querySelector('[data-choice="' + (index ? 'b' : 'a') + '"]').setAttribute('aria-label', 'Vote for ' + c.name);
            });
            return article.outerHTML;
        }
        function catalog(qid) {
            return crypto.subtle.digest('SHA-256', new TextEncoder().encode(qid)).then(function (hash) {
                var shard = new Uint8Array(hash)[31] % 32;
                return ready.then(function (initial) {
                    var source = current || initial, url = source.base + source.manifest.catalog[shard];
                    if (!memory.has(url)) memory.set(url, read(url));
                    return memory.get(url);
                });
            }).then(function (value) { return value.cards[qid]; });
        }
        function pairCards(value, day, seed) {
            return data('deck_first').then(function (first) {
                template = first.pairs[0].html;
                if (value.length > 256) throw new Error('missing pair');
                var candidates = [], offset = value.indexOf('-');
                while (offset > 0 && candidates.length < 8) {
                    (function (a,b) { candidates.push(Promise.all([catalog(a),catalog(b)]).then(function (rows) { return rows[0] && rows[1] ? {a:a,b:b,rows:rows} : null; })); })(value.slice(0,offset),value.slice(offset+1));
                    offset = value.indexOf('-',offset+1);
                }
                return Promise.all(candidates).then(function (matches) {
                    var match = matches.find(Boolean); if (!match) throw new Error('missing pair');
                    var a = match.a, b = match.b, rows = match.rows;
                    sharedPair = true;
                    if (meContext.pair && meContext.pair.past_html) return meContext.pair.past_html;
                    if (day) return dailyCards(day, seed, key(a,b));
                    return renderPair(a, b, Object.fromEntries([[a, rows[0]], [b, rows[1]]]));
                });
            });
        }
        function load(mode, day, seed, pair) {
            return identityBoot.then(function () {
                if (mode === 'daily') return dailyCards(day, seed);
                if (mode === 'pair') return pairCards(pair || '', day, seed);
                return randomCards();
            });
        }
        function choose(choice, card) {
            var a = card.dataset.a || card.querySelector('.half-a').dataset.qid, b = card.dataset.b || card.querySelector('.half-b').dataset.qid;
            if (choice === 'skip') {
                if (card.dataset.kind === 'daily' && dailyData) {
                    var rotationKey = dailyKey(card.dataset.day) + '-skips-' + card.dataset.seed;
                    var rotation = stored(rotationKey, []).filter(function (k) { return k !== key(a,b); }); rotation.push(key(a,b)); keep(rotationKey, rotation);
                } else { var index = pool.findIndex(function (p) { return p.a === a && p.b === b; }); if (index >= 0) pool.push(pool.splice(index, 1)[0]); }
                keep(deckKey(),pool.slice(-240));
                return Promise.resolve();
            }
            var token = options.token(), choiceOwner = owner && owner.handle, choiceScope = scope();
            return credential(token).then(function (fingerprint) {
            var items = queue(), item = { op: crypto.randomUUID().replace(/-/g, ''), session: options.tab, owner: choiceOwner || null, credential: fingerprint,
                form: { kind: card.dataset.kind || 'pool', a: a, b: b, choice: choice, proof: card.dataset.proof || '' }, created: Date.now() };
            if (item.form.kind === 'daily') {
                Object.assign(item.form, { day: card.dataset.day, seed: card.dataset.seed, position: card.dataset.position });
                var localKey = 'eupoiia-daily-' + item.form.day + '-' + choiceScope;
                var local = stored(localKey, { day: item.form.day, seed: item.form.seed, voted: [], done: 0 });
                local.voted = Array.from(new Set(local.voted.concat([key(a, b)]))); local.done = local.voted.length;
                keep(localKey, local);
            }
            items.push(item);
            if (!saveQueue(items)) { options.notice('Keep this tab open until your vote is saved.'); }
            mark(a, b, choiceScope); paused = false; flush();
            });
        }
        function shared(day, handle, seed) {
            day = day || nyDay();
            function find(value) { var result = value.results[handle]; return result && (!seed || seed === result.seed) ? result.result_html : null; }
            return data('results',day).then(find).then(function (html) {
                return html || primary.then(function (source) { return from(source,'results',day).then(find); });
            }).catch(function () { return null; });
        }
        // One more number column goes in the two places below marked 'columns'; a long heading takes class "num wide".
        function rowsTable(rows, players, mount, page, view, searching) {
            page = page || 1; var limit = 50, all = rows.length, shown = rows.slice((page - 1) * limit, page * limit), votesColumn = players && view !== 'today';
            var html = '<table class="board"><thead><tr><th class="num">#</th><th>Name</th>' + (players ? (votesColumn ? '<th class="num">Votes</th>' : '') + '<th class="num wide">Foresight</th>' : '<th class="num">Rating</th><th class="num" title="wins, draws, losses">W–D–L</th><th class="num">Votes</th>') + '</tr></thead><tbody>';
            shown.forEach(function (row) {
                html += '<tr' + (players && owner && row.key === owner.board_key ? ' class="me"' : '') + '><td class="num">' + (row.rank || '—') + '</td><td>';
                if (players) html += escape(row.name);
                else html += '<a href="?c=' + encodeURIComponent(row.qid) + '">' + escape(row.name) + '</a>';
                html += '</td>' + (players ? (votesColumn ? '<td class="num">' + Number(row.n) + '</td>' : '') + '<td class="num wide">' + (row.foresight == null ? '—' : Math.round(row.foresight)) + '</td>' : '<td class="num">' + Math.round(row.rating) + '</td><td class="num">' + row.wins + '–' + row.ties + '–' + row.losses + '</td><td class="num">' + row.votes + '</td>') + '</tr>';
            });
            if (!shown.length) html += '<tr><td colspan="' + (players ? (votesColumn ? 4 : 3) : 5) + '">' + (searching ? 'No matching names.'
                : !players ? 'No votes yet.' : view === 'today' ? "No signed-in player has voted on today's Daily 10 yet." : 'No signed-in player has voted yet.') + '</td></tr>';
            html += '</tbody></table>';
            if (all > limit) html += '<nav class="pagination" aria-label="Leaderboard pages"><button type="button" data-static-page="' + Math.max(1, page - 1) + '"' + (page <= 1 ? ' disabled' : '') + '>Previous</button><span>Page ' + page + ' of ' + Math.ceil(all / limit) + '</span><button type="button" data-static-page="' + (page + 1) + '"' + (page * limit >= all ? ' disabled' : '') + '>Next</button></nav>';
            mount.innerHTML = html;
            mount.querySelectorAll('[data-static-page]').forEach(function (button) { button.addEventListener('click', function () { rowsTable(rows, players, mount, Number(button.dataset.staticPage), view, searching); }); });
        }
        function board(container, players, view, math) {
            var alive = true, search, table = document.createElement('div'), control = document.createElement('div'), explanation = document.createElement('div'), note = document.createElement('p');
            table.innerHTML = container.innerHTML; note.className = 'score-explainer note';
            container.replaceChildren(control, table, note, explanation);
            var rows = [], drawnFrom = current;
            function fill() { return data('top').then(function (top) {
                if (!alive) return;
                var part = players ? top.players[view] : top.contenders[view];
                if (!search) {
                    table.innerHTML = part.html;
                    table.querySelectorAll('.score-method,.pagination').forEach(function (e) { e.remove(); });
                }
                explanation.innerHTML = part.explanation_html;
                math(explanation);
                return data(players ? 'players_' + view : 'contenders').then(function (full) {
                    if (!alive) return;
                    rows = players || view === 'all' ? full.rows : full.rows.filter(function (row) { return row.kind === view; });
                    if (search) { if (boardUpdate) boardUpdate(); return; }
                    function render(filtered, state) { if (alive) rowsTable(filtered, players, table, state && state.page || 1, view, !!(state && state.query)); }
                    search = window.eupoiiaSearch(control, { rows: rows, render: render });
                    boardUpdate = function () {
                        if (!alive) return;
                        var fresh = players && playerBoards && playerBoards[view];
                        if (fresh) rows = fresh;
                        search.setRows(rows);
                        note.textContent = players && owner ? owner.name + "'s votes are recalculated using current Elo ratings. Their score can change as those ratings change." : '';
                    };
                    boardUpdate();
                });
            }).catch(function () { /* The pre-rendered board remains usable while its snapshot is unavailable. */ }); }
            // A board drawn from the bundle is filled again, in place, once a newer published snapshot arrives.
            var filled = fill();
            primary.then(function (fresh) {
                if (!drawnFrom || fresh.base !== base || fresh.manifest.revision === drawnFrom.manifest.revision) return;
                return filled.then(function () { if (alive) return fill(); });
            }).catch(function () {});
            return function () { alive = false; if (search) search.destroy(); };
        }
        function contender(qid) {
            return catalog(qid).then(function (row) { return row && row.detail_html || '<p class="note">There is no such contender.</p>'; });
        }
        window.addEventListener('online', function () { paused = false; timer = null; flush(); });
        window.addEventListener('storage', function (event) { if (event.key === QUEUE) flush(); });
        return { ready: ready, data: data, load: load, choose: choose, identity: identity, shared: shared, board: board, contender: contender,
            state: function () { return dailyState; }, fillPool: fillPool, flush: flush };
    }
    window.eupoiiaStatic = { create: create, today: nyDay };
})();
