// ===================== Firebase Configuration =====================
// Replace with your own Firebase project values.
const firebaseConfig = {
  apiKey: "AIzaSyCUJd7ijdNrvFCRBMAR4-0nbVzb00uVyF4",
  authDomain: "quickhands-9c092.firebaseapp.com",
  databaseURL: "https://quickhands-9c092-default-rtdb.firebaseio.com",
  projectId: "quickhands-9c092",
  storageBucket: "quickhands-9c092.firebasestorage.app",
  messagingSenderId: "471229344059",
  appId: "1:471229344059:web:f5e81184bfe70ba1182f1e",
  measurementId: "G-ZQBDYZ92F0"
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}
const db = firebase.database();

// ===================== UI References =====================
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

const statusText = document.getElementById("statusText");
const roomBadge = document.getElementById("roomBadge");
const playerBadge = document.getElementById("playerBadge");
const difficultyBadge = document.getElementById("difficultyBadge");
const p1Name = document.getElementById("p1Name");
const p2Name = document.getElementById("p2Name");
const p1Score = document.getElementById("p1Score");
const p2Score = document.getElementById("p2Score");
const overlay = document.getElementById("gameOverlay");
const overlayTitle = document.getElementById("overlayTitle");
const overlayMessage = document.getElementById("overlayMessage");
const restartBtn = document.getElementById("restartBtn");

const playerNameInput = document.getElementById("playerName");
const difficultySelect = document.getElementById("difficulty");
const gameModeSelect = document.getElementById("gameMode");
const roomCodeInput = document.getElementById("roomCodeInput");
const createRoomBtn = document.getElementById("createRoomBtn");
const joinRoomBtn = document.getElementById("joinRoomBtn");
const singlePlayerBtn = document.getElementById("singlePlayerBtn");

// ===================== Game Setup =====================
const DIFFICULTIES = {
  easy: { tickMs: 220, gridSize: 24, label: "Easy" },
  medium: { tickMs: 150, gridSize: 20, label: "Medium" },
  hard: { tickMs: 95, gridSize: 14, label: "Hard" },
};

const DIRS = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

const OPPOSITES = { up: "down", down: "up", left: "right", right: "left" };
const playerId = `${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`;

let mode = "online";
let roomCode = null;
let roomRef = null;
let roomData = null;
let localSlot = null;
let hostLoop = null;

let singleLoop = null;
let singleData = null;
let singleDirection = "right";
let singleNextDirection = "right";

function setStatus(message) {
  statusText.textContent = message;
}

function randomCode() {
  return Math.random().toString(36).slice(2, 6).toUpperCase();
}

function normalizeName() {
  const val = playerNameInput.value.trim();
  return (val || "Player").slice(0, 14);
}

function initialSnakes(grid) {
  return {
    player1: [
      { x: Math.floor(grid * 0.25), y: Math.floor(grid * 0.5) },
      { x: Math.floor(grid * 0.25) - 1, y: Math.floor(grid * 0.5) },
    ],
    player2: [
      { x: Math.floor(grid * 0.75), y: Math.floor(grid * 0.5) },
      { x: Math.floor(grid * 0.75) + 1, y: Math.floor(grid * 0.5) },
    ],
  };
}

function generateFood(snakes, gridSize) {
  const occupied = new Set(
    [...(snakes.player1 || []), ...(snakes.player2 || [])].map((part) => `${part.x},${part.y}`)
  );

  let x;
  let y;
  do {
    x = Math.floor(Math.random() * gridSize);
    y = Math.floor(Math.random() * gridSize);
  } while (occupied.has(`${x},${y}`));

  return { x, y };
}

function buildInitialRoomState(difficulty) {
  const d = DIFFICULTIES[difficulty];
  const snakes = initialSnakes(d.gridSize);
  return {
    difficulty,
    status: "waiting",
    hostId: playerId,
    createdAt: firebase.database.ServerValue.TIMESTAMP,
    players: {
      player1: {
        id: playerId,
        name: normalizeName(),
        connected: true,
        direction: "right",
        nextDirection: "right",
        score: 0,
      },
      player2: {
        id: null,
        name: "Waiting...",
        connected: false,
        direction: "left",
        nextDirection: "left",
        score: 0,
      },
    },
    state: {
      snakes,
      food: generateFood(snakes, d.gridSize),
      winner: null,
      resultText: "",
      tick: 0,
    },
    restartRequest: null,
  };
}

