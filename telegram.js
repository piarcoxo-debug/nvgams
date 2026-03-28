(() => {
  const tg = window.Telegram && window.Telegram.WebApp;
  if (!tg) return;
  tg.ready();
  try { tg.expand(); } catch {}
  try { tg.setHeaderColor('#14063d'); } catch {}
  try { tg.setBackgroundColor('#08011e'); } catch {}
})();
