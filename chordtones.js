// Chord Tone Finder — pure logic, no MuseScore objects in here.
// parseChord(text)       chord symbol text -> root, bass and the chord's members
// analyseNote(chord,tpc) which member of that chord a spelled note is
//
// Everything works on TPC (MuseScore's line-of-fifths spelling: C=14, G=15, F=13,
// one sharp = +7), because the plugin API hands a Harmony over only as its text
// (no rootTpc/baseTpc — probed on 3.6.2) and a Note as pitch + tpc. Using the
// spelling, not the MIDI pitch, is what lets D♯ over C read as a ♯9 and E♭ as a ♭3.
.pragma library

var LETTERS = "CDEFGAB";                        // scale order: letter steps
var FIFTHS = "FCGDAEB";                         // line-of-fifths order
var LETTER_PC = [0, 2, 4, 5, 7, 9, 11];         // pitch class of C D E F G A B
var MAJOR = [0, 2, 4, 5, 7, 9, 11];             // semitones above the root per step
var STEP_TPC = [0, 2, 4, -1, 1, 3, 5];          // tpc offset of the major-scale degree

// chord degree -> letter steps above the root
var DEG_STEPS = { 1: 0, 2: 1, 9: 1, 3: 2, 4: 3, 11: 3, 5: 4, 6: 5, 13: 5, 7: 6 };

// ---------------------------------------------------------------- spelling

function tpcLetter(tpc) { return FIFTHS.charAt(((tpc + 1) % 7 + 7) % 7); }
function tpcAlter(tpc)  { return Math.floor((tpc + 1) / 7) - 2; }
function tpcPc(tpc)     { return ((LETTER_PC[LETTERS.indexOf(tpcLetter(tpc))] + tpcAlter(tpc)) % 12 + 12) % 12; }

function accidental(alter) {
    return alter === -2 ? "𝄫" : alter === -1 ? "♭" : alter === 1 ? "♯" : alter === 2 ? "𝄪" : "";
}

function tpcName(tpc) { return tpcLetter(tpc) + accidental(tpcAlter(tpc)); }

function letterTpc(letter, alter) { return FIFTHS.indexOf(letter) + 13 + 7 * alter; }

// ---------------------------------------------------------------- parsing

// Normalise the many ways a chord symbol is typed into one ASCII vocabulary.
function normalise(s) {
    return String(s)
        .replace(/[♭]/g, "b").replace(/[♯]/g, "#").replace(/♮/g, "")
        .replace(/[Δ∆]|\^/g, "maj")          // Δ, ∆, ^
        .replace(/[°º˚]/g, "dim")       // °
        .replace(/[øØ]/g, "hdim")            // ø
        .replace(/−/g, "-")
        .replace(/\s+/g, "");
}

