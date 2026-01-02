// grid-game.js - Ray Grid Puzzle (8x8)
// Rules implemented:
// - Click to toggle player obstacles.
// - Fixed obstacles cannot be changed.
// - Ray enters from a developer-defined entry.
// - When ray enters obstacle (player or fixed), rotate 90° CCW.
// - Otherwise continue straight.
// - Level clears if ray exits at the designated exit.
// - Loop detection prevents infinite bouncing.

class RayGridGame {
  constructor() {
    this.N = 8;
    this.gridEl = document.getElementById("grid-container");
    this.statusEl = document.getElementById("status");

    this.btnFire = document.getElementById("btnFire");
    this.btnReset = document.getElementById("btnReset");
    this.btnClear = document.getElementById("btnClear");
    this.btnToggleCover = document.getElementById("btnToggleCover");
    this.btnClearFixed = document.getElementById("btnClearFixed");
    this.gridCover = document.getElementById("grid-cover");
    this.successModal = document.getElementById("successModal");
    this.successClose = document.getElementById("successClose");
    this.failureModal = document.getElementById("failureModal");
    this.failureClose = document.getElementById("failureClose");
    this.timerDisplay = document.getElementById("timerDisplay");
    this.timerText = document.getElementById("timerText");

    this.firebaseIndicator = document.getElementById("firebaseIndicator");
    this.firebaseText = document.getElementById("firebaseText");

    // ----------------------------
    // Level definition (developer-defined)
    // ----------------------------
    this.level = {
      // Entry is from a side; index means row/col depending on side:
      // - left/right validate index as row (0..7)
      // - top/bottom validate index as col (0..7)
      entry: { side: "left", index: 3 },   // enters into (row=3, col=0), direction east
      exit:  { side: "bottom", index: 5 },  // must exit from right side at row=6

      // Fixed obstacles (immutable)
      fixedObstacles: [
        [0, 1], [1, 5],
        [2, 3], [3, 6],
        [4, 6],
        [5, 2],
        [6, 4], [6, 6]
      ],
    };

    // 0 = empty, 1 = player obstacle, 2 = fixed obstacle
    this.state = Array.from({ length: this.N }, () => Array(this.N).fill(0));

    // Mark fixed
    for (const [r, c] of this.level.fixedObstacles) {
      this.state[r][c] = 2;
    }

    // Ray animation control
    this.animating = false;
    this.animationDelayMs = 90;

    // Optional Firebase input
    this.db = null;
    this.firebaseInitialized = false;
    this.firebaseListenerAttached = false;
    this.sessionStartMs = Date.now();
    
    // Signal buffer for 1~8 input mode
    this.signalBuffer = []; // Array of {signal: 1-8, timestamp: ms}
    this.signalTimeoutMs = 3000; // 3 seconds window for two signals
    
    // Timer for single signal 9 (fireRay)
    this.signal9Timer = null;
    
    // Center cover state
    this.coverVisible = false;
    
    // Timer state
    this.timerInterval = null;
    this.timerSeconds = 300; // 5 minutes = 300 seconds
    this.timerInitialSeconds = 300;
    this.gameWon = false; // Track if game was won before timer expires
    
    // Score tracking
    this.fireRayCount = 0; // Number of times fireRay was called
    this.startTime = null; // Time when Play Mode started

    this.init();
  }

  init() {
    this.buildGrid();
    this.bindUI();
    this.renderAll();

    // Firebase is optional; game should work even if config is missing.
    this.initFirebaseOptional();

    this.setStatus(this.describeLevel());
  }

  // ---------- Level helpers ----------
  getEntryCell() {
    const { side, index } = this.level.entry;
    if (side === "left") return { r: index, c: 0 };
    if (side === "right") return { r: index, c: this.N - 1 };
    if (side === "top") return { r: 0, c: index };
    if (side === "bottom") return { r: this.N - 1, c: index };
    throw new Error("Invalid entry side");
  }

