# Chili — DSP-Architektur

Alles Hörbare entsteht in `src/audio/chili-processor.js`, einem einzigen `AudioWorkletProcessor`. Der Main-Thread schickt nur Zustand (Pattern, Parameter, Samples) und empfängt Meter-/Visualisierungsdaten (~30 Hz).

## Signalfluss

```
Clock (sample-genau) ─┬─ Strahl A ──┐
                      └─ Strahl B ──┤ (Collide)
                                    ▼
            Voices (Sampler | Synth) → Filter → Amp-Env → Phaser → Flanger → Chorus → Pan → Delay → Reverb ─┐
            Collide-Grains ──────────────────────────────────────────────────────────────────────────────┤
                                                                                                          ▼
                                                                                         Sequencer-Bus → Rip
                                                                                                          ▼
                                    Compressor (Dry/Wet) → Delay (Dry/Wet) → Reverb (Dry/Wet) → Fader → Limiter → LUFS/Peak → Out
```

## Clock
- Zeit in Samples als Double, Events werden innerhalb eines Render-Quantums an die exakte Sampleposition gelegt: der Block wird an jedem Event in Segmente geteilt. Kein Drift, kein `setTimeout`-Jitter.
- Collide-Modus: Strahlpositionen kontinuierlich in Step-Einheiten; nächster Event = Minimum aus Strahl-A-Step, Strahl-B-Step und analytisch berechnetem Kollisionszeitpunkt `gap / (1 + rB)`.

## Quellen
- **Sampler:** Windowed-Sinc-Interpolation (Blackman-Harris, 512 Phasen, linear zwischen Phasen). Bei Pitch-Up wird der Kernel um `1/ratio` gestreckt (echtes Anti-Aliasing statt Aliasing-behaftetem linearem Resampling). Bei exakt ganzzahliger Position und Pitch 0 wird direkt kopiert → bit-transparent. 1-ms-Kantenblenden an Slice-Grenzen verhindern Klicks bei Schnitten mitten in der Welle.
- **Synth:** Wavetables per additiver Synthese, **eine Tabelle pro halbe Oktave** (24 Mipmaps), jeweils nur Harmonische unter Nyquist für die höchste Frequenz der Halboktave → aliasfrei auch bei Pitch-Modulation. Lesen mit 4-Punkt-Hermite.

## Modulation
- Alle Modulatoren (LFOs, Filter-Hüllkurve, Mutate, Pan) laufen mit Control-Rate (16 Samples) und werden **pro Sample linear interpoliert** (Ramps für Rate, Filter-g, Pegel, Pan-Gains, Allpass-Koeffizienten, Delayzeiten). Pegel und Pan zusätzlich mit 3-ms-Einpol-Glättung → kein Zipper, auch bei Rechteck-LFOs.
- Filter: TPT/ZDF-State-Variable-Filter (Zavalishin/Simper) — linear, stabil unter schneller Modulation, keine Nichtlinearität → keine Alias-Quelle.
- Modulierte Delays (Flanger, Chorus, Master-Delay mit gleitender Zeit): 4-Punkt-Hermite-Interpolation.

## Mutate
Pro Auslösung: neue Zufallsfrequenzen (0.35–2.25 × Tempo, Vorzeichen zufällig) und -phasen für 5 Dimensionen, je Summe zweier Sinus. Einsatz erst ab `Attack + Schutzzeit`, 25 ms Einblendung. Der Ansatz ist damit sample-identisch bei jeder Wiederholung.

## Collide
Kollision → 3…80 Grains (Hann-Fenster, 6–76 ms) aus den Slices beider beteiligter Steps (bei Synth-Steps: Sinus-Pings im Obertonraster). Startzeiten exponentialverteilt (Schauer), Pitch/Pan-Streuung skaliert mit Energie und Strahlgeschwindigkeit. Grains nutzen denselben Sinc-Reader.

## Rip
- Ringpuffer 8 s des Sequencer-Busses.
- Reservoir: 24 Leaky-tanh-Neuronen, dünn besetzte rekurrente Matrix (Spektralradius ≈ 0.95), 10 Eingänge (schnelle/langsame Hüllkurve, Transientenmaß, Nulldurchgangsrate, Pattern-Phase sin/cos, Rip-Gewicht des Steps, Zustand, Rauschen × Temperatur, Bias), 6 Ausgänge.
- Entscheidung pro Step mit Explorationsrauschen. Event: Wiederholung 0 ist live (Aufnahme), danach Schleife mit Sinc-Resampling (Pitch-Drift kumulativ), optional rückwärts, Zerfall pro Wiederholung, 1.5-ms-Fenster und 3-ms-Crossfade zurück zum Dry-Signal.
- Lernen (REINFORCE-artig): `Wout += lr · (r − r̄) · noise · x_decision`, Belohnung = Transientenstärke beim Einsatz + Energie − Dichte-Strafe, langsamer Rückzug zur Initialisierung (Homöostase), Gewichte auf ±3 begrenzt. Seed + gelernte Gewichte werden im Projekt gespeichert.

## Master
- Compressor: Feed-Forward, Stereo-Link (Max-Peak), Soft-Knee-Kennlinie im dB-Bereich, Attack/Release auf der Gain-Reduktion. Dry/Wet = Parallelkompression.
- Reverb: Pre-Delay → 4 Schroeder-Allpässe pro Kanal → 8×8-Feedback-Delay-Network mit Hadamard-Matrix (orthogonal, verlustfrei bis auf frequenzabhängige Dämpfung im Loop, T60-exakte Leitungsverstärkungen).
- Alle Dry/Wet-Werte werden über 20 ms geglättet.
- **Fader:** Gain = Position² (−12 dB bei halber Stellung), Maximum exakt 1.0 (0 dB), 15-ms-Glättung.
- **Safety-Limiter:** 1.5 ms Lookahead, Sliding-Window-Minimum (monotone Deque) + Box-Glättung über das Fenster → die Gain-Kurve erreicht garantiert vor dem Peak den nötigen Wert, ohne Sprung. Unterhalb der Ceiling ist g = 1 → bit-transparent. Release 80 ms.
- LUFS Momentary: K-Weighting nach BS.1770 (für jede Samplerate neu berechnete Koeffizienten), 400-ms-Fenster.

## Aufnahme (Capture)
- Der Eingang (MediaStream) ist direkt an den Worklet-Eingang angeschlossen; Kanalwahl (Stereo/L/R) im Worklet.
- Sync-Start wird im selben Tick-Handler ausgelöst wie die Step-Trigger: Startsample = Event-Sample von Step 1. Stopp nach `Länge × Durchläufe` Steps am Event-Sample.
- Latenzausgleich: die ersten `compN` Samples werden verworfen und ab dem Stopp-Sample `compN` Samples nachgeschrieben → identische Länge, verschobener Inhalt.
- Daten gehen in 16384-Frame-Blöcken an den Main-Thread, werden als 32-Bit-Float-WAV (ohne Dither) gespeichert und wie ein Import behandelt.

## Voices
- Pool `maxVoices + 4`, alles vorallokiert (keine Garbage Collection im Audio-Thread).
- Stealing: zuerst Voices im Ausklang (nur noch Delay/Reverb-Tail), dann die älteste, mit 4-ms-Fade.
- Tail-Fast-Path: nach dem Release wird nur noch Delay/Reverb gerechnet; Voice endet nach 100 ms unter ca. −110 dBFS.
- Denormal-Schutz in allen Rückkopplungszuständen.