function setMode(nextMode) {
  mode = nextMode;
  if (mode === "single") {
    createRoomBtn.disabled = true;
    joinRoomBtn.disabled = true;
    roomCodeInput.disabled = true;
    singlePlayerBtn.disabled = false;
  } else {
    createRoomBtn.disabled = false;
    joinRoomBtn.disabled = false;
    roomCodeInput.disabled = false;
    singlePlayerBtn.disabled = false;
  }
}

function cleanupOnline() {
  if (roomRef) {
    roomRef.off();
  }
  stopHostLoop();
  roomRef = null;
  roomData = null;
  roomCode = null;
  localSlot = null;
}

function cleanupSingle() {
  if (singleLoop) {
    clearInterval(singleLoop);
    singleLoop = null;
  }
  singleData = null;
}

function getRoomRef(code) {
  return db.ref(`rooms/${code}`);
}

async function createRoom() {
  if (mode === "single") {
    startSinglePlayer();
    return;
  }

  cleanupSingle();
  const difficulty = difficultySelect.value;
  let code = randomCode();

  for (let i = 0; i < 6; i += 1) {
    const existing = await getRoomRef(code).get();
    if (!existing.exists()) break;
    code = randomCode();
  }

  roomCode = code;
  roomRef = getRoomRef(code);
  await roomRef.set(buildInitialRoomState(difficulty));
  localSlot = "player1";

  await roomRef.child("players/player1").onDisconnect().update({ connected: false });
  setStatus(`Room ${roomCode} created! Share code with your friend.`);
  attachRoomListeners();
}

async function joinRoom() {
  if (mode === "single") {
    setStatus("Switch mode to Online Multiplayer to join a room.");
    return;
  }

  cleanupSingle();
  const code = roomCodeInput.value.trim().toUpperCase();
  if (!code) {
    setStatus("Please enter a room code.");
    return;
  }

  roomCode = code;
  roomRef = getRoomRef(code);
  const snap = await roomRef.get();

  if (!snap.exists()) {
    setStatus("Room not found. Check the code and try again.");
    return;
  }

  const room = snap.val();
  if (room.players?.player2?.id) {
    setStatus("Room is full. Ask host to create a new one.");
    return;
  }

  const updates = {
    "players/player2/id": playerId,
    "players/player2/name": normalizeName(),
    "players/player2/connected": true,
    "players/player2/score": 0,
    "players/player2/direction": "left",
    "players/player2/nextDirection": "left",
    status: "playing",
  };

  await roomRef.update(updates);
  await roomRef.child("players/player2").onDisconnect().update({ connected: false });
  localSlot = "player2";
  setStatus(`Joined room ${roomCode}. Game started!`);
  attachRoomListeners();
}

function attachRoomListeners() {
  if (!roomRef) return;

  roomRef.off();
  roomRef.on("value", (snap) => {
    roomData = snap.val();
    if (!roomData) {
      setStatus("Room closed.");
      return;
    }

    autoDetectLocalSlot();
    renderUI();
    renderGame();

    if (isHost() && roomData.status === "playing" && !hostLoop) {
      startHostLoop();
    }

    if (roomData.status !== "playing" && hostLoop) {
      stopHostLoop();
    }

    if (isHost() && roomData.restartRequest && roomData.status === "finished") {
      restartGame();
    }
  });
}

function autoDetectLocalSlot() {
  const p = roomData.players;
  if (p?.player1?.id === playerId) localSlot = "player1";
  if (p?.player2?.id === playerId) localSlot = "player2";
}

function isHost() {
  return roomData?.hostId === playerId;
}

function startHostLoop() {
  stopHostLoop();
  const diff = DIFFICULTIES[roomData.difficulty] || DIFFICULTIES.medium;
  hostLoop = setInterval(runHostTick, diff.tickMs);
}

function stopHostLoop() {
  if (hostLoop) {
    clearInterval(hostLoop);
    hostLoop = null;
  }
}

