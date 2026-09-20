// falling object catcher, plain canvas, no libraries

const canvas = document.getElementById("gameCanvas");
const drawingContext = canvas.getContext("2d");

// pixel art, never let the browser blur it while scaling
drawingContext.imageSmoothingEnabled = false;

function loadImage(fileName) {
  const image = new Image();
  image.src = "assets/" + encodeURIComponent(fileName);
  return image;
}

const backgroundImage = loadImage("background.png");
const fallingFrames = [1, 2, 3, 4, 5].map((frameNumber) => loadImage(`falling - ${frameNumber}.png`));

// the background tile is tiny pixel art, blow it up by a whole number of pixels
// so every source pixel stays a crisp square
const BACKGROUND_SCALE = 4;
const FALLING_FRAMES_PER_SECOND = 10;

let backgroundPattern = null;

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

// every falling thing is the same cat, so the tiers are told apart by size:
// spriteSize is what gets drawn, radius is the more forgiving catch box
const FALLING_KINDS = [
  { name: "big cat", spriteSize: 120, radius: 34, points: 1, weight: 6, textColor: "#6b4a2f" },
  { name: "medium cat", spriteSize: 94, radius: 27, points: 3, weight: 3, textColor: "#8c3f5d" },
  { name: "small cat", spriteSize: 70, radius: 20, points: 6, weight: 1.4, textColor: "#b8432c" }
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

function spawnFallingObject() {
  const kind = pickFallingKind();
  const fallSpeed = (BASE_FALL_SPEED + Math.random() * 90) * difficultyMultiplier();
  // start with the whole sprite on screen so no cat pops in mid fall
  const spawnY = kind.spriteSize / 2;
  const arrivalTime = elapsedSeconds + (player.y - spawnY) / fallSpeed;
  const x = pickReachableX(kind, arrivalTime);

  catchCommitments.push({ x, arrivalTime });

  fallingObjects.push({
    kind,
    x,
    y: spawnY,
    fallSpeed,
    wobbleOffset: Math.random() * Math.PI * 2,
    // stagger the tumble so a screenful of cats is not in lockstep
    animationTime: Math.random()
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
    fallingObject.animationTime += deltaSeconds;

    if (isCaught(fallingObject)) {
      score += fallingObject.kind.points;
      addFloatingText(`+${fallingObject.kind.points}`, fallingObject.x, fallingObject.y,
        fallingObject.kind.textColor);
      updateHud();
      continue;
    }

    if (fallingObject.y - fallingObject.kind.radius > canvas.height) {
      losePoint(1);
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

// the tile is only built once the png has actually decoded
function ensureBackgroundPattern() {
  if (backgroundPattern || !backgroundImage.complete || backgroundImage.naturalWidth === 0) return;

  const tile = document.createElement("canvas");
  tile.width = backgroundImage.naturalWidth * BACKGROUND_SCALE;
  tile.height = backgroundImage.naturalHeight * BACKGROUND_SCALE;

  const tileContext = tile.getContext("2d");
  tileContext.imageSmoothingEnabled = false;
  tileContext.drawImage(backgroundImage, 0, 0, tile.width, tile.height);

  backgroundPattern = drawingContext.createPattern(tile, "repeat");
}

function drawBackground() {
  ensureBackgroundPattern();
  drawingContext.clearRect(0, 0, canvas.width, canvas.height);

  if (backgroundPattern) {
    drawingContext.fillStyle = backgroundPattern;
  } else {
    // plain fill for the frame or two before the tile has decoded
    drawingContext.fillStyle = "#e8d6b0";
  }
  drawingContext.fillRect(0, 0, canvas.width, canvas.height);

  // faint ground line the bag sits on
  drawingContext.fillStyle = "rgba(60, 35, 20, 0.12)";
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
    const frameIndex = Math.floor(fallingObject.animationTime * FALLING_FRAMES_PER_SECOND)
      % fallingFrames.length;
    const frame = fallingFrames[frameIndex];

    if (!frame.complete || frame.naturalWidth === 0) continue;

    const size = fallingObject.kind.spriteSize;
    drawingContext.drawImage(
      frame,
      Math.round(fallingObject.x + wobble - size / 2),
      Math.round(fallingObject.y - size / 2),
      size,
      size
    );
  }
}

function drawFloatingTexts() {
  drawingContext.font = "26px rainyhearts, 'Trebuchet MS', sans-serif";
  drawingContext.textAlign = "center";

  drawingContext.lineWidth = 4;
  drawingContext.lineJoin = "round";

  for (const floatingText of floatingTexts) {
    drawingContext.globalAlpha = Math.max(0, floatingText.lifeLeft / 0.8);
    drawingContext.strokeStyle = "rgba(255, 248, 235, 0.9)";
    drawingContext.strokeText(floatingText.text, floatingText.x, floatingText.y);
    drawingContext.fillStyle = floatingText.color;
    drawingContext.fillText(floatingText.text, floatingText.x, floatingText.y);
  }

  drawingContext.globalAlpha = 1;
}

function drawPausedLabel() {
  drawingContext.fillStyle = "rgba(9, 12, 28, 0.6)";
  drawingContext.fillRect(0, 0, canvas.width, canvas.height);
  drawingContext.fillStyle = "#ffcf5c";
  drawingContext.font = "46px rainyhearts, 'Trebuchet MS', sans-serif";
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

// canvas text quietly falls back to the default font unless the face is already
// loaded, so ask for it before the first frame is drawn
if (document.fonts && document.fonts.load) {
  document.fonts.load("26px rainyhearts").catch(() => {});
  document.fonts.load("46px rainyhearts").catch(() => {});
}

requestAnimationFrame((timestamp) => {
  lastFrameTimestamp = timestamp;
  requestAnimationFrame(gameLoop);
});
