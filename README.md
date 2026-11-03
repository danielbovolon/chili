# 🌶 Chili — v0.2

**Deep Step Sequencer für importiertes Audio und Synth.** Inspiriert von Looperator, aber jeder Step ist ein eigenes kleines Instrument: eigener Slice oder eigene Synth-Note, eigene Hüllkurven, Filter mit Zufallsformen, Panorama-Modulation, Effektkette — plus drei Funktionen, die es so nirgends gibt: **Mutate**, **Collide**, **Rip**.

Reines Web Audio. Die komplette Klangerzeugung läuft sample-genau in einem einzigen `AudioWorklet` — keine Web-Audio-Knoten-Ketten, keine Timer-Jitter, keine Fremdbibliotheken.

---

## Schnellstart

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # → dist/ (statisch, läuft auf jedem Webserver / GitHub Pages)
npm test           # Headless-DSP-Tests (Aliasing, Peaks, Bit-Transparenz, CPU)
```

Ohne Build geht es auch: Der Ordner läuft direkt über jeden statischen Server (`python3 -m http.server`), da keine Bundler-Features nötig sind. `file://` funktioniert nicht (AudioWorklet braucht http/https).

Browser: Chrome/Edge empfohlen (bestes AudioWorklet-Timing, Ausgabegerät wählbar). Firefox und Safari laufen, ohne Geräteauswahl.

---

## Funktionen

### Sequencer
- **4 / 8 / 16 / 32 Steps**, Raster 1/8, 1/8T, 1/16, 1/16T, 1/32, Swing bis 75 %
- **Tempo in drei Modi:** BPM · Hz (1 Hz = 60 BPM) · **Note** (z. B. A4 = 440 Hz → in Oktaven auf einen musikalischen BPM-Bereich gefaltet; Kammerton und Faltbereich einstellbar)
- Clock läuft im Audio-Thread, sample-genau, ohne Drift (Double-Akkumulator)
- Pattern-Werkzeuge: würfeln, ganzes Pattern rotieren ◀ ▶, ×2-Verdopplung, Rückgängig/Wiederholen (150 Schritte)

### Layer-System (seit v0.2)
Inspiriert von Looperator: **jeder Parameter ist eine Lane über alle Steps** und wird direkt gezeichnet — kein Step muss vorher ausgewählt werden.
- **15 Layer:** Sequenz · Sample · Synth · Hüllkurve · Filter · Panorama · Tremolo · Pitch-Mod · Phaser · Flanger · Chorus · Delay · Reverb · Mutate · Rip. Jeder in eigener Farbe.
- **Layer-Leiste:** Layer ein-/ausblenden. Ein leuchtender Punkt zeigt, dass der Layer gerade klanglich etwas tut.
- **Zugeklappt** zeigt ein Layer eine Haupt-Lane; per Tab wählst du, welcher Parameter das ist (ein Punkt am Tab = dort sind Werte gezeichnet). **Aufgeklappt** (▸) zeigt jede Lane des Layers untereinander.
- **Bypass (⏻)** pro Layer: neutralisiert den Layer im Klang, die gezeichneten Werte bleiben erhalten.
- **Lanes sind visuell:** Slices als Mini-Wellenform, Hüllkurven als Form, Filter-Formen als Kurven-Icons, Noten als Namen, Pan bipolar. Steps, die für einen Layer nicht relevant sind (z. B. Synth-Lanes auf Sample-Steps), werden abgedunkelt.
- Pro Lane: würfeln ✦, zurücksetzen ⟲, rotieren ◀ ▶. Pro Layer: ganzen Layer würfeln/zurücksetzen.
- Die **Hilfeleiste** unten erklärt jedes Element, über dem die Maus steht.

| Geste in einer Lane | Wirkung |
|---|---|
| Ziehen | Werte zeichnen, über beliebig viele Steps |
| Shift + Ziehen | gerade Linie / Rampe |
| Alt + Ziehen | fein und relativ, nur der angeklickte Step |
| Strg/⌘ + Ziehen | alle Steps gleichzeitig |
| Rechtsklick (auch ziehend) / Doppelklick | auf Standardwert |
| Alt + Mausrad | einzelnen Step fein einstellen |
| Klick in Auswahl-Lanes (Form, Typ, Quelle …) | nächste Option, ziehen malt sie weiter (Shift = rückwärts) |
| Step-Nummer anklicken | Step vorhören |