  getExitCell() {
    const { side, index } = this.level.exit;
    if (side === "left") return { r: index, c: 0 };
    if (side === "right") return { r: index, c: this.N - 1 };
    if (side === "top") return { r: 0, c: index };
    if (side === "bottom") return { r: this.N - 1, c: index };
    throw new Error("Invalid exit side");
  }

  entryStartOutside() {
    // Start position is outside the grid, one step before the entry-adjacent border cell.
    const { side, index } = this.level.entry;
    if (side === "left") return { r: index, c: -1, dir: "E" };
    if (side === "right") return { r: index, c: this.N, dir: "W" };
    if (side === "top") return { r: -1, c: index, dir: "S" };
    if (side === "bottom") return { r: this.N, c: index, dir: "N" };
    throw new Error("Invalid entry side");
  }

  describeLevel() {
    const e = this.level.entry;
    const x = this.level.exit;
    // Display indices as 1-based (1~8)
    return `Entry: ${e.side.toUpperCase()} @ ${e.index + 1} | Exit: ${x.side.toUpperCase()} @ ${x.index + 1}`;
  }

  // ---------- UI ----------
  bindUI() {
    this.btnFire.addEventListener("click", () => this.fireRay());
    this.btnReset.addEventListener("click", () => this.resetPlayerObstacles());
    this.btnClear.addEventListener("click", () => this.clearAllPlayerObstacles());
    this.btnToggleCover.addEventListener("click", () => this.toggleCover());
    this.btnClearFixed.addEventListener("click", () => this.clearFixedObstacles());
    
    // Success modal close button
    if (this.successClose) {
      this.successClose.addEventListener("click", () => this.hideSuccessModal());
    }
    
    // Close modal when clicking outside
    if (this.successModal) {
      this.successModal.addEventListener("click", (e) => {
        if (e.target === this.successModal) {
          this.hideSuccessModal();
        }
      });
    }
  }

  setStatus(text) {
    this.statusEl.textContent = text;
  }

  buildGrid() {
    this.gridEl.innerHTML = "";
    for (let r = 0; r < this.N; r++) {
      for (let c = 0; c < this.N; c++) {
        const cell = document.createElement("div");
        cell.className = "grid-cell";
        cell.dataset.row = String(r);
        cell.dataset.col = String(c);
        // Display coordinates as 1-based (1,1 to 8,8)
        cell.title = `(${r + 1},${c + 1})`;

        // optional: show coordinates (remove if you want a cleaner UI)
        cell.textContent = `${r + 1},${c + 1}`;

        cell.addEventListener("click", () => {
          if (this.animating) return;
          this.toggleCell(r, c);
        });

        this.gridEl.appendChild(cell);
      }
    }
    
    // Recreate the grid cover element after building grid
    // (it gets removed by innerHTML = "" above)
    this.gridCover = document.createElement("div");
    this.gridCover.className = "grid-cover";
    this.gridCover.id = "grid-cover";
    // Restore cover visibility state if it was previously visible
    if (this.coverVisible) {
      this.gridCover.classList.add("active");
      if (this.btnToggleCover) {
        this.btnToggleCover.textContent = "Play Mode";
      }
      // Hide Clear Fixed Obstacles button in Play Mode
      if (this.btnClearFixed) {
        this.btnClearFixed.style.display = "none";
      }
    } else {
      if (this.btnToggleCover) {
        this.btnToggleCover.textContent = "Edit Mode";
      }
      // Show Clear Fixed Obstacles button in Edit Mode
      if (this.btnClearFixed) {
        this.btnClearFixed.style.display = "inline-block";
      }
    }
    this.gridEl.appendChild(this.gridCover);
  }

