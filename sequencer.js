/* ==========================================================
   GESTURE SEQUENCER — sequencer.js
   Ported from Processing/Java + Kinect → Pure browser
   No hardware required. Mouse or webcam hand tracking.
   ========================================================== */

// ── Constants ──────────────────────────────────────────────
const COLS = 16;
const ROWS = 8;


// Musical scales (intervals in semitones from root)
const SCALES = {
  minor_penta: { name: 'Minor Pentatonic', intervals: [0,3,5,7,10] },
  major:       { name: 'Major',            intervals: [0,2,4,5,7,9,11] },
  minor:       { name: 'Natural Minor',    intervals: [0,2,3,5,7,8,10] },
  dorian:      { name: 'Dorian',           intervals: [0,2,3,5,7,9,10] },
  blues:       { name: 'Blues',            intervals: [0,3,5,6,7,10] },
  chromatic:   { name: 'Chromatic',        intervals: [0,1,2,3,4,5,6,7,8,9,10,11] },
};

// ── Web Audio setup ────────────────────────────────────────
let audioCtx = null;
let reverbNode = null;
let masterGain = null;
let reverbLevel = 0.3;

function getAudioCtx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = 0.6;
    masterGain.connect(audioCtx.destination);
    buildReverb();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

async function buildReverb() {
  const ctx = getAudioCtx();
  reverbNode = ctx.createConvolver();
  const len = ctx.sampleRate * 2.5;
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
  }
  reverbNode.buffer = buf;
  reverbNode.connect(masterGain);
}

