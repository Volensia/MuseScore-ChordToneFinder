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
    if (deg === 3) return "3";              // the chord's quality is in its symbol; this names the member
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

// ================================================================ Roman numerals
// MuseScore's Roman-numeral chord symbols (harmonyType 1) are plain text such as
// "V65/V", "viio7", "bVI", "N6", optionally with a key label "a: i". A numeral only
// means something in a key, so the caller passes the key: tonicTpc + minor.
//
// Conventions (common textbook usage):
//  - case and marks give the triad: I major, i minor, ° / o diminished, ø half-
//    diminished, + augmented;
//  - a seventh is diatonic to the key unless marked: °7 diminished, ø7 minor,
//    M7 / maj7 major;
//  - figures give the inversion: 6 / 63, 64; 7, 65, 43, 42 / 2; 9 adds a diatonic ninth;
//  - in minor, lowercase vi / vii sit on the raised 6th / 7th, uppercase VI / VII on
//    the natural ones; a written accidental (bVI, #iv) counts from the major scale;
//  - X/Y is X in the key of Y (major if Y is uppercase, minor if lowercase);
//  - N / N6 is the Neapolitan: major triad on the lowered 2nd.
//  - major or minor always comes from the caller (the panel's checkbox); a key label
//    in the text ("a: i") only moves the tonic.

var NUMERALS = ["VII", "III", "IV", "VI", "II", "V", "I"];      // longest first
var DEGREE = { I: 0, II: 1, III: 2, IV: 3, V: 4, VI: 5, VII: 6 };
var MAJOR_TPC = [0, 2, 4, -1, 1, 3, 5];           // scale degrees on the line of fifths
var MINOR_TPC = [0, 2, -3, -1, 1, -4, -2];        // natural minor

function romanNormalise(s) {
    return String(s).replace(/♭/g, "b").replace(/♯/g, "#").replace(/[°º˚]/g, "o")
                    .replace(/[øØ]/g, "0").replace(/\s+/g, "");
}

