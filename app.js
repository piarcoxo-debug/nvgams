(() => {
  const cfg = window.NOVA_CONFIG;
  const tg = window.NovaTelegram ? window.NovaTelegram.init() : null;

  const ui = {
    balance: document.getElementById('balance'),
    multiplier: document.getElementById('multiplier'),
    statusText: document.getElementById('statusText'),
    historyList: document.getElementById('historyList'),
    badge: document.getElementById('gameStateBadge'),
    betInput: document.getElementById('betInput'),
    minusBtn: document.getElementById('minusBtn'),
    plusBtn: document.getElementById('plusBtn'),
    startBtn: document.getElementById('startBtn'),
    cashoutBtn: document.getElementById('cashoutBtn'),
    scene: document.querySelector('.scene-wrap'),
    pilot: document.getElementById('pilot'),
    trailCanvas: document.getElementById('trailCanvas'),
    sparkLayer: document.getElementById('sparkLayer'),
    explosion: document.getElementById('explosion')
  };

  const state = {
    balance: cfg.startBalance,
    currentBet: cfg.defaultBet,
    history: [],
    gameState: 'idle',
    currentMultiplier: 1,
    crashPoint: null,
    startAt: 0,
    lastFrame: 0,
    rafId: 0,
    path: [],
    cashedOut: false,
    roundDuration: 3000,
    pendingCrashTimeout: null,
    particlesTimer: null
  };

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function toNum(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

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
      state.history = Array.isArray(parsed.history) ? parsed.history.filter(v => Number.isFinite(v)).slice(0, cfg.historySize) : [];
    } catch (err) {
      console.warn('Bad saved data, reset to defaults');
      state.balance = cfg.startBalance;
      state.currentBet = cfg.defaultBet;
      state.history = [];
    }
    if (state.currentBet > state.balance && state.balance >= cfg.minBet) {
      state.currentBet = clamp(Math.floor(state.balance / 10) * 10 || cfg.minBet, cfg.minBet, cfg.maxBet);
    }
    if (state.balance < cfg.minBet) {
      state.balance = cfg.startBalance;
    }
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

  function setBadge(text, type) {
    ui.badge.textContent = text;
    ui.badge.className = 'badge';
    ui.badge.classList.add(type === 'running' ? 'badge-limit' : 'badge-idle');
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
      if (roll <= 0) {
        return clamp(rand(band.min, band.max), 1, cfg.maxCrash);
      }
    }
    return cfg.maxCrash;
  }

  function estimateRoundDuration(crashPoint) {
    const normalized = (crashPoint - 1) / (cfg.maxCrash - 1);
    const ms = cfg.minRoundDurationMs + normalized * (cfg.maxRoundDurationMs - cfg.minRoundDurationMs);
    return Math.round(ms);
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

    const gradient = ctx.createLinearGradient(0, rect.height, rect.width, 0);
    gradient.addColorStop(0, '#ff48d7');
    gradient.addColorStop(0.45, '#b06bff');
    gradient.addColorStop(1, '#64e6ff');

    ctx.strokeStyle = 'rgba(255, 72, 215, 0.25)';
    ctx.lineWidth = 18;
    ctx.beginPath();
    ctx.moveTo(state.path[0].x, state.path[0].y);
    for (const p of state.path.slice(1)) ctx.lineTo(p.x, p.y);
    ctx.stroke();

    ctx.strokeStyle = gradient;
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(state.path[0].x, state.path[0].y);
    for (const p of state.path.slice(1)) ctx.lineTo(p.x, p.y);
    ctx.stroke();

    state.path.forEach((p, index) => {
      if (index % 14 === 0) {
        ctx.fillStyle = '#fff1a6';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2.3, 0, Math.PI * 2);
        ctx.fill();
      }
    });

    if (state.path.length > 20) {
      const marks = [0.15, 0.35, 0.6, 0.8];
      marks.forEach(mark => {
        const idx = Math.min(state.path.length - 1, Math.floor(state.path.length * mark));
        const p = state.path[idx];
        const pseudo = (1 + (state.currentMultiplier - 1) * mark).toFixed(2);
        ctx.fillStyle = '#ffd7ff';
        ctx.font = '700 14px Inter';
        ctx.fillText(`${pseudo}x`, p.x + 8, p.y - 10);
      });
    }

    ctx.restore();
  }

  function setPilotPosition(progress, multiplier) {
    const rect = ui.scene.getBoundingClientRect();
    const x = 60 + progress * (rect.width - 180);
    const arc = Math.sin(progress * Math.PI * 0.92);
    const y = rect.height - 116 - arc * (rect.height * 0.58);
    ui.pilot.style.left = `${x}px`;
    ui.pilot.style.top = `${y}px`;
    const tilt = clamp(14 - progress * 42, -38, 14);
    const scale = 0.88 + progress * 0.22;
    ui.pilot.style.transform = `rotate(${tilt}deg) scale(${scale})`;

    state.path.push({ x: x + 36, y: y + 60 });
    if (state.path.length > 120) state.path.shift();

    if (multiplier > 8 && Math.random() < 0.15) addSpark(x + 24, y + 48);
  }

  function addSpark(x, y) {
    const spark = document.createElement('div');
    spark.className = 'spark';
    spark.style.left = `${x}px`;
    spark.style.top = `${y}px`;
    spark.style.setProperty('--dx', `${rand(-32, 32)}px`);
    spark.style.setProperty('--dy', `${rand(-18, 28)}px`);
    ui.sparkLayer.appendChild(spark);
    setTimeout(() => spark.remove(), 800);
  }

  function startRound() {
    normalizeBet(ui.betInput.value);
    if (state.currentBet > state.balance) {
      updateStatusText('Недостаточно монет для такой ставки.');
      updateButtons();
      return;
    }

    state.balance -= state.currentBet;
    state.currentMultiplier = 1;
    state.crashPoint = generateCrashPoint();
    state.roundDuration = estimateRoundDuration(state.crashPoint);
    state.gameState = 'running';
    state.cashedOut = false;
    state.startAt = performance.now();
    state.lastFrame = state.startAt;
    clearTimeout(state.pendingCrashTimeout);
    clearTrail();

    ui.multiplier.textContent = '1.00x';
    updateBalanceUI();
    updateStatusText(`Раунд запущен. Краш будет где-то до ${state.crashPoint.toFixed(2)}x`);
    setBadge('Полёт', 'running');
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
    setPilotPosition(progress, state.currentMultiplier);
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
    updateStatusText(`Успешно! Забрано ${formatInt(payout)} ${cfg.currencyName}.`);
    setBadge('Успех', 'idle');
    ui.pilot.className = 'pilot state-idle';
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
    updateStatusText(`Краш на ${state.currentMultiplier.toFixed(2)}x. Попробуй ещё раз.`);
    setBadge('Краш', 'idle');
    updateButtons();

    ui.pilot.className = 'pilot state-fall';
    const startLeft = parseFloat(ui.pilot.style.left || '80');
    const startTop = parseFloat(ui.pilot.style.top || '200');
    const fallTo = ui.scene.clientHeight - 130;
    const started = performance.now();

    const animateFall = (time) => {
      const p = clamp((time - started) / 650, 0, 1);
      ui.pilot.style.left = `${startLeft + p * 90}px`;
      ui.pilot.style.top = `${startTop + p * (fallTo - startTop)}px`;
      ui.pilot.style.transform = `rotate(${24 + p * 110}deg) scale(${1 - p * 0.1})`;
      if (p < 1) {
        requestAnimationFrame(animateFall);
      } else {
        doExplosion(startLeft + 110, fallTo + 28);
        state.gameState = 'idle';
        ui.pilot.className = 'pilot state-idle';
        ui.pilot.style.left = '84px';
        ui.pilot.style.top = '';
        ui.pilot.style.bottom = '92px';
        ui.pilot.style.transform = 'rotate(0deg) scale(1)';
        updateButtons();
        saveState();
      }
    };

    requestAnimationFrame(animateFall);
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

    for (let i = 0; i < 18; i++) addSpark(x, y);
    setTimeout(() => ui.explosion.classList.add('hidden'), 700);
  }

  function bindEvents() {
    ui.startBtn.addEventListener('click', startRound);
    ui.cashoutBtn.addEventListener('click', cashOut);
    ui.minusBtn.addEventListener('click', () => normalizeBet(state.currentBet - 50));
    ui.plusBtn.addEventListener('click', () => normalizeBet(state.currentBet + 50));
    ui.betInput.addEventListener('change', (e) => normalizeBet(e.target.value));
    document.querySelectorAll('.preset-btn').forEach(btn => {
      btn.addEventListener('click', () => normalizeBet(btn.dataset.bet));
    });
    window.addEventListener('resize', () => {
      resizeCanvas();
      drawTrail();
    });
  }

  function init() {
    loadState();
    if (state.currentBet > state.balance) state.currentBet = Math.min(cfg.defaultBet, state.balance);
    if (state.currentBet < cfg.minBet) state.currentBet = cfg.minBet;
    updateBalanceUI();
    updateBetUI();
    renderHistory();
    updateButtons();
    resizeCanvas();
    clearTrail();
    updateStatusText('Нажми «Старт», чтобы начать раунд');
    setBadge('Ожидание', 'idle');
    bindEvents();
  }

  init();
})();
