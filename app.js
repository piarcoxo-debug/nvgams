
(() => {
  const cfg = window.NOVA_CONFIG;
  const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
  if (tg) {
    tg.ready();
    tg.expand();
  }

  const ui = {
    badge: document.getElementById('gameStateBadge'),
    multiplier: document.getElementById('multiplier'),
    statusText: document.getElementById('statusText'),
    balance: document.getElementById('balance'),
    historyList: document.getElementById('historyList'),
    scene: document.getElementById('sceneWrap'),
    pilot: document.getElementById('pilot'),
    trailCanvas: document.getElementById('trailCanvas'),
    sparkLayer: document.getElementById('sparkLayer'),
    explosion: document.getElementById('explosion'),
    betInput: document.getElementById('betInput'),
    minusBtn: document.getElementById('minusBtn'),
    plusBtn: document.getElementById('plusBtn'),
    startBtn: document.getElementById('startBtn'),
    cashoutBtn: document.getElementById('cashoutBtn')
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
    cashedOut: false,
    resetTimer: 0
  };

  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
  const toNum = (value, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  };

  function saveState() {
    try {
      localStorage.setItem(cfg.storageKey, JSON.stringify({
        balance: state.balance,
        currentBet: state.currentBet,
        history: state.history
      }));
    } catch (err) {
      console.warn('Cannot save state', err);
    }
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(cfg.storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      state.balance = clamp(Math.floor(toNum(parsed.balance, cfg.startBalance)), 0, 10_000_000);
      state.currentBet = clamp(Math.floor(toNum(parsed.currentBet, cfg.defaultBet)), cfg.minBet, cfg.maxBet);
      state.history = Array.isArray(parsed.history)
        ? parsed.history.filter(v => Number.isFinite(v)).slice(0, cfg.historySize)
        : [];
    } catch (err) {
      state.balance = cfg.startBalance;
      state.currentBet = cfg.defaultBet;
      state.history = [];
    }
    if (state.balance < cfg.minBet) state.balance = cfg.startBalance;
    if (state.currentBet > state.balance) state.currentBet = Math.min(cfg.defaultBet, state.balance);
    if (state.currentBet < cfg.minBet) state.currentBet = cfg.minBet;
  }

  function formatInt(value) {
    return new Intl.NumberFormat('ru-RU').format(Math.floor(value));
  }

  function updateBalanceUI() {
    ui.balance.textContent = `${formatInt(state.balance)} ${cfg.currencyName}`;
  }

  function renderHistory() {
    ui.historyList.innerHTML = '';
    if (!state.history.length) {
      const empty = document.createElement('div');
      empty.className = 'history-item';
      empty.textContent = '—';
      ui.historyList.appendChild(empty);
      return;
    }
    state.history.forEach(item => {
      const el = document.createElement('div');
      el.className = 'history-item ' + (item < 2 ? 'history-low' : item < 5 ? 'history-mid' : 'history-high');
      el.textContent = `${item.toFixed(2)}x`;
      ui.historyList.appendChild(el);
    });
  }

  function updateBetUI() {
    ui.betInput.value = String(state.currentBet);
  }

  function setBadge(text, running) {
    ui.badge.textContent = text;
    ui.badge.className = 'badge';
    ui.badge.classList.add(running ? 'badge-limit' : 'badge-idle');
  }

  function updateButtons() {
    const canStart = state.gameState === 'idle' && state.currentBet >= cfg.minBet && state.currentBet <= state.balance;
    ui.startBtn.disabled = !canStart;
    ui.cashoutBtn.disabled = state.gameState !== 'running' || state.cashedOut;
    ui.cashoutBtn.classList.toggle('cashout-live', state.gameState === 'running' && !state.cashedOut);

    if (state.gameState === 'running' && !state.cashedOut) {
      ui.cashoutBtn.textContent = `Забрать ${formatInt(state.currentBet * state.currentMultiplier)}`;
    } else {
      ui.cashoutBtn.textContent = 'Забрать';
    }
  }

  function updateStatusText(text) {
    ui.statusText.textContent = text;
  }

  function normalizeBet(raw) {
    let value = Math.floor(toNum(raw, cfg.defaultBet));
    if (!Number.isFinite(value)) value = cfg.defaultBet;
    value = Math.round(value / 10) * 10;
    value = clamp(value, cfg.minBet, cfg.maxBet);
    if (value > state.balance) value = state.balance >= cfg.minBet ? clamp(Math.floor(state.balance / 10) * 10, cfg.minBet, cfg.maxBet) : cfg.minBet;
    if (!Number.isFinite(value) || value < cfg.minBet) value = cfg.minBet;
    state.currentBet = value;
    updateBetUI();
    updateButtons();
    saveState();
  }

  function rand(min, max) {
    return Number((Math.random() * (max - min) + min).toFixed(2));
  }

  function generateCrashPoint() {
    const totalChance = cfg.crashDistribution.reduce((sum, item) => sum + item.chance, 0);
    let roll = Math.random() * totalChance;
    for (const band of cfg.crashDistribution) {
      roll -= band.chance;
      if (roll <= 0) return clamp(rand(band.min, band.max), 1, cfg.maxCrash);
    }
    return cfg.maxCrash;
  }

  function estimateRoundDuration(crashPoint) {
    const normalized = (crashPoint - 1) / (cfg.maxCrash - 1);
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

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const glow = ctx.createLinearGradient(0, rect.height, rect.width, 0);
    glow.addColorStop(0, '#ff48d7');
    glow.addColorStop(0.45, '#b06bff');
    glow.addColorStop(1, '#64e6ff');

    ctx.strokeStyle = 'rgba(255, 72, 215, 0.22)';
    ctx.lineWidth = 14;
    ctx.beginPath();
    ctx.moveTo(state.path[0].x, state.path[0].y);
    for (const p of state.path.slice(1)) ctx.lineTo(p.x, p.y);
    ctx.stroke();

    ctx.strokeStyle = glow;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(state.path[0].x, state.path[0].y);
    for (const p of state.path.slice(1)) ctx.lineTo(p.x, p.y);
    ctx.stroke();

    state.path.forEach((p, index) => {
      if (index % 12 === 0) {
        ctx.fillStyle = '#fff1a6';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    ctx.restore();
  }

  function setPilotPosition(progress) {
    const rect = ui.scene.getBoundingClientRect();
    const x = 18 + progress * (rect.width - 110);
    const arc = Math.sin(progress * Math.PI * 0.9);
    const y = rect.height - 78 - arc * (rect.height * 0.58);
    ui.pilot.style.left = `${x}px`;
    ui.pilot.style.top = `${y}px`;
    ui.pilot.style.bottom = 'auto';
    const tilt = clamp(18 - progress * 34, -24, 18);
    const scale = 0.95 + progress * 0.14;
    ui.pilot.style.transform = `rotate(${tilt}deg) scale(${scale})`;
    state.path.push({ x: x + 30, y: y + 44 });
    if (state.path.length > 90) state.path.shift();
    if (state.currentMultiplier > 7 && Math.random() < 0.14) addSpark(x + 26, y + 42);
  }

  function addSpark(x, y) {
    const spark = document.createElement('div');
    spark.className = 'spark';
    spark.style.left = `${x}px`;
    spark.style.top = `${y}px`;
    spark.style.setProperty('--dx', `${rand(-24, 24)}px`);
    spark.style.setProperty('--dy', `${rand(-16, 20)}px`);
    ui.sparkLayer.appendChild(spark);
    setTimeout(() => spark.remove(), 800);
  }

  function resetPilotToIdle() {
    ui.pilot.className = 'pilot state-idle';
    ui.pilot.style.left = '24px';
    ui.pilot.style.top = '';
    ui.pilot.style.bottom = '72px';
    ui.pilot.style.transform = 'rotate(0deg) scale(1)';
  }

  function startRound() {
    normalizeBet(ui.betInput.value);
    if (state.currentBet > state.balance) {
      updateStatusText('Недостаточно монет');
      updateButtons();
      return;
    }

    clearTimeout(state.resetTimer);
    state.balance -= state.currentBet;
    state.currentMultiplier = 1;
    state.crashPoint = generateCrashPoint();
    state.roundDuration = estimateRoundDuration(state.crashPoint);
    state.gameState = 'running';
    state.cashedOut = false;
    state.startAt = performance.now();
    clearTrail();

    ui.multiplier.textContent = '1.00x';
    updateBalanceUI();
    updateStatusText('');
    setBadge('Полёт', true);
    ui.pilot.className = 'pilot state-fly';
    ui.explosion.classList.add('hidden');
    updateButtons();
    saveState();

    cancelAnimationFrame(state.rafId);
    state.rafId = requestAnimationFrame(tick);
  }

  function tick(now) {
    if (state.gameState !== 'running') return;
    const elapsed = now - state.startAt;
    const progress = clamp(elapsed / state.roundDuration, 0, 1);
    const targetMultiplier = 1 + (state.crashPoint - 1) * (1 - Math.pow(1 - progress, cfg.multiplierGrowth));
    state.currentMultiplier = clamp(targetMultiplier, 1, state.crashPoint);

    ui.multiplier.textContent = `${state.currentMultiplier.toFixed(2)}x`;
    updateButtons();
    setPilotPosition(progress);
    drawTrail();

    if (state.currentMultiplier >= state.crashPoint - 0.005 || progress >= 1) {
      crashRound();
      return;
    }

    state.rafId = requestAnimationFrame(tick);
  }

  function cashOut() {
    if (state.gameState !== 'running' || state.cashedOut) return;
    state.cashedOut = true;
    cancelAnimationFrame(state.rafId);
    const payout = Math.floor(state.currentBet * state.currentMultiplier);
    state.balance += payout;
    state.history.unshift(Number(state.currentMultiplier.toFixed(2)));
    state.history = state.history.slice(0, cfg.historySize);
    state.gameState = 'idle';
    updateBalanceUI();
    renderHistory();
    updateStatusText(`Забрано ${formatInt(payout)}`);
    setBadge('Успех', false);
    resetPilotToIdle();
    updateButtons();
    saveState();
    tg && tg.HapticFeedback && tg.HapticFeedback.notificationOccurred('success');
  }

  function crashRound() {
    if (state.gameState !== 'running') return;
    cancelAnimationFrame(state.rafId);
    state.currentMultiplier = Number(state.crashPoint.toFixed(2));
    ui.multiplier.textContent = `${state.currentMultiplier.toFixed(2)}x`;
    state.history.unshift(state.currentMultiplier);
    state.history = state.history.slice(0, cfg.historySize);
    renderHistory();
    updateStatusText('');
    setBadge('Краш', false);
    updateButtons();

    ui.pilot.className = 'pilot state-fall';
    const left = parseFloat(ui.pilot.style.left || '24');
    const top = parseFloat(ui.pilot.style.top || '160');
    ui.pilot.style.left = `${left + 40}px`;
    ui.pilot.style.top = `${Math.min(ui.scene.clientHeight - 90, top + 90)}px`;
    ui.pilot.style.transform = 'rotate(96deg) scale(.92)';

    state.gameState = 'idle';
    setTimeout(() => doExplosion(left + 58, Math.min(ui.scene.clientHeight - 48, top + 108)), 70);
    state.resetTimer = setTimeout(() => {
      resetPilotToIdle();
      updateButtons();
      saveState();
    }, 420);

    tg && tg.HapticFeedback && tg.HapticFeedback.notificationOccurred('error');
  }

  function doExplosion(x, y) {
    ui.scene.classList.remove('scene-shake');
    void ui.scene.offsetWidth;
    ui.scene.classList.add('scene-shake');

    ui.explosion.classList.remove('hidden');
    ui.explosion.classList.remove('active');
    ui.explosion.style.left = `${x}px`;
    ui.explosion.style.top = `${y}px`;
    void ui.explosion.offsetWidth;
    ui.explosion.classList.add('active');

    for (let i = 0; i < 22; i++) addSpark(x, y);
    setTimeout(() => ui.explosion.classList.add('hidden'), 680);
  }

  function bindEvents() {
    ui.startBtn.addEventListener('click', startRound);
    ui.cashoutBtn.addEventListener('click', cashOut);
    ui.minusBtn.addEventListener('click', () => normalizeBet(state.currentBet - 50));
    ui.plusBtn.addEventListener('click', () => normalizeBet(state.currentBet + 50));
    ui.betInput.addEventListener('change', (e) => normalizeBet(e.target.value));
    document.querySelectorAll('.preset-btn').forEach(btn => btn.addEventListener('click', () => normalizeBet(btn.dataset.bet)));
    window.addEventListener('resize', () => {
      resizeCanvas();
      drawTrail();
    });
  }

  function init() {
    loadState();
    updateBalanceUI();
    updateBetUI();
    renderHistory();
    updateButtons();
    resizeCanvas();
    clearTrail();
    updateStatusText('Нажми «Старт»');
    setBadge('Ожидание', false);
    resetPilotToIdle();
    bindEvents();
  }

  init();
})();