  renderAll() {
    const entryCell = this.getEntryCell();
    const exitCell = this.getExitCell();

    for (let r = 0; r < this.N; r++) {
      for (let c = 0; c < this.N; c++) {
        const el = this.getCellEl(r, c);
        el.classList.remove("cell-obstacle", "cell-fixed", "cell-entry", "cell-exit");
        el.classList.remove("cell-ray", "cell-ray-head");

        const v = this.state[r][c];
        if (v === 1) el.classList.add("cell-obstacle");
        if (v === 2) {
          el.classList.add("cell-fixed");
          // Update cursor style based on cover state
          if (this.coverVisible) {
            el.style.cursor = "not-allowed"; // Cannot click when cover is on
          } else {
            el.style.cursor = "pointer"; // Can click when cover is off
          }
        } else {
          el.style.cursor = "pointer"; // Normal cells are always clickable
        }

        if (r === entryCell.r && c === entryCell.c) el.classList.add("cell-entry");
        if (r === exitCell.r && c === exitCell.c) el.classList.add("cell-exit");
      }
    }
  }

  clearRayVisuals() {
    for (let r = 0; r < this.N; r++) {
      for (let c = 0; c < this.N; c++) {
        const el = this.getCellEl(r, c);
        el.classList.remove("cell-ray", "cell-ray-head");
      }
    }
  }

  getCellEl(r, c) {
    return this.gridEl.querySelector(`[data-row="${r}"][data-col="${c}"]`);
  }

  // ---------- Cell toggling ----------
  toggleCell(r, c) {
    // If cover is on and cell is fixed obstacle, cannot click
    if (this.coverVisible && this.state[r][c] === 2) {
      return; // fixed obstacle immutable when cover is on
    }

    // When cover is off: toggle between fixed obstacle and empty
    if (!this.coverVisible) {
      if (this.state[r][c] === 2) {
        // Fixed obstacle -> empty
        this.state[r][c] = 0;
        this.renderAll();
        this.setStatus(`${this.describeLevel()} | Removed fixed obstacle at (${r + 1},${c + 1})`);
        return;
      } else if (this.state[r][c] === 0) {
        // Empty -> fixed obstacle
        this.state[r][c] = 2;
        this.renderAll();
        this.setStatus(`${this.describeLevel()} | Added fixed obstacle at (${r + 1},${c + 1})`);
        return;
      } else if (this.state[r][c] === 1) {
        // Player obstacle -> empty (next click will make it fixed obstacle)
        this.state[r][c] = 0;
        this.renderAll();
        this.setStatus(`${this.describeLevel()} | Removed player obstacle at (${r + 1},${c + 1}), click again to add fixed obstacle`);
        return;
      }
    }

    // When cover is on (and not fixed obstacle): toggle player obstacle
    // Toggle player obstacle on/off
    this.state[r][c] = (this.state[r][c] === 1) ? 0 : 1;

    this.renderAll();
    // Display coordinates as 1-based (1,1 to 8,8)
    this.setStatus(`${this.describeLevel()} | Toggled cell (${r + 1},${c + 1})`);
  }

  resetPlayerObstacles() {
    // Reset to empty where player obstacles exist (keep fixed as-is).
    for (let r = 0; r < this.N; r++) {
      for (let c = 0; c < this.N; c++) {
        if (this.state[r][c] === 1) this.state[r][c] = 0;
      }
    }
    this.renderAll();
    this.setStatus(`${this.describeLevel()} | Player obstacles reset.`);
  }

  clearAllPlayerObstacles() {
    // Same as reset but also clears ray visuals
    this.resetPlayerObstacles();
    this.clearRayVisuals();
    this.setStatus(`${this.describeLevel()} | Cleared all player obstacles and ray visuals.`);
  }

  clearFixedObstacles() {
    // Only works in Edit Mode (when cover is off)
    if (this.coverVisible) {
      this.setStatus(`${this.describeLevel()} | Cannot clear fixed obstacles in Play Mode`);
      return;
    }

    // Clear all fixed obstacles (state 2 -> 0)
    let clearedCount = 0;
    for (let r = 0; r < this.N; r++) {
      for (let c = 0; c < this.N; c++) {
        if (this.state[r][c] === 2) {
          this.state[r][c] = 0;
          clearedCount++;
        }
      }
    }
    
    this.renderAll();
    this.setStatus(`${this.describeLevel()} | Cleared ${clearedCount} fixed obstacle(s)`);
  }