async function runHostTick() {
  if (!roomData || roomData.status !== "playing") return;

  const gridSize = (DIFFICULTIES[roomData.difficulty] || DIFFICULTIES.medium).gridSize;
  const players = roomData.players;
  const snakes = {
    player1: [...roomData.state.snakes.player1],
    player2: [...roomData.state.snakes.player2],
  };

  const d1 = players.player1.nextDirection || players.player1.direction;
  const d2 = players.player2.nextDirection || players.player2.direction;
  const head1 = snakes.player1[0];
  const head2 = snakes.player2[0];

  const next1 = { x: head1.x + DIRS[d1].x, y: head1.y + DIRS[d1].y };
  const next2 = { x: head2.x + DIRS[d2].x, y: head2.y + DIRS[d2].y };

  let lose1 = false;
  let lose2 = false;

  const isOut = (p) => p.x < 0 || p.y < 0 || p.x >= gridSize || p.y >= gridSize;
  if (isOut(next1)) lose1 = true;
  if (isOut(next2)) lose2 = true;

  const collides = (point, snake) => snake.some((part) => part.x === point.x && part.y === point.y);

  if (!lose1 && collides(next1, snakes.player1)) lose1 = true;
  if (!lose2 && collides(next2, snakes.player2)) lose2 = true;
  if (!lose1 && collides(next1, snakes.player2)) lose1 = true;
  if (!lose2 && collides(next2, snakes.player1)) lose2 = true;

  if (next1.x === next2.x && next1.y === next2.y) {
    lose1 = true;
    lose2 = true;
  }

  let winner = null;
  let resultText = "";

  if (lose1 || lose2) {
    if (lose1 && lose2) {
      winner = "draw";
      resultText = "Head bonk! It's a draw 💫";
    } else if (lose1) {
      winner = "player2";
      resultText = `${players.player2.name} wins! 🎉`;
    } else {
      winner = "player1";
      resultText = `${players.player1.name} wins! 🎉`;
    }

    await roomRef.update({
      status: "finished",
      "state/winner": winner,
      "state/resultText": resultText,
      "players/player1/direction": d1,
      "players/player2/direction": d2,
      restartRequest: null,
    });
    return;
  }

  snakes.player1.unshift(next1);
  snakes.player2.unshift(next2);

  let food = roomData.state.food;
  let score1 = players.player1.score;
  let score2 = players.player2.score;

  const ate1 = next1.x === food.x && next1.y === food.y;
  const ate2 = next2.x === food.x && next2.y === food.y;

  if (ate1 || ate2) {
    if (ate1) score1 += 1;
    if (ate2) score2 += 1;
    food = generateFood(snakes, gridSize);
  } else {
    snakes.player1.pop();
    snakes.player2.pop();
  }

  await roomRef.update({
    "state/snakes": snakes,
    "state/food": food,
    "state/tick": (roomData.state.tick || 0) + 1,
    "players/player1/score": score1,
    "players/player2/score": score2,
    "players/player1/direction": d1,
    "players/player2/direction": d2,
  });
}

function startSinglePlayer() {
  cleanupOnline();
  cleanupSingle();

  const difficulty = difficultySelect.value;
  const diff = DIFFICULTIES[difficulty] || DIFFICULTIES.medium;
  const name = normalizeName();
  const snakes = {
    player1: [
      { x: Math.floor(diff.gridSize * 0.45), y: Math.floor(diff.gridSize * 0.5) },
      { x: Math.floor(diff.gridSize * 0.45) - 1, y: Math.floor(diff.gridSize * 0.5) },
    ],
    player2: [],
  };

  singleDirection = "right";
  singleNextDirection = "right";
  singleData = {
    difficulty,
    status: "playing",
    players: {
      player1: { name, score: 0 },
      player2: { name: "-", score: 0 },
    },
    state: {
      snakes,
      food: generateFood(snakes, diff.gridSize),
      winner: null,
      resultText: "",
    },
  };

  setStatus("Single player started! Use Arrow keys / WASD or touch controls.");
  singleLoop = setInterval(runSingleTick, diff.tickMs);
  renderUI();
  renderGame();
}

