(() => {
  const cfg = window.NOVA_CONFIG;
  const ui = {
    multiplier: document.getElementById('multiplier'),
    statusText: document.getElementById('statusText'),
    balance: document.getElementById('balance'),
    historyList: document.getElementById('historyList'),
    badge: document.getElementById('gameStateBadge'),
    betInput: document.getElementById('betInput'),
    minusBtn: document.getElementById('minusBtn'),
    plusBtn: document.getElementById('plusBtn'),
    startBtn: document.getElementById('startBtn'),
    cashoutBtn: document.getElementById('cashoutBtn'),
    scene: document.getElementById('sceneWrap'),
    pilot: document.getElementById('pilot'),
    trailCanvas: document.getElementById('trailCanvas'),
    sparkLayer: document.getElementById('sparkLayer'),
    explosion: document.getElementById('explosion')
  };

  const state = {
    balance: cfg.startBalance,
    currentBet: cfg.defaultBet,
    currentMultiplier: 1,
    history: [],
    gameState: 'idle',
    crashPoint: 1.3,
    startAt: 0,
    roundDuration: 2500,
    rafId: 0,
    resetTimer: 0,
    path: [],
    pilotPoint: { x: 40, y: 200 },
    crashPointXY: null,
    fallStartAt: 0,
    fallFrom: null,
    fallTo: null
  };

  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
  const toNum = (v, fallback) => Number.isFinite(Number(v)) ? Number(v) : fallback;
  const rand = (min, max) => Number((Math.random() * (max - min) + min).toFixed(2));

  function formatInt(v) {
    return new Intl.NumberFormat('ru-RU').format(Math.floor(v));
  }
  function formatBalance(v) {
    return `${formatInt(v)} ${cfg.currencyName}`;
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
    } catch {}
    if (state.currentBet > state.balance) state.currentBet = clamp(Math.floor(state.balance / 10) * 10, cfg.minBet, cfg.maxBet);
  }

  function updateBalanceUI() {
    ui.balance.textContent = formatBalance(state.balance);
  }

  function renderHistory() {
    ui.historyList.innerHTML = '';
    if (!state.history.length) {
      const item = document.createElement('div');
      item.className = 'history-item';
      item.textContent = '—';
      ui.historyList.appendChild(item);
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
    ui.badge.className = 'chip';
    if (mode === 'running' || mode === 'falling') {
      ui.badge.textContent = 'Полёт';
      ui.badge.classList.add('chip-running');
    } else if (mode === 'crash') {
      ui.badge.textContent = 'Краш';
      ui.badge.classList.add('chip-crash');
    } else {
      ui.badge.textContent = 'Ожидание';
      ui.badge.classList.add('chip-idle');
    }
  }

  function updateButtons() {
    const canStart = state.gameState === 'idle' && state.currentBet >= cfg.minBet && state.currentBet <= state.balance;
    ui.startBtn.disabled = !canStart;
    const canCashout = state.gameState === 'running';
    ui.cashoutBtn.disabled = !canCashout;
    ui.cashoutBtn.classList.toggle('cashout-live', canCashout);
    ui.cashoutBtn.textContent = canCashout ? `Забрать ${formatInt(state.currentBet * state.currentMultiplier)}` : 'Забрать';
  }

  function normalizeBet(value) {
    let v = Math.floor(toNum(value, cfg.defaultBet));
    v = Math.round(v / 10) * 10;
    v = clamp(v, cfg.minBet, cfg.maxBet);
    if (v > state.balance) v = clamp(Math.floor(state.balance / 10) * 10, cfg.minBet, cfg.maxBet);
    state.currentBet = v;
    ui.betInput.value = String(v);
    updateButtons();
    saveState();
  }

  function generateCrashPoint() {
    const total = cfg.crashDistribution.reduce((acc, x) => acc + x.chance, 0);
    let roll = Math.random() * total;
    for (const band of cfg.crashDistribution) {
      roll -= band.chance;
      if (roll <= 0) return clamp(rand(band.min, band.max), 1, cfg.maxCrash);
    }
    return cfg.maxCrash;
  }

  function estimateRoundDuration(cp) {
    const n = (cp - 1) / (cfg.maxCrash - 1);
    return Math.round(cfg.minRoundDurationMs + n * (cfg.maxRoundDurationMs - cfg.minRoundDurationMs));
  }

  function resizeCanvas() {
    const rect = ui.trailCanvas.getBoundingClientRect();
    ui.trailCanvas.width = Math.max(1, Math.floor(rect.width * devicePixelRatio));
    ui.trailCanvas.height = Math.max(1, Math.floor(rect.height * devicePixelRatio));
    const ctx = ui.trailCanvas.getContext('2d');
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  }

  function clearTrail() {
    state.path = [];
    const ctx = ui.trailCanvas.getContext('2d');
    const rect = ui.trailCanvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
  }

  function drawTrail() {
    const ctx = ui.trailCanvas.getContext('2d');
    const rect = ui.trailCanvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
    if (state.path.length < 2) return;

    const grad = ctx.createLinearGradient(0, rect.height, rect.width, 0);
    grad.addColorStop(0, '#6cf5ff');
    grad.addColorStop(.25, '#7f85ff');
    grad.addColorStop(.55, '#ff52e3');
    grad.addColorStop(1, '#ffb439');

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const drawPath = () => {
      ctx.beginPath();
      state.path.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
    };

    drawPath();
    ctx.strokeStyle = 'rgba(120,100,255,.18)';
    ctx.lineWidth = 24;
    ctx.shadowBlur = 30;
    ctx.shadowColor = 'rgba(154,107,255,.42)';
    ctx.stroke();

    drawPath();
    ctx.strokeStyle = grad;
    ctx.lineWidth = 11;
    ctx.shadowBlur = 18;
    ctx.shadowColor = 'rgba(255,82,227,.26)';
    ctx.stroke();

    drawPath();
    ctx.strokeStyle = '#bffcff';
    ctx.lineWidth = 2.6;
    ctx.shadowBlur = 8;
    ctx.shadowColor = 'rgba(108,245,255,.8)';
    ctx.stroke();

    state.path.forEach((p, i) => {
      if (i % 7 === 0) {
        ctx.beginPath();
        ctx.fillStyle = i % 14 === 0 ? '#fff0a7' : '#ff8fe9';
        ctx.arc(p.x, p.y, i % 14 === 0 ? 2.4 : 1.7, 0, Math.PI * 2);
        ctx.fill();
      }
    });

    ctx.restore();
  }

  function getFlightXY(progress) {
    const rect = ui.scene.getBoundingClientRect();
    const left = 12;
    const right = rect.width - 150;
    const startY = rect.height - 132;
    const amp = rect.height * 0.60;
    const x = left + progress * (right - left);
    const y = startY - Math.sin(progress * Math.PI * 0.92) * amp;
    return { x, y };
  }

  function placePilot(x, y, angle, scale = 1) {
    state.pilotPoint = { x, y };
    ui.pilot.style.left = `${x}px`;
    ui.pilot.style.top = `${y}px`;
    ui.pilot.style.transform = `rotate(${angle}deg) scale(${scale})`;
  }

  function updateFlight(progress) {
    const p = getFlightXY(progress);
    const angle = 16 - progress * 26;
    const scale = .9 + progress * .18;
    placePilot(p.x, p.y, angle, scale);
    state.path.push({ x: p.x + 16, y: p.y + 80 });
    if (state.path.length > 110) state.path.shift();
  }

  function addSpark(x, y, dx, dy) {
    const el = document.createElement('div');
    el.className = 'spark';
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.setProperty('--dx', `${dx}px`);
    el.style.setProperty('--dy', `${dy}px`);
    ui.sparkLayer.appendChild(el);
    setTimeout(() => el.remove(), 700);
  }

  function burstSparks(x, y, count = 18) {
    for (let i = 0; i < count; i++) {
      addSpark(x, y, rand(-80, 80), rand(-55, 45));
    }
  }

  function animateFlight(now) {
    const elapsed = now - state.startAt;
    const progress = clamp(elapsed / state.roundDuration, 0, 1);
    const eased = Math.pow(progress, 0.92);
    state.currentMultiplier = Number((1 + eased * (state.crashPoint - 1)).toFixed(2));
    ui.multiplier.textContent = `${state.currentMultiplier.toFixed(2)}x`;
    updateFlight(progress);
    drawTrail();
    if (Math.random() < 0.15) addSpark(state.pilotPoint.x + 16, state.pilotPoint.y + 76, rand(-12, 16), rand(-4, 16));
    updateButtons();
    if (elapsed >= state.roundDuration) {
      startFall();
      return;
    }
    state.rafId = requestAnimationFrame(animateFlight);
  }

  function animateFall(now) {
    const t = clamp((now - state.fallStartAt) / cfg.fallDurationMs, 0, 1);
    const ease = t * t;
    const x = state.fallFrom.x + (state.fallTo.x - state.fallFrom.x) * t;
    const y = state.fallFrom.y + (state.fallTo.y - state.fallFrom.y) * ease;
    const angle = 6 + t * 92;
    placePilot(x, y, angle, 1.04 - t * .12);
    if (t >= 1) {
      explodeNow();
      return;
    }
    state.rafId = requestAnimationFrame(animateFall);
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
    ui.pilot.classList.remove('hidden');

    state.balance -= state.currentBet;
    state.currentMultiplier = 1;
    state.crashPoint = generateCrashPoint();
    state.roundDuration = estimateRoundDuration(state.crashPoint);
    state.startAt = performance.now();
    state.gameState = 'running';
    ui.multiplier.textContent = '1.00x';
    ui.statusText.textContent = ' ';
    setBadge('running');
    updateBalanceUI();
    updateButtons();
    saveState();

    updateFlight(0);
    drawTrail();
    state.rafId = requestAnimationFrame(animateFlight);
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
    setBadge('idle');
    ui.statusText.textContent = ' ';
    updateBalanceUI();
    updateButtons();
    saveState();
    state.resetTimer = setTimeout(resetIdleView, cfg.postCashoutResetMs);
  }

  function startFall() {
    cancelAnimationFrame(state.rafId);
    state.gameState = 'falling';
    state.currentMultiplier = state.crashPoint;
    ui.multiplier.textContent = `${state.crashPoint.toFixed(2)}x`;
    ui.statusText.textContent = ' ';
    setBadge('crash');
    updateButtons();
    finishRound(state.crashPoint);

    const rect = ui.scene.getBoundingClientRect();
    state.fallStartAt = performance.now();
    state.fallFrom = { x: state.pilotPoint.x, y: state.pilotPoint.y };
    state.fallTo = {
      x: clamp(state.pilotPoint.x + 62, 22, rect.width - 120),
      y: rect.height - 118
    };
    state.crashPointXY = { x: state.fallTo.x + 46, y: rect.height - 56 };
    state.rafId = requestAnimationFrame(animateFall);
  }

  function explodeNow() {
    cancelAnimationFrame(state.rafId);
    state.gameState = 'crash';
    ui.pilot.classList.add('hidden');
    const { x, y } = state.crashPointXY;
    ui.explosion.style.left = `${x}px`;
    ui.explosion.style.top = `${y}px`;
    ui.explosion.classList.remove('hidden');
    ui.explosion.classList.remove('active');
    void ui.explosion.offsetWidth;
    ui.explosion.classList.add('active');
    burstSparks(x, y, 22);
    ui.scene.classList.add('scene-shake');
    setTimeout(() => ui.scene.classList.remove('scene-shake'), 180);
    state.resetTimer = setTimeout(resetIdleView, cfg.postCrashResetMs);
  }

  function resetIdleView() {
    state.gameState = 'idle';
    state.currentMultiplier = 1;
    ui.multiplier.textContent = '1.00x';
    ui.statusText.textContent = 'Нажми «Старт»';
    setBadge('idle');
    clearTrail();
    ui.explosion.classList.add('hidden');
    ui.explosion.classList.remove('active');
    const p = getFlightXY(0);
    placePilot(p.x, p.y, 0, .94);
    ui.pilot.classList.remove('hidden');
    updateButtons();
  }

  function bindEvents() {
    ui.minusBtn.addEventListener('click', () => normalizeBet(state.currentBet - 50));
    ui.plusBtn.addEventListener('click', () => normalizeBet(state.currentBet + 50));
    ui.betInput.addEventListener('change', e => normalizeBet(e.target.value));
    ui.betInput.addEventListener('blur', e => normalizeBet(e.target.value));
    document.querySelectorAll('.preset-btn').forEach(btn => btn.addEventListener('click', () => normalizeBet(btn.dataset.bet)));
    ui.startBtn.addEventListener('click', startRound);
    ui.cashoutBtn.addEventListener('click', cashout);
    window.addEventListener('resize', () => {
      resizeCanvas();
      if (state.gameState === 'idle') {
        const p = getFlightXY(0);
        placePilot(p.x, p.y, 0, .94);
      }
      drawTrail();
    });
  }

  function init() {
    loadState();
    updateBalanceUI();
    renderHistory();
    ui.betInput.value = String(state.currentBet);
    resizeCanvas();
    const p = getFlightXY(0);
    placePilot(p.x, p.y, 0, .94);
    setBadge('idle');
    updateButtons();
    bindEvents();
  }

  init();
})();
