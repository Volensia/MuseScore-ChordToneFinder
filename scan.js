// Chord Tone Finder — reads the selection and pairs every selected note with the
// chord symbol in effect for it. Talks to MuseScore objects; the music theory is in
// chordtones.js. Element type ids come in through `env` (Element.* is not visible
// inside a .pragma library).
.pragma library
.import "chordtones.js" as CT

var MAX_NOTES = 48;                 // a big range selection stops listing here

function segmentOf(el, env) {
    var e = el;
    while (e && e.type !== env.SEGMENT) e = e.parent;   // grace notes sit one Chord deeper
    return e;
}

function staffOfTrack(track) { return Math.floor(track / 4); }

// Every chord symbol in the score, in tick order: [{ tick, staff, harmony, seg }].
// Built once per update; looking symbols up per note by walking back segment by
// segment was quadratic on a range selection.
function indexHarmonies(score, env) {
    var list = [];
    for (var m = score.firstMeasure; m; m = m.nextMeasure)
        for (var s = m.firstSegment; s; s = s.nextInMeasure) {
            var a = s.annotations;
            if (!a) continue;
            for (var i = 0; i < a.length; i++)
                if (a[i].type === env.HARMONY)
                    list.push({ tick: s.tick, staff: staffOfTrack(a[i].track), harmony: a[i], seg: s,
                                roman: a[i].harmonyType === 1 ? CT.romanInfo(a[i].text) : null });
        }
    return list;
}

// The chord symbol that governs a note at `tick` on `staffIdx`:
//  1. the latest symbol on the note's own staff, if that staff has any before it;
//  2. otherwise the latest symbol on any staff (topmost staff on a tie) — the
//     lead-sheet case, symbols above the melody governing the other staves too.
function harmonyFor(index, tick, staffIdx) {
    var cand = null;
    for (var i = index.length - 1; i >= 0; i--) {
        var e = index[i];
        if (e.tick > tick) continue;
        if (e.staff === staffIdx) return e;
        if (!cand || (e.tick === cand.tick && e.staff < cand.staff)) cand = e;
    }
    return cand;
}

// Transposition of a staff as a line-of-fifths offset (written tpc − concert tpc):
// Bb clarinet +2, Eb alto sax +3, horn in F +1, A clarinet −3. The plugin API has no
// transposition on Instrument, so it is read off a nearby note on that staff.
function staffDelta(score, staffIdx, tick, env) {
    var c = score.newCursor();
    c.staffIdx = staffIdx; c.voice = 0;
    for (var pass = 0; pass < 2; pass++) {
        if (pass === 0) c.rewindToTick(tick); else c.rewind(0);
        while (c.segment) {
            if (c.element && c.element.type === env.CHORD) return fifthsDelta(c.element.notes[0]);
            c.next();
        }
    }
    return 0;                                   // a staff with no notes: assume concert
}

function fifthsDelta(note) {
    var d = ((note.tpc2 - note.tpc1) % 12 + 12) % 12;   // spelling can wrap by 12 fifths
    return d > 6 ? d - 12 : d;
}

// ---------------------------------------------------------------- keys (Roman numerals)
// The plugin API gives the key signature (cursor.keySignature, in fifths) but not the
// mode, so the panel asks: "Minor key" checkbox -> setRomanMinor(); major/minor is never
// inferred. The tonic is the key signature's major key, or its relative minor when the box
// is ticked. A key label in a numeral ("a: i", "C: V7") moves the tonic (not the mode) until
// the next label or key-signature change.

var romanMinor = false;
function setRomanMinor(b) { romanMinor = !!b; }

// ticks where this staff has a key signature of its own (not the ones repeated per system)
function keyChanges(score, env, staffIdx) {
    var out = [0];
    for (var m = score.firstMeasure; m; m = m.nextMeasure)
        for (var s = m.firstSegment; s; s = s.nextInMeasure) {
            var e = s.elementAt(staffIdx * 4);
            if (e && e.type === env.KEYSIG && !e.generated && s.tick > 0 && out.indexOf(s.tick) < 0) out.push(s.tick);
        }
    return out.sort(function (a, b) { return a - b; });
}