function midiToHz(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// Play a single note — maps exactly to original myBus.sendNoteOn()
function playNote(midiNote, velocity) {
  const ctx = getAudioCtx();
  if (!reverbNode) return;

  const gain = ctx.createGain();
  const dryGain = ctx.createGain();
  const wetGain = ctx.createGain();
  const osc = ctx.createOscillator();
  const osc2 = ctx.createOscillator(); // slight detune for warmth

  const vol = (velocity / 127) * 0.5;
  gain.gain.value = vol;
  dryGain.gain.value = 1 - reverbLevel;
  wetGain.gain.value = reverbLevel;

  osc.type = 'triangle';
  osc2.type = 'sine';
  osc.frequency.value = midiToHz(midiNote);
  osc2.frequency.value = midiToHz(midiNote) * 1.003; // detune

  osc.connect(gain);
  osc2.connect(gain);
  gain.connect(dryGain);
  gain.connect(wetGain);
  dryGain.connect(masterGain);
  wetGain.connect(reverbNode);

  const now = ctx.currentTime;
  gain.gain.setValueAtTime(vol, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);

  osc.start(now);
  osc2.start(now);
  osc.stop(now + 0.65);
  osc2.stop(now + 0.65);
}

// ── Board Class ────────────────────────────────────────────
// Direct port of the Processing Board class
// cells[][]: velocity of each cell (0–127)
// influence[][]: energy being added per frame
// playedstep[][]: prevents double-trigger per sweep pass
class Board {
  constructor(cols, rows) {
    this.cols = cols;
    this.rows = rows;
    this.curstep = 0;
    this.bpm = 120;
    this.decay = 0.4;
    this.influrate = 34;
    this.sounds = new Array(rows).fill(0);
    this.locked = new Array(rows).fill(false);
    this.cells = Array.from({ length: cols }, () => new Float32Array(rows));
    this.influence = Array.from({ length: cols }, () => new Float32Array(rows));
    this.playedstep = Array.from({ length: cols }, () => new Uint8Array(rows));
    this.currentScale = 'minor_penta';
    this.rootNote = 60;
    this.normalSounds();
  }

  // Assign notes based on selected scale
  normalSounds() {
    const intervals = SCALES[this.currentScale].intervals;
    for (let y = 0; y < this.rows; y++) {
      // Map rows to scale degrees, spanning 2 octaves from root
      const degree = (this.rows - 1 - y);
      const octave = Math.floor(degree / intervals.length);
      const step = degree % intervals.length;
      this.sounds[y] = this.rootNote + intervals[step] + octave * 12;
    }
  }

  randomSounds() {
    const intervals = SCALES[this.currentScale].intervals;
    for (let y = 0; y < this.rows; y++) {
      const rndOct = Math.floor(Math.random() * 3);
      const rndStep = Math.floor(Math.random() * intervals.length);
      this.sounds[y] = this.rootNote + intervals[rndStep] + rndOct * 12;
    }
  }

  toggleLock(row) {
    this.locked[row] = !this.locked[row];
  }

  clearBoard() {
    for (let x = 0; x < this.cols; x++)
      for (let y = 0; y < this.rows; y++) {
        this.cells[x][y] = 0;
        this.influence[x][y] = 0;
        this.playedstep[x][y] = 0;
      }
  }

  // Map a 2D influence matrix (from mouse/webcam positions) onto the board
  // Exact port of influmatrix() from original
  influmatrix(mat) {
    for (let x = 0; x < this.cols; x++)
      for (let y = 0; y < this.rows; y++)
        this.influence[x][y] = mat[x][y] ? this.influrate : 0;
  }

  // Single point influence (mouse hover)
  influ(gx, gy) {
    const x = Math.max(0, Math.min(this.cols - 1, gx));
    const y = Math.max(0, Math.min(this.rows - 1, gy));
    for (let ax = 0; ax < this.cols; ax++)
      for (let ay = 0; ay < this.rows; ay++)
        this.influence[ax][ay] = (ax === x && ay === y) ? this.influrate : 0;
  }

  // Called every frame — direct port of Board.update()
  update(xpos, canvasWidth) {
    const step = Math.floor((xpos / canvasWidth) * this.cols);

    // Reset playedstep when the playhead moves to a new column
    if (step !== this.curstep) {
      for (let i = 0; i < this.rows; i++)
        this.playedstep[this.curstep][i] = 0;
      this.curstep = step;
    }

    // Decay and influence — port of the nested loop in Board.update()
    for (let x = 0; x < this.cols; x++) {
      for (let y = 0; y < this.rows; y++) {
        if (!this.locked[y]) {
          if (this.cells[x][y] > 0)
            this.cells[x][y] = Math.max(0, this.cells[x][y] - this.decay);
          if (this.cells[x][y] < 120)
            this.cells[x][y] = Math.min(120, this.cells[x][y] + this.influence[x][y]);
        }
      }
    }
  }

  // Fire notes for the current step
  triggerNotes(step) {
    for (let y = 0; y < this.rows; y++) {
      if (this.cells[step][y] > 5 && !this.playedstep[step][y]) {
        this.playedstep[step][y] = 1;
        playNote(this.sounds[y], Math.round(this.cells[step][y]));
      }
    }
  }
}

// ── Canvas Renderer ────────────────────────────────────────
class Renderer {
  constructor(canvas, board) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.board = board;
    this.resize();
  }

  resize() {
    const wrap = this.canvas.parentElement;
    this.canvas.width = wrap.clientWidth;
    this.canvas.height = wrap.clientHeight;
    this.cellW = this.canvas.width / this.board.cols;
    this.cellH = this.canvas.height / this.board.rows;
  }

  // Returns playhead x position — port of Board.vert()
  getPlayheadX(bpm) {
    const pixelsPerMilli = (bpm * (this.canvas.width / this.board.cols)) / 60000;
    return (pixelsPerMilli * Date.now()) % this.canvas.width;
  }

  draw(xpos) {
    const ctx = this.ctx;
    const { cols, rows, cells, influence, locked } = this.board;
    const { cellW, cellH } = this;
    const W = this.canvas.width;
    const H = this.canvas.height;

    ctx.clearRect(0, 0, W, H);

    // Background
    ctx.fillStyle = '#0a0a0b';
    ctx.fillRect(0, 0, W, H);

    const activeCol = Math.floor((xpos / W) * cols);

    for (let x = 0; x < cols; x++) {
      for (let y = 0; y < rows; y++) {
        const px = x * cellW;
        const py = y * cellH;
        const vel = cells[x][y];
        const inf = influence[x][y];
        const isActive = x === activeCol;

        // Cell background
        ctx.fillStyle = isActive ? 'rgba(0,229,160,0.05)' : (x % 2 === 0 ? '#0f0f12' : '#0d0d10');
        ctx.fillRect(px, py, cellW, cellH);

        // Influence highlight (where your hand is)
        if (inf > 0) {
          const alpha = (inf / 80) * 0.18;
          ctx.fillStyle = `rgba(124,108,250,${alpha})`;
          ctx.fillRect(px, py, cellW, cellH);
        }

        // Cell velocity circle — direct port of displaycirc-style rendering
        if (vel > 1) {
          const maxRadius = Math.min(cellW, cellH) * 0.42;
          const r = (vel / 120) * maxRadius;
          const cx = px + cellW / 2;
          const cy = py + cellH / 2;

          // Outer glow
          const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 1.5);
          const hue = 160 + (vel / 120) * 40;
          grad.addColorStop(0, `hsla(${hue}, 90%, 65%, ${vel / 200})`);
          grad.addColorStop(1, `hsla(${hue}, 90%, 65%, 0)`);
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(cx, cy, r * 1.5, 0, Math.PI * 2);
          ctx.fill();

          // Core circle
          ctx.fillStyle = `hsla(${hue}, 85%, 62%, ${0.5 + (vel / 120) * 0.5})`;
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.fill();
        }

        // Playhead column — note trigger bar (port of the rect indicator)
        if (isActive) {
          ctx.fillStyle = `rgba(0,229,160,${0.12 + (vel / 120) * 0.18})`;
          ctx.fillRect(px, py + cellH - 4, cellW, 4);
          if (vel > 5) {
            ctx.fillStyle = `rgba(0,229,160,0.8)`;
            ctx.fillRect(px, py + cellH - 18, cellW, 14);
          }
        }
      }
    }

    // Grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    for (let x = 1; x < cols; x++) {
      ctx.beginPath();
      ctx.moveTo(x * cellW, 0);
      ctx.lineTo(x * cellW, H);
      ctx.stroke();
    }
    for (let y = 1; y < rows; y++) {
      ctx.beginPath();
      ctx.moveTo(0, y * cellH);
      ctx.lineTo(W, y * cellH);
      ctx.stroke();
    }

    // Beat markers (every 4 columns)
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1.5;
    for (let x = 0; x < cols; x += 4) {
      ctx.beginPath();
      ctx.moveTo(x * cellW, 0);
      ctx.lineTo(x * cellW, H);
      ctx.stroke();
    }

    // Locked row indicators
    for (let y = 0; y < rows; y++) {
      if (locked[y]) {
        ctx.strokeStyle = 'rgba(245,158,11,0.4)';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(1, y * cellH + 1, W - 2, cellH - 2);
        ctx.setLineDash([]);
      }
    }

    // Playhead line — port of Board.vert()
    ctx.strokeStyle = 'rgba(0,229,160,0.9)';
    ctx.lineWidth = 2;
    ctx.shadowColor = '#00e5a0';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(xpos, 0);
    ctx.lineTo(xpos, H);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Note labels on left edge
    ctx.font = '10px "Space Mono", monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.textAlign = 'left';
    for (let y = 0; y < rows; y++) {
      const noteName = midiToNoteName(this.board.sounds[y]);
      ctx.fillText(noteName, 4, y * cellH + cellH / 2 + 4);
    }
  }
}

