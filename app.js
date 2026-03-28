(() => {
  const CFG = window.NovaRushConfig;
  const storeKey = `novarush:${CFG.cacheVersion}`;
  const els = {
    balanceValue: document.getElementById('balanceValue'),
    historyStrip: document.getElementById('historyStrip'),
    multiplierValue: document.getElementById('multiplierValue'),
    betInput: document.getElementById('betInput'),
    quickButtons: document.getElementById('quickButtons'),
    startBtn: document.getElementById('startBtn'),
    cashoutBtn: document.getElementById('cashoutBtn'),
    stage: document.getElementById('stage'),
    pilot: document.getElementById('pilot'),
    explosion: document.getElementById('explosion'),
    trailCanvas: document.getElementById('trailCanvas')
  };

  const state = loadState();
  state.mode = 'idle';
  state.multiplier = 1;
  state.crashPoint = null;
  state.startTime = 0;
  state.animFrame = 0;
  state.currentPos = { x: 56, y: 0 };
  state.explosionAt = null;

  const ctx = els.trailCanvas.getContext('2d');
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  renderQuickButtons();
  normalizeBet();
  renderAll();
  positionPilot(0, 0);
  drawTrail(0);

  document.querySelectorAll('[data-delta]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (state.mode !== 'idle') return;
      state.bet = clampBet((Number(state.bet) || CFG.defaultBet) + Number(btn.dataset.delta));
      normalizeBet();
      renderAll();
    });
  });

  els.betInput.addEventListener('change', () => {
    state.bet = clampBet(Number(els.betInput.value || CFG.defaultBet));
    normalizeBet();
    renderAll();
  });

  els.startBtn.addEventListener('click', startRound);
  els.cashoutBtn.addEventListener('click', cashout);

  function loadState() {
    try {
      const raw = JSON.parse(localStorage.getItem(storeKey) || '{}');
      return {
        balance: Number.isFinite(raw.balance) ? raw.balance : CFG.startBalance,
        bet: Number.isFinite(raw.bet) ? raw.bet : CFG.defaultBet,
        history: Array.isArray(raw.history) ? raw.history.slice(0, CFG.historySize) : []
      };
    } catch {
      return { balance: CFG.startBalance, bet: CFG.defaultBet, history: [] };
    }
  }

  function saveState() {
    localStorage.setItem(storeKey, JSON.stringify({
      balance: state.balance,
      bet: state.bet,
      history: state.history
    }));
  }

  function formatBalance(v) {
    return `${new Intl.NumberFormat('ru-RU').format(Math.max(0, Math.floor(v)))} ${CFG.currencyName}`;
  }

  function clampBet(v) {
    if (!Number.isFinite(v)) return CFG.defaultBet;
    return Math.max(50, Math.min(1000000, Math.round(v / 50) * 50));
  }

  function normalizeBet() {
    state.bet = clampBet(state.bet);
    if (state.bet > state.balance && state.balance >= 50) {
      state.bet = clampBet(Math.floor(state.balance / 50) * 50);
    }
    if (state.balance < 50) {
      state.balance = CFG.startBalance;
    }
    els.betInput.value = state.bet;
    saveState();
  }

  function renderQuickButtons() {
    els.quickButtons.innerHTML = '';
    CFG.quickBets.forEach(v => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'quick-btn';
      b.textContent = new Intl.NumberFormat('ru-RU').format(v);
      b.addEventListener('click', () => {
        if (state.mode !== 'idle') return;
        state.bet = clampBet(v);
        normalizeBet();
        renderAll();
      });
      els.quickButtons.appendChild(b);
    });
  }

  function renderHistory() {
    els.historyStrip.innerHTML = '';
    const items = state.history.length ? state.history : [1.45, 2.36, 8.72, 1.12, 6.51];
    items.slice(0, CFG.historySize).forEach(v => {
      const chip = document.createElement('div');
      chip.className = `history-chip ${v >= 10 ? 'high' : v >= 2 ? 'mid' : 'low'}`;
      chip.textContent = `${Number(v).toFixed(2)}x`;
      els.historyStrip.appendChild(chip);
    });
  }

  function renderAll() {
    els.balanceValue.textContent = formatBalance(state.balance);
    els.multiplierValue.textContent = `${state.multiplier.toFixed(2)}x`;
    els.startBtn.disabled = !(state.mode === 'idle' && state.balance >= state.bet && state.bet >= 50);
    if (state.mode === 'running') {
      els.cashoutBtn.disabled = false;
      els.cashoutBtn.textContent = `ЗАБРАТЬ ${new Intl.NumberFormat('ru-RU').format(Math.floor(state.bet * state.multiplier))}`;
    } else {
      els.cashoutBtn.disabled = true;
      els.cashoutBtn.textContent = 'ЗАБРАТЬ';
    }
    renderHistory();
  }

  function resizeCanvas() {
    const rect = els.stage.getBoundingClientRect();
    els.trailCanvas.width = rect.width * devicePixelRatio;
    els.trailCanvas.height = rect.height * devicePixelRatio;
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  }

  function pointAt(progress) {
    const rect = els.stage.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    const start = { x: 18, y: h - 165 };
    const c1 = { x: w * 0.28, y: h - 168 };
    const c2 = { x: w * 0.64, y: h - 275 };
    const end = { x: w - 92, y: 182 };
    const t = Math.max(0, Math.min(1, progress));
    const mt = 1 - t;
    return {
      x: mt * mt * mt * start.x + 3 * mt * mt * t * c1.x + 3 * mt * t * t * c2.x + t * t * t * end.x,
      y: mt * mt * mt * start.y + 3 * mt * mt * t * c1.y + 3 * mt * t * t * c2.y + t * t * t * end.y
    };
  }

  function tangentAngle(progress) {
    const a = pointAt(Math.max(0, progress - 0.01));
    const b = pointAt(Math.min(1, progress + 0.01));
    return Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
  }

  function positionPilot(progress, angle) {
    const p = pointAt(progress);
    state.currentPos = p;
    els.pilot.style.left = `${p.x - 36}px`;
    els.pilot.style.top = `${p.y - 28}px`;
    els.pilot.style.transform = `rotate(${angle}deg)`;
  }

  function drawTrail(progress) {
    const rect = els.stage.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
    const p0 = pointAt(0);
    const p1 = pointAt(Math.min(1, progress * 0.45 + 0.08));
    const p2 = pointAt(Math.min(1, progress * 0.8 + 0.12));
    const p3 = pointAt(progress);

    ctx.save();
    ctx.lineCap = 'round';

    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.bezierCurveTo(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
    ctx.strokeStyle = 'rgba(82,235,255,0.18)';
    ctx.lineWidth = 14;
    ctx.shadowBlur = 22;
    ctx.shadowColor = 'rgba(89,228,255,0.55)';
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.bezierCurveTo(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
    ctx.strokeStyle = '#8d67ff';
    ctx.lineWidth = 2;
    ctx.shadowBlur = 8;
    ctx.shadowColor = 'rgba(141,103,255,0.8)';
    ctx.stroke();

    for (let i = 0; i < 26; i++) {
      const t = progress * (i / 25);
      const p = pointAt(t);
      const size = 1.2 + (i % 4 === 0 ? 1.2 : 0);
      ctx.fillStyle = i % 3 === 0 ? 'rgba(255,147,223,0.9)' : 'rgba(114,228,255,0.85)';
      ctx.beginPath();
      ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function crashPoint() {
    const total = CFG.crashRanges.reduce((s, r) => s + r.weight, 0);
    let roll = Math.random() * total;
    for (const r of CFG.crashRanges) {
      roll -= r.weight;
      if (roll <= 0) return Number((Math.random() * (r.max - r.min) + r.min).toFixed(2));
    }
    return 1.25;
  }

  function startRound() {
    if (state.mode !== 'idle') return;
    normalizeBet();
    if (state.balance < state.bet || state.bet < 50) return;
    state.balance -= state.bet;
    state.mode = 'running';
    state.multiplier = 1;
    state.crashPoint = crashPoint();
    state.startTime = performance.now();
    els.explosion.classList.add('hidden');
    els.pilot.classList.remove('hidden');
    cancelAnimationFrame(state.animFrame);
    renderAll();
    tick();
  }

  function cashout() {
    if (state.mode !== 'running') return;
    const payout = Math.floor(state.bet * state.multiplier);
    state.balance += payout;
    state.history.unshift(state.multiplier);
    state.history = state.history.slice(0, CFG.historySize);
    state.mode = 'idle';
    saveState();
    renderAll();
  }

  function triggerCrash() {
    state.mode = 'crashed';
    state.history.unshift(state.crashPoint);
    state.history = state.history.slice(0, CFG.historySize);
    state.multiplier = state.crashPoint;
    state.explosionAt = { ...state.currentPos };
    els.explosion.style.left = `${state.explosionAt.x + 8}px`;
    els.explosion.style.top = `${state.explosionAt.y + 18}px`;
    els.explosion.classList.remove('hidden');
    els.pilot.classList.add('hidden');
    saveState();
    renderAll();
    setTimeout(() => {
      els.explosion.classList.add('hidden');
      state.mode = 'idle';
      renderAll();
    }, 360);
  }

  function tick() {
    const elapsed = (performance.now() - state.startTime) / 1000;
    state.multiplier = Math.min(CFG.maxCrash, Number((Math.exp(elapsed * 0.33)).toFixed(2)));
    const progress = Math.min(1, Math.log(state.multiplier) / Math.log(CFG.maxCrash));
    drawTrail(progress);
    positionPilot(progress, tangentAngle(progress) + 2);
    renderAll();

    if (state.multiplier >= state.crashPoint) {
      triggerCrash();
      return;
    }
    state.animFrame = requestAnimationFrame(tick);
  }
})();