// -> { tonicTpc, minor, how: "label" | "setting" }
function keyAt(score, env, index, tick, staffIdx, cache) {
    var ch = cache && cache[staffIdx] ? cache[staffIdx] : keyChanges(score, env, staffIdx);
    if (cache) cache[staffIdx] = ch;
    var from = 0, i;
    for (i = 0; i < ch.length && ch[i] <= tick; i++) from = ch[i];
    for (i = index.length - 1; i >= 0; i--) {
        var e = index[i];
        if (e.tick > tick || !e.roman || !e.roman.label) continue;
        if (e.tick >= from) return { tonicTpc: e.roman.label.tonicTpc, minor: romanMinor, how: "label" };
        break;
    }
    var c = score.newCursor();
    c.staffIdx = staffIdx; c.voice = 0;
    c.rewindToTick(tick);
    return { tonicTpc: (romanMinor ? 17 : 14) + c.keySignature, minor: romanMinor, how: "setting" };
}

// A chord symbol (index entry) -> parsed chord; Roman numerals are resolved in the key
// in effect. Adds .display (the symbol as shown) and .resolvedText (Roman only).
function symbolChord(score, env, index, h, cache) {
    var text = String(h.harmony.text), chord;
    if (h.harmony.harmonyType === 1) {
        var k = keyAt(score, env, index, h.tick, h.staff, cache);
        chord = CT.parseRoman(text, k.tonicTpc, k.minor);
        chord.display = CT.romanPretty(text);
        if (chord.ok) chord.resolvedText = "= " + chord.resolved;
    } else {
        chord = CT.parseChord(text);
        chord.display = pretty(text);
        if (chord.ok) {                         // the same chord as a Roman numeral, in the key in effect
            var k2 = keyAt(score, env, index, h.tick, h.staff, cache);
            var rn = CT.romanFor(chord, k2.tonicTpc, k2.minor);
            if (rn) chord.resolvedText = "= " + CT.romanPretty(rn);
        }
    }
    return chord;
}

function barOf(score, tick) {
    var n = 0;
    for (var m = score.firstMeasure; m; m = m.nextMeasure) {
        if (m.firstSegment.tick > tick) break;
        n++;
    }
    return n;
}

function isDrum(note) {
    try { return note.staff.part.hasDrumStaff; } catch (e) { return false; }
}

// ---------------------------------------------------------------- collecting

// -> [{ note, seg } | { rest, seg } | { harmony, seg }]
function collect(score, env) {
    var items = [], symbols = [], sel = score.selection, els = sel.elements, i;

    if (els && els.length) {
        for (i = 0; i < els.length && items.length < MAX_NOTES; i++) {
            var e = els[i];
            if (e.type === env.NOTE) addItem(items, { note: e, seg: segmentOf(e, env) });
            else if (e.type === env.CHORD) addChord(items, e, segmentOf(e, env));
            else if (e.type === env.REST) items.push({ rest: e, seg: segmentOf(e, env) });
            else if (e.type === env.HARMONY) symbols.push({ harmony: e, seg: segmentOf(e, env) });
        }
        // a chord symbol counts as "clicked" only on its own; a range drags its
        // symbols into the selection along with the notes
        return items.length ? items : symbols;
    }
    if (sel.isRange) collectRange(score, env, items);
    return items;
}

function addChord(items, chord, seg) {
    var ns = chord.notes;
    for (var k = ns.length - 1; k >= 0; k--) addItem(items, { note: ns[k], seg: seg });  // top down
}

// A selection can hold a Note and also its Chord; plugin wrappers are fresh objects
// on every access, so identity has to be checked with is().
function addItem(items, item) {
    for (var i = 0; i < items.length; i++)
        if (items[i].note && items[i].note.is(item.note)) return;
    items.push(item);
}

