(() => {
  const tg = window.Telegram && window.Telegram.WebApp;
  if (!tg) return;
  try {
    tg.ready();
    tg.expand();
    tg.setHeaderColor('#1a0551');
    tg.setBackgroundColor('#16044a');
  } catch (e) {
    console.warn('Telegram WebApp init skipped', e);
  }
})();
