// The username rule, checked as the player types: the page's copy of 90-sign-in-players/57-choose-a-username.py.
// Both run the cases in 90-sign-in-players/57-username-cases.json. Whether a name is taken or not allowed is the
// server's answer alone (POST /auth/username/check).
(function () {
    'use strict';
    var messages = {
        short: 'Use at least 3 characters.',
        long: 'Use 24 characters or fewer.',
        characters: 'Use letters, numbers, hyphens and underscores only, with no spaces.',
        taken: 'That username is taken.',
        unavailable: "That username isn't available."
    };
    var allowed = /^[\p{L}\p{M}\p{Nd}_-]+$/u, substance = /[\p{L}\p{Nd}]/u;
    // Refused although they are letters or marks: ones that draw nothing, an accent with no letter to sit on, and
    // a pile of three or more accents. The same list as the server's.
    var invisible = /[\u034f\u115f\u1160\u17b4\u17b5\u180b-\u180f\u3164\ufe00-\ufe0f\uffa0\u{e0100}-\u{e01ef}]/u, piled = /^\p{M}|\p{M}{3}/u;
    function refuse(reason) { return { ok: false, reason: reason, message: messages[reason] }; }
    // {ok: true, name} with the name as it would be stored, or {ok: false, reason, message}.
    function check(raw) {
        var name = String(raw == null ? '' : raw).normalize('NFC').replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '');
        var length = Array.from(name).length;  // characters, not UTF-16 units
        if (length < 3) return refuse('short');
        if (length > 24) return refuse('long');
        if (!allowed.test(name) || !substance.test(name) || invisible.test(name) || piled.test(name)) return refuse('characters');
        return { ok: true, name: name };
    }
    // A funny name as a username to start from: "Sleepless Praetor" -> "Sleepless-Praetor"; '' if it can't be one.
    function suggest(funny) {
        var words = String(funny == null ? '' : funny).split(/[ \t\r\n]+/).filter(Boolean);
        if (!words.length) return '';
        var candidates = [words.join('-'), words.join(' ').replace(/-/g, ' ').split(' ').filter(Boolean).join('')];
        for (var i = 0; i < candidates.length; i++) {
            var answer = check(candidates[i]);
            if (answer.ok && answer.name === candidates[i]) return candidates[i];
        }
        return '';
    }
    window.eupoiiaUsername = { check: check, suggest: suggest, messages: messages,
        helper: 'This is how your name will be displayed on the leaderboard.' };
})();