### Pro Step
| Bereich | Parameter |
|---|---|
| Quelle | Sample-Slice oder Synth · Gain · Chance · Länge (in Steps) · Pitch/Fein · Startoffset · Reverse · Loop |
| Synth | 2 Oszillatoren (Sinus/Dreieck/Säge/Rechteck), Osc-2-Verstimmung, Mix, Sub, Noise |
| Amp-Hüllkurve | Attack · Decay · Sustain · Release |
| Filter | LP/HP/BP/Notch, Cutoff, Resonanz · **Filter-Hüllkurve** mit 8 Grundformen + 6 Zufallsformen (Stufen, Glatt, Walk, Spikes, Chaos/Logistic Map, Rampen) + „Zufall: Form wechselt" · Dauer in Steps · Loop (Zufallsformen erzeugen bei jedem Zyklus neue Kurven) |
| Panorama | Pan · Zufalls-Pan pro Auslösung · Pan-Modulation (6 LFO-Formen inkl. S&H/glatter Zufall) · Autopan tempo-synchron |
| Effekte | Tremolo · Pitch-Mod · Phaser (6 Stufen, Feedback) · Flanger · Chorus · Delay (sync, Ping-Pong, Ton) · Reverb (8×8-FDN) |
| Mutate | siehe unten |

### ● Aufnahme
Direkt in den Sequencer aufnehmen — das Ergebnis wird sofort ein neues Sample im Projekt (verlustfrei als 32-Bit-Float gespeichert) und automatisch auf die Steps gesliced.
- **Quelle:** *Eingang* (Mikrofon/Interface, Stereo oder Mono L/R, Geräteauswahl) oder *Resample Master* (der komplette Ausgang inkl. FX, Collide und Rip — zum Weiterschichten).
- **Sync:** startet sample-genau auf Step 1 und stoppt nach 1/2/4/8 Pattern-Durchläufen; optional ein Durchlauf **Count-in**. Die Slices sitzen damit exakt auf den Steps. Startet die Wiedergabe bei Bedarf selbst.
- **Frei:** Aufnahme per Knopf, danach nach Transienten gesliced (max. 10 min).
- **Latenzausgleich:** Eingangsaufnahmen im Sync-Modus werden um die vom Browser gemeldete Roundtrip-Latenz verschoben, plus manuellem Versatz (Einstellungen → Aufnahme). Exakt messen: Ausgang per Kabel auf den Eingang, einen Step mit kurzem Klick aufnehmen, Versatz so einstellen, dass der Klick am Slice-Anfang liegt.
- Eingang ohne Echo-Unterdrückung, Rauschfilter und automatische Pegelregelung — das Signal kommt unbearbeitet an. Eingangsmeter mit CLIP-Anzeige, optionales Monitoring über den Master (Kopfhörer verwenden).
- *Bounce* im Transport bleibt davon getrennt: Er schreibt den Master direkt als WAV-Datei auf die Festplatte.

### ✦ Mutate
Nach dem Ansatz jedes Mal anders. Der **Attack bleibt bei jeder Auslösung identisch** (plus einstellbare Schutzzeit), erst danach blendet Mutate in 25 ms eine pro Auslösung neu gewürfelte Modulation ein — über fünf Dimensionen: Pitch, Filter, Raum (Pan), Warp (Bandgeschwindigkeit) und Pegel. Kein Durchlauf klingt wie der vorige, aber der Step bleibt erkennbar er selbst.

### ✦ Collide
Der Sequencer als Teilchenbeschleuniger. Zwei Strahlen umkreisen die Sequenz gegenläufig: **Strahl A** spielt die Steps normal, **Strahl B** läuft rückwärts mit eigenem Tempoverhältnis und spielt die Slices rückwärts. Wo sich die Strahlen treffen, kollidieren die beiden Steps: Ein **Schauer aus Trümmer-Grains** beider Slices zerstreut sich in Tonhöhe, Zeit und Raum. Mit jeder Runde beschleunigt Strahl B; über 8× gibt es einen **Beam Dump** — eine große Kollision und Reset.

### ✦ Rip
Beat-Repeat wie in Ableton, aber entschieden von einem **rekurrenten neuronalen Netz** (Echo-State-Reservoir, 24 Neuronen). Es hört den Sequencer-Bus (Hüllkurven, Transienten, Helligkeit, Position im Pattern, Rip-Gewicht des Steps) und entscheidet auf jedem Step: auslösen ja/nein, Wiederholungsraster, Pitch-Drift, Reverse, Zerfall, Dauer. Nach jedem Event **lernt** es (belohnungsmodulierte Plastizität): Wiederholungen auf starken Transienten werden verstärkt, zu dichte Wiederholung bestraft. Das gelernte Gehirn wird mit dem Projekt gespeichert. „Temperatur" steuert die Exploration, „Plastizität" die Lernrate, „Lernen einfrieren" konserviert einen Zustand.