function runSingleTick() {
  if (!singleData || singleData.status !== "playing") return;

  const diff = DIFFICULTIES[singleData.difficulty] || DIFFICULTIES.medium;
  const gridSize = diff.gridSize;
  const snake = [...singleData.state.snakes.player1];
  const head = snake[0];

  singleDirection = singleNextDirection;
  const next = { x: head.x + DIRS[singleDirection].x, y: head.y + DIRS[singleDirection].y };

  const hitWall = next.x < 0 || next.y < 0 || next.x >= gridSize || next.y >= gridSize;
  const hitSelf = snake.some((part) => part.x === next.x && part.y === next.y);

  if (hitWall || hitSelf) {
    singleData.status = "finished";
    singleData.state.winner = "none";
    singleData.state.resultText = `Game over! Final score: ${singleData.players.player1.score} 💖`;
    clearInterval(singleLoop);
    singleLoop = null;
    renderUI();
    renderGame();
    return;
  }

  snake.unshift(next);

  const food = singleData.state.food;
  const ate = next.x === food.x && next.y === food.y;

  if (ate) {
    singleData.players.player1.score += 1;
    singleData.state.food = generateFood({ player1: snake, player2: [] }, gridSize);
  } else {
    snake.pop();
  }

  singleData.state.snakes.player1 = snake;
  renderUI();
  renderGame();
}

function trySetDirection(nextDir) {
  if (mode === "single") {
    if (OPPOSITES[singleDirection] === nextDir) return;
    singleNextDirection = nextDir;
    return;
  }

  if (!roomRef || !roomData || roomData.status !== "playing" || !localSlot) return;

  const current = roomData.players?.[localSlot]?.direction || "right";
  if (OPPOSITES[current] === nextDir) return;

  roomRef.child(`players/${localSlot}/nextDirection`).set(nextDir);
}

function keyToDirection(key) {
  const k = key.toLowerCase();
  if (k === "arrowup" || k === "w") return "up";
  if (k === "arrowdown" || k === "s") return "down";
  if (k === "arrowleft" || k === "a") return "left";
  if (k === "arrowright" || k === "d") return "right";
  return null;
}

function renderUI() {
  const currentData = mode === "single" ? singleData : roomData;
  const currentDifficulty = currentData?.difficulty || difficultySelect.value;
  const diff = DIFFICULTIES[currentDifficulty] || DIFFICULTIES.medium;

  roomBadge.textContent = mode === "single" ? "Room: Local" : `Room: ${roomCode || "----"}`;
  playerBadge.textContent = `You: ${normalizeName()}`;
  difficultyBadge.textContent = `Difficulty: ${diff.label} • ${mode === "single" ? "Single" : "Online"}`;

  if (!currentData) {
    p1Name.textContent = "🩷 Player 1";
    p2Name.textContent = "🩵 Player 2";
    p1Score.textContent = "0";
    p2Score.textContent = "0";
    return;
  }

  p1Name.textContent = `🩷 ${currentData.players.player1.name}`;
  p2Name.textContent = `🩵 ${currentData.players.player2.name}`;
  p1Score.textContent = currentData.players.player1.score;
  p2Score.textContent = currentData.players.player2.score;

  if (currentData.status === "waiting") {
    overlay.classList.remove("hidden");
    overlayTitle.textContent = "Waiting for second player...";
    overlayMessage.textContent = `Share room code ${roomCode} with your friend.`;
    restartBtn.classList.add("hidden");
  } else if (currentData.status === "playing") {
    overlay.classList.add("hidden");
    restartBtn.classList.add("hidden");
  } else {
    overlay.classList.remove("hidden");
    if (mode === "single") {
      overlayTitle.textContent = "Round complete!";
      overlayMessage.textContent = currentData.state.resultText;
    } else {
      overlayTitle.textContent =
        currentData.state.winner === "draw"
          ? "It's a draw! 🤝"
          : currentData.state.winner === localSlot
          ? "You win! 🌟"
          : "You lost! 💖 Try again";
      overlayMessage.textContent = currentData.state.resultText || "Game over";
    }
    restartBtn.classList.remove("hidden");
  }
}

function roundedCell(x, y, size, color) {
  const pad = size * 0.06;
  const px = x * size + pad;
  const py = y * size + pad;
  const w = size - pad * 2;
  const r = Math.max(4, size * 0.24);

  ctx.fillStyle = color;
  ctx.shadowColor = "rgba(0,0,0,0.12)";
  ctx.shadowBlur = size * 0.22;

  ctx.beginPath();
  ctx.moveTo(px + r, py);
  ctx.arcTo(px + w, py, px + w, py + w, r);
  ctx.arcTo(px + w, py + w, px, py + w, r);
  ctx.arcTo(px, py + w, px, py, r);
  ctx.arcTo(px, py, px + w, py, r);
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;
}

