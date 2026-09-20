// falling object catcher, plain canvas, no libraries

const canvas = document.getElementById("gameCanvas");
const drawingContext = canvas.getContext("2d");

const scoreValueElement = document.getElementById("scoreValue");
const bestValueElement = document.getElementById("bestValue");
const livesValueElement = document.getElementById("livesValue");
const overlayElement = document.getElementById("overlay");
const overlayTitleElement = document.getElementById("overlayTitle");
const overlayTextElement = document.getElementById("overlayText");
const startButton = document.getElementById("startButton");

const BEST_SCORE_STORAGE_KEY = "dishwaterBagBestScore";
const STARTING_LIVES = 3;
const PLAYER_SPEED = 560;
const BASE_FALL_SPEED = 170;
const BASE_SPAWN_INTERVAL = 0.85;

// only ever ask the player to use this fraction of their top speed between two
// catches, so a perfect run never depends on frame perfect movement
const REACH_SAFETY_FACTOR = 0.7;

// a hazard landing this close in time to a catchable object must not block it
const HAZARD_CLEARANCE_SECONDS = 0.45;

// each falling kind: how it looks, what catching it does
const FALLING_KINDS = [
  { name: "drop", color: "#6fd3ff", radius: 15, points: 1, weight: 6, harmful: false },
  { name: "bubble", color: "#b58cff", radius: 19, points: 3, weight: 3, harmful: false },
  { name: "star", color: "#ffcf5c", radius: 13, points: 6, weight: 1.4, harmful: false },
  { name: "sludge", color: "#ff5f6d", radius: 17, points: 0, weight: 2.0, harmful: true }
];

const totalKindWeight = FALLING_KINDS.reduce((runningTotal, kind) => runningTotal + kind.weight, 0);

const player = {
  width: 110,
  height: 26,
  x: canvas.width / 2,
  y: canvas.height - 56
};

const pressedKeys = new Set();

let fallingObjects = [];
let floatingTexts = [];

// where and when the player has to be to catch each object still in flight,
// used to keep every new spawn within reach of the previous one
let catchCommitments = [];
let score = 0;
let bestScore = loadBestScore();
let livesLeft = STARTING_LIVES;
let elapsedSeconds = 0;
let timeUntilNextSpawn = 0;
let gameState = "menu"; // menu, playing, paused, over
let lastFrameTimestamp = 0;

bestValueElement.textContent = bestScore;

function loadBestScore() {
  try {
    return Number(localStorage.getItem(BEST_SCORE_STORAGE_KEY)) || 0;
  } catch (storageError) {
    return 0;
  }
}

function saveBestScore(value) {
  try {
    localStorage.setItem(BEST_SCORE_STORAGE_KEY, String(value));
  } catch (storageError) {
    // storage may be blocked, the game still works without it
  }
}

function pickFallingKind() {
  let remainingWeight = Math.random() * totalKindWeight;
  for (const kind of FALLING_KINDS) {
    remainingWeight -= kind.weight;
    if (remainingWeight <= 0) return kind;
  }
  return FALLING_KINDS[0];
}

function difficultyMultiplier() {
  // speeds things up steadily but flattens out so it stays playable
  return 1 + Math.min(elapsedSeconds / 60, 1.25);
}

// objects fall at different speeds, so a new spawn can land between two that
// are already in flight, the player must still be able to reach it from the one
// before it and carry on to the one after it
function neighbouringCommitments(arrivalTime) {
  let before = { x: player.x, arrivalTime: elapsedSeconds };
  let after = null;

  for (const commitment of catchCommitments) {
    if (commitment.arrivalTime <= arrivalTime) {
      if (commitment.arrivalTime > before.arrivalTime) before = commitment;
    } else if (after === null || commitment.arrivalTime < after.arrivalTime) {
      after = commitment;
    }
  }

  return { before, after };
}

function pickReachableX(kind, arrivalTime) {
  const { before, after } = neighbouringCommitments(arrivalTime);

  const reachFromBefore = PLAYER_SPEED
    * Math.max(arrivalTime - before.arrivalTime, 0) * REACH_SAFETY_FACTOR;

  let leftLimit = Math.max(kind.radius, before.x - reachFromBefore);
  let rightLimit = Math.min(canvas.width - kind.radius, before.x + reachFromBefore);

  if (after !== null) {
    const reachToAfter = PLAYER_SPEED
      * Math.max(after.arrivalTime - arrivalTime, 0) * REACH_SAFETY_FACTOR;
    leftLimit = Math.max(leftLimit, after.x - reachToAfter);
    rightLimit = Math.min(rightLimit, after.x + reachToAfter);
  }

  if (rightLimit < leftLimit) return before.x;
  return leftLimit + Math.random() * (rightLimit - leftLimit);
}