### Master
Compressor (Soft-Knee, Peak-Detektor, Attack/Release, Makeup, Dry/Wet = Parallelkompression) · Delay (sync, Ping-Pong, Ton, Hochpass im Feedback, gleitende Zeitänderung) · Reverb (Pre-Delay, Diffusoren, 8×8-FDN) · **Fader bis max. 0 dB** · Safety-Limiter · Peak-Meter mit Hold · **LUFS Momentary (ITU-R BS.1770)** · OVER-Anzeige · DSP-Last.

### Projekte & Einstellungen
- Speichern mit **Strg/⌘+S** oder Autosave; alles liegt lokal in IndexedDB — inklusive der **Original-Audiodateien**, sodass bei Samplerate-Wechsel neu und verlustfrei dekodiert wird.
- Projektseite: öffnen, umbenennen, duplizieren, löschen, **Export/Import als `.chili`** (eine Datei mit eingebetteten Samples).
- Einstellungen: Samplerate (44.1–96 kHz), Latenz, Ausgabegerät, Resampling-Qualität, Voice-Limit, Pan-Law (5 Varianten), Limiter/Ceiling, Peak-Hold, Kammerton, Note-Tempo-Bereich, Bounce-Format (16/24 Bit + TPDF-Dither oder 32 Bit Float), Autosave.
- **Bounce:** nimmt den Master-Ausgang bit-genau auf und speichert eine WAV.

### Tastatur
`Leertaste` Play/Stop · `Strg/⌘+Z` Rückgängig · `Strg/⌘+Shift+Z` bzw. `Strg+Y` Wiederholen · `Strg/⌘+S` Speichern · Knobs: ziehen, Shift = fein, Mausrad, Doppelklick = Standardwert, Pfeiltasten.

---

## Klangqualität — gemessen, nicht behauptet

`npm test` lädt den Processor headless und prüft:

| Test | Ergebnis (48 kHz) |
|---|---|
| Synth-Sägezahn auf C8 (4186 Hz): stärkste Nicht-Harmonische | **−99 dB** unter Grundton |
| Sampler: 15-kHz-Sinus +12 st (würde bei 18 kHz aliasen) — Qualität „Hoch" | **−115 dB** |
| Sampler unverändert (Pitch 0, Fader 0 dB, Pan-Law Balance) | **bit-genau** identisch zur Quelle |
| Sync-Aufnahme bei krummem Tempo (117 BPM), Count-in + Latenzausgleich | Start und Länge **auf das Sample genau** |
| Stresstest: alle FX auf Maximum, Feedback 0.95, Collide + Rip, Gain +6 dB | kein NaN/Inf, Peak ≤ −0.3 dBFS |

Details zu Architektur und Entscheidungen: [`docs/DSP.md`](docs/DSP.md).

---

## Struktur

```
index.html
src/
  main.js                 App-Controller (Zustand, Projekte, Shortcuts)
  styles.css
  audio/
    chili-processor.js    die gesamte DSP-Engine (AudioWorklet)
    engine.js             Brücke Main-Thread ↔ Worklet, Eingang, Aufnahme, Bounce
    slicer.js             gleichmäßiges + Transienten-Slicing, Wellenform-Peaks
    wav.js                WAV-Encoder (16/24 PCM mit TPDF-Dither, 32 Float)
  state/
    params.js             alle Parameter-Definitionen (Bereiche, Kurven, Defaults)
    project.js            Projektmodell, Tempo-Umrechnung, Würfeln, Layer-Bypass
    layers.js             Layer-Definitionen (Lanes, Farben, Bypass-Werte)
    storage.js            IndexedDB, .chili-Export/Import
  ui/                     lanes.js (Layer-Stack), dom.js (Knobs etc.), sequencer.js, recorder.js, special.js, master.js, pages.js
tests/dsp.test.mjs        Headless-DSP-Tests
docs/DSP.md               Engine-Dokumentation
```

## Bekannte Grenzen von v0.1
- Step-Parameter werden beim Auslösen übernommen; Änderungen wirken ab der nächsten Auslösung (Master, Collide, Rip und Layer-Bypass wirken ab dem nächsten Step).
- Ein Sample-Pool pro Projekt; „Slicen" ordnet die Steps des Patterns neu zu.
- Synth-Oszillatoren ohne Pulsbreitenmodulation; keine MIDI-Steuerung, kein Undo.
- Bei sehr dichten Patterns mit langen Delay/Reverb-Ausklängen auf vielen Steps steigt die CPU-Last — Voice-Limit in den Einstellungen anpassen.
- Noch keine Lizenzdatei — vor einer Veröffentlichung eine passende Lizenz ergänzen.
