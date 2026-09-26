// Webbläsarsnutt (INTE node): körs med Claude in Chrome javascript_tool i fliken med
// Messenger-chatten "3d print". Läser bara sidan — skriver/klickar aldrig i chatten.
// Scrollar uppåt tills inga nya länkar dyker upp och returnerar en rad per länk:
//   ig <shortcode>            Instagram reel/post
//   tt <@konto> <videoid>     TikTok
//   ttkort <kod>              vm.tiktok.com-kortlänk
//   yt <videoid>              YouTube/Shorts
// eller EJ_INLOGGAD / INGEN_CHATT. Inga querystrings i utdata (Chrome-verktyget blockerar dem).
(async () => {
  if (/\/login|checkpoint/.test(location.pathname) || document.querySelector('input[name="pass"]')) return 'EJ_INLOGGAD';
  const ut = new Set();
  const plocka = () => {
    for (const a of document.querySelectorAll('a[href]')) {
      let h = a.href;
      try {
        const u = new URL(h);
        if (/(^|\.)facebook\.com$/.test(u.hostname) && u.pathname === '/l.php' && u.searchParams.get('u')) h = u.searchParams.get('u');
      } catch { continue; }
      let m;
      if ((m = /instagram\.com\/(?:[^/?#]+\/)?(?:reel|reels|p)\/([A-Za-z0-9_-]+)/.exec(h))) ut.add('ig ' + m[1]);
      else if ((m = /tiktok\.com\/(@[^/?#]+)\/video\/(\d+)/.exec(h))) ut.add('tt ' + m[1] + ' ' + m[2]);
      else if ((m = /vm\.tiktok\.com\/([A-Za-z0-9]+)/.exec(h))) ut.add('ttkort ' + m[1]);
      else if ((m = /(?:youtube\.com\/(?:shorts\/|watch\?v=)|youtu\.be\/)([A-Za-z0-9_-]{11})/.exec(h))) ut.add('yt ' + m[1]);
    }
  };
  const main = document.querySelector('[role="main"]') || document.body;
  const scroller = [...main.querySelectorAll('div')]
    .filter((d) => d.scrollHeight > d.clientHeight + 200 && /auto|scroll/.test(getComputedStyle(d).overflowY))
    .sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
  if (!scroller) return 'INGEN_CHATT';
  plocka();
  let tomma = 0;
  for (let i = 0; i < 40 && tomma < 3; i++) {
    const fore = ut.size, hojd = scroller.scrollHeight;
    scroller.scrollTop = 0;
    await new Promise((r) => setTimeout(r, 1800));
    plocka();
    tomma = (ut.size === fore && scroller.scrollHeight === hojd) ? tomma + 1 : 0;
  }
  return [...ut].join('\n') || 'INGA_LANKAR';
})()