// "a: i" -> { tonicTpc, minor, rest } ; no label -> null
function romanKeyLabel(text) {
    var m = /^([A-Ga-g])(bb|##|b|#)?:(.*)$/.exec(romanNormalise(text));
    if (!m) return null;
    return { tonicTpc: letterTpc(m[1].toUpperCase(), alterOf(m[2])), minor: m[1] === m[1].toLowerCase(), rest: m[3] };
}

function keyName(tonicTpc, minor) { return tpcName(tonicTpc) + (minor ? " minor" : " major"); }

// One numeral with its marks and figures, e.g. "bVIIM7", "viio65".
// -> { acc, degree, upper, quality, seventh, ninth, inversion, neapolitan } or null
function parseNumeral(s) {
    var m = /^(b|#)?(N|[IViv]+)(o|0|\+|dim|aug)?(M7|maj7|M)?([0-9]*)(o|0|\+)?(M7|maj7)?$/.exec(s);
    if (!m) return null;
    var r = { acc: alterOf(m[1]), neapolitan: m[2] === "N", upper: true, degree: 0, quality: "", seventh: "", ninth: false, inversion: 0 };
    if (!r.neapolitan) {
        var up = m[2].toUpperCase();
        if (!(up in DEGREE) || (m[2] !== up && m[2] !== m[2].toLowerCase())) return null;   // mixed case
        r.degree = DEGREE[up];
        r.upper = m[2] === up;
    } else { r.acc = -1; r.degree = 1; }
    var q = m[3] || m[6] || "";
    r.quality = q === "o" || q === "dim" ? "dim" : q === "0" ? "hdim" : q === "+" || q === "aug" ? "aug" : "";
    var maj = !!(m[4] || m[7]);
    var fig = m[5];
    var figs = { "": [0, false], "5": [0, false], "53": [0, false], "6": [1, false], "63": [1, false], "64": [2, false],
                 "7": [0, true], "753": [0, true], "65": [1, true], "653": [1, true], "43": [2, true], "643": [2, true],
                 "42": [3, true], "642": [3, true], "2": [3, true], "9": [0, true] };
    if (!(fig in figs)) return null;
    r.inversion = figs[fig][0];
    var hasSeventh = figs[fig][1] || maj || r.quality === "hdim";
    r.ninth = fig === "9";
    r.seventh = !hasSeventh ? "" : maj ? "major" : r.quality === "dim" ? "dim" : r.quality === "hdim" ? "minor" : "diatonic";
    return r;
}

// root tpc of numeral n in key (tonicTpc, minor)
function numeralRoot(n, tonicTpc, minor) {
    if (n.acc !== 0 || n.neapolitan || !minor) return tonicTpc + MAJOR_TPC[n.degree] + 7 * n.acc;
    var t = tonicTpc + MINOR_TPC[n.degree];
    if (!n.upper && (n.degree === 5 || n.degree === 6)) t += 7;       // vi, vii on the raised degrees
    return t;
}

// the diatonic scale tpc for a letter step above the local tonic
function scaleTpc(tonicTpc, minor, step) { return tonicTpc + (minor ? MINOR_TPC : MAJOR_TPC)[step % 7]; }

// Build the chord for a numeral (no key label, no secondary) in a key.
function numeralChord(n, tonicTpc, minor) {
    var root = numeralRoot(n, tonicTpc, minor);
    var upper = n.neapolitan ? true : n.upper;
    var mem = [{ deg: 1, alt: 0 }];
    mem.push({ deg: 3, alt: upper && n.quality !== "dim" && n.quality !== "hdim" ? 0 : -1 });
    mem.push({ deg: 5, alt: n.quality === "dim" || n.quality === "hdim" ? -1 : n.quality === "aug" ? 1 : 0 });
    // the letter step of the root above the tonic, for diatonic 7ths / 9ths
    var rootStep = ((LETTERS.indexOf(tpcLetter(root)) - LETTERS.indexOf(tpcLetter(tonicTpc))) % 7 + 7) % 7;
    function diatonicAlt(stepsAboveRoot) {
        var t = scaleTpc(tonicTpc, minor, rootStep + stepsAboveRoot);
        return Math.round((t - root - STEP_TPC[stepsAboveRoot]) / 7);
    }
    if (n.seventh) {
        var a7 = n.seventh === "major" ? 0 : n.seventh === "minor" ? -1 : n.seventh === "dim" ? -2 : diatonicAlt(6);
        mem.push({ deg: 7, alt: a7 });
    }
    if (n.ninth) mem.push({ deg: 9, alt: diatonicAlt(1) });
    var members = mem.map(function (x) { return decorate(root, x); });
    var bassMember = [0, 1, 2, 3][n.inversion];
    var bass = n.inversion > 0 && members[bassMember] ? members[bassMember].tpc : null;
    return { rootTpc: root, bassTpc: bass, members: members };
}

// Text of a Roman-numeral symbol -> chord (same shape as parseChord), given the key
// in effect. A key label inside the text ("a: i") overrides that key.
function parseRoman(text, tonicTpc, minor) {
    var raw = String(text), out = { text: raw, ok: false, rootTpc: null, bassTpc: null, members: [],
                                    unparsed: "", noChord: false, roman: true, key: "", resolved: "" };
    var s = romanNormalise(raw);
    if (/^(N\.?C\.?|NC)$/i.test(s) || s === "") { out.noChord = true; return out; }
    var lab = romanKeyLabel(raw);                  // "a: i": moves the tonic; major/minor stays the caller's
    if (lab) { tonicTpc = lab.tonicTpc; s = lab.rest; }
    var parts = s.split("/");
    var nums = parts.map(parseNumeral);
    if (nums.some(function (n) { return !n; })) { out.unparsed = raw; return out; }
    // resolve secondaries from the right: X/Y/Z = X in the key of (Y in the key of Z)
    var t = tonicTpc, mi = minor;
    for (var i = nums.length - 1; i >= 1; i--) {
        var target = nums[i];
        t = numeralRoot(target, t, mi);
        mi = !target.upper && !target.neapolitan;
    }
    var c = numeralChord(nums[0], t, mi);
    out.rootTpc = c.rootTpc; out.bassTpc = c.bassTpc; out.members = c.members;
    out.key = keyName(tonicTpc, minor);
    out.resolved = chordName(out);
    out.ok = true;
    return out;
}

// What a built chord would be called as a chord symbol: "D7/F♯", "Bdim7", "Fm".
function chordName(chord) {
    var by = {};
    chord.members.forEach(function (m) { by[m.deg] = m.alt; });
    var t = by[3], f = by[5], s = by[7], q;
    if (s === undefined) q = t === 0 ? (f === 1 ? "+" : "") : (f === -1 ? "dim" : "m");
    else if (t === 0) q = f === 1 ? "+7" : s === 0 ? "maj7" : "7";
    else if (f === -1) q = s === -2 ? "dim7" : "m7♭5";
    else q = s === 0 ? "m(maj7)" : "m7";
    if (by[9] !== undefined) q = q.replace("7", "9") + (by[9] !== 0 ? "(" + accidental(by[9]) + "9)" : "");
    return tpcName(chord.rootTpc) + q + (chord.bassTpc !== null && chord.bassTpc !== chord.rootTpc ? "/" + tpcName(chord.bassTpc) : "");
}

// A Roman symbol's key label, if it has one: -> { label: {tonicTpc, minor} | null }
function romanInfo(text) {
    var lab = romanKeyLabel(text);
    return { label: lab ? { tonicTpc: lab.tonicTpc, minor: lab.minor } : null };
}

// Pretty form for display: "bVII" -> "♭VII", "viio7" -> "vii°7", "iiø7" kept.
function romanPretty(text) {
    return String(text).replace(/(^|[:/\s])b(?=[IViv])/g, "$1♭").replace(/(^|[:/\s])#(?=[IViv])/g, "$1♯")
                       .replace(/([IViv])o/g, "$1°").replace(/([IViv])0/g, "$1ø");
}

// ================================================================ letter -> Roman
// The Roman numeral for a letter-name chord in a key, or "" when there is no standard
// one (6th chords, sus, add9, slash basses that aren't chord members…). Candidates are
// tried in textbook order and each is read back with parseRoman(); the first whose
// notes and bass match exactly wins, so a numeral shown is never wrong.
var ROMAN_UP = ["I", "II", "III", "IV", "V", "VI", "VII"];
var DIATONIC_TARGETS = {
    major: ["ii", "iii", "IV", "V", "vi"],
    minor: ["III", "iv", "V", "VI", "VII"]
};

function romanFor(chord, tonicTpc, minor) {
    if (!chord || !chord.ok || chord.roman) return "";
    var degs = chord.members.map(function (m) { return m.deg; });
    var allowed = degs.every(function (d) { return d === 1 || d === 3 || d === 5 || d === 7 || d === 9; });
    if (!allowed || degs.indexOf(3) < 0 || degs.indexOf(5) < 0) return "";
    var hasSeventh = degs.indexOf(7) >= 0, hasNinth = degs.indexOf(9) >= 0;
    if (hasNinth && !hasSeventh) return "";

    var inv = 0;
    if (chord.bassTpc !== null && chord.bassTpc !== chord.rootTpc) {
        var bi = -1;
        chord.members.forEach(function (m, i) { if (m.tpc === chord.bassTpc) bi = i; });
        if (bi < 0) return "";
        inv = [0, 1, 2, 3][[1, 3, 5, 7].indexOf(chord.members[bi].deg)];
        if (inv === undefined || inv < 0) return "";
    }
    if (hasNinth && inv) return "";
    var figs = hasNinth ? ["9"] : hasSeventh ? [["7", "65", "43", "42"][inv], "M" + ["7", "65", "43", "42"][inv]]
                                             : [["", "6", "64"][inv]];
    if (figs[0] === undefined) return "";

    var want = chord.members.map(function (m) { return m.tpc; }).sort(function (a, b) { return a - b; }).join(",");
    var wantBass = inv ? chord.bassTpc : null;
    function matches(txt) {
        var c = parseRoman(txt, tonicTpc, minor);
        if (!c.ok) return false;
        var got = c.members.map(function (m) { return m.tpc; }).sort(function (a, b) { return a - b; }).join(",");
        return got === want && (c.bassTpc === null ? null : c.bassTpc) === wantBass;
    }

    var d = ((LETTERS.indexOf(tpcLetter(chord.rootTpc)) - LETTERS.indexOf(tpcLetter(tonicTpc))) % 7 + 7) % 7;
    var acc = Math.round((chord.rootTpc - tonicTpc - MAJOR_TPC[d]) / 7);
    var accStr = acc < 0 ? new Array(-acc + 1).join("b") : new Array(acc + 1).join("#");
    var up = ROMAN_UP[d], lo = up.toLowerCase();
    // every case/mark spelling of this degree, conventional ones only (° ø lowercase, + uppercase)
    var spellings = [up, lo, lo + "o", lo + "ø", up + "+"];
    var i, j, k, t;
    function tryAll(prefix, list, suffix) {
        for (var a1 = 0; a1 < list.length; a1++) for (var b1 = 0; b1 < figs.length; b1++)
            if (matches(t = prefix + list[a1] + figs[b1] + (suffix || ""))) return t;
        return "";
    }

    // 1. the key's own chord on this degree
    var diatonic = (minor ? ["i", "iio", "III", "iv", "V", "VI", "viio"] : ["I", "ii", "iii", "IV", "V", "vi", "viio"])[d];
    var dia = [diatonic];
    if (/o$/.test(diatonic)) dia.push(diatonic.replace(/o$/, "ø"));     // vii°7 / viiø7
    if (minor && d === 6) dia.push("VII");                                // natural minor's subtonic
    if (minor && d === 4) dia.push("v");                                  // natural minor's minor v
    if ((t = tryAll("", dia))) return t;
    // 2. the tonic borrowed from the other mode (I in minor, i in major)
    if (d === 0 && (t = tryAll("", spellings))) return t;
    // 3. Neapolitan
    if (!hasSeventh && (t = tryAll("", ["N"]))) return t;
    // 4. secondary dominant / leading-tone chords
    var targets = DIATONIC_TARGETS[minor ? "minor" : "major"];
    var primaries = hasSeventh ? ["V", "viio", "viiø"] : ["V", "viio"];
    for (i = 0; i < targets.length; i++) if ((t = tryAll("", primaries, "/" + targets[i]))) return t;
    // 5. other chords on this degree (mixture: iv in major, III+…), then with an accidental
    if ((t = tryAll("", spellings))) return t;
    if (accStr && (t = tryAll(accStr, spellings))) return t;
    return "";
}
