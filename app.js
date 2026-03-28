const CONFIG = window.NovaRushConfig || {};
CONFIG.startBalance = Number.isFinite(Number(CONFIG.startBalance)) ? Number(CONFIG.startBalance) : 10000;
CONFIG.maxCrash = Number.isFinite(Number(CONFIG.maxCrash)) ? Number(CONFIG.maxCrash) : 50;
CONFIG.currencyName = String(CONFIG.currencyName || "монет");
CONFIG.minBet = Number.isFinite(Number(CONFIG.minBet)) ? Number(CONFIG.minBet) : 10;
CONFIG.maxBet = Number.isFinite(Number(CONFIG.maxBet)) ? Number(CONFIG.maxBet) : 5000;

const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
const balanceValue = document.getElementById("balanceValue");
const multiplierValue = document.getElementById("multiplierValue");
const roundStatus = document.getElementById("roundStatus");
const hintText = document.getElementById("hintText");
const historyList = document.getElementById("historyList");
const betInput = document.getElementById("betInput");
const startBtn = document.getElementById("startBtn");
const cashoutBtn = document.getElementById("cashoutBtn");
const currencyNodes = document.querySelectorAll("[data-currency-name]");
const maxCrashValue = document.getElementById("maxCrashValue");
const maxCrashNote = document.getElementById("maxCrashNote");
const probabilityNote = document.getElementById("probabilityNote");

const heroFly = loadImage("./assets/hero-fly.svg");
const heroFall = loadImage("./assets/hero-fall.svg");
const explosionImg = loadImage("./assets/explosion.svg");

const DPR = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
let roundResetTimer = null;

function loadImage(src) {
  const img = new Image();
  img.src = src;
  return img;
}
function safeNumber(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}
function clamp(num, min, max) {
  return Math.min(max, Math.max(min, num));
}
function randomBetween(min, max) {
  if (max <= min) return Number(min.toFixed(2));
  return Number((Math.random() * (max - min) + min).toFixed(2));
}
function normalizeDistribution() {
  const raw = Array.isArray(CONFIG.distribution) ? CONFIG.distribution : [];
  const valid = raw
    .map((item) => ({
      min: safeNumber(item.min, NaN),
      max: safeNumber(item.max, NaN),
      chance: safeNumber(item.chance, NaN)
    }))
    .filter((item) => Number.isFinite(item.min) && Number.isFinite(item.max) && Number.isFinite(item.chance) && item.chance > 0);

  const capped = valid
    .map((item) => ({
      min: clamp(item.min, 1, CONFIG.maxCrash),
      max: clamp(item.max, 1, CONFIG.maxCrash),
      chance: item.chance
    }))
    .filter((item) => item.max >= item.min);

  if (!capped.length) {
    return [{ min: 1, max: CONFIG.maxCrash, chance: 1 }];
  }

  const total = capped.reduce((sum, item) => sum + item.chance, 0);
  return capped.map((item) => ({ ...item, chance: item.chance / total }));
}
const DISTRIBUTION = normalizeDistribution();
function formatDistributionNote() {
  const text = DISTRIBUTION.map((item) => `${item.min.toFixed(2)}–${item.max.toFixed(2)}x — ${(item.chance * 100).toFixed(0)}%`).join(", ");
  probabilityNote.innerHTML = `<strong>Шансы по диапазонам:</strong> ${text}.`;
}
function loadState() {
  let balance = CONFIG.startBalance;
  let history = [];
  try {
    balance = safeNumber(localStorage.getItem("nr.balance"), CONFIG.startBalance);
    history = JSON.parse(localStorage.getItem("nr.history") || "[]");
    if (!Array.isArray(history)) history = [];
    history = history.map((entry) => safeNumber(entry, NaN)).filter((entry) => Number.isFinite(entry));
  } catch (error) {
    console.warn("Local state reset", error);
  }
  balance = clamp(Math.floor(balance), 0, Number.MAX_SAFE_INTEGER);
  return { balance, history };
}
const persisted = loadState();
const state = {
  balance: persisted.balance,
  history: persisted.history,
  roundActive: false,
  crashed: false,
  cashedOut: false,
  multiplier: 1,
  startAt: 0,
  crashPoint: 1.5,
  bet: 100,
  trailPoints: [],
  milestoneMarks: [],
  fallProgress: 0,
  displayT: 0
};
function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const displayWidth = Math.max(1, Math.round(rect.width));
  const displayHeight = Math.max(1, Math.round(rect.height));
  canvas.width = displayWidth * DPR;
  canvas.height = displayHeight * DPR;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}
