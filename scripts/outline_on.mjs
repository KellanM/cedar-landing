// Preload: run any capture/test script with the ink outline forced on.
//   OUTLINE=1|hull|hybrid node --import ./scripts/outline_on.mjs scripts/smoke.mjs <base>
// Every new browser context gets an init script that adds ?outline=<mode> to the URL before the game boots.
import pw from 'playwright';
const mode = process.env.OUTLINE ?? '1';
const launch = pw.chromium.launch.bind(pw.chromium);
pw.chromium.launch = async (...a) => {
  const b = await launch(...a);
  const nc = b.newContext.bind(b);
  b.newContext = async (...c) => {
    const ctx = await nc(...c);
    await ctx.addInitScript((m) => {
      const u = new URL(location.href);
      if (!u.searchParams.has('outline')) { u.searchParams.set('outline', m); history.replaceState(history.state, '', u.toString()); }
    }, mode);
    return ctx;
  };
  return b;
};
console.log(`[outline_on] ?outline=${mode} on every page`);