// Members are { deg, alt }: deg is the chord degree (1 3 5 7 9 11 13, or 2 4 6 for
// sus/add/six chords), alt the chromatic change from the major-scale degree, except
// that a 7 is stored with alt -1 for a plain seventh — the way musicians name it.
function parseChord(text) {
    var raw = String(text);
    var s = normalise(raw);
    var out = { text: raw, ok: false, rootTpc: null, bassTpc: null, members: [],
                unparsed: "", noChord: false };

    if (/^(N\.?C\.?|NC|\(?N\.C\.\)?)$/i.test(s) || s === "") { out.noChord = true; return out; }

    var m = /^([A-Ga-g])(bb|##|b|#|x)?/.exec(s);
    if (!m) { out.unparsed = raw; return out; }
    out.rootTpc = letterTpc(m[1].toUpperCase(), alterOf(m[2]));
    s = s.substr(m[0].length);

    // slash bass: only a letter after the slash (6/9 is not a slash chord)
    var b = /\/([A-Ga-g])(bb|##|b|#|x)?$/.exec(s);
    if (b) {
        out.bassTpc = letterTpc(b[1].toUpperCase(), alterOf(b[2]));
        s = s.substr(0, b.index);
    }

    var third = 0, fifth = 0, seventh = null;   // alts; seventh null = none
    var noThird = false, noFifth = false, sus = null, power = false;
    var majSeven = false, dim = false;
    var ext = {};                               // deg -> [alts]
    var removed = {};
    var explicit = {};                          // degrees written with "add"
    var bad = "";
    var start = true;                           // still at the head of the quality

    function addExt(deg, alt) {
        if (!ext[deg]) ext[deg] = [];
        if (ext[deg].indexOf(alt) < 0) ext[deg].push(alt);
    }
    // an altered 9/11/13 replaces the natural one a 13 or 11 implied (C13♭9 has no 9)
    function alterExt(deg, alt) {
        if (ext[deg] && !explicit[deg] && alt !== 0) {
            var k = ext[deg].indexOf(0);
            if (k >= 0) ext[deg].splice(k, 1);
        }
        addExt(deg, alt);
    }
    function stack(n) {                         // 7, 9, 11, 13 imply what's below
        seventh = majSeven ? 0 : (dim ? -2 : -1);
        if (n >= 9)  addExt(9, 0);
        if (n >= 11 && (third === -1 || n === 11)) addExt(11, 0);
        if (n >= 13) addExt(13, 0);
    }

    while (s.length) {
        var t;
        if ((t = /^[(),.]/.exec(s))) { s = s.substr(1); continue; }
        if (start && (t = /^(hdim|m7b5|min7b5|mi7b5|-7b5)/.exec(s))) {
            third = -1; fifth = -1; seventh = -1; dim = false;
        } else if (start && (t = /^(dim|o(?!mit))/.exec(s))) {
            third = -1; fifth = -1; dim = true;
        } else if ((t = /^(aug|\+(?![4569]|1[13]))/.exec(s))) {
            fifth = 1;
        } else if ((t = /^(maj|Maj|MAJ)/.exec(s)) || (t = /^(ma|Ma|M)(?![a-z])/.exec(s))) {
            majSeven = true;
            if (!/^[0-9]/.test(s.substr(t[0].length))) seventh = 0;   // "CΔ", "Cmaj"
        } else if (start && (t = /^(min|mi|m|-)/.exec(s))) {
            third = -1;
        } else if ((t = /^sus(2|4)?/.exec(s))) {
            noThird = true; sus = t[1] === "2" ? 2 : 4;
        } else if ((t = /^alt/.exec(s))) {
            seventh = -1; noFifth = true;
            addExt(9, -1); addExt(9, 1); addExt(11, 1); addExt(13, -1);
        } else if ((t = /^add(b|#|-|\+)?(2|4|6|9|11|13)/.exec(s))) {
            var d = +t[2];
            addExt(d, alterOf(t[1]));
            explicit[d] = true;
        } else if ((t = /^(omit|no)(3|5|7|9|11|13)/.exec(s))) {
            removed[+t[2]] = true;
        } else if ((t = /^(b|#|-|\+)(4|5|6|9|11|13)/.exec(s))) {
            var a = alterOf(t[1]), dd = +t[2];
            if (dd === 5) fifth = a;
            else alterExt(dd === 4 ? 11 : dd === 6 ? 13 : dd, a);
        } else if ((t = /^(6\/9|69)/.exec(s))) {
            addExt(6, 0); addExt(9, 0);
        } else if ((t = /^(13|11|9|7)/.exec(s))) {
            stack(+t[1]);
        } else if ((t = /^6/.exec(s))) {
            addExt(6, 0);
        } else if ((t = /^5/.exec(s))) {
            if (start) power = true; else fifth = 0;
        } else if ((t = /^2/.exec(s))) {
            addExt(2, 0);
        } else if ((t = /^4/.exec(s))) {
            noThird = true; sus = 4;
        } else {
            bad += s.charAt(0); s = s.substr(1); start = false; continue;
        }
        s = s.substr(t[0].length);
        start = false;
    }

    var mem = [{ deg: 1, alt: 0 }];
    if (!power && !noThird && !removed[3]) mem.push({ deg: 3, alt: third });
    if (sus) mem.push({ deg: sus, alt: 0 });
    if (!noFifth && !removed[5]) mem.push({ deg: 5, alt: fifth });
    if (ext[6]) mem.push({ deg: 6, alt: ext[6][0] });
    if (seventh !== null && !removed[7]) mem.push({ deg: 7, alt: seventh });
    [2, 4, 9, 11, 13].forEach(function (d) {
        if (removed[d] || !ext[d]) return;
        ext[d].sort().forEach(function (a) { mem.push({ deg: d, alt: a }); });
    });
    out.members = mem.map(function (x) { return decorate(out.rootTpc, x); });
    out.unparsed = bad;
    out.ok = true;
    return out;
}

function alterOf(acc) {
    if (!acc) return 0;
    if (acc === "b" || acc === "-") return -1;
    if (acc === "bb") return -2;
    if (acc === "#" || acc === "+") return 1;
    if (acc === "##" || acc === "x") return 2;
    return 0;
}

// fill in spelling, semitones and the label of one chord member
function decorate(rootTpc, x) {
    var steps = DEG_STEPS[x.deg];
    var tpc = rootTpc + STEP_TPC[steps] + 7 * x.alt;
    return { deg: x.deg, alt: x.alt, steps: steps,
             semis: ((MAJOR[steps] + x.alt) % 12 + 12) % 12,
             tpc: tpc, name: tpcName(tpc),
             label: degreeLabel(x.deg, x.alt), short: shortLabel(x.deg, x.alt),
             role: roleOf(x.deg) };
}

// ---------------------------------------------------------------- naming

function ordinal(deg) {
    if (deg === 1) return "Root";
    return deg + (deg === 2 ? "nd" : deg === 3 ? "rd" : "th");
}

// "3rd", "♭5th", "♯9th". The quality of a 3rd, 6th or 7th is part of the chord's
// colour, not an alteration, so those carry no accidental (the detail line says
// minor/major). 5ths and the extensions do carry one.
function degreeLabel(deg, alt) {
    var showAcc = !(deg === 1 || deg === 3 || deg === 6 || deg === 7 || deg === 2 || deg === 4);
    return (showAcc ? accidental(alt) : "") + ordinal(deg);
}

function shortLabel(deg, alt) {
    if (deg === 1) return "R";
    if (deg === 7) return alt === 0 ? "△7" : alt === -2 ? "°7" : "7";
    if (deg === 3) return alt === -1 ? "♭3" : "3";
    return accidental(alt) + deg;
}

function roleOf(deg) {
    if (deg === 9 || deg === 11 || deg === 13) return "extension";
    if (deg === 2 || deg === 4) return "added";
    return "chord tone";
}

function intervalName(steps, alt) {
    var perfect = steps === 0 || steps === 3 || steps === 4;
    var q;
    if (perfect) q = alt === 0 ? "perfect" : alt === -1 ? "diminished" : alt === 1 ? "augmented"
                   : alt < 0 ? "doubly diminished" : "doubly augmented";
    else q = alt === 0 ? "major" : alt === -1 ? "minor" : alt === -2 ? "diminished" : alt === 1 ? "augmented"
           : alt < 0 ? "doubly diminished" : "doubly augmented";
    var num = ["unison", "2nd", "3rd", "4th", "5th", "6th", "7th"][steps];
    if (steps === 0) return alt === 0 ? "unison" : q + " unison";
    return q + " " + num;
}

// ---------------------------------------------------------------- analysis

// What is the note spelled `tpc` in `chord`?
// status: "member"      spelled as the chord member it is
//         "enharmonic"  sounds like a member but is spelled otherwise
//         "bass"        not a chord member, but it is the slash bass
//         "outside"     not in the chord
function analyseNote(chord, tpc) {
    var steps = ((LETTERS.indexOf(tpcLetter(tpc)) - LETTERS.indexOf(tpcLetter(chord.rootTpc))) % 7 + 7) % 7;
    var semis = ((tpcPc(tpc) - tpcPc(chord.rootTpc)) % 12 + 12) % 12;
    var alt = semis - MAJOR[steps];
    if (alt > 6) alt -= 12;
    if (alt < -6) alt += 12;
    var res = { name: tpcName(tpc), tpc: tpc, steps: steps, semis: semis,
                interval: intervalName(steps, alt) + " above " + tpcName(chord.rootTpc),
                status: "outside", member: -1, label: "", detail: "",
                isBass: chord.bassTpc !== null && tpcPc(chord.bassTpc) === tpcPc(tpc) };
    var i, mem = chord.members;

    for (i = 0; i < mem.length; i++)
        if (mem[i].steps === steps && mem[i].semis === semis) {
            res.status = "member"; res.member = i; res.label = mem[i].label;
            res.detail = res.interval + " · " + mem[i].role;
            break;
        }
    if (res.status === "outside")
        for (i = 0; i < mem.length; i++)
            if (mem[i].semis === semis) {
                res.status = "enharmonic"; res.member = i; res.label = mem[i].label;
                res.detail = "written " + res.name + ", the chord spells it " + mem[i].name +
                             " · " + mem[i].role;
                break;
            }
    if (res.status === "outside") {
        if (res.isBass) {
            res.status = "bass"; res.label = "Bass";
            res.detail = "slash bass, not a chord tone · " + res.interval;
        } else {
            res.label = "Not in chord";
            var same = null;
            for (i = 0; i < mem.length; i++) if (mem[i].steps === steps) same = mem[i];
            res.detail = res.interval + (same ? " · the chord has " + same.name + " (" + same.label + ")" : "");
        }
    } else if (res.isBass) {
        res.detail += " · also the slash bass";
    }
    return res;
}

// One-line description of the parsed chord, for tests and the tooltip.
function describe(chord) {
    if (chord.noChord) return "no chord";
    if (!chord.ok) return "not understood";
    return chord.members.map(function (m) { return m.short + "=" + m.name; }).join(" ") +
           (chord.bassTpc !== null ? " /" + tpcName(chord.bassTpc) : "") +
           (chord.unparsed ? " ?" + chord.unparsed : "");
}