  toggleCover() {
    this.coverVisible = !this.coverVisible;
    if (this.coverVisible) {
      // Play Mode: Cover is ON
      this.gridCover.classList.add("active");
      this.btnToggleCover.textContent = "Play Mode";
      // Hide Clear Fixed Obstacles button in Play Mode
      if (this.btnClearFixed) {
        this.btnClearFixed.style.display = "none";
      }
      // Start timer
      this.startTimer();
      this.setStatus(`${this.describeLevel()} | Play Mode (hiding cells 2,2 to 7,7)`);
    } else {
      // Edit Mode: Cover is OFF
      this.gridCover.classList.remove("active");
      this.btnToggleCover.textContent = "Edit Mode";
      // Show Clear Fixed Obstacles button in Edit Mode
      if (this.btnClearFixed) {
        this.btnClearFixed.style.display = "inline-block";
      }
      // Reset timer
      this.resetTimer();
      this.setStatus(`${this.describeLevel()} | Edit Mode`);
    }
    // Update cell styles (especially cursor for fixed obstacles)
    this.renderAll();
  }

  startTimer() {
    // Reset game won flag
    this.gameWon = false;
    // Reset fireRay count
    this.fireRayCount = 0;
    // Record start time
    this.startTime = Date.now();
    // Reset timer to initial value
    this.timerSeconds = this.timerInitialSeconds;
    // Show timer display
    if (this.timerDisplay) {
      this.timerDisplay.style.display = "inline-flex";
    }
    // Update timer display
    this.updateTimerDisplay();
    
    // Clear any existing timer
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
    }
    
