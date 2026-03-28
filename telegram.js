(function () {
  const tg = window.Telegram && window.Telegram.WebApp;
  if (!tg) return;
  try {
    tg.ready();
    tg.expand();
    tg.setHeaderColor('#130632');
    tg.setBackgroundColor('#130632');
  } catch (e) {
    console.warn('Telegram WebApp init skipped', e);
  }
})();
