# Chili — DSP-Architektur

Alles Hörbare entsteht in `src/audio/chili-processor.js`, einem einzigen `AudioWorkletProcessor`. Der Main-Thread schickt nur Zustand (Pattern, Parameter, Samples) und empfängt Meter-/Visualisierungsdaten (~30 Hz).

## Signalfluss

```
Clock (sample-genau) ── Steps ──┐
                                 ▼
            Voices (Sampler | Synth) → Filter → Amp-Env → Phaser → Flanger → Chorus → Pan → Delay → Reverb ─┐
                                                                                                          ▼
                                                                                         Sequencer-Bus → Rip
                                                                                                          ▼
                                    Compressor (Dry/Wet) → Delay (Dry/Wet) → Reverb (Dry/Wet) → Fader → Limiter → LUFS/Peak → Out
```

## Clock
- Zeit in Samples als Double, Events werden innerhalb eines Render-Quantums an die exakte Sampleposition gelegt: der Block wird an jedem Event in Segmente geteilt. Kein Drift, kein `setTimeout`-Jitter.

## Quellen
- **Sampler:** Windowed-Sinc-Interpolation (Blackman-Harris, 512 Phasen, linear zwischen Phasen). Bei Pitch-Up wird der Kernel um `1/ratio` gestreckt (echtes Anti-Aliasing statt Aliasing-behaftetem linearem Resampling). Bei exakt ganzzahliger Position und Pitch 0 wird direkt kopiert → bit-transparent. 1-ms-Kantenblenden an Slice-Grenzen verhindern Klicks bei Schnitten mitten in der Welle.
- **Synth:** Wavetables per additiver Synthese, **eine Tabelle pro halbe Oktave** (24 Mipmaps), jeweils nur Harmonische unter Nyquist für die höchste Frequenz der Halboktave → aliasfrei auch bei Pitch-Modulation. Lesen mit 4-Punkt-Hermite.

## Modulation
- Alle Modulatoren (LFOs, Filter-Hüllkurve, Mutate, Pan) laufen mit Control-Rate (16 Samples) und werden **pro Sample linear interpoliert** (Ramps für Rate, Filter-g, Pegel, Pan-Gains, Allpass-Koeffizienten, Delayzeiten). Pegel und Pan zusätzlich mit 3-ms-Einpol-Glättung → kein Zipper, auch bei Rechteck-LFOs.
- Filter: TPT/ZDF-State-Variable-Filter (Zavalishin/Simper) — linear, stabil unter schneller Modulation, keine Nichtlinearität → keine Alias-Quelle.
- Modulierte Delays (Flanger, Chorus, Master-Delay mit gleitender Zeit): 4-Punkt-Hermite-Interpolation.

## Mutate
Pro Auslösung: neue Zufallsfrequenzen (0.35–2.25 × Tempo, Vorzeichen zufällig) und -phasen für 5 Dimensionen, je Summe zweier Sinus. Einsatz erst ab `Attack + Schutzzeit`, 25 ms Einblendung. Der Ansatz ist damit sample-identisch bei jeder Wiederholung.

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

## v0.3: Makros, Chaos, Ratchets, Surround, Master-Filter
- **Trigger-Pipeline:** Step kopieren (Scratch-Objekt, keine Allokation) → Chaos anwenden → Gate/Dichte/Chance → Makros → Ratchets/Mikro-Timing. Verzögerte Anschläge liegen in einem vorallokierten Pending-Pool (64) und werden wie Clock-Events sample-genau in den Block geschnitten.
- **Chaos:** pro Parameter ein Kanal (prev/next/cur, Historie bis 32). Neuer Wert alle `rate` Steps mit Wahrscheinlichkeit `prob`; `next = prev + rand·(U − prev)`; mit `lock` wird stattdessen ein Wert aus der Loop-Historie wiederholt. Übergang innerhalb der Rate über stufenlos gemischte Kurven (Stufe/Linear/Cosinus/Kubisch). Anwendung im normierten Parameterraum (lin/log/kubisch wie die UI), relativ (±) oder absolut (Überblendung). Auswahl- und Schalter-Parameter springen ab Schwellwerten.
- **Heat:** tanh mit Antiderivative-Antialiasing 1. Ordnung, `y = (F(x) − F(x₁)) / (x − x₁)`, `F = ln cosh`; Drive bis +24 dB, Ausgleich `1/√g`, sanfte Einblendung. Bei Heat 0 komplett umgangen.
- **Master-Filter:** ZDF-SVF; LP/BP/HP/Notch als Kaskade aus 1–4 Stufen mit Butterworth-Dämpfung `k = 2·cos((2i+1)π/4N)`, Resonanz skaliert nur die letzte Stufe; Peak/Shelf nach Simper (A = 10^(gain/40)); Comb mit Hermite-Delay; Formant aus 3 parallelen Bandpässen. Modulation (Env-Follower, LFO, Stereo-Phase) mit Control-Rate und linearer Interpolation der Koeffizienten. Bypass bit-transparent, Ein-/Ausschalten über 20 ms überblendet, Zustände beim Einschalten gelöscht, NaN-Sicherheitsnetz.
- **Surround:** nach dem Pan ein Einpol-Tiefpass (20 kHz → ~4 kHz) und −2.8 dB bei „hinten", Seitenanteil verbreitert; Orbit moduliert Pan (sin) und Tiefe (cos). Spread: M/S-Skalierung, beim Synth Seitensignal aus der Oszillator-Differenz. Alle Pfade bei neutralen Werten übersprungen.
- **CPU-Schutz:** gleitender Mittelwert der Blockrechenzeit; über 85 % wird alle 6 Blöcke die älteste Stimme (bevorzugt im Ausklang) in 6 ms ausgeblendet.

## v0.4: Granular, globale Hüllkurven, Collide entfernt
- **Granular:** pro Stimme bis 12 Körner (vorallokiert). Neues Korn alle `sr/Kornrate` Samples (±30 % Jitter) an Lesekopf + Streuung; Pitch pro Korn = Step-Rate · 2^(±Streuung/12); Hann-Fenster (1024 Punkte, interpoliert); Lesen mit Hermite bis Rate 1, darüber Windowed-Sinc mit fc = 1/Rate. Normierung 1/√Überlappung. Der Lesekopf läuft mit Rate · Scan und wickelt im Slice.
- **Globale Amp-Hüllkurve:** Mischung der Step-ADSR mit der globalen beim Anschlag (Menge 0–1).
- **Globale Filter-Hüllkurve:** eigene ADSR pro Stimme mit Control-Rate (16 Samples), addiert Menge × Hüllkurve in Oktaven zum Cutoff; erzwingt einen Lowpass, wenn der Step keinen Filter hat.
- **Collide** wurde komplett entfernt (Engine, Zustand, UI).

## Voices
- Pool `maxVoices + 4`, alles vorallokiert (keine Garbage Collection im Audio-Thread).
- Stealing: zuerst Voices im Ausklang (nur noch Delay/Reverb-Tail), dann die älteste, mit 4-ms-Fade.
- Tail-Fast-Path: nach dem Release wird nur noch Delay/Reverb gerechnet; Voice endet nach 100 ms unter ca. −110 dBFS.
- Denormal-Schutz in allen Rückkopplungszuständen.
