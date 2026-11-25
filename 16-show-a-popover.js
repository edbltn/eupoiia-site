// One popover for every (i): the header's definition of the name, the (i) beside each name on a card, and the one
// in a leaderboard row. Hover (mouse) or keyboard focus previews it; a click or tap pins it open, so its text can be
// selected and its links followed. A click or tap outside it, Escape, or the icon again closes it. One is open at a time.
//
// An (i) is a button; its text box is the element named by aria-describedby, else the .info-text right after it.
// A box marked data-lazy is filled the first time it opens, from `eupoiiaPopover.provide(button)` (a string of
// HTML, or a promise of one), so a board of rows holds no text until someone asks.
(function () {
    'use strict';
    var current = null, attached = new WeakSet();

    function boxOf(button) {
        var id = button.getAttribute('aria-describedby'), named = id && document.getElementById(id);
        if (named) return named;
        var next = button.nextElementSibling, scope = button.closest('.name-line, td');
        return next && next.classList.contains('info-text') ? next : scope && scope.querySelector('.info-text');
    }

    // When the text has to be shorter than it is, the box ends at a whole line of .info-main with a short fade, and the source line
    // below it stays: never a line cut in half.
    function uncut(box) { var main = box.querySelector('.info-main'); if (main) { main.style.maxHeight = ''; main.classList.remove('cut'); } }
    function cut(box, room) {
        var main = box.querySelector('.info-main'), from = box.querySelector('.from');
        if (!main) { box.style.maxHeight = Math.max(80, room) + 'px'; return; }
        var chrome = box.offsetHeight - main.offsetHeight, budget = room - chrome;
        if (main.offsetHeight <= budget) return;
        var top = main.getBoundingClientRect().top, end = 0, range = document.createRange();
        range.selectNodeContents(main);
        Array.prototype.forEach.call(range.getClientRects(), function (r) { var bottom = r.bottom - top; if (r.height > 2 && bottom <= budget && bottom > end) end = bottom; });
        main.style.maxHeight = Math.max(end, 20) + 'px'; main.classList.add('cut');
    }

    // A box under a card's name or a board row's name is laid out here, in pixels from the card (or the row's cell): about 22rem
    // wide, centred under the icon, kept inside the card (or the table) and the screen, below the name unless that would run
    // past the card's bottom edge and there is room above it. Cards clip what hangs outside them, so it must fit inside.
    function place(button, box) {
        if (!box.classList.contains('info-text')) return;
        var parent = box.offsetParent || document.body, pr = parent.getBoundingClientRect();
        var card = button.closest('.card'), frame = (card || button.closest('table') || document.documentElement).getBoundingClientRect();
        var line = (button.closest('.name-line, td') || button).getBoundingClientRect(), at = button.getBoundingClientRect();
        var low = Math.max(frame.left, 0) + 6, high = Math.min(frame.right, document.documentElement.clientWidth) - 6;
        var width = Math.min(352, high - low);
        box.style.width = width + 'px';
        box.style.maxHeight = ''; uncut(box);
        var left = Math.min(Math.max(at.left + at.width / 2 - width / 2, low), high - width);
        // Below the name if it fits above the vote buttons, else above the name if it fits there, else below (and scrolls).
        var buttons = card && card.querySelector('.buttons'), floor = (buttons ? buttons.getBoundingClientRect().top : frame.bottom) - 6;
        var height = box.offsetHeight, top = line.bottom + 4;
        if (card && top + height > floor) {
            if (line.top - 4 - height > frame.top + 6) top = line.top - 4 - height;
            else if (top + height > frame.bottom - 6) cut(box, Math.min(frame.bottom - 6 - top, frame.height - 12));
        }
        box.style.left = (left - pr.left - parent.clientLeft) + 'px';
        box.style.top = (top - pr.top - parent.clientTop) + 'px';
    }

    // A picture is an empty span carrying its address until its text is opened; then it becomes an img and loads.
    function draw(box) {
        box.querySelectorAll('.info-image[data-src]').forEach(function (span) {
            var img = document.createElement('img'); img.alt = span.dataset.alt || ''; img.decoding = 'async'; img.draggable = false;
            img.src = span.dataset.src; span.replaceWith(img);
        });
    }

    function attach(button) {
        var box = boxOf(button);
        if (!box || attached.has(button)) return;
        attached.add(button);
        var hovered = false, focused = false, pinned = false, dismissed = false, leaving = 0, filled = !box.hasAttribute('data-lazy');
        var self = {
            button: button, box: box,
            contains: function (node) { return button.contains(node) || box.contains(node); },
            near: function (e) {
                var a = button.getBoundingClientRect(), b = box.getBoundingClientRect();
                return e.clientY > a.bottom - 2 && e.clientY < b.top + 2 && e.clientX >= Math.min(a.left, b.left) - 6 && e.clientX <= Math.max(a.right, b.right) + 6;
            },
            hold: function () { clearTimeout(leaving); hovered = true; render(); },
            isHeld: function () { return hovered || !!leaving; },
            close: close
        };
        function fill() {
            if (filled) return;
            filled = true;
            var provide = window.eupoiiaPopover.provide, got = provide ? provide(button) : null;
            box.removeAttribute('data-lazy');
            Promise.resolve(got).then(function (html) {
                if (html) { box.innerHTML = html; draw(box); }
                else box.textContent = 'There is no summary here. Open the name for its matches.';
                place(button, box);
            }, function () { box.textContent = 'The summary could not be loaded. Try again in a moment.'; filled = false; box.setAttribute('data-lazy', ''); });
        }
        function render() {
            var open = pinned || (!dismissed && (hovered || focused)), opening = open && box.hidden;
            if (open && current && current !== self) current.close();
            box.hidden = !open;
            button.setAttribute('aria-expanded', open ? 'true' : 'false');
            // The box is placed once, as it opens. Hover, focus and a click each render again, and placing it again each time
            // moved it whenever anything it is placed against had changed in between (a scrollbar shrinking the page, the card
            // narrowing): it jumped as it was pinned. It is placed again only when the page is resized or its text arrives.
            if (open) { current = self; fill(); draw(box); if (opening) place(button, box); } else if (current === self) current = null;
        }
        function close() { pinned = false; dismissed = true; hovered = false; render(); }
        function enter(e) { if (e.pointerType !== 'mouse' || box.hidden && e.currentTarget === box) return; clearTimeout(leaving); hovered = true; if (e.currentTarget === button) dismissed = false; render(); }
        // A short grace lets the mouse cross from the icon to the text without the preview closing.
        function leave(e) { if (e.pointerType !== 'mouse') return; clearTimeout(leaving); leaving = setTimeout(function () { leaving = 0; hovered = false; render(); }, 200); }
        [button, box].forEach(function (el) { el.addEventListener('pointerenter', enter); el.addEventListener('pointerleave', leave); });
        button.addEventListener('focus', function () { focused = button.matches(':focus-visible'); dismissed = false; render(); });
        button.addEventListener('blur', function () { focused = false; render(); });
        button.addEventListener('click', function () {
            if (pinned) { focused = false; close(); } else { pinned = true; dismissed = false; render(); }
        });
    }

    // The text hangs below the icon with a gap between them. While the preview is open, a mouse anywhere in the band
    // that joins the two (the icon's width to the text's) counts as still on them, so a slow move across the gap never closes it.
    document.addEventListener('pointermove', function (e) {
        if (e.pointerType !== 'mouse' || !current || current.box.hidden || !current.isHeld()) return;
        if (current.near(e)) current.hold();
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && current && !current.box.hidden) current.close(); });
    document.addEventListener('pointerdown', function (e) { if (current && !current.box.hidden && !current.contains(e.target)) current.close(); });
    window.addEventListener('resize', function () { if (current && !current.box.hidden) place(current.button, current.box); });

    function scan(root) {
        (root || document).querySelectorAll('button.info, #name-info').forEach(attach);
    }
    window.eupoiiaPopover = { attach: attach, scan: scan, provide: null };
    scan();
    // Cards and board rows are drawn after the page loads, so a new (i) anywhere is picked up as it appears.
    new MutationObserver(function (records) {
        records.forEach(function (r) { r.addedNodes.forEach(function (n) {
            if (n.nodeType !== 1) return;
            if (n.matches('button.info, #name-info')) attach(n); else scan(n);
        }); });
    }).observe(document.documentElement, { childList: true, subtree: true });
})();