function conflictsWithCatch(x, kind, arrivalTime) {
  const blockingDistance = player.width / 2 + kind.radius;
  return catchCommitments.some((commitment) =>
    Math.abs(commitment.arrivalTime - arrivalTime) < HAZARD_CLEARANCE_SECONDS
    && Math.abs(commitment.x - x) < blockingDistance);
}

function pickHazardX(kind, arrivalTime) {
  // retry a few times so a hazard rarely sits on top of something worth catching
  let x = 0;
  for (let attempt = 0; attempt < 8; attempt++) {
    x = kind.radius + Math.random() * (canvas.width - kind.radius * 2);
    if (!conflictsWithCatch(x, kind, arrivalTime)) return x;
  }
  return x;
}

function spawnFallingObject() {
  const kind = pickFallingKind();
  const fallSpeed = (BASE_FALL_SPEED + Math.random() * 90) * difficultyMultiplier();
  // start fully visible at the very top edge so nothing pops in mid fall
  const spawnY = kind.radius;
  const arrivalTime = elapsedSeconds + (player.y - spawnY) / fallSpeed;

  const x = kind.harmful
    ? pickHazardX(kind, arrivalTime)
    : pickReachableX(kind, arrivalTime);

  if (!kind.harmful) {
    catchCommitments.push({ x, arrivalTime });
  }

  fallingObjects.push({
    kind,
    x,
    y: spawnY,
    fallSpeed,
    wobbleOffset: Math.random() * Math.PI * 2
  });
}

function addFloatingText(text, x, y, color) {
  floatingTexts.push({ text, x, y, color, lifeLeft: 0.8 });
}

function startGame() {
  fallingObjects = [];
  floatingTexts = [];
  catchCommitments = [];
  score = 0;
  livesLeft = STARTING_LIVES;
  elapsedSeconds = 0;
  timeUntilNextSpawn = 0.4;
  player.x = canvas.width / 2;
  gameState = "playing";
  overlayElement.classList.add("hidden");
  updateHud();
}

function endGame() {
  gameState = "over";
  if (score > bestScore) {
    bestScore = score;
    saveBestScore(bestScore);
  }
  updateHud();
  showOverlay("game over", `you caught ${score} point${score === 1 ? "" : "s"}.`, "play again");
}

function showOverlay(title, text, buttonLabel) {
  overlayTitleElement.textContent = title;
  overlayTextElement.textContent = text;
  startButton.textContent = buttonLabel;
  overlayElement.classList.remove("hidden");
}

function updateHud() {
  scoreValueElement.textContent = score;
  bestValueElement.textContent = bestScore;
  livesValueElement.textContent = livesLeft;
}

function losePoint(amount) {
  livesLeft -= amount;
  updateHud();
  if (livesLeft <= 0) {
    livesLeft = 0;
    updateHud();
    endGame();
  }
}

function updatePlayer(deltaSeconds) {
  let direction = 0;
  if (pressedKeys.has("ArrowLeft") || pressedKeys.has("KeyA")) direction -= 1;
  if (pressedKeys.has("ArrowRight") || pressedKeys.has("KeyD")) direction += 1;

  player.x += direction * PLAYER_SPEED * deltaSeconds;

  const halfWidth = player.width / 2;
  player.x = Math.max(halfWidth, Math.min(canvas.width - halfWidth, player.x));
}

function isCaught(fallingObject) {
  const halfWidth = player.width / 2;
  const withinX = fallingObject.x > player.x - halfWidth - fallingObject.kind.radius * 0.4
    && fallingObject.x < player.x + halfWidth + fallingObject.kind.radius * 0.4;
  const withinY = fallingObject.y + fallingObject.kind.radius >= player.y
    && fallingObject.y - fallingObject.kind.radius <= player.y + player.height;
  return withinX && withinY;
}

function updateFallingObjects(deltaSeconds) {
  const survivors = [];

  for (const fallingObject of fallingObjects) {
    fallingObject.y += fallingObject.fallSpeed * deltaSeconds;

    if (isCaught(fallingObject)) {
      if (fallingObject.kind.harmful) {
        addFloatingText("ouch", fallingObject.x, fallingObject.y, "#ff8a94");
        losePoint(1);
      } else {
        score += fallingObject.kind.points;
        addFloatingText(`+${fallingObject.kind.points}`, fallingObject.x, fallingObject.y, fallingObject.kind.color);
        updateHud();
      }
      continue;
    }

    if (fallingObject.y - fallingObject.kind.radius > canvas.height) {
      // sludge is safe to let through, everything else costs a life
      if (!fallingObject.kind.harmful) {
        losePoint(1);
      }
      continue;
    }

    survivors.push(fallingObject);
  }

  fallingObjects = survivors;
}

function updateFloatingTexts(deltaSeconds) {
  for (const floatingText of floatingTexts) {
    floatingText.y -= 42 * deltaSeconds;
    floatingText.lifeLeft -= deltaSeconds;
  }
  floatingTexts = floatingTexts.filter((floatingText) => floatingText.lifeLeft > 0);
}