// A range selection has no element list (3.6.2), so walk it with a cursor.
function collectRange(score, env, items) {
    var c = score.newCursor();
    c.rewind(env.SELECTION_START);
    if (!c.segment) return;
    var startTick = c.tick, firstStaff = c.staffIdx;
    c.rewind(env.SELECTION_END);
    var endTick = c.segment ? c.tick : score.lastSegment.tick + 1;
    var lastStaff = c.staffIdx;

    for (var track = firstStaff * 4; track < (lastStaff + 1) * 4; track++) {
        c.rewind(env.SELECTION_START);
        c.track = track;
        while (c.segment && c.tick < endTick) {
            var el = c.element;
            if (el && el.type === env.CHORD && el.track === track) addChord(items, el, c.segment);
            if (items.length >= MAX_NOTES) break;
            c.next();
        }
        if (items.length >= MAX_NOTES) break;
    }
    items.sort(function (a, b) { return a.seg.tick - b.seg.tick; });
}

// ---------------------------------------------------------------- analysing

// -> { message, groups: [{ key, text, chord, bar, onBeat, staffIdx, notes: [...], tones: [...] }] }
function analyse(score, env) {
    if (!score) return { message: "No score open.", groups: [] };
    var items = collect(score, env);
    if (!items.length)
        return { message: "Select a note to see where it sits in the chord symbol above it.", groups: [] };

    var groups = [], byKey = {}, skipped = 0;
    var index = indexHarmonies(score, env);
    var concert = !!score.style.value("concertPitch");
    var deltas = {};                            // staff -> fifths offset, per update

    // The note's spelling in the pitch space its chord symbol is written in. With
    // concert pitch off a symbol is shown transposed for its own staff, so a written
    // Bb-clarinet D under the piano's Cmaj7 is compared as the C it sounds.
    function harmonySpaceTpc(note, hStaff) {
        if (concert) return note.tpc1;
        if (!(hStaff in deltas)) {
            var seg = segmentOf(note, env);
            deltas[hStaff] = hStaff === staffOfTrack(note.track) ? fifthsDelta(note)
                           : staffDelta(score, hStaff, seg ? seg.tick : 0, env);
        }
        return note.tpc1 + deltas[hStaff];
    }

    for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (!it.seg) continue;

        if (it.harmony) {                       // clicked the symbol itself
            var g0 = groupFor(score, env, index, groups, byKey, it.harmony, it.seg, it.seg);
            var hs = staffOfTrack(it.harmony.track);
            notesStartingAt(score, it.seg, env).forEach(function (n) {
                addNote(g0, n, harmonySpaceTpc(n, hs));
            });
            continue;
        }
        var staffIdx = staffOfTrack((it.note || it.rest).track);
        if (it.note && isDrum(it.note)) { skipped++; continue; }
        var found = harmonyFor(index, it.seg.tick, staffIdx);
        if (!found) {
            var g1 = byKey["none"];
            if (!g1) { g1 = byKey["none"] = { key: "none", text: "", chord: null, notes: [], tones: [],
                                              where: "no chord symbol before this point" }; groups.push(g1); }
            if (it.note) g1.notes.push({ name: CT.tpcName(it.note.tpc), label: "", detail: "", status: "none" });
            continue;
        }
        var g = groupFor(score, env, index, groups, byKey, found.harmony, found.seg, it.seg);
        if (it.note) addNote(g, it.note, harmonySpaceTpc(it.note, found.staff));
    }
    return { message: groups.length ? "" : (skipped ? "Percussion notes have no pitch to analyse." : ""),
             groups: groups };
}

function groupFor(score, env, index, groups, byKey, harmony, hSeg, noteSeg) {
    var key = hSeg.tick + "|" + harmony.track + "|" + harmony.text;
    var g = byKey[key];
    if (g) return g;
    var chord = symbolChord(score, env, index, { tick: hSeg.tick, staff: staffOfTrack(harmony.track), harmony: harmony });
    var bar = barOf(score, hSeg.tick);
    g = byKey[key] = {
        key: key, text: String(harmony.text), chord: chord, notes: [],
        where: hSeg.tick === noteSeg.tick ? "bar " + bar : "since bar " + bar,
        tones: tonesOf(chord)
    };
    groups.push(g);
    return g;
}