    // Start countdown
    this.timerInterval = setInterval(() => {
      this.timerSeconds--;
      this.updateTimerDisplay();
      
      if (this.timerSeconds <= 0) {
        this.stopTimer();
        // Check if game was won
        if (!this.gameWon) {
          this.showFailureModal();
        }
      }
    }, 1000);
  }

  resetTimer() {
    this.stopTimer();
    this.timerSeconds = this.timerInitialSeconds;
    this.gameWon = false;
    this.fireRayCount = 0;
    this.startTime = null;
    // Hide timer display
    if (this.timerDisplay) {
      this.timerDisplay.style.display = "none";
    }
  }

  stopTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  updateTimerDisplay() {
    if (!this.timerText) return;
    
    const minutes = Math.floor(this.timerSeconds / 60);
    const seconds = this.timerSeconds % 60;
    const timeString = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    this.timerText.textContent = timeString;
    
    // Add warning class when less than 30 seconds
    if (this.timerDisplay) {
      if (this.timerSeconds <= 30) {
        this.timerDisplay.classList.add("warning");
      } else {
        this.timerDisplay.classList.remove("warning");
      }
    }
  }

  showSuccessModal() {
    if (this.successModal) {
      // Calculate scores
      const obstacleCount = this.countPlayerObstacles();
      const testCount = this.fireRayCount;
      const timeUsed = this.startTime ? Math.floor((Date.now() - this.startTime) / 1000) : 0;
      
      // Calculate total score: 1000000 / obstacleCount / testCount / timeUsed
      let totalScore = 0;
      if (obstacleCount > 0 && testCount > 0 && timeUsed > 0) {
        totalScore = Math.floor(1000000 / obstacleCount / testCount / timeUsed);
      }
      
      // Update score display
      const totalScoreEl = document.getElementById("totalScore");
      const obstacleCountEl = document.getElementById("obstacleCount");
      const testCountEl = document.getElementById("testCount");
      const timeUsedEl = document.getElementById("timeUsed");
      
      if (totalScoreEl) totalScoreEl.textContent = totalScore.toLocaleString();
      if (obstacleCountEl) obstacleCountEl.textContent = obstacleCount;
      if (testCountEl) testCountEl.textContent = testCount;
      if (timeUsedEl) {
        const minutes = Math.floor(timeUsed / 60);
        const seconds = timeUsed % 60;
        timeUsedEl.textContent = `${minutes}:${String(seconds).padStart(2, '0')}`;
      }
      
      this.successModal.classList.add("active");
    }
  }

  countPlayerObstacles() {
    let count = 0;
    for (let r = 0; r < this.N; r++) {
      for (let c = 0; c < this.N; c++) {
        if (this.state[r][c] === 1) {
          count++;
        }
      }
    }
    return count;
  }

  hideSuccessModal() {
    if (this.successModal) {
      this.successModal.classList.remove("active");
    }
  }

  showFailureModal() {
    if (this.failureModal) {
      this.failureModal.classList.add("active");
    }
  }

  hideFailureModal() {
    if (this.failureModal) {
      this.failureModal.classList.remove("active");
    }
  }

  // ---------- Ray logic ----------
  dirToDelta(dir) {
    switch (dir) {
      case "N": return { dr: -1, dc: 0 };
      case "S": return { dr: 1, dc: 0 };
      case "E": return { dr: 0, dc: 1 };
      case "W": return { dr: 0, dc: -1 };
      default: throw new Error("Bad dir");
    }
  }

  rotateCCW(dir) {
    // N -> W -> S -> E -> N
    switch (dir) {
      case "N": return "W";
      case "W": return "S";
      case "S": return "E";
      case "E": return "N";
      default: throw new Error("Bad dir");
    }
  }

  isInside(r, c) {
    return r >= 0 && r < this.N && c >= 0 && c < this.N;
  }

  computeExitSideAndIndex(lastInsideR, lastInsideC, nextR, nextC) {
    // Determine which boundary was crossed, and which index along that boundary.
    if (nextR < 0) return { side: "top", index: lastInsideC };
    if (nextR >= this.N) return { side: "bottom", index: lastInsideC };
    if (nextC < 0) return { side: "left", index: lastInsideR };
    if (nextC >= this.N) return { side: "right", index: lastInsideR };
    throw new Error("Expected outside");
  }

  traceRay() {
    const start = this.entryStartOutside();
    let r = start.r;
    let c = start.c;
    let dir = start.dir;

    const visited = new Set(); // (r,c,dir) while inside, for loop detection
    const path = []; // list of {r,c,dirBeforeCell, cellType}

    let steps = 0;
    const maxSteps = 512; // safety cap

    while (steps++ < maxSteps) {
      const { dr, dc } = this.dirToDelta(dir);
      const nr = r + dr;
      const nc = c + dc;

      // reminder: r,c might be outside at the start; nr,nc might enter the grid
      if (!this.isInside(nr, nc)) {
        // Exiting the grid (or never entered)
        if (this.isInside(r, c)) {
          const exitInfo = this.computeExitSideAndIndex(r, c, nr, nc);
          const win = (exitInfo.side === this.level.exit.side && exitInfo.index === this.level.exit.index);
          return {
            outcome: win ? "WIN" : "LOSE",
            exitInfo,
            path,
            reason: win ? "Ray exited through the designated exit." : `Ray exited at ${exitInfo.side.toUpperCase()} @ ${exitInfo.index}, not the target exit.`
          };
        } else {
          // Should not happen for valid entry configs, but keep safe
          return {
            outcome: "LOSE",
            exitInfo: null,
            path,
            reason: "Ray never entered the grid (invalid entry config)."
          };
        }
      }

      // Entering cell (nr,nc)
      r = nr; c = nc;

      // Loop detection: only meaningful while inside
      const key = `${r},${c},${dir}`;
      if (visited.has(key)) {
        return {
          outcome: "LOSE",
          exitInfo: null,
          path,
          reason: "Loop detected (ray revisited the same cell with the same direction)."
        };
      }
      visited.add(key);

      const cellVal = this.state[r][c];
      const isObstacle = (cellVal === 1 || cellVal === 2);

      path.push({
        r, c,
        dirBeforeCell: dir,
        cellType: (cellVal === 2 ? "FIXED" : (cellVal === 1 ? "PLAYER" : "EMPTY"))
      });

      // Rotation mechanic
      if (isObstacle) {
        dir = this.rotateCCW(dir);
      }
      // else continue straight (dir unchanged)
    }

    return {
      outcome: "LOSE",
      exitInfo: null,
      path,
      reason: "Step limit reached (likely looping)."
    };
  }

  async fireRay() {
    if (this.animating) return;

    // Increment test count
    this.fireRayCount++;

    this.clearRayVisuals();
    this.renderAll();

    const result = this.traceRay();
    await this.animateRayPath(result.path);

    if (result.outcome === "WIN") {
      this.setStatus(`CLEARED. ${this.describeLevel()} | ${result.reason}`);
      this.gameWon = true;
      this.stopTimer();
      this.showSuccessModal();
    } else {
      const extra = result.exitInfo
        ? ` Exit reached: ${result.exitInfo.side.toUpperCase()} @ ${result.exitInfo.index + 1}.`
        : "";
      this.setStatus(`FAILED. ${this.describeLevel()} | ${result.reason}${extra}`);
    }
  }

  animateRayPath(path) {
    this.animating = true;

    return new Promise((resolve) => {
      let i = 0;

      const step = () => {
        if (i > 0) {
          const prev = path[i - 1];
          const prevEl = this.getCellEl(prev.r, prev.c);
          prevEl.classList.remove("cell-ray-head");
          prevEl.classList.add("cell-ray");
        }

        if (i >= path.length) {
          this.animating = false;
          resolve();
          return;
        }

        const cur = path[i];
        const el = this.getCellEl(cur.r, cur.c);
        el.classList.add("cell-ray-head");

        i++;
        setTimeout(step, this.animationDelayMs);
      };

      if (path.length === 0) {
        this.animating = false;
        resolve();
        return;
      }

      step();
    });
  }

  // ---------- Optional Firebase input ----------
  updateFirebaseStatus(connected, message) {
    if (connected) {
      this.firebaseIndicator.textContent = "🟢";
      this.firebaseText.textContent = message || "Firebase: Connected";
    } else {
      this.firebaseIndicator.textContent = "🔴";
      this.firebaseText.textContent = message || "Firebase: Disconnected";
    }
  }

  async initFirebaseOptional() {
    try {
      if (typeof firebase === "undefined") {
        this.updateFirebaseStatus(false, "Firebase: SDK not loaded (game still works)");
        return;
      }
      if (typeof firebaseConfig === "undefined") {
        this.updateFirebaseStatus(false, "Firebase: firebaseConfig missing (game still works)");
        return;
      }

      if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
      this.db = firebase.database();
      this.firebaseInitialized = true;
      this.updateFirebaseStatus(true, "Firebase: Connected (1~8: coordinates, 9: single=fireRay, double=reset)");

      this.attachFirebaseListener();
    } catch (err) {
      console.error("Firebase init failed:", err);
      this.updateFirebaseStatus(false, "Firebase: Init failed (game still works)");
    }
  }

  attachFirebaseListener() {
    if (!this.firebaseInitialized || !this.db || this.firebaseListenerAttached) return;

    try {
      const matPressesRef = this.db.ref("mat_presses");

      // NOTE:
      // child_added will replay existing data. If your DB keeps historical presses,
      // you may want to ignore old rows. Here we try to filter by timestamp if numeric,
      // and also ignore initial backlog by checking "sessionStartMs" when possible.
      matPressesRef
        .orderByChild("groupId")
        .equalTo(1)
        .on("child_added", (snapshot) => {
          const data = snapshot.val();
          if (!data || typeof data.matNumber !== "number") return;
          if (this.animating) return;

          // New mode: accept 1~9 signals
          // 1~8: coordinates (displayed as 1,1 to 8,8)
          // 9: special command (single = fireRay, double = resetPlayerObstacles)
          const signal = data.matNumber;
          if (signal < 1 || signal > 9) return;

          // Optional: ignore old events if timestamp is ms
          const timestamp = typeof data.timestamp === "number" ? data.timestamp : Date.now();
          if (timestamp < this.sessionStartMs) return;

          // Process signal in buffer mode
          this.processSignal(signal, timestamp);
        });

      this.firebaseListenerAttached = true;
    } catch (err) {
      console.error("Firebase listen failed:", err);
      this.updateFirebaseStatus(false, "Firebase: Listen failed (game still works)");
    }
  }

  processSignal(signal, timestamp) {
    // Handle special signal 9 (command signal)
    if (signal === 9) {
      // Clear any pending single 9 timer
      if (this.signal9Timer) {
        clearTimeout(this.signal9Timer);
        this.signal9Timer = null;
      }

      // Check if there's a recent signal 9 in buffer
      const now = timestamp;
      const recent9 = this.signalBuffer.filter(
        item => item.signal === 9 && (now - item.timestamp) <= this.signalTimeoutMs
      );

      if (recent9.length > 0) {
        // Found a recent 9, this is a double 9 -> resetPlayerObstacles
        this.signalBuffer = this.signalBuffer.filter(item => item.signal !== 9);
        this.resetPlayerObstacles();
        this.setStatus(`${this.describeLevel()} | Reset player obstacles via double signal 9`);
        return;
      } else {
        // Single 9, add to buffer and set timer
        this.signalBuffer.push({ signal, timestamp });
        
        // Set timer to execute fireRay() if no second 9 arrives
        this.signal9Timer = setTimeout(() => {
          // Check if still only one 9 in buffer (no second 9 arrived)
          const current9s = this.signalBuffer.filter(item => item.signal === 9);
          if (current9s.length === 1) {
            this.signalBuffer = this.signalBuffer.filter(item => item.signal !== 9);
            this.fireRay();
            this.setStatus(`${this.describeLevel()} | Fired ray via single signal 9`);
          }
          this.signal9Timer = null;
        }, this.signalTimeoutMs);
        return;
      }
    }

    // Handle coordinate signals (1~8)
    // Clean old signals from buffer (outside time window)
    const now = timestamp;
    this.signalBuffer = this.signalBuffer.filter(
      item => (now - item.timestamp) <= this.signalTimeoutMs && item.signal !== 9
    );

    // Add new signal
    this.signalBuffer.push({ signal, timestamp });

    // If we have 2 or more coordinate signals, try to process the last two
    const coordinateSignals = this.signalBuffer.filter(item => item.signal !== 9);
    if (coordinateSignals.length >= 2) {
      const [first, second] = coordinateSignals.slice(-2);
      
      // Check if both signals are within time window
      const timeDiff = second.timestamp - first.timestamp;
      if (timeDiff <= this.signalTimeoutMs && timeDiff >= 0) {
        // Convert 1~8 signals to 0~7 internal indices
        const r = first.signal - 1;
        const c = second.signal - 1;

        // Validate coordinates
        if (r >= 0 && r < this.N && c >= 0 && c < this.N) {
          // Toggle obstacle at (r, c)
          this.toggleCell(r, c);
          
          // Clear coordinate signals from buffer after processing
          this.signalBuffer = this.signalBuffer.filter(item => item.signal === 9);
          
          // Display coordinates as 1-based (1,1 to 8,8)
          this.setStatus(`${this.describeLevel()} | Toggled cell (${r + 1},${c + 1}) via signals [${first.signal},${second.signal}]`);
        } else {
          // Invalid coordinates, clear coordinate signals
          this.signalBuffer = this.signalBuffer.filter(item => item.signal === 9);
        }
      } else {
        // Signals are too far apart, keep only the latest coordinate signal and all 9s
        this.signalBuffer = [...this.signalBuffer.filter(item => item.signal === 9), second];
      }
    }
  }
}

// Boot
const game = new RayGridGame();
window.addEventListener("beforeunload", () => {
  // Clean up timer
  if (game.timerInterval) {
    clearInterval(game.timerInterval);
  }
  // If you want, detach Firebase listeners here. For simplicity, omitted.
 /* reminding: v8 off() requires same ref + callback reference. */
});
