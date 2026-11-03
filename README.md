# 🌶 Chili — v0.3

**Ein Step-Sequencer wie die Konsole eines Raumschiffs.** Importiertes Audio oder Synth, 4–32 Steps, jeder Parameter jedes Steps direkt zeichenbar, acht Makros, die Klang und Struktur der ganzen Sequenz umbauen, ein Zufallsmodulator für unendliche Komplexität — und drei eigene Systeme: **Mutate**, **Collide**, **Rip**.

Reines Web Audio. Die gesamte Klangerzeugung läuft sample-genau in einem einzigen `AudioWorklet`, ohne Fremdbibliotheken. Läuft auf Desktop und Phone.

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # → dist/ (statisch, läuft auf jedem Webserver)
npm test           # Headless-DSP-Tests
```
Browser: Chrome/Edge empfohlen. `file://` geht nicht (AudioWorklet braucht http/https).

---

## Aufbau der Konsole

| Bereich | Inhalt |
|---|---|
| **Deck** | Play · Bounce · Tempo-LCD (BPM / Hz / Note) · Steps · Raster · **Laufrichtung** · Swing · globale Würfel · Pattern-Werkzeuge · Undo |
| **Makro** | Heat · Dichte · Warp · Ton · Pitch · Länge · Raum · Chaos |
| **Viewport** | WAVE: Sample, Slices, Live-Abspielköpfe · SCOPE: Oszilloskop + Spektrum · FELD: Surround-Feld mit jeder Stimme im Raum + Goniometer |
| **Layer-Stack** | 14 Layer, jeder Parameter eine Lane über alle Steps |
| **Bay** | MASTER (Comp/Delay/Reverb) · FILTER (Master-Filter) · CHAOS · COLLIDE · RIP · REC |
| **OUT** | Master-Fader (max. 0 dB), LED-Meter, Peak, LUFS, Limiter, DSP |

Auf dem Phone teilt eine Tab-Leiste die Konsole in **SEQ · MAKRO · MODULE · OUT**. Die Hilfeleiste unten erklärt jedes Element, über dem die Maus steht.

## Einfach bis extrem komplex
- **Einfach:** Sample reinziehen → wird automatisch gesliced und auf die Steps gelegt → Play.
- **Schnell:** Makros drehen, Würfel werfen, Laufrichtung wechseln.
- **Tief:** jede Lane jedes Layers per Hand zeichnen, Ratchets pro Step, Chaos-Modulator auf einzelne Reihen.
- **Unendlich:** Chaos ∞ — jeder Parameter jedes Steps ändert sich bei jeder Auslösung.

### Makros (neutral = keine Wirkung)
| Makro | Wirkung |
|---|---|
| **Heat** | Sättigung des Sequencer-Busses (tanh mit ADAA, aliasarm), mehr Resonanz und Filter-Hub |
| **Dichte** | links: Pattern dünnt aus · rechts: Ghost-Notes auf leeren Steps und eingestreute Ratchets |
| **Warp** | Mikro-Timing, Pitch-Drift, Startpunkt-Jitter, Längen-Variation, gelegentlich rückwärts |
| **Ton** | alle Filter-Cutoffs ±3 Oktaven |
| **Pitch** | Transponieren ±24 Halbtöne |
| **Länge** | alle Notenlängen ×0.1 … ×4 (Staccato bis Drone) |
| **Raum** | links trocken · rechts mehr Master-Delay/-Hall, Spread und Surround-Orbit |
| **Chaos** | Gesamttiefe des Zufallsmodulators |

### Würfel 🎲
- **Pro Reihe:** 🎲 **1** = ein zufälliges Preset (kuratiert oder generiert), gleich auf allen Steps · 🎲 **ALL** = jeder Step bekommt einen eigenen Zufallswert.
- **Global (Deck):** 🎲 **1** = jede Reihe ein zufälliges Preset · 🎲 **ALL** = jeder Step jeder Reihe zufällig, inklusive Gates.
- **Pro Lane:** 🎲 würfelt nur diese Lane.

### Chaos — Zufallsmodulator (angelehnt an VCV Random)
Pro Ziel-Parameter ein eigener Zufallskanal, getaktet in Steps.
**Tiefe** · **Rate** (neuer Wert alle n Steps) · **Chance** (überhaupt neu würfeln) · **Zufall** (Sprungweite vom vorigen Wert) · **Form** (Stufe → Linear → Glatt → Exponentiell, stufenlos) · **Lock** + **Loop** (Phrasen wiederholen wie eine Turing Machine) · **Relativ/Absolut** · **Seed** · **Ziele** (jede Reihe einzeln, dazu Gates).
„∞ Unendlich" schaltet alles auf Maximum.

### Master-Filter
LP · BP · HP · Notch (12/24/36/48 dB/Okt, Butterworth-Stufen, Resonanz in der letzten Stufe) · Peak · Low-/High-Shelf · Comb ± · Formant (Vokal-Morph A–E–I–O–U).
Drive vor dem Filter (ADAA) · Hüllkurvenfolger (Menge, Attack, Release) · LFO (frei oder tempo-synchron, 6 Formen) · Stereo-Phase · L/R-Versatz · Mix · Ausgang. Der Frequenzgang wird live gezeichnet, inklusive der modulierten Cutoff-Position links/rechts.

### Surround-Panner & Spread (Layer „Raum")
Pro Step: **Pan** (links/rechts), **Tiefe** (vorne → hinten), **Orbit** (kreist um den Hörer, eigene Rate), **Spread** (Stereobreite 0–200 %; beim Synth trennt Spread die beiden Oszillatoren). Dazu Zufalls-Pan, Pan-Modulation und Autopan.
Die Ausgabe ist Stereo: „hinten" wird psychoakustisch erzeugt (Höhendämpfung wie durch Kopf und Ohrmuschel, leiser, breiter). Das FELD im Viewport zeigt jede Stimme live im Raum.