function tonesOf(chord) {
    if (!chord.ok) return [];
    var t = chord.members.map(function (m) {
        return { short: m.short, name: m.name, role: m.role, hit: "" };
    });
    if (chord.bassTpc !== null) t.push({ short: "bass", name: CT.tpcName(chord.bassTpc), role: "bass", hit: "" });
    return t;
}

// note: the Note; tpc: its spelling in the chord symbol's pitch space
function addNote(g, note, tpc) {
    var name = CT.tpcName(note.tpc);            // as it appears on the staff
    if (!g.chord.ok) {
        g.notes.push({ name: name, label: g.chord.noChord ? "No chord" : "?", status: "none",
                       detail: g.chord.noChord ? "N.C. — no harmony here"
                                               : "can't read the chord symbol \"" + g.text + "\"" });
        return;
    }
    var r = CT.analyseNote(g.chord, tpc);
    var sounds = tpc === note.tpc ? ""
               : tpc === note.tpc1 ? "written " + name + ", sounds " + r.name + " · "
               : "read as " + r.name + " in the symbol's transposition · ";
    g.notes.push({ name: name, label: r.label, detail: sounds + r.detail, status: r.status });
    if (r.member >= 0 && !g.tones[r.member].hit) g.tones[r.member].hit = r.status;
    if (r.isBass && g.chord.bassTpc !== null) g.tones[g.tones.length - 1].hit = r.status === "bass" ? "bass" : "member";
}

function notesStartingAt(score, seg, env) {
    var out = [];
    for (var t = 0; t < score.ntracks; t++) {
        var el = seg.elementAt(t);
        if (el && el.type === env.CHORD) {
            for (var k = el.notes.length - 1; k >= 0; k--)
                if (!isDrum(el.notes[k])) out.push(el.notes[k]);
        }
    }
    return out;
}

