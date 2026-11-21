// In-memory board search. The caller owns table rendering and pagination; rows retain their ranks.
(function () {
    'use strict';
    var serial = 0;
    function normalize(value) {
        return String(value == null ? '' : value).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    }
    window.eupoiiaSearch = function (container, options) {
        options = options || {};
        var rows = [], names = [], timer = null, active = true;
        var form = document.createElement('form'); form.className = 'board-search'; form.setAttribute('role', 'search');
        var id = 'board-search-' + (++serial);
        var label = document.createElement('label'); label.htmlFor = id; label.textContent = 'Search names';
        var input = document.createElement('input'); input.id = id; input.type = 'search'; input.name = 'search';
        input.autocomplete = 'off'; input.spellcheck = false;
        var clear = document.createElement('button'); clear.type = 'button'; clear.textContent = 'Clear';
        clear.setAttribute('aria-label', 'Clear search'); clear.disabled = true;
        var status = document.createElement('span'); status.id = id + '-status'; status.className = 'board-search-status';
        status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); input.setAttribute('aria-describedby', status.id);
        form.append(label, input, clear, status); container.prepend(form);
        function index(next) {
            rows = Array.from(next || []); names = rows.map(function (row) { return normalize(row.name); });
        }
        function filter(query) {
            var needle = normalize(query).trim();
            if (!needle) return rows.slice();
            var found = [];
            for (var i = 0; i < rows.length; i++) if (names[i].includes(needle)) found.push(rows[i]);
            return found;
        }
        function cancel() { if (timer !== null) { clearTimeout(timer); timer = null; } }
        function apply() {
            timer = null;
            if (!active) return [];
            var query = input.value.trim(), found = filter(query);
            clear.disabled = !input.value.length;
            status.textContent = query ? found.length + (found.length === 1 ? ' match' : ' matches') : '';
            if (options.onPage) options.onPage(1);
            if (options.render) options.render(found, { query: query, page: 1 });
            return found;
        }
        function reset() {
            if (!active) return;
            cancel(); input.value = ''; apply(); input.focus();
        }
        input.addEventListener('input', function () {
            cancel(); clear.disabled = !input.value.length; timer = setTimeout(apply, 100);
        });
        input.addEventListener('keydown', function (event) {
            if (event.key === 'Escape' && input.value) { event.preventDefault(); event.stopPropagation(); reset(); }
        });
        clear.addEventListener('click', reset);
        form.addEventListener('submit', function (event) { event.preventDefault(); cancel(); apply(); });
        index(options.rows);
        // The existing first frame stays intact; callbacks begin on interaction or an explicit setRows.
        return {
            filter: filter,
            setRows: function (next) { if (active) { index(next); return apply(); } return []; },
            clear: reset,
            destroy: function () { active = false; cancel(); rows = []; names = []; form.remove(); }
        };
    };
})();
