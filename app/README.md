# Gesture Sequencer

A browser-based music sequencer controlled by mouse or webcam hand tracking. No hardware, no install — just open and play.

## How it works

There's a 16×8 grid. Each row is a musical note. A line sweeps left to right — when it hits a glowing cell, that note plays.

Hover your mouse over cells to activate them. Move away and they slowly fade out. The longer you hover, the louder the note.

## Controls

| Input | Action |
|-------|--------|
| Mouse hover | Activate cells |
| Right click | Lock/unlock a row |
| `[` / `]` | BPM down / up |
| `R` | Randomize notes |
| `C` | Clear board |
| `W` | Toggle webcam |

## Tech

- Vanilla JS — no framework, no build step
- Web Audio API for sound (replaces MIDI)
- MediaPipe Hands for webcam tracking (replaces Kinect)
- HTML5 Canvas for rendering

## Original vs this version

| | Original | This |
|-|----------|------|
| Input | Microsoft Kinect | Mouse or webcam |
| Sound | MIDI | Web Audio API |
| Hand detection | OpenCV blobs | MediaPipe Hands |
| Language | Java / Processing | JavaScript |
| Setup | Hardware rig | Open index.html |