window.addEventListener("resize", resizeCanvas);
resizeCanvas();

function generateCrashPoint() {
  const p = Math.random();
  let cumulative = 0;
  for (const bucket of DISTRIBUTION) {
    cumulative += bucket.chance;
    if (p <= cumulative + 1e-9) {
      return randomBetween(bucket.min, bucket.max);
    }
  }
  const last = DISTRIBUTION[DISTRIBUTION.length - 1];
  return randomBetween(last.min, last.max);
}
function curvePoint(t) {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const p0 = { x: 100, y: h - 170 };
  const p1 = { x: w * 0.32, y: h * 0.56 };
  const p2 = { x: w * 0.58, y: h * 0.34 };
  const p3 = { x: w * 0.88, y: 155 };
  const u = 1 - t;
  return {
    x: u ** 3 * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t ** 3 * p3.x,
    y: u ** 3 * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t ** 3 * p3.y
  };
}
function tangentAngle(t) {
  const pA = curvePoint(clamp(t - 0.01, 0, 1));
  const pB = curvePoint(clamp(t + 0.01, 0, 1));
  return Math.atan2(pB.y - pA.y, pB.x - pA.x);
}
function multiplierFromTime(seconds) {
  return clamp(Number(Math.exp(0.69 * seconds).toFixed(2)), 1, CONFIG.maxCrash);
}
function durationForCrash(crashPoint) {
  return Math.max(0.1, Math.log(Math.max(1.01, crashPoint)) / 0.69);
}
function sanitizeBet() {
  const raw = Number(betInput.value) || 0;
  const maxAllowed = Math.min(CONFIG.maxBet, Math.max(CONFIG.minBet, state.balance || CONFIG.maxBet));
  const bet = clamp(Math.round(raw), CONFIG.minBet, maxAllowed);
  betInput.value = String(bet);
  state.bet = bet;
  return bet;
}
function updateCashoutText() {
  const bet = sanitizeBet();
  const payout = Math.floor(bet * state.multiplier);
  cashoutBtn.textContent = `Забрать ${payout}`;
}
function save() {
  try {
    localStorage.setItem("nr.balance", String(state.balance));
    localStorage.setItem("nr.history", JSON.stringify(state.history.slice(0, 10)));
  } catch (error) {
    console.warn("Unable to persist local state", error);
  }
}
function addHistory(value) {
  state.history.unshift(value);
  state.history = state.history.slice(0, 10);
  save();
  renderHistory();
}
function renderHistory() {
  historyList.innerHTML = "";
  if (!state.history.length) {
    const empty = document.createElement("div");
    empty.className = "history-chip";
    empty.textContent = "—";
    historyList.appendChild(empty);
    return;
  }
  state.history.forEach((entry) => {
    const chip = document.createElement("div");
    chip.className = "history-chip " + (entry < 2 ? "low" : entry < 5 ? "mid" : "high");
    chip.textContent = Number(entry).toFixed(2) + "x";
    historyList.appendChild(chip);
  });
}
function updateBalance() {
  balanceValue.textContent = Math.floor(state.balance);
}
function resetRoundState() {
  if (roundResetTimer) {
    clearTimeout(roundResetTimer);
    roundResetTimer = null;
  }
  state.roundActive = false;
  state.crashed = false;
  state.cashedOut = false;
  state.multiplier = 1;
  state.startAt = 0;
  state.crashPoint = 1.2;
  state.trailPoints = [];
  state.milestoneMarks = [];
  state.fallProgress = 0;
  state.displayT = 0;
  multiplierValue.textContent = "1.00x";
  roundStatus.textContent = "Ожидание";
  hintText.textContent = "Нажми «Старт», чтобы запустить раунд.";
  startBtn.disabled = false;
  cashoutBtn.disabled = true;
  updateCashoutText();
}
function finishRoundSoon() {
  if (roundResetTimer) clearTimeout(roundResetTimer);
  roundResetTimer = setTimeout(() => {
    roundStatus.textContent = "Раунд завершён";
    hintText.textContent = "Можно запускать следующий раунд.";
    startBtn.disabled = false;
  }, 1400);
}
function startRound() {
  const bet = sanitizeBet();
  if (state.roundActive) return;
  if (bet > state.balance) {
    hintText.textContent = `Недостаточно ${CONFIG.currencyName} для такой ставки.`;
    return;
  }
  if (roundResetTimer) {
    clearTimeout(roundResetTimer);
    roundResetTimer = null;
  }
  state.balance -= bet;
  updateBalance();
  save();
  state.roundActive = true;
  state.crashed = false;
  state.cashedOut = false;
  state.multiplier = 1;
  state.startAt = performance.now();
  state.crashPoint = generateCrashPoint();
  state.trailPoints = [];
  state.milestoneMarks = [{ value: 1.0, pos: curvePoint(0) }];
  state.fallProgress = 0;
  state.displayT = 0;
  roundStatus.textContent = "Полёт";
  hintText.textContent = "Раунд активен. Crash point скрыт до столкновения.";
  startBtn.disabled = true;
  cashoutBtn.disabled = false;
  updateCashoutText();
}
function cashOut() {
  if (!state.roundActive || state.crashed || state.cashedOut) return;
  state.cashedOut = true;
  state.roundActive = false;
  const payout = Math.floor(state.bet * state.multiplier);
  state.balance += payout;
  addHistory(state.multiplier);
  updateBalance();
  roundStatus.textContent = "Забрано";
  hintText.textContent = `Ты забрал ${payout} ${CONFIG.currencyName} на ${state.multiplier.toFixed(2)}x`;
  startBtn.disabled = false;
  cashoutBtn.disabled = true;
  save();
}
startBtn.addEventListener("click", startRound);
cashoutBtn.addEventListener("click", cashOut);
betInput.addEventListener("change", updateCashoutText);
betInput.addEventListener("input", updateCashoutText);
betInput.addEventListener("blur", sanitizeBet);
for (const btn of document.querySelectorAll("[data-bet-mod]")) {
  btn.addEventListener("click", () => {
    const delta = Number(btn.dataset.betMod);
    betInput.value = String(clamp((Number(betInput.value) || 100) + delta, CONFIG.minBet, CONFIG.maxBet));
    updateCashoutText();
  });
}
function drawBackground() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "#21104c"); grad.addColorStop(0.5, "#120a2d"); grad.addColorStop(1, "#0a0516");
  ctx.fillStyle = grad; ctx.fillRect(0, 0, w, h);
  const cityGrad = ctx.createLinearGradient(0, h * 0.7, 0, h);
  cityGrad.addColorStop(0, "rgba(116, 82, 255, 0.0)"); cityGrad.addColorStop(1, "rgba(130, 62, 255, 0.18)");
  ctx.fillStyle = cityGrad; ctx.fillRect(0, h * 0.65, w, h * 0.35);
  for (let i = 0; i < 80; i += 1) {
    const x = (i * 73) % w, y = (i * 131) % (h * 0.7), r = i % 9 === 0 ? 1.8 : 1;
    ctx.fillStyle = i % 3 === 0 ? "rgba(255,255,255,0.75)" : "rgba(173,216,255,0.55)";
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  const baseY = h - 10;
  [25, 65, 115, 175, 240, 305, 395, 480, 560, 650, 740].forEach((x, idx) => {
    const bw = 42 + (idx % 3) * 18, bh = 90 + (idx % 5) * 42;
    const bGrad = ctx.createLinearGradient(0, baseY - bh, 0, baseY);
    bGrad.addColorStop(0, "#312067"); bGrad.addColorStop(1, "#0f0a22");
    ctx.fillStyle = bGrad; ctx.fillRect(x, baseY - bh, bw, bh);
    for (let wy = baseY - bh + 10; wy < baseY - 10; wy += 14) {
      for (let wx = x + 8; wx < x + bw - 8; wx += 12) {
        if ((wx + wy + idx) % 3 === 0) {
          ctx.fillStyle = (wx + wy) % 2 === 0 ? "#63e8ff" : "#ff62db";
          ctx.fillRect(wx, wy, 5, 7);
        }
      }
    }
  });
}
function drawTrail() {
  if (!state.trailPoints.length) return;
  const lineGrad = ctx.createLinearGradient(90, canvas.clientHeight - 200, canvas.clientWidth * 0.72, 220);
  lineGrad.addColorStop(0, "#ff38d8"); lineGrad.addColorStop(0.5, "#61ecff"); lineGrad.addColorStop(1, "#ffd248");
  ctx.save(); ctx.lineJoin = "round"; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(state.trailPoints[0].x, state.trailPoints[0].y); for (const p of state.trailPoints) ctx.lineTo(p.x, p.y);
  ctx.strokeStyle = "rgba(99, 245, 255, 0.18)"; ctx.lineWidth = 22; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(state.trailPoints[0].x, state.trailPoints[0].y); for (const p of state.trailPoints) ctx.lineTo(p.x, p.y);
  ctx.strokeStyle = lineGrad; ctx.lineWidth = 8; ctx.stroke();
  for (let i = 0; i < state.trailPoints.length; i += 4) {
    const p = state.trailPoints[i];
    ctx.fillStyle = i % 8 === 0 ? "#ffe56d" : "#ff73e2";
    ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill();
  }
  ctx.font = "800 20px Inter, sans-serif"; ctx.textAlign = "center";
  for (const mark of state.milestoneMarks) {
    ctx.fillStyle = "#ffd47c"; ctx.shadowColor = "rgba(255,140,67,0.45)"; ctx.shadowBlur = 18;
    ctx.fillText(mark.value.toFixed(2) + "x", mark.pos.x + 18, mark.pos.y - 12);
  }
  ctx.restore();
}
function drawHero(t, angle) {
  const pos = curvePoint(t);
  if (state.crashed && !state.cashedOut) {
    const fallX = pos.x + Math.sin(state.fallProgress * Math.PI) * 45;
    const fallY = pos.y + state.fallProgress * 340;
    ctx.save(); ctx.translate(fallX, fallY); ctx.rotate(0.7 + state.fallProgress * 1.8); ctx.drawImage(heroFall, -55, -45, 110, 90); ctx.restore();
    if (state.fallProgress > 0.82) {
      const scale = 80 + (state.fallProgress - 0.82) * 240;
      ctx.save(); ctx.globalAlpha = clamp((state.fallProgress - 0.82) * 4.2, 0, 1); ctx.drawImage(explosionImg, fallX - scale / 2, fallY - scale / 2, scale, scale); ctx.restore();
    }
    return;
  }
  ctx.save(); ctx.translate(pos.x, pos.y); ctx.rotate(angle); ctx.shadowColor = "rgba(255,120,220,0.35)"; ctx.shadowBlur = 28; ctx.drawImage(heroFly, -62, -48, 124, 96); ctx.restore();
}
function drawDangerOverlay() {
  if (state.multiplier < 10 || !state.roundActive) return;
  const intensity = clamp((state.multiplier - 10) / Math.max(1, CONFIG.maxCrash - 10), 0, 1);
  const alpha = 0.04 + intensity * 0.16 + Math.sin(performance.now() * 0.01) * 0.01;
  ctx.fillStyle = `rgba(255, 92, 28, ${alpha})`; ctx.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);
}
function drawGroundGlow() {
  const y = canvas.clientHeight - 92;
  const grad = ctx.createLinearGradient(0, y, 0, canvas.clientHeight);
  grad.addColorStop(0, "rgba(116, 82, 255, 0)"); grad.addColorStop(1, "rgba(60, 237, 255, 0.15)");
  ctx.fillStyle = grad; ctx.fillRect(0, y, canvas.clientWidth, canvas.clientHeight - y);
  ctx.strokeStyle = "rgba(92, 242, 255, 0.75)"; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, canvas.clientHeight - 8); ctx.lineTo(canvas.clientWidth, canvas.clientHeight - 8); ctx.stroke();
}
function getVisibleCurveT(now) {
  if (state.roundActive) {
    const activeDuration = durationForCrash(state.crashPoint);
    state.displayT = clamp(((now - state.startAt) / 1000) / activeDuration, 0, 1);
    return state.displayT;
  }
  if (state.crashed) return state.displayT;
  if (state.cashedOut) return state.displayT;
  return state.displayT;
}
function tick(now) {
  requestAnimationFrame(tick);
  if (state.roundActive) {
    const elapsed = (now - state.startAt) / 1000;
    state.multiplier = multiplierFromTime(elapsed);
    const roundDuration = durationForCrash(state.crashPoint);
    const t = clamp(elapsed / roundDuration, 0, 1);
    state.displayT = t;
    const pos = curvePoint(t);
    const lastPoint = state.trailPoints[state.trailPoints.length - 1];
    if (!lastPoint || Math.hypot(pos.x - lastPoint.x, pos.y - lastPoint.y) > 8) state.trailPoints.push(pos);
    const lastMilestone = state.milestoneMarks[state.milestoneMarks.length - 1]?.value ?? 1;
    if (state.multiplier >= lastMilestone + 1.25 && state.multiplier < state.crashPoint) state.milestoneMarks.push({ value: state.multiplier, pos });
    if (state.multiplier >= state.crashPoint) {
      state.multiplier = state.crashPoint;
      state.roundActive = false;
      state.crashed = true;
      state.fallProgress = 0.01;
      addHistory(state.crashPoint);
      roundStatus.textContent = "Падение";
      hintText.textContent = `Краш на ${state.crashPoint.toFixed(2)}x`;
      startBtn.disabled = true;
      cashoutBtn.disabled = true;
      finishRoundSoon();
    }
  }
  if (state.crashed && !state.cashedOut && state.fallProgress < 1) state.fallProgress = Math.min(state.fallProgress + 0.02, 1);
  multiplierValue.textContent = state.multiplier.toFixed(2) + "x";
  updateCashoutText();
  drawBackground();
  drawTrail();
  const visibleT = getVisibleCurveT(now);
  drawHero(visibleT, tangentAngle(visibleT));
  drawDangerOverlay();
  drawGroundGlow();
}
for (const node of currencyNodes) node.textContent = CONFIG.currencyName;
maxCrashValue.textContent = CONFIG.maxCrash.toFixed(2) + 'x';
maxCrashNote.textContent = CONFIG.maxCrash.toFixed(2) + 'x';
formatDistributionNote();
resetRoundState();
renderHistory();
updateBalance();
updateCashoutText();
requestAnimationFrame(tick);
if (window.Telegram && window.Telegram.WebApp) {
  try { window.Telegram.WebApp.ready(); window.Telegram.WebApp.expand(); } catch (error) { console.warn("Telegram WebApp init skipped", error); }
}