function renderGame() {
  const data = mode === "single" ? singleData : roomData;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (!data?.state?.snakes) {
    drawGrid(20);
    return;
  }

  const diff = DIFFICULTIES[data.difficulty] || DIFFICULTIES.medium;
  const gridSize = diff.gridSize;
  const cellSize = canvas.width / gridSize;

  drawGrid(gridSize);

  const food = data.state.food;
  if (food) {
    const cx = food.x * cellSize + cellSize / 2;
    const cy = food.y * cellSize + cellSize / 2;
    const rad = cellSize * 0.32;

    const grad = ctx.createRadialGradient(cx, cy, 1, cx, cy, rad * 1.9);
    grad.addColorStop(0, "#fff7ff");
    grad.addColorStop(0.45, "#ff87d0");
    grad.addColorStop(1, "#ffa6b2");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.fill();
  }

  data.state.snakes.player1.forEach((cell, i) => {
    roundedCell(cell.x, cell.y, cellSize, i === 0 ? "#ff77bd" : "#ffb0d8");
  });

  (data.state.snakes.player2 || []).forEach((cell, i) => {
    roundedCell(cell.x, cell.y, cellSize, i === 0 ? "#57b6ff" : "#9fd8ff");
  });
}

function drawGrid(gridSize) {
  const size = canvas.width / gridSize;
  ctx.fillStyle = "#fffafc";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = "#f3dcf7";
  ctx.lineWidth = 1;

  for (let i = 0; i <= gridSize; i += 1) {
    const p = Math.round(i * size) + 0.5;
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, canvas.height);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, p);
    ctx.lineTo(canvas.width, p);
    ctx.stroke();
  }
}

async function restartGame() {
  if (mode === "single") {
    startSinglePlayer();
    return;
  }

  if (!roomRef || !roomData) return;

  if (!isHost()) {
    await roomRef.update({ restartRequest: { by: playerId, at: Date.now() } });
    setStatus("Restart requested! Waiting for host...");
    return;
  }

  const diff = DIFFICULTIES[roomData.difficulty] || DIFFICULTIES.medium;
  const snakes = initialSnakes(diff.gridSize);
  await roomRef.update({
    status: "playing",
    restartRequest: null,
    "players/player1/score": 0,
    "players/player2/score": 0,
    "players/player1/direction": "right",
    "players/player1/nextDirection": "right",
    "players/player2/direction": "left",
    "players/player2/nextDirection": "left",
    "state/snakes": snakes,
    "state/food": generateFood(snakes, diff.gridSize),
    "state/winner": null,
    "state/resultText": "",
    "state/tick": 0,
  });

  setStatus("Fresh round started!");
}

// ===================== Event Bindings =====================
createRoomBtn.addEventListener("click", createRoom);
joinRoomBtn.addEventListener("click", joinRoom);
singlePlayerBtn.addEventListener("click", startSinglePlayer);
restartBtn.addEventListener("click", restartGame);

gameModeSelect.addEventListener("change", () => {
  setMode(gameModeSelect.value);
  if (mode === "single") {
    setStatus("Single player mode selected. Tap Start Single Player.");
  } else {
    setStatus("Online multiplayer mode selected. Create or join a room.");
  }
  renderUI();
});

function isTypingContext(target) {
  if (!target) return false;
  const tag = target.tagName;
  return (
    target.isContentEditable ||
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT"
  );
}

document.addEventListener("keydown", (event) => {
  if (isTypingContext(event.target) || isTypingContext(document.activeElement)) {
    return;
  }

  const dir = keyToDirection(event.key);
  if (dir) {
    event.preventDefault();
    trySetDirection(dir);
  }
});

document.querySelectorAll(".mobile-controls button").forEach((btn) => {
  btn.addEventListener("click", () => {
    const dir = btn.dataset.dir;
    trySetDirection(dir);
  });
});

setMode(gameModeSelect.value);
setStatus("Ready! Enter your name, choose mode, and start.");
renderUI();
renderGame();