function update(deltaSeconds) {
  elapsedSeconds += deltaSeconds;
  updatePlayer(deltaSeconds);

  catchCommitments = catchCommitments.filter(
    (commitment) => commitment.arrivalTime > elapsedSeconds);

  timeUntilNextSpawn -= deltaSeconds;
  if (timeUntilNextSpawn <= 0) {
    spawnFallingObject();
    timeUntilNextSpawn = Math.max(0.25, BASE_SPAWN_INTERVAL / difficultyMultiplier());
  }

  updateFallingObjects(deltaSeconds);
  updateFloatingTexts(deltaSeconds);
}

function drawBackground() {
  drawingContext.clearRect(0, 0, canvas.width, canvas.height);

  // faint ground line the basket sits on
  drawingContext.fillStyle = "rgba(255, 255, 255, 0.05)";
  drawingContext.fillRect(0, player.y + player.height + 14, canvas.width, canvas.height);
}

function drawPlayer() {
  const halfWidth = player.width / 2;

  drawingContext.fillStyle = "#f2f4ff";
  drawingContext.beginPath();
  drawingContext.roundRect(player.x - halfWidth, player.y, player.width, player.height, 10);
  drawingContext.fill();

  drawingContext.fillStyle = "rgba(255, 207, 92, 0.85)";
  drawingContext.beginPath();
  drawingContext.roundRect(player.x - halfWidth + 8, player.y + 4, player.width - 16, 7, 4);
  drawingContext.fill();
}

function drawFallingObjects() {
  for (const fallingObject of fallingObjects) {
    const wobble = Math.sin(elapsedSeconds * 4 + fallingObject.wobbleOffset) * 3;

    drawingContext.fillStyle = fallingObject.kind.color;
    drawingContext.beginPath();
    drawingContext.arc(fallingObject.x + wobble, fallingObject.y, fallingObject.kind.radius, 0, Math.PI * 2);
    drawingContext.fill();

    // small highlight so the shapes read as round
    drawingContext.fillStyle = "rgba(255, 255, 255, 0.35)";
    drawingContext.beginPath();
    drawingContext.arc(
      fallingObject.x + wobble - fallingObject.kind.radius * 0.3,
      fallingObject.y - fallingObject.kind.radius * 0.3,
      fallingObject.kind.radius * 0.28,
      0,
      Math.PI * 2
    );
    drawingContext.fill();
  }
}

function drawFloatingTexts() {
  drawingContext.font = "bold 18px 'Trebuchet MS', sans-serif";
  drawingContext.textAlign = "center";

  for (const floatingText of floatingTexts) {
    drawingContext.globalAlpha = Math.max(0, floatingText.lifeLeft / 0.8);
    drawingContext.fillStyle = floatingText.color;
    drawingContext.fillText(floatingText.text, floatingText.x, floatingText.y);
  }

  drawingContext.globalAlpha = 1;
}

function drawPausedLabel() {
  drawingContext.fillStyle = "rgba(9, 12, 28, 0.6)";
  drawingContext.fillRect(0, 0, canvas.width, canvas.height);
  drawingContext.fillStyle = "#ffcf5c";
  drawingContext.font = "bold 34px 'Trebuchet MS', sans-serif";
  drawingContext.textAlign = "center";
  drawingContext.fillText("paused", canvas.width / 2, canvas.height / 2);
}

function draw() {
  drawBackground();
  drawFallingObjects();
  drawPlayer();
  drawFloatingTexts();
  if (gameState === "paused") drawPausedLabel();
}

function gameLoop(timestamp) {
  const deltaSeconds = Math.min((timestamp - lastFrameTimestamp) / 1000, 0.05);
  lastFrameTimestamp = timestamp;

  if (gameState === "playing") update(deltaSeconds);
  draw();

  requestAnimationFrame(gameLoop);
}

document.addEventListener("keydown", (event) => {
  if (["ArrowLeft", "ArrowRight", "Space"].includes(event.code)) event.preventDefault();

  pressedKeys.add(event.code);

  if (event.code === "KeyP") {
    if (gameState === "playing") {
      gameState = "paused";
    } else if (gameState === "paused") {
      gameState = "playing";
    }
  }

  if (event.code === "Space" && (gameState === "menu" || gameState === "over")) {
    startGame();
  }
});

document.addEventListener("keyup", (event) => {
  pressedKeys.delete(event.code);
});

// let the basket follow a pointer too, handy on a laptop trackpad or phone
canvas.addEventListener("pointermove", (event) => {
  if (gameState !== "playing") return;
  const bounds = canvas.getBoundingClientRect();
  const scale = canvas.width / bounds.width;
  player.x = (event.clientX - bounds.left) * scale;
});

startButton.addEventListener("click", startGame);

requestAnimationFrame((timestamp) => {
  lastFrameTimestamp = timestamp;
  requestAnimationFrame(gameLoop);
});