function midiToNoteName(midi) {
  const names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  const oct = Math.floor(midi / 12) - 1;
  return names[midi % 12] + oct;
}

// ── Input Handler ──────────────────────────────────────────
class InputHandler {
  constructor(canvas, board, renderer) {
    this.canvas = canvas;
    this.board = board;
    this.renderer = renderer;
    this.mode = 'mouse';
    this.mouseDown = false;
    this.lastInfluCell = [-1, -1];
    this.influenceMatrix = Array.from({ length: COLS }, () => new Uint8Array(ROWS));
    this.bindMouse();
    this.bindTouch();
    this.bindKeys();
  }

  pixelToCell(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const mx = clientX - rect.left;
    const my = clientY - rect.top;
    const gx = Math.max(0, Math.min(COLS - 1, Math.floor((mx / rect.width) * COLS)));
    const gy = Math.max(0, Math.min(ROWS - 1, Math.floor((my / rect.height) * ROWS)));
    return [gx, gy];
  }

  applyInfluence(clientX, clientY, radius = 0) {
    const [gx, gy] = this.pixelToCell(clientX, clientY);
    for (let x = 0; x < COLS; x++)
      for (let y = 0; y < ROWS; y++)
        this.influenceMatrix[x][y] = 0;

    // Apply influence in a small radius (simulates finger/hand size)
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        const nx = gx + dx, ny = gy + dy;
        if (nx >= 0 && nx < COLS && ny >= 0 && ny < ROWS)
          this.influenceMatrix[nx][ny] = 1;
      }
    }
    this.board.influmatrix(this.influenceMatrix);
  }

  clearInfluence() {
    for (let x = 0; x < COLS; x++)
      for (let y = 0; y < ROWS; y++)
        this.influenceMatrix[x][y] = 0;
    this.board.influmatrix(this.influenceMatrix);
  }

  bindMouse() {
    this.canvas.addEventListener('mousemove', e => {
      if (this.mode !== 'mouse') return;
      this.applyInfluence(e.clientX, e.clientY, 0);
    });
    this.canvas.addEventListener('mousedown', e => {
      if (e.button === 2) {
        const [, gy] = this.pixelToCell(e.clientX, e.clientY);
        this.board.toggleLock(gy);
        return;
      }
      this.mouseDown = true;
      getAudioCtx(); // unlock audio on first click
    });
    this.canvas.addEventListener('mouseup', () => { this.mouseDown = false; });
    this.canvas.addEventListener('mouseleave', () => this.clearInfluence());
    this.canvas.addEventListener('contextmenu', e => e.preventDefault());
  }

  bindTouch() {
    this.canvas.addEventListener('touchmove', e => {
      e.preventDefault();
      if (this.mode !== 'mouse') return;
      for (let x = 0; x < COLS; x++)
        for (let y = 0; y < ROWS; y++)
          this.influenceMatrix[x][y] = 0;
      for (const t of e.touches)
        this.applyInfluence(t.clientX, t.clientY, 1);
      this.board.influmatrix(this.influenceMatrix);
    }, { passive: false });
    this.canvas.addEventListener('touchstart', e => {
      e.preventDefault();
      getAudioCtx();
    }, { passive: false });
    this.canvas.addEventListener('touchend', e => {
      if (e.touches.length === 0) this.clearInfluence();
    });
  }

  bindKeys() {
    document.addEventListener('keydown', e => {
      switch (e.key) {
        case ']': app.changeBpm(1); break;
        case '[': app.changeBpm(-1); break;
        case 'r': case 'R': app.randomizeScale(); break;
        case 'c': case 'C': this.board.clearBoard(); break;
        case 'w': case 'W': app.toggleWebcam(); break;
      }
    });
  }

  // Called by webcam tracker with normalized [0-1] x,y coordinates
  applyHandPosition(normX, normY) {
    // Mirror X (webcam is mirrored)
    const gx = Math.max(0, Math.min(COLS - 1, Math.floor((1 - normX) * COLS)));
    const gy = Math.max(0, Math.min(ROWS - 1, Math.floor(normY * ROWS)));
    for (let x = 0; x < COLS; x++)
      for (let y = 0; y < ROWS; y++)
        this.influenceMatrix[x][y] = 0;
    // 2-cell radius for hand tracking
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        const nx = gx + dx, ny = gy + dy;
        if (nx >= 0 && nx < COLS && ny >= 0 && ny < ROWS)
          this.influenceMatrix[nx][ny] = 1;
      }
    this.board.influmatrix(this.influenceMatrix);
  }
}

