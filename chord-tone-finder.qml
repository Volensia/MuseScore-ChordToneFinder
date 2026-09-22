//=============================================================================
//  Chord Tone Finder — voicing view
//  Select notes, or a range across several staves. The panel at the bottom shows
//  the chord at the start of the selection: every sounding note on a pitch strip,
//  who plays it, its role in the chord symbol, unison/octave doublings and how
//  many players are on each chord member. ◀ ▶ steps through the chord symbols
//  inside the selection.
//
//  Only reads the score — it never edits, colours or re-selects anything.
//
//  If the dock misbehaves in your MuseScore, change pluginType to "dialog" and
//  delete the dockArea line — everything else works the same.
//=============================================================================
import QtQuick 2.2
import QtQuick.Controls 1.1
import MuseScore 3.0
import Qt.labs.settings 1.0
import "scan.js" as SC

MuseScore {
    id: root
    menuPath: "Plugins.Chord Tone Finder"
    description: "Shows how the selected staves voice the chord symbol: who plays which chord member, doublings, and players per member."
    version: "2.0"
    requiresScore: false
    pluginType: "dock"
    dockArea: "bottom"
    width: 900
    height: 150

    property var env: ({ NOTE: Element.NOTE, CHORD: Element.CHORD, REST: Element.REST,
                         HARMONY: Element.HARMONY, SEGMENT: Element.SEGMENT, KEYSIG: Element.KEYSIG,
                         SELECTION_START: Cursor.SELECTION_START, SELECTION_END: Cursor.SELECTION_END })
    property var v: null                 // SC.voicing(): span + step ticks
    property var cur: null               // SC.voicingAt() for the step shown
    property int stepIdx: 0
    property string message: "Select notes or staves to see how the chord is voiced."
    property var labels: []              // laid-out notes for the strip
    property var cells: []               // pitch strip cells
    property int maxWho: 1
    property int hlDeg: -99              // highlighted chord member (-99 = none)
    property bool selChanged: true

    SystemPalette { id: pal; colorGroup: SystemPalette.Active }

    // Roman numerals need to know major or minor; the plugin API doesn't say, so ask.
    property bool romanMinor: false
    Settings { category: "ChordToneFinder"; property alias romanMinor: root.romanMinor }
    onRomanMinorChanged: { SC.setRomanMinor(romanMinor); refresh(); }

    // Role colours: Okabe–Ito, distinct for most colour-vision types.
    function roleColor(deg, status) {
        if (status === "outside") return "#8a8a8a";
        if (status === "bass") return "#b8860b";
        if (status === "none") return "#7d7d7d";
        return deg === 1 ? "#0072b2" : deg === 3 ? "#d55e00" : deg === 5 ? "#009e73"
             : deg === 7 ? "#cc79a7" : deg === 6 ? "#56b4e9" : "#e69f00";
    }
    function countKey(c) { return c.status === "member" ? c.deg : (c.status === "outside" ? -1 : -2); }
    function noteKey(p) { return p.status === "outside" ? -1 : (p.status === "bass" ? -2 : p.deg); }

    // ---------------------------------------------------------------- data
    function refresh() {
        try {
            SC.setRomanMinor(romanMinor);
            v = SC.voicing(curScore, env);
            if (selChanged || !v.steps.length || stepIdx >= v.steps.length) { stepIdx = 0; hlDeg = -99; }
            selChanged = false;
            showStep();
        } catch (e) {
            v = null; cur = null; message = "Chord Tone Finder: " + e;
            console.log("ChordToneFinder error: " + e + (e.stack ? "\n" + e.stack : ""));
            layoutStrip();
        }
    }

    function showStep() {
        if (!v || !v.steps.length) { cur = null; message = v ? v.message : message; layoutStrip(); return; }
        cur = SC.voicingAt(curScore, env, v.span, v.index, v.steps[stepIdx]);
        message = cur.pitches.length ? "" : "Nothing sounds here on the selected staves.";
        layoutStrip();
    }

    function step(d) {
        if (!v || v.steps.length < 2) return;
        stepIdx = (stepIdx + d + v.steps.length) % v.steps.length;
        showStep();
    }

    // Pitch runs left to right. Labels keep a minimum gap and slide sideways when
    // notes are close; a thin leader joins each label to its pitch.
    function layoutStrip() {
        if (!cur || !cur.pitches.length) { labels = []; cells = []; return; }
        var ps = cur.pitches, W = strip.width, pad = 26, gap = 50;
        var lo = Math.floor(ps[0].pitch / 12) * 12, hi = Math.ceil((ps[ps.length - 1].pitch + 1) / 12) * 12;
        while (hi - lo < 24) { lo -= 6; hi += 6; }
        var span = hi - lo, cw = (W - 2 * pad) / span;
        function kx(p) { return pad + (p - lo + 0.5) * cw; }

        var c = [], lit = {};
        ps.forEach(function (p) { lit[p.pitch] = p; });
        for (var q = lo; q < hi; q++) {
            var black = [1, 3, 6, 8, 10].indexOf(((q % 12) + 12) % 12) >= 0;
            c.push({ x: pad + (q - lo) * cw, w: Math.max(1, cw - 0.5), black: black,
                     color: lit[q] ? roleColor(lit[q].deg, lit[q].status) : "" });
        }
        cells = c;

        var L = ps.map(function (p) { return { kx: kx(p.pitch), lx: kx(p.pitch), p: p }; });
        for (var i = 1; i < L.length; i++) L[i].lx = Math.max(L[i].lx, L[i - 1].lx + gap);
        var right = W - gap / 2;
        for (i = L.length - 1; i >= 0; i--) {
            L[i].lx = Math.min(L[i].lx, right);
            right = L[i].lx - gap;
        }
        for (i = 0; i < L.length; i++) L[i].lx = Math.max(L[i].lx, gap / 2 + (i > 0 ? 0 : 0));
        var mw = 1;
        labels = L.map(function (l) {
            var p = l.p;
            mw = Math.max(mw, p.who.length);
            var dx = l.lx - l.kx, dy = 10;
            return { kx: l.kx, lx: l.lx, len: Math.sqrt(dx * dx + dy * dy), angle: -Math.atan2(dx, dy) * 180 / Math.PI,
                     role: p.role, name: p.name, who: p.who, color: roleColor(p.deg, p.status),
                     outline: p.status === "enharmonic", key: noteKey(p) };
        });
        maxWho = mw;
    }

    // MuseScore 3.6.2 sizes only side docks (resizeDocks() gets the plugin's width
    // for a bottom dock), and Qt's window container takes no size from the view, so
    // a bottom panel opens collapsed and has to be dragged open once per session.

    onScoreStateChanged: {
        if (state.selectionChanged) selChanged = true;
        refreshTimer.restart();
    }
    Timer { id: refreshTimer; interval: 40; onTriggered: refresh() }
    onRun: refresh()
    onWidthChanged: layoutStrip()

    // ---------------------------------------------------------------- view
    Rectangle {
        anchors.fill: parent
        color: pal.window

        Text {
            anchors.left: parent.left; anchors.leftMargin: 10
            anchors.verticalCenter: parent.top; anchors.verticalCenterOffset: 22
            visible: !cur || !cur.pitches.length
            text: message
            color: pal.windowText
            opacity: 0.7
            font.pixelSize: 13
        }

        Item {
            anchors.fill: parent
            anchors.margins: 8
            anchors.topMargin: 6
            visible: !!cur && cur.pitches.length > 0

            // header: chord · where · players per member · balance · doublings · stepper
            Row {
                id: header
                width: parent.width
                height: 24
                spacing: 10

                Text {
                    anchors.verticalCenter: parent.verticalCenter
                    text: !cur ? "" : cur.noSymbol ? (cur.unreadable ? "\"" + cur.chordText + "\"?" : "No chord symbol")
                                                   : cur.display
                    color: pal.windowText
                    font.pixelSize: cur && cur.noSymbol ? 13 : 18
                    font.bold: true
                }
                Text {
                    anchors.verticalCenter: parent.verticalCenter
                    visible: text !== ""
                    text: cur ? cur.resolved : ""
                    color: pal.windowText; opacity: 0.8; font.pixelSize: 12
                }
                Text {
                    anchors.verticalCenter: parent.verticalCenter
                    text: cur ? cur.where + " · " + cur.players + (cur.players === 1 ? " player" : " players") : ""
                    color: pal.windowText; opacity: 0.6; font.pixelSize: 11
                }
                Row {
                    anchors.verticalCenter: parent.verticalCenter
                    spacing: 3
                    Repeater {
                        model: cur ? cur.counts : []
                        Rectangle {
                            property int key: countKey(modelData)
                            width: countText.width + 10; height: 18; radius: 3
                            color: roleColor(modelData.deg, modelData.status)
                            opacity: modelData.n === 0 ? 0.35 : (hlDeg === -99 || hlDeg === key ? 1 : 0.45)
                            border.width: hlDeg === key ? 2 : 0
                            border.color: pal.windowText
                            Text {
                                id: countText
                                anchors.centerIn: parent
                                text: modelData.role + " ×" + modelData.n
                                color: "white"; font.pixelSize: 11; font.bold: true
                            }
                            MouseArea {
                                anchors.fill: parent
                                cursorShape: Qt.PointingHandCursor
                                onClicked: hlDeg = (hlDeg === parent.key ? -99 : parent.key)
                            }
                        }
                    }
                }
                Row {
                    anchors.verticalCenter: parent.verticalCenter
                    visible: !!cur && cur.counts.length > 0
                    width: 90; height: 6
                    Repeater {
                        model: cur ? cur.counts : []
                        Rectangle {
                            height: 6
                            width: cur && cur.players ? 90 * modelData.n / cur.players : 0
                            color: roleColor(modelData.deg, modelData.status)
                        }
                    }
                }
                Text {
                    anchors.verticalCenter: parent.verticalCenter
                    width: Math.max(0, header.width - x - (stepper.visible ? stepper.width + 10 : 0))
                    elide: Text.ElideRight
                    text: cur ? cur.doublings : ""
                    color: pal.windowText; opacity: 0.75; font.pixelSize: 11
                }
            }
            Row {
                id: stepper
                anchors.right: parent.right
                anchors.verticalCenter: header.verticalCenter
                spacing: 6
                visible: (!!v && v.steps.length > 1) || (!!cur && cur.roman)
                CheckBox {
                    id: minorBox
                    anchors.verticalCenter: parent.verticalCenter
                    visible: !!cur && cur.roman
                    text: "Minor key"
                    checked: romanMinor
                    onClicked: romanMinor = checked
                }
                Button { text: "◀"; width: 26; height: 20; visible: !!v && v.steps.length > 1; onClicked: step(-1) }
                Text {
                    anchors.verticalCenter: parent.verticalCenter
                    visible: !!v && v.steps.length > 1
                    text: v ? (stepIdx + 1) + " / " + v.steps.length : ""
                    color: pal.windowText; font.pixelSize: 11
                }
                Button { text: "▶"; width: 26; height: 20; visible: !!v && v.steps.length > 1; onClicked: step(1) }
            }

            // pitch strip + labels
            Item {
                id: strip
                anchors.top: header.bottom
                anchors.topMargin: 6
                width: parent.width
                height: 8 + 10 + 16 + 14 + 13 * maxWho
                onWidthChanged: layoutStrip()

                Repeater {
                    model: cells
                    Rectangle {
                        x: modelData.x; y: 0
                        width: modelData.w; height: 8
                        color: modelData.color !== "" ? modelData.color
                             : (modelData.black ? Qt.darker(pal.window, 1.35) : Qt.lighter(pal.window, 1.12))
                    }
                }
                Repeater {
                    model: labels
                    Item {
                        opacity: hlDeg === -99 || hlDeg === modelData.key ? 1 : 0.22
                        Rectangle {                         // leader from the pitch to its label
                            x: modelData.kx; y: 8
                            width: 1.2; height: modelData.len
                            transformOrigin: Item.Top
                            rotation: modelData.angle
                            color: modelData.color
                        }
                        Column {
                            x: modelData.lx - width / 2
                            y: 18
                            spacing: 0
                            Rectangle {
                                anchors.horizontalCenter: parent.horizontalCenter
                                width: Math.max(18, roleText.width + 8); height: 16; radius: 3
                                color: modelData.outline ? "transparent" : modelData.color
                                border.width: modelData.outline ? 1.5 : 0
                                border.color: modelData.color
                                Text {
                                    id: roleText
                                    anchors.centerIn: parent
                                    text: modelData.role || "·"
                                    color: modelData.outline ? modelData.color : "white"
                                    font.pixelSize: 11; font.bold: true
                                }
                            }
                            Text {
                                anchors.horizontalCenter: parent.horizontalCenter
                                text: modelData.name
                                color: pal.windowText; font.pixelSize: 11; font.bold: true
                            }
                            Repeater {
                                model: modelData.who
                                Text {
                                    anchors.horizontalCenter: parent.horizontalCenter
                                    text: modelData
                                    color: pal.windowText; opacity: 0.8; font.pixelSize: 10
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