// "Bb7b9" -> "B♭7♭9" for display; the # of a sharp becomes ♯.
function pretty(text) {
    return String(text).replace(/^([A-G])b/, "$1♭").replace(/\/([A-G])b/, "/$1♭")
                       .replace(/b(?=\d)/g, "♭").replace(/#/g, "♯");
}

// ================================================================ voicing view
// The selection's staves at one chord at a time: every sounding note with who plays
// it and its chord role, unison/octave doublings, and players per chord member.
//
// A "step" is one chord symbol's stretch inside the selection (plus the selection's
// own start). The notes shown for a step are those sounding at its first tick —
// notes attacked later in the same stretch are not included.

var ROLE_ORDER = [1, 3, 2, 4, 5, 6, 7, 9, 11, 13];

// selection -> { t0, t1, staves: [idx…] } or null
function selectionSpan(score, env) {
    var sel = score.selection, els = sel.elements, i, t0 = Infinity, t1 = -Infinity, st = {};
    if (sel.isRange) {
        var c = score.newCursor();
        c.rewind(env.SELECTION_START);
        if (!c.segment) return null;
        t0 = c.tick;
        var first = c.staffIdx;
        c.rewind(env.SELECTION_END);
        t1 = c.segment ? c.tick : score.lastSegment.tick + 1;
        for (i = first; i <= c.staffIdx; i++) st[i] = true;
    } else if (els && els.length) {
        var clickedSymbol = false;
        for (i = 0; i < els.length; i++) {
            var e = els[i];
            if (e.type !== env.NOTE && e.type !== env.CHORD && e.type !== env.REST && e.type !== env.HARMONY) continue;
            var seg = segmentOf(e, env);
            if (!seg) continue;
            var cr = e.type === env.NOTE ? e.parent : e;
            var len = (e.type === env.HARMONY) ? 1 : (cr.actualDuration ? cr.actualDuration.ticks : 1);
            t0 = Math.min(t0, seg.tick);
            t1 = Math.max(t1, seg.tick + Math.max(1, len));
            if (e.type === env.HARMONY) clickedSymbol = true;
            else st[staffOfTrack(e.track)] = true;
        }
        if (t0 === Infinity) return null;
        if (clickedSymbol && !Object.keys(st).length)      // a chord symbol alone: every staff
            for (i = 0; i < score.nstaves; i++) st[i] = true;
    } else return null;
    var staves = Object.keys(st).map(Number).sort(function (a, b) { return a - b; });
    return staves.length ? { t0: t0, t1: t1, staves: staves } : null;
}

function measureStart(score, tick) {
    var start = 0;
    for (var m = score.firstMeasure; m; m = m.nextMeasure) {
        if (m.firstSegment.tick > tick) break;
        start = m.firstSegment.tick;
    }
    return start;
}

// the step ticks: selection start + every chord-symbol change inside the selection
function voicingSteps(score, env, span, index) {
    var ticks = [span.t0];
    index.forEach(function (h) {
        if (h.tick > span.t0 && h.tick < span.t1 && ticks.indexOf(h.tick) < 0) ticks.push(h.tick);
    });
    return ticks.sort(function (a, b) { return a - b; });
}

function instrumentName(score, staffIdx, tick) {
    for (var i = 0; i < score.parts.length; i++) {
        var p = score.parts[i];
        if (staffIdx * 4 < p.startTrack || staffIdx * 4 >= p.endTrack) continue;
        var ins = null;
        try { ins = p.instrumentAtTick(tick); } catch (e) {}
        var name = String((ins && ins.shortName) || p.shortName || (ins && ins.longName) || p.longName || ("Staff " + (staffIdx + 1)));
        name = name.replace(/\.(?=\s|$)/g, "");                  // "Vn. I" -> "Vn I"
        var nst = (p.endTrack - p.startTrack) / 4;
        if (nst > 1) name += " " + (staffIdx - p.startTrack / 4 + 1);     // piano 1 / piano 2
        return name;
    }
    return "Staff " + (staffIdx + 1);
}

// Notes heard in [t0, t1) on the given staves: anything still sounding at t0 plus
// everything attacked before t1. -> [{ note, staff }], each staff/pitch once.
function soundingIn(score, env, staves, t0, t1) {
    var out = [], seen = {}, ms = measureStart(score, t0);
    staves.forEach(function (st) {
        for (var v = 0; v < 4; v++) {
            var c = score.newCursor();
            c.track = st * 4 + v;
            c.rewindToTick(ms);
            while (c.segment && c.tick < t1) {
                var el = c.element;
                if (el && el.track === st * 4 + v && el.type === env.CHORD) {
                    var d = el.actualDuration ? el.actualDuration.ticks : 0;
                    if (c.tick + d > t0) {
                        for (var k = 0; k < el.notes.length; k++) {
                            var n = el.notes[k], key = st + "|" + n.pitch + "|" + n.tpc1;
                            if (isDrum(n) || seen[key]) continue;
                            seen[key] = true;
                            out.push({ note: n, staff: st });
                        }
                    }
                }
                c.next();
            }
        }
    });
    return out;
}

function noteName(tpc, pitch) {
    return CT.tpcName(tpc) + (Math.floor((pitch - CT.tpcAlter(tpc)) / 12) - 1);
}

// The voicing for one step: from `tick` to the next chord symbol or the end of the selection.
function voicingAt(score, env, span, index, tick) {
    var end = span.t1;
    index.forEach(function (e) { if (e.tick > tick && e.tick < end) end = e.tick; });
    var concert = !!score.style.value("concertPitch");
    var h = harmonyFor(index, tick, span.staves[0]);
    var chord = h ? symbolChord(score, env, index, h, {}) : null;
    var roles = chord && chord.ok;
    var deltas = {};
    function space(note) {                              // see harmonySpaceTpc in analyse()
        if (concert || !h) return note.tpc1;
        if (!(h.staff in deltas))
            deltas[h.staff] = h.staff === staffOfTrack(note.track) ? fifthsDelta(note) : staffDelta(score, h.staff, tick, env);
        return note.tpc1 + deltas[h.staff];
    }

    var names = {};
    var raw = soundingIn(score, env, span.staves, tick, end).map(function (x) {
        if (!(x.staff in names)) names[x.staff] = instrumentName(score, x.staff, tick);
        var n = x.note, r = roles ? CT.analyseNote(chord, space(n)) : null;
        var mem = r && r.member >= 0 ? chord.members[r.member] : null;
        return { pitch: n.pitch, name: noteName(n.tpc1, n.pitch), who: names[x.staff], staff: x.staff,
                 status: r ? r.status : "none",
                 role: mem ? mem.short : (r && r.status === "bass" ? "B" : (r ? "✕" : "")),
                 deg: mem ? mem.deg : 0, member: r ? r.member : -1, label: r ? r.label : "" };
    });

    // one entry per sounding pitch; unisons collect their players
    var byPitch = {}, pitches = [];
    raw.forEach(function (x) {
        var k = x.pitch + "|" + x.name;
        if (!byPitch[k]) { byPitch[k] = { pitch: x.pitch, name: x.name, role: x.role, deg: x.deg, status: x.status,
                                          label: x.label, who: [] }; pitches.push(byPitch[k]); }
        if (byPitch[k].who.indexOf(x.who) < 0) byPitch[k].who.push(x.who);
    });
    pitches.sort(function (a, b) { return a.pitch - b.pitch; });

    // players per chord member, in chord order; then outside / bass-only notes
    var counts = [];
    if (roles) {
        chord.members.forEach(function (m, i) {
            var n = raw.filter(function (x) { return x.member === i && x.status !== "bass"; }).length;
            counts.push({ role: m.short, deg: m.deg, n: n, status: "member" });
        });
        var out = raw.filter(function (x) { return x.status === "outside"; }).length;
        if (out) counts.push({ role: "✕", deg: 0, n: out, status: "outside" });
        var bass = raw.filter(function (x) { return x.status === "bass"; }).length;
        if (bass) counts.push({ role: "B", deg: 0, n: bass, status: "bass" });
    }

    // doublings
    var uni = pitches.filter(function (p) { return p.who.length > 1; })
                     .map(function (p) { return p.name + " (" + p.who.join(" + ") + ")"; });
    var byLetter = {}, letters = [];
    pitches.forEach(function (p) {
        var l = p.name.replace(/-?\d+$/, "");
        if (!byLetter[l]) { byLetter[l] = 0; letters.push(l); }
        byLetter[l]++;
    });
    var oct = letters.filter(function (l) { return byLetter[l] > 1; })
                     .map(function (l) { return l + " in " + byLetter[l] + " octaves"; });
    var dbl = [];
    if (uni.length) dbl.push("Unison: " + uni.join(", "));
    if (oct.length) dbl.push("Octaves: " + oct.join(", "));

    var ms = measureStart(score, tick);
    return {
        tick: tick,
        where: "bar " + barOf(score, tick) + (tick > ms ? ", beat " + (Math.floor((tick - ms) / 480) + 1) : ""),
        chordText: h ? String(h.harmony.text) : "",
        display: chord ? chord.display : "",
        resolved: chord && chord.resolvedText ? chord.resolvedText : "",
        roman: !!(chord && (chord.roman || chord.ok)),     // shows the Minor key box
        noSymbol: !h || !chord || chord.noChord,
        unreadable: !!(h && chord && !chord.ok && !chord.noChord),
        pitches: pitches, counts: counts,
        players: raw.length,
        doublings: dbl.join(" · ")
    };
}

// -> { message, steps: [tick…], span, index } ; call voicingAt(…) for the step shown
function voicing(score, env) {
    if (!score) return { message: "No score open.", steps: [] };
    var span = selectionSpan(score, env);
    if (!span) return { message: "Select notes or staves to see how the chord is voiced.", steps: [] };
    var index = indexHarmonies(score, env);
    return { message: "", span: span, index: index, steps: voicingSteps(score, env, span, index) };
}
