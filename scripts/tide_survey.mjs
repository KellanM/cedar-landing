import { chromium } from 'playwright';
import os from 'node:os'; import path from 'node:path'; import fs from 'node:fs';
const root = path.join(os.homedir(), 'AppData/Local/ms-playwright');
const d = fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()[0];
const browser = await chromium.launch({ executablePath: path.join(root, d, 'chrome-win64', 'chrome.exe'), args: ['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
page.on('pageerror', (e) => console.log('ERR', e));
await page.goto(process.argv[2] + '?debug');
await page.waitForFunction(() => window.__debug && window.__debug.state.chunks > 0, null, { timeout: 120000 });
const r = await page.evaluate(() => {
  const scene = window.__debug.seaObj().group.parent;
  const bands = {}; // by 0.25 m band from -3 to +1.5: projected area, steep area
  const cells = new Map(); // 4m cells with intertidal rock (-1.6..0) area
  const v = [[0,0,0],[0,0,0],[0,0,0]];
  let meshes = 0;
  scene.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || !o.geometry) return;
    const pos = o.geometry.getAttribute('position'); if (!pos) return;
    const col = o.geometry.getAttribute('color');
    if (!/chunk/.test(o.name) && !/chunk/.test(o.parent?.name ?? '')) return;
    meshes++;
    o.updateMatrixWorld(true);
    const e = o.matrixWorld.elements;
    const idx = o.geometry.index; const n = idx ? idx.count : pos.count;
    for (let t = 0; t + 2 < n; t += 3) {
      for (let k = 0; k < 3; k++) { const i = idx ? idx.getX(t + k) : t + k; const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        v[k][0] = e[0]*x+e[4]*y+e[8]*z+e[12]; v[k][1] = e[1]*x+e[5]*y+e[9]*z+e[13]; v[k][2] = e[2]*x+e[6]*y+e[10]*z+e[14]; }
      const cy = (v[0][1]+v[1][1]+v[2][1])/3;
      if (cy < -3 || cy > 1.5) continue;
      const ax = v[1][0]-v[0][0], ay = v[1][1]-v[0][1], az = v[1][2]-v[0][2], bx = v[2][0]-v[0][0], by = v[2][1]-v[0][1], bz = v[2][2]-v[0][2];
      const nx = ay*bz-az*by, ny = az*bx-ax*bz, nz = ax*by-ay*bx; const L = Math.hypot(nx,ny,nz)/2; if (L < 1e-6) continue;
      const proj = Math.abs(ny)/2; const steep = Math.abs(ny)/2/L < 0.6;
      const b = (Math.floor(cy*4)/4).toFixed(2);
      bands[b] ??= { area: 0, proj: 0, steep: 0, rockish: 0 };
      bands[b].area += L; bands[b].proj += proj; if (steep) bands[b].steep += L;
      let grey = false;
      if (col) { const i = idx ? idx.getX(t) : t; const r = col.getX(i), g = col.getY(i), bl = col.getZ(i); grey = Math.max(r,g,bl) - Math.min(r,g,bl) < 0.08; if (grey) bands[b].rockish += L; }
      if (cy > -1.6 && cy < 0 && proj > 0) { const cx = Math.floor((v[0][0]+v[1][0]+v[2][0])/3/8), cz = Math.floor((v[0][2]+v[1][2]+v[2][2])/3/8); const key = cx+','+cz; const c = cells.get(key) ?? { p: 0, grey: 0, steep: 0 }; c.p += proj; if (grey) c.grey += proj; if (steep) c.steep += L; cells.set(key, c); }
    }
  });
  const top = [...cells.entries()].sort((a,b)=>b[1].p-a[1].p).slice(0,40).map(([k,c])=>[k.split(',').map(s=>+s*8+4), +c.p.toFixed(1), +c.grey.toFixed(1), +c.steep.toFixed(1)]);
  return { meshes, bands: Object.fromEntries(Object.entries(bands).sort((a,b)=>+a[0]-+b[0]).map(([k,b])=>[k, { area: Math.round(b.area), proj: Math.round(b.proj), steep: Math.round(b.steep), grey: Math.round(b.rockish) }])), cells: cells.size, top };
});
console.log(JSON.stringify(r, null, 1));
const ints = await page.evaluate(() => window.__debug.state);
await browser.close();