### Ratchets & Laufrichtung
- **Ratchet** 1–8 Wiederholungen pro Step, **Ratchet-Dynamik** (anschwellend/abfallend).
- **Laufrichtung:** vorwärts · rückwärts · Ping-Pong · Zufall · Brown · Sprung.

### Slicing wie Simpler/Sampler
**Auto** (Transienten, sonst Beat-Raster) · **Transienten** (mit Empfindlichkeit) · **Beat** (Raster 1/2–1/32 beim Projekttempo) · **Region** (gleiche Teile) · **Manuell**: Marker im Viewport ziehen, Doppelklick setzt einen neuen, Rechtsklick entfernt ihn.
**Zuordnung** Slice → Step: 1 2 3 … · rückwärts · Ping-Pong · Zufall · nur Slice 1.

### Layer-System
Sequenz (Pegel, Chance, Länge, Ratchet, Quelle, Rip-Gewicht) · Sample · Synth · Hüllkurve · Filter · Raum · Tremolo · Pitch-Mod · Phaser · Flanger · Chorus · Delay · Reverb · Mutate.
Layer ein-/ausblenden über die Leiste, Bypass ⏻ pro Layer, auf-/zuklappen für alle Lanes.

| Geste in einer Lane | Wirkung |
|---|---|
| Ziehen | zeichnen, über beliebig viele Steps |
| Shift + Ziehen | gerade Linie / Rampe |
| Alt + Ziehen | fein und relativ |
| Strg/⌘ + Ziehen | alle Steps gleichzeitig |
| Rechtsklick / Doppelklick | Standardwert |
| Alt + Mausrad | einzelnen Step fein |
| Step-Nummer | vorhören |

### Mutate · Collide · Rip
- **Mutate:** Der Attack bleibt bei jeder Auslösung identisch, danach moduliert Mutate Pitch, Filter, Raum, Warp und Pegel jedes Mal neu.
- **Collide:** Zwei gegenläufige Strahlen umkreisen die Sequenz. Wo sie sich treffen, entsteht ein Trümmer-Schauer aus Grains beider Steps; Strahl B beschleunigt bis zum Beam Dump.
- **Rip:** Beat-Repeat, gesteuert von einem rekurrenten neuronalen Netz, das aus jeder Wiederholung lernt. Das Gehirn wird mit dem Projekt gespeichert.

### Aufnahme, Projekte, Einstellungen
- **REC:** Eingang oder Master direkt als Sample, Sync auf Step 1 mit Count-in und Latenzausgleich, sample-genau.
- **Bounce:** Master als WAV (16/24 Bit mit TPDF-Dither oder 32 Bit Float).
- Projekte lokal in IndexedDB inklusive Original-Audio; Export/Import als `.chili`.
- Einstellungen: Samplerate bis 96 kHz, Latenz, Ausgabegerät, Resampling-Qualität, Voices, Pan-Law, Limiter/Ceiling, Kammerton, Autosave …

---

## Klangqualität — gemessen (`npm test`, 48 kHz)

| Test | Ergebnis |
|---|---|
| Synth-Sägezahn C8: stärkste Nicht-Harmonische | −99 dB |
| Sampler +12 st auf 15-kHz-Sinus, Alias-Rest (Qualität Hoch) | −115 dB |
| Sampler unverändert, alle neuen Funktionen neutral | bit-genau |
| Heat-Sättigung, 5-kHz-Sinus, +24 dB Drive: Aliasing naiv → ADAA | −47 dB → −71 dB |
| Master-Filter LP 48 dB/Okt bei 1 kHz: 2 kHz | −48.5 dB |
| Master-Filter: 10 Typen, Resonanz 1, Drive 36 dB, LFO/Env voll | stabil, kein NaN |
| Chaos 100 % auf 76 Parametern + alle Makros + Ratchets | stabil, Peak ≤ −0.3 dBFS |
| Ratchet 4 | exakt 4 Anschläge pro Step |
| Sync-Aufnahme mit Count-in + Latenzausgleich | sample-genau |

**CPU-Schutz:** Bei Dauerlast über 85 % blendet die Engine die ältesten Ausklänge (Delay-/Hall-Tails) in 6 ms aus, statt Dropouts zu riskieren.

## Struktur
```
src/
  main.js                 App-Controller, Layout, Undo, Würfel global
  styles.css              Raumschiff-Konsole, Desktop + Phone
  audio/  chili-processor.js (gesamte DSP) · engine.js · slicer.js · wav.js
  state/  params.js · layers.js (Layer, Presets) · project.js · storage.js
  ui/     deck.js · viewport.js · lanes.js · bay.js (Bay, Chaos) · master.js (Master, Filter, Out)
          special.js (Collide, Rip) · recorder.js · pages.js · dom.js
tests/dsp.test.mjs
docs/DSP.md
```

## Grenzen von v0.3
- Surround wird als Stereo gerendert (psychoakustisch); echte Mehrkanal-Ausgabe (Quad/5.1/7.1) ist der nächste Schritt.
- Step-Parameter wirken ab der nächsten Auslösung; Makros, Master und Bypass ab dem nächsten Step.
- Delay und Reverb laufen pro Stimme — viele lange Hall-Tails gleichzeitig kosten CPU (der Schutz greift dann).
- Keine MIDI-Steuerung, keine Lizenzdatei.
