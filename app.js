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

  const ctx = els.trailCanvas.getContext('2d');
  const state = loadState();
  state.mode = 'idle';
  state.multiplier = 1;
  state.crashPoint = 0;
  state.startTime = 0;
  state.frameId = 0;
  state.progress = 0;
  state.currentPos = { x: 0, y: 0 };

  resizeCanvas();
  window.addEventListener('resize', () => {
    resizeCanvas();
    redrawStatic();
  });

  renderQuickButtons();
  normalizeBet();
  seedHistory();
  renderAll();
  placePilot(0);
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

  function seedHistory() {
    if (state.history.length) return;
    state.history = [1.95, 1.92, 1.45, 1.71, 1.77, 1.88];
  }

  function formatCoins(v) {
    return `${new Intl.NumberFormat('ru-RU').format(Math.max(0, Math.floor(v)))} ${CFG.currencyName}`;
  }

  function clampBet(v) {
    if (!Number.isFinite(v)) return CFG.defaultBet;
    return Math.max(50, Math.min(1000000, Math.round(v / 50) * 50));
  }

  function normalizeBet() {
    state.balance = Number.isFinite(state.balance) && state.balance >= 0 ? state.balance : CFG.startBalance;
    if (state.balance < 50) state.balance = CFG.startBalance;
    state.bet = clampBet(state.bet);
    if (state.bet > state.balance && state.balance >= 50) {
      state.bet = clampBet(Math.floor(state.balance / 50) * 50);
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
    state.history.slice(0, CFG.historySize).forEach(v => {
      const chip = document.createElement('div');
      chip.className = `history-chip ${v >= 10 ? 'high' : v >= 2 ? 'mid' : ''}`;
      chip.textContent = `${Number(v).toFixed(2)}x`;
      els.historyStrip.appendChild(chip);
    });
  }

  function renderAll() {
    els.balanceValue.textContent = formatCoins(state.balance);
    els.multiplierValue.textContent = `${state.multiplier.toFixed(2)}x`;
    els.startBtn.disabled = !(state.mode === 'idle' && state.balance >= state.bet);
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

  function pointAt(t) {
    const rect = els.stage.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    const p0 = { x: 8, y: h - 165 };
    const p1 = { x: w * 0.24, y: h - 165 };
    const p2 = { x: w * 0.58, y: h - 255 };
    const p3 = { x: w - 78, y: 180 };
    const mt = 1 - t;
    return {
      x: mt * mt * mt * p0.x + 3 * mt * mt * t * p1.x + 3 * mt * t * t * p2.x + t * t * t * p3.x,
      y: mt * mt * mt * p0.y + 3 * mt * mt * t * p1.y + 3 * mt * t * t * p2.y + t * t * t * p3.y
    };
  }

  function tangentAngle(t) {
    const a = pointAt(Math.max(0, t - 0.01));
    const b = pointAt(Math.min(1, t + 0.01));
    return Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
  }

  function placePilot(progress) {
    const p = pointAt(progress);
    state.currentPos = p;
    els.pilot.style.left = `${p.x - 62}px`;
    els.pilot.style.top = `${p.y - 62}px`;
    els.pilot.style.transform = `rotate(${tangentAngle(progress)}deg)`;
  }

  function drawTrail(progress) {
    const rect = els.stage.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);

    const endT = Math.max(0.02, progress);
    const samples = [];
    for (let i = 0; i <= 50; i += 1) {
      samples.push(pointAt(endT * (i / 50)));
    }

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();
    ctx.moveTo(samples[0].x, samples[0].y);
    for (let i = 1; i < samples.length; i += 1) ctx.lineTo(samples[i].x, samples[i].y);
    ctx.strokeStyle = 'rgba(86, 231, 255, 0.16)';
    ctx.lineWidth = 18;
    ctx.shadowBlur = 26;
    ctx.shadowColor = 'rgba(111, 231, 255, 0.5)';
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(samples[0].x, samples[0].y);
    for (let i = 1; i < samples.length; i += 1) ctx.lineTo(samples[i].x, samples[i].y);
    ctx.strokeStyle = '#7ecfff';
    ctx.lineWidth = 3;
    ctx.shadowBlur = 10;
    ctx.shadowColor = 'rgba(126, 207, 255, 0.8)';
    ctx.stroke();

    for (let i = 0; i < samples.length; i += 1) {
      if (i % 4 !== 0) continue;
      const p = samples[i];
      ctx.fillStyle = i % 8 === 0 ? 'rgba(255, 148, 223, 0.88)' : 'rgba(111, 231, 255, 0.84)';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.7, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  function redrawStatic() {
    drawTrail(state.mode === 'running' ? state.progress : 0);
    if (state.mode !== 'crashed') placePilot(state.mode === 'running' ? state.progress : 0);
  }

  function generateCrashPoint() {
    const total = CFG.crashRanges.reduce((sum, r) => sum + r.weight, 0);
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
    if (state.balance < state.bet) return;
    state.balance -= state.bet;
    state.mode = 'running';
    state.multiplier = 1;
    state.progress = 0;
    state.crashPoint = generateCrashPoint();
    state.startTime = performance.now();
    els.explosion.classList.add('hidden');
    els.pilot.classList.remove('hidden');
    saveState();
    renderAll();
    cancelAnimationFrame(state.frameId);
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
    state.multiplier = state.crashPoint;
    state.history.unshift(state.crashPoint);
    state.history = state.history.slice(0, CFG.historySize);
    els.explosion.style.left = `${state.currentPos.x + 8}px`;
    els.explosion.style.top = `${state.currentPos.y + 6}px`;
    els.explosion.classList.remove('hidden');
    els.pilot.classList.add('hidden');
    saveState();
    renderAll();
    setTimeout(() => {
      els.explosion.classList.add('hidden');
      state.mode = 'idle';
      state.multiplier = 1;
      state.progress = 0;
      drawTrail(0);
      placePilot(0);
      els.pilot.classList.remove('hidden');
      renderAll();
    }, 380);
  }

  function tick() {
    const elapsed = (performance.now() - state.startTime) / 1000;
    state.multiplier = Math.min(CFG.maxCrash, Number((Math.exp(elapsed * 0.34)).toFixed(2)));
    state.progress = Math.min(1, Math.log(state.multiplier) / Math.log(CFG.maxCrash));
    drawTrail(state.progress);
    placePilot(state.progress);
    renderAll();

    if (state.multiplier >= state.crashPoint) {
      triggerCrash();
      return;
    }
    state.frameId = requestAnimationFrame(tick);
  }
})();