// ── Webcam Hand Tracker (MediaPipe) ───────────────────────
class WebcamTracker {
  constructor(onHand, onStatus) {
    this.onHand = onHand;
    this.onStatus = onStatus;
    this.active = false;
    this.hands = null;
    this.camera = null;
    this.videoEl = document.getElementById('webcamVideo');
    this.stream = null;
  }

  async start() {
    this.onStatus('Loading MediaPipe…');
    try {
      await this.loadMediaPipe();
      this.onStatus('Starting camera…');
      this.stream = await navigator.mediaDevices.getUserMedia({ video: true });
      this.videoEl.srcObject = this.stream;
      await new Promise(r => this.videoEl.onloadeddata = r);
      this.active = true;
      this.onStatus('✓ Hand tracking active');
      this.loop();
    } catch (err) {
      console.warn('Webcam/MediaPipe error:', err);
      this.onStatus('⚠ Camera unavailable — using mouse');
      return false;
    }
    return true;
  }

  async loadMediaPipe() {
    // Dynamically load MediaPipe Hands from CDN
    return new Promise((resolve, reject) => {
      if (window.Hands) { resolve(); return; }
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js';
      script.crossOrigin = 'anonymous';
      script.onload = () => {
        const script2 = document.createElement('script');
        script2.src = 'https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js';
        script2.crossOrigin = 'anonymous';
        script2.onload = resolve;
        script2.onerror = reject;
        document.head.appendChild(script2);
      };
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  async initHands() {
    this.hands = new Hands({
      locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}`
    });
    this.hands.setOptions({
      maxNumHands: 2,
      modelComplexity: 0,
      minDetectionConfidence: 0.6,
      minTrackingConfidence: 0.5
    });
    this.hands.onResults(results => {
      if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        // Use wrist (landmark 0) as position — cleaner than palm center for mapping
        for (const landmarks of results.multiHandLandmarks) {
          const wrist = landmarks[0];
          this.onHand(wrist.x, wrist.y);
        }
      }
    });
    return this.hands;
  }

  async loop() {
    const hands = await this.initHands();
    const detect = async () => {
      if (!this.active) return;
      if (this.videoEl.readyState >= 2) {
        await hands.send({ image: this.videoEl });
      }
      requestAnimationFrame(detect);
    };
    detect();
  }

  stop() {
    this.active = false;
    if (this.stream) this.stream.getTracks().forEach(t => t.stop());
    if (this.videoEl) this.videoEl.srcObject = null;
  }
}

// ── App Controller ─────────────────────────────────────────
class App {
  constructor() {
    this.board = new Board(COLS, ROWS);
    this.canvas = document.getElementById('seq');
    this.renderer = new Renderer(this.canvas, this.board);
    this.input = new InputHandler(this.canvas, this.board, this.renderer);
    this.webcamTracker = null;
    this.webcamMode = false;
    this.running = true;
    this.bindUI();
    this.loop();
    // Show ELI2 modal on first visit
    if (!localStorage.getItem('seq_visited')) {
      document.getElementById('eli2Modal').classList.remove('hidden');
      localStorage.setItem('seq_visited', '1');
    }
  }

  loop() {
    if (!this.running) return;
    const xpos = this.renderer.getPlayheadX(this.board.bpm);
    this.board.update(xpos, this.renderer.canvas.width);
    const step = Math.floor((xpos / this.renderer.canvas.width) * COLS);
    this.board.triggerNotes(step);
    this.renderer.draw(xpos);
    requestAnimationFrame(() => this.loop());
  }

  changeBpm(delta) {
    this.board.bpm = Math.max(40, Math.min(240, this.board.bpm + delta));
    document.getElementById('bpmValue').textContent = this.board.bpm;
  }

  randomizeScale() {
    this.board.randomSounds();
  }

  async toggleWebcam() {
    if (this.webcamMode) {
      this.webcamMode = false;
      if (this.webcamTracker) this.webcamTracker.stop();
      document.getElementById('webcamOverlay').classList.add('hidden');
      document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === 'mouse'));
      this.input.mode = 'mouse';
    } else {
      document.getElementById('webcamOverlay').classList.remove('hidden');
      document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === 'webcam'));
      this.input.mode = 'webcam';
      this.webcamTracker = new WebcamTracker(
        (x, y) => this.input.applyHandPosition(x, y),
        status => { document.getElementById('webcamStatus').textContent = status; }
      );
      const ok = await this.webcamTracker.start();
      if (!ok) {
        // Fall back to mouse
        this.input.mode = 'mouse';
        this.webcamMode = false;
        document.getElementById('webcamOverlay').classList.add('hidden');
        document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === 'mouse'));
      } else {
        this.webcamMode = true;
      }
    }
  }

  bindUI() {
    // BPM
    document.getElementById('bpmUp').onclick = () => this.changeBpm(1);
    document.getElementById('bpmDown').onclick = () => this.changeBpm(-1);

    // Mode toggle
    document.querySelectorAll('.mode-btn').forEach(btn => {
      btn.onclick = () => {
        const mode = btn.dataset.mode;
        if (mode === 'webcam' && !this.webcamMode) this.toggleWebcam();
        else if (mode === 'mouse' && this.webcamMode) this.toggleWebcam();
      };
    });

    // Random / Clear
    document.getElementById('randomBtn').onclick = () => this.randomizeScale();
    document.getElementById('clearBtn').onclick = () => this.board.clearBoard();

    // Scale select
    document.getElementById('scaleSelect').onchange = e => {
      this.board.currentScale = e.target.value;
      this.board.normalSounds();
      document.getElementById('scaleName').textContent = SCALES[e.target.value].name;
    };

    // Root note
    document.getElementById('rootSelect').onchange = e => {
      this.board.rootNote = parseInt(e.target.value);
      this.board.normalSounds();
    };

    // Sliders
    document.getElementById('decaySlider').oninput = e => {
      this.board.decay = parseFloat(e.target.value);
    };
    document.getElementById('influSlider').oninput = e => {
      this.board.influrate = parseFloat(e.target.value);
    };
    document.getElementById('reverbSlider').oninput = e => {
      reverbLevel = parseFloat(e.target.value);
    };

    // ELI2 modal
    document.getElementById('eli2Btn').onclick = () =>
      document.getElementById('eli2Modal').classList.remove('hidden');
    document.getElementById('closeModal').onclick = () =>
      document.getElementById('eli2Modal').classList.add('hidden');
    document.getElementById('closeModalPlay').onclick = () =>
      document.getElementById('eli2Modal').classList.add('hidden');
    document.getElementById('eli2Modal').onclick = e => {
      if (e.target === e.currentTarget)
        document.getElementById('eli2Modal').classList.add('hidden');
    };

    // Resize
    window.addEventListener('resize', () => {
      this.renderer.resize();
    });
  }
}

// ── Boot ───────────────────────────────────────────────────
const app = new App();
