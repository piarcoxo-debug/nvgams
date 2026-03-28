(() => {
  const cfg = window.NOVA_CONFIG;
  const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
  if (tg) { tg.ready(); tg.expand(); }

  const $ = (id) => document.getElementById(id);
  const ui = {
    badge: $('gameStateBadge'),
    multiplier: $('multiplier'),
    statusText: $('statusText'),
    balance: $('balance'),
    historyList: $('historyList'),
    scene: $('sceneWrap'),
    pilot: $('pilot'),
    trailCanvas: $('trailCanvas'),
    sparkLayer: $('sparkLayer'),
    explosion: $('explosion'),
    betInput: $('betInput'),
    minusBtn: $('minusBtn'),
    plusBtn: $('plusBtn'),
    startBtn: $('startBtn'),
    cashoutBtn: $('cashoutBtn')
  };

  const state = {
    balance: cfg.startBalance,
    currentBet: cfg.defaultBet,
    currentMultiplier: 1,
    crashPoint: 1,
    gameState: 'idle',
    history: [],
    path: [],
    rafId: 0,
    roundDuration: 0,
    startAt: 0,
    resetTimer: 0,
    pilotPoint: { x: 40, y: 200 }
  };

  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
  const toNum = (v, fallback) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };

  function formatInt(value) {
    return new Intl.NumberFormat('ru-RU').format(Math.floor(value));
  }

  function formatBalance(value) {
    return `${formatInt(value)} ${cfg.currencyName}`;
  }

  function saveState() {
    try {
      localStorage.setItem(cfg.storageKey, JSON.stringify({
        balance: state.balance,
        currentBet: state.currentBet,
        history: state.history
      }));
    } catch {}
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(cfg.storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      state.balance = clamp(Math.floor(toNum(parsed.balance, cfg.startBalance)), cfg.minBet, 1_000_000_000);
      state.currentBet = clamp(Math.floor(toNum(parsed.currentBet, cfg.defaultBet)), cfg.minBet, cfg.maxBet);
      state.history = Array.isArray(parsed.history) ? parsed.history.filter(Number.isFinite).slice(0, cfg.historySize) : [];
    } catch {
      state.balance = cfg.startBalance;
      state.currentBet = cfg.defaultBet;
      state.history = [];
    }
    if (state.currentBet > state.balance) state.currentBet = clamp(Math.floor(state.balance / 10) * 10, cfg.minBet, cfg.maxBet);
  }

  function updateBalanceUI() { ui.balance.textContent = formatBalance(state.balance); }

  function renderHistory() {
    ui.historyList.innerHTML = '';
    if (!state.history.length) {
      const empty = document.createElement('div');
      empty.className = 'history-item';
      empty.textContent = '—';
      ui.historyList.appendChild(empty);
      return;
    }
    state.history.forEach(v => {
      const item = document.createElement('div');
      item.className = `history-item ${v < 2 ? 'history-low' : v < 5 ? 'history-mid' : 'history-high'}`;
      item.textContent = `${v.toFixed(2)}x`;
      ui.historyList.appendChild(item);
    });
  }

  function setBadge(mode) {
    ui.badge.className = 'badge';
    if (mode === 'running') {
      ui.badge.textContent = 'Полёт';
      ui.badge.classList.add('badge-running');
    } else if (mode === 'crash') {
      ui.badge.textContent = 'Краш';
      ui.badge.classList.add('badge-crash');
    } else {
      ui.badge.textContent = 'Ожидание';
      ui.badge.classList.add('badge-idle');
    }
  }

  function updateButtons() {
    const canStart = state.gameState !== 'running' && state.currentBet >= cfg.minBet && state.currentBet <= state.balance;
    ui.startBtn.disabled = !canStart;
    const liveCashout = state.gameState === 'running';
    ui.cashoutBtn.disabled = !liveCashout;
    ui.cashoutBtn.classList.toggle('cashout-live', liveCashout);
    ui.cashoutBtn.textContent = liveCashout ? `Забрать ${formatInt(state.currentBet * state.currentMultiplier)}` : 'Забрать';
  }

  function normalizeBet(raw) {
    let value = Math.floor(toNum(raw, cfg.defaultBet));
    value = Math.round(value / 10) * 10;
    value = clamp(value, cfg.minBet, cfg.maxBet);
    if (value > state.balance) value = clamp(Math.floor(state.balance / 10) * 10, cfg.minBet, cfg.maxBet);
    state.currentBet = value;
    ui.betInput.value = String(value);
    updateButtons();
    saveState();
  }

  function rand(min, max) { return Number((Math.random() * (max - min) + min).toFixed(2)); }
  function generateCrashPoint() {
    const total = cfg.crashDistribution.reduce((s, band) => s + band.chance, 0);
    let roll = Math.random() * total;
    for (const band of cfg.crashDistribution) {
      roll -= band.chance;
      if (roll <= 0) return clamp(rand(band.min, band.max), 1, cfg.maxCrash);
    }
    return cfg.maxCrash;
  }

  function estimateRoundDuration(cp) {
    const normalized = (cp - 1) / (cfg.maxCrash - 1);
    return Math.round(cfg.minRoundDurationMs + normalized * (cfg.maxRoundDurationMs - cfg.minRoundDurationMs));
  }

  function resizeCanvas() {
    const rect = ui.trailCanvas.getBoundingClientRect();
    ui.trailCanvas.width = Math.max(1, Math.floor(rect.width * window.devicePixelRatio));
    ui.trailCanvas.height = Math.max(1, Math.floor(rect.height * window.devicePixelRatio));
    const ctx = ui.trailCanvas.getContext('2d');
    ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
  }

  function clearTrail() {
    const ctx = ui.trailCanvas.getContext('2d');
    const rect = ui.trailCanvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
    state.path = [];
  }

  function drawTrail() {
    const ctx = ui.trailCanvas.getContext('2d');
    const rect = ui.trailCanvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
    if (state.path.length < 2) return;

    const grad = ctx.createLinearGradient(0, rect.height, rect.width, 0);
    grad.addColorStop(0, '#ff7c1f');
    grad.addColorStop(0.25, '#ff4ce5');
    grad.addColorStop(0.55, '#ad79ff');
    grad.addColorStop(1, '#67f4ff');

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();
    state.path.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
    ctx.strokeStyle = 'rgba(255,135,58,.26)';
    ctx.lineWidth = 28;
    ctx.shadowBlur = 26;
    ctx.shadowColor = 'rgba(255,103,69,.55)';
    ctx.stroke();

    ctx.beginPath();
    state.path.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
    ctx.strokeStyle = grad;
    ctx.lineWidth = 14;
    ctx.shadowBlur = 14;
    ctx.shadowColor = 'rgba(255,78,227,.45)';
    ctx.stroke();

    ctx.beginPath();
    state.path.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
    ctx.strokeStyle = '#9bfbff';
    ctx.lineWidth = 4;
    ctx.shadowBlur = 8;
    ctx.shadowColor = 'rgba(103,244,255,.8)';
    ctx.stroke();

    state.path.forEach((p, i) => {
      if (i % 6 === 0) {
        ctx.fillStyle = i % 12 === 0 ? '#fff4bc' : '#ff7fde';
        ctx.beginPath();
        ctx.arc(p.x, p.y, i % 12 === 0 ? 2.4 : 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
    });

    ctx.restore();
  }

  function setPilotPosition(progress) {
    const rect = ui.scene.getBoundingClientRect();
    const x = 18 + progress * (rect.width - 130);
    const arc = Math.sin(progress * Math.PI * 0.94);
    const y = rect.height - 110 - arc * (rect.height * 0.56);
    state.pilotPoint = { x, y };
    ui.pilot.style.left = `${x}px`;
    ui.pilot.style.top = `${y}px`;
    ui.pilot.style.bottom = 'auto';
    ui.pilot.style.transform = `rotate(${14 - progress * 26}deg) scale(${0.95 + progress * 0.22})`;
    state.path.push({ x: x + 22, y: y + 82 });
    if (state.path.length > 100) state.path.shift();
  }

  function addSpark(x, y, dx, dy) {
    const spark = document.createElement('div');
    spark.className = 'spark';
    spark.style.left = `${x}px`;
    spark.style.top = `${y}px`;
    spark.style.setProperty('--dx', `${dx}px`);
    spark.style.setProperty('--dy', `${dy}px`);
    ui.sparkLayer.appendChild(spark);
    setTimeout(() => spark.remove(), 800);
  }

  function burstSparks(x, y) {
    for (let i = 0; i < 18; i++) {
      addSpark(x, y, rand(-70, 70), rand(-55, 45));
    }
  }

  function resetPilot() {
    ui.pilot.classList.remove('hidden');
    ui.pilot.style.left = '28px';
    ui.pilot.style.top = '';
    ui.pilot.style.bottom = '84px';
    ui.pilot.style.transform = 'rotate(0deg) scale(1)';
  }

  function animate(now) {
    const elapsed = now - state.startAt;
    const progress = clamp(elapsed / state.roundDuration, 0, 1);
    const eased = Math.pow(progress, 0.92);
    state.currentMultiplier = Number((1 + eased * (state.crashPoint - 1)).toFixed(2));
    ui.multiplier.textContent = `${state.currentMultiplier.toFixed(2)}x`;
    setPilotPosition(progress);
    drawTrail();
    if (Math.random() < 0.14) {
      addSpark(state.pilotPoint.x + 20, state.pilotPoint.y + 76, rand(-18, 16), rand(-8, 18));
    }
    updateButtons();
    if (elapsed >= state.roundDuration) {
      crashNow();
      return;
    }
    state.rafId = requestAnimationFrame(animate);
  }

  function startRound() {
    normalizeBet(ui.betInput.value);
    if (state.currentBet > state.balance) {
      ui.statusText.textContent = 'Недостаточно монет';
      updateButtons();
      return;
    }
    clearTimeout(state.resetTimer);
    cancelAnimationFrame(state.rafId);
    clearTrail();
    ui.explosion.classList.add('hidden');
    ui.explosion.classList.remove('active');
    state.balance -= state.currentBet;
    state.currentMultiplier = 1;
    state.crashPoint = generateCrashPoint();
    state.roundDuration = estimateRoundDuration(state.crashPoint);
    state.startAt = performance.now();
    state.gameState = 'running';
    ui.statusText.textContent = 'Лети и забирай вовремя';
    ui.multiplier.textContent = '1.00x';
    setBadge('running');
    updateBalanceUI();
    updateButtons();
    saveState();
    resetPilot();
    state.rafId = requestAnimationFrame(animate);
  }

  function finishRound(value) {
    state.history.unshift(Number(value.toFixed(2)));
    state.history = state.history.slice(0, cfg.historySize);
    renderHistory();
    saveState();
  }

  function cashout() {
    if (state.gameState !== 'running') return;
    cancelAnimationFrame(state.rafId);
    const payout = Math.floor(state.currentBet * state.currentMultiplier);
    state.balance += payout;
    state.gameState = 'idle';
    finishRound(state.currentMultiplier);
    ui.statusText.textContent = 'Успешный заборт';
    setBadge('idle');
    updateBalanceUI();
    updateButtons();
    saveState();
    state.resetTimer = setTimeout(() => {
      ui.multiplier.textContent = '1.00x';
      ui.statusText.textContent = 'Нажми «Старт»';
      clearTrail();
      resetPilot();
      drawTrail();
      updateButtons();
    }, cfg.postCashoutResetMs);
  }

  function crashNow() {
    cancelAnimationFrame(state.rafId);
    state.gameState = 'crash';
    ui.multiplier.textContent = `${state.crashPoint.toFixed(2)}x`;
    ui.statusText.textContent = ' '; // no crash hint text
    setBadge('crash');
    updateButtons();
    finishRound(state.crashPoint);

    const rect = ui.scene.getBoundingClientRect();
    const ex = clamp(state.pilotPoint.x + 58, 50, rect.width - 50);
    const ey = clamp(state.pilotPoint.y + 78, 40, rect.height - 30);
    ui.explosion.style.left = `${ex}px`;
    ui.explosion.style.top = `${ey}px`;
    ui.explosion.classList.remove('hidden');
    ui.explosion.classList.remove('active');
    void ui.explosion.offsetWidth;
    ui.explosion.classList.add('active');
    ui.pilot.classList.add('hidden');
    burstSparks(ex, ey);
    ui.scene.classList.add('scene-shake');
    setTimeout(() => ui.scene.classList.remove('scene-shake'), 240);

    state.resetTimer = setTimeout(() => {
      state.gameState = 'idle';
      ui.multiplier.textContent = '1.00x';
      ui.statusText.textContent = 'Нажми «Старт»';
      setBadge('idle');
      clearTrail();
      resetPilot();
      ui.explosion.classList.add('hidden');
      ui.explosion.classList.remove('active');
      updateButtons();
    }, cfg.postCrashResetMs);
  }

  function bindEvents() {
    ui.minusBtn.addEventListener('click', () => normalizeBet(state.currentBet - 50));
    ui.plusBtn.addEventListener('click', () => normalizeBet(state.currentBet + 50));
    ui.betInput.addEventListener('change', (e) => normalizeBet(e.target.value));
    ui.betInput.addEventListener('blur', (e) => normalizeBet(e.target.value));
    document.querySelectorAll('.preset-btn').forEach(btn => {
      btn.addEventListener('click', () => normalizeBet(btn.dataset.bet));
    });
    ui.startBtn.addEventListener('click', startRound);
    ui.cashoutBtn.addEventListener('click', cashout);
    window.addEventListener('resize', () => {
      resizeCanvas();
      drawTrail();
    });
  }

  function init() {
    loadState();
    updateBalanceUI();
    renderHistory();
    ui.betInput.value = String(state.currentBet);
    setBadge('idle');
    updateButtons();
    resizeCanvas();
    resetPilot();
    bindEvents();
  }

  init();
})();
