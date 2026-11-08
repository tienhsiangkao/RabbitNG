// Exercise the real main entrypoint. Isolate user settings and OS side effects;
// retain Electron initialization, IPC setup, tray creation and scan scheduling.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { syncBuiltinESMExports } = require('module');
const { app, globalShortcut, BrowserWindow, screen, session, Menu } = require('electron');
let currentMenu=[];
const buildMenu=Menu.buildFromTemplate.bind(Menu);
Menu.buildFromTemplate=template=>{if(template.some(item=>item.label==='Settings...'))currentMenu=template;return buildMenu(template);};
const childProcess = require('child_process');
const appRoot = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'pokerrng-startup-'));
const workspaceFull=process.argv.includes('--workspace-layout');
const automatic = process.argv.includes('--automatic-layout')||workspaceFull;
const lifecycle = process.argv.includes('--overlay-lifecycle')||automatic;
if (lifecycle) {
  const settings = JSON.parse(fs.readFileSync(path.join(appRoot, 'settings.json'), 'utf8'));
  settings.scanMs = 120; settings.quietMode = true; settings.autoStartEnabled = false;
  settings.tableLayout.enabled = false;
  settings.comfortDefaultsVersion=2;
  settings.comfort={clockMode:'table'};
  settings.overlays.buyInEnabled = true; settings.overlays.clockEnabled = true;
  if(automatic){settings.tableLayout={enabled:true,autoArrange:true,arrangeOnStartup:true,restoreOnStop:false,activeProfileId:'automatic',profiles:[{id:'automatic',name:'Automatic',monitorId:'monitor:999',rows:0,columns:0,gap:8,margin:0}]};settings.comfort.clockMode='shared';}
  fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify(settings));
}
app.setName('PokerRNG Startup Test');
app.setPath('userData', userData);
app.getAppPath = () => appRoot;
const execFileSync = childProcess.execFileSync;
childProcess.execFileSync = function (file, args, ...rest) {
  if (path.basename(file).toLowerCase() === 'reg.exe') {
    if (args[0] === 'QUERY') throw new Error('Test uses no startup registry entry');
    return '';
  }
  return execFileSync.call(this, file, args, ...rest);
};
syncBuiltinESMExports();
globalShortcut.register = () => true;
globalShortcut.unregisterAll = () => {};
const { windowManager, Window } = require(path.join(appRoot, 'node_modules', 'node-window-manager'));
const nativeMonitors=windowManager.getMonitors.bind(windowManager);
let automaticWork;
if(automatic) {
  const monitor=nativeMonitors().find(m=>m.isPrimary()),originalWork=monitor.getWorkArea();
  automaticWork=workspaceFull?{...originalWork}:{...originalWork,width:Math.min(2560,originalWork.width),height:Math.min(1600,originalWork.height)};
  const secondaryWork={x:-1600,y:0,width:1600,height:900};
  windowManager.getMonitors=()=>[
    {id:999,isValid:()=>true,isPrimary:()=>false,getBounds:()=>secondaryWork,getWorkArea:()=>secondaryWork,getScaleFactor:()=>1},
    {id:monitor.id,isValid:()=>true,isPrimary:()=>true,getBounds:()=>automaticWork,getWorkArea:()=>automaticWork,getScaleFactor:()=>monitor.getScaleFactor()}
  ];
}
let testWindows = [];
const nativeWindows = windowManager.getWindows.bind(windowManager);
windowManager.getWindows = () => {
  if (!lifecycle) return [];
  const ids = new Set(BrowserWindow.getAllWindows().map((bw) => Number(bw.getNativeWindowHandle().readBigUInt64LE())));
  const overrides = new Map(testWindows.map((win) => [win.id, win]));
  return nativeWindows().filter((win) => ids.has(win.id)).map((win) => overrides.get(win.id) || win);
};
windowManager.getActiveWindow = () => null;
let complete = false, errors = [];
const originalLog = console.log, originalError = console.error;
console.log = (...args) => {
  if (args[0] === '[app] startup complete') complete = true;
  originalLog(...args);
};
console.error = (...args) => { errors.push(args.map(String).join(' ')); originalError(...args); };
const fail = (error) => { originalError(error.stack || error); app.exit(1); };
process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);
setTimeout(() => fail(new Error('Main startup timed out')), 30000).unref();
async function waitUntil(condition, message) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
  throw new Error(message);
}
function frameReport() {
  try { return JSON.parse(fs.readFileSync(path.join(userData,'frame-status.json'),'utf8')); }
  catch { return null; }
}
async function testAttachment() {
  const table = new BrowserWindow({ x: 100, y: 100, width: 900, height: 650, show: false });
  const cover = new BrowserWindow({ x: 100, y: 100, width: 900, height: 650, show: false });
  await table.loadURL('data:text/html,<title>Rush %26 Cash - $0.10 / $0.25</title>PokerRNG attachment test');
  await cover.loadURL('data:text/html,<title>Cover test</title>PokerRNG cover test');
  table.setTitle('Rush & Cash - $0.10 / $0.25');
  const native = (bw) => new Window(Number(bw.getNativeWindowHandle().readBigUInt64LE()));
  const target = native(table), covering = native(cover);
  target.path = 'C:\\test\\GGPoker.exe';
  testWindows = [target];
  const overlays = () => BrowserWindow.getAllWindows().filter((w) => w !== table && w !== cover);
  await new Promise((resolve) => setTimeout(resolve, 350));
  if (overlays().some((w) => w.isVisible())) throw new Error('Hidden native table created a visible overlay');
  table.showInactive();
  await waitUntil(() => overlays().some((w) => w.isVisible()), 'Visible table did not get its overlay');
  const original = overlays().find((w) => w.getTitle() === 'Poker RNG').getBounds();
  table.setPosition(200, 100);
  await waitUntil(() => overlays().some((w) => w.getTitle() === 'Poker RNG' && Math.abs(w.getBounds().x - original.x - 100) <= 3), 'Overlay failed to follow table movement');
  const number = () => overlays().find((w) => w.getTitle() === 'Poker RNG');
  const small = number().getBounds();
  table.setSize(1200, 850);
  await waitUntil(() => number() && number().getBounds().width > small.width && number().getBounds().height > small.height,
    'Resizing the table did not proportionally grow the number overlay');
  await new Promise((resolve) => setTimeout(resolve, 500));
  const fits = await number().webContents.executeJavaScript(`(() => {
    const n = document.getElementById('num').getBoundingClientRect();
    const c = document.querySelector('.card').getBoundingClientRect();
    return n.left >= c.left && n.right <= c.right && n.top >= c.top && n.bottom <= c.bottom;
  })()`);
  if (!fits) throw new Error('Proportional digits were clipped after resizing');
  const { auxiliaryOverlayLayout } = await import(pathToFileURL(path.join(appRoot, 'src', 'overlay-sizing.js')).href);
  for (const [width, height] of [[800, 567], [1490, 1056], [1900, 1347]]) {
    table.setSize(width, height);
    const expected = auxiliaryOverlayLayout(table.getBounds(), true);
    const clock = () => overlays().find((w) => w.getTitle() === 'Clock');
    await waitUntil(() => clock() && clock().getBounds().width === expected.clock.width && clock().getBounds().height === expected.clock.height,
      'Clock overlay failed to resize consistently with the table');
    const stakes = () => overlays().find((w) => w.getTitle() === 'Poker Stakes');
    await waitUntil(() => stakes() && stakes().getBounds().width === expected.stakes.width && stakes().getBounds().height === expected.stakes.height,
      'Buy-in overlay failed to resize consistently with the table');
    await waitUntil(async () => (await stakes().webContents.executeJavaScript("Number.parseFloat(getComputedStyle(document.body).fontSize)")) === expected.stakes.fontSize,
      'Buy-in text did not grow with its panel');
    if (!(await stakes().webContents.executeJavaScript("(() => { const b = document.querySelector('.bi').getBoundingClientRect(); return b.width <= innerWidth && b.height <= innerHeight; })()"))) {
      throw new Error('Buy-in text was clipped');
    }
    const panelStyle = "(() => { const s = getComputedStyle(document.querySelector('.overlay-panel')); return JSON.stringify([s.backgroundColor, s.borderRadius, s.borderColor, s.boxShadow]); })()";
    if ((await stakes().webContents.executeJavaScript(panelStyle)) !== (await number().webContents.executeJavaScript(panelStyle))) {
      throw new Error('RNG and buy-in panel styling do not match');
    }
    await waitUntil(async () => !(await number().webContents.executeJavaScript("document.getElementById('num').classList.contains('rolling')")), 'Animation did not settle');
    const clockFits = await clock().webContents.executeJavaScript(`Array.from(document.querySelectorAll('.clock, .clock-utc, .clock-label')).every((el) => {
      const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight && el.scrollWidth <= el.clientWidth + 1;
    })`);
    if (!clockFits) throw new Error(`Clock digits clipped at table size ${width}x${height}`);
    const clockCentered = await clock().webContents.executeJavaScript(`!document.querySelector('.clock-label') && Array.from(document.querySelectorAll('.clock,.clock-utc')).every(el => {
      const r=el.getBoundingClientRect(); return getComputedStyle(el).textAlign==='center' && Math.abs((r.left+r.right)/2-innerWidth/2)<1;
    })`);
    if (!clockCentered) throw new Error('Clock rows must be centered without visible timezone labels');
    const numberFits = await number().webContents.executeJavaScript(`(() => {
      const n = document.getElementById('num').getBoundingClientRect(), c = document.querySelector('.card').getBoundingClientRect();
      return n.left >= c.left && n.right <= c.right && n.top >= c.top && n.bottom <= c.bottom;
    })()`);
    if (!numberFits) throw new Error(`RNG digits clipped at table size ${width}x${height}`);
    const n = number().getBounds(), t = table.getBounds();
    if (Math.abs((n.x + n.width - t.x) / t.width - .418) > .002 || Math.abs((n.y + n.height / 2 - t.y) / t.height - .76) > .002) {
      throw new Error('RNG moved away from the left side of the hero hand when resizing');
    }
  }
  originalLog('PASS: RNG stays beside the hero hand; larger clock and buy-in text fit at 800, 1490 and 1900 table widths');
  const badgeWindow = () => overlays().find(w => w.getTitle() === 'Poker Stakes');
  const frameWindow = () => overlays().find(w => w.getTitle() === 'Poker Stake Frame');
  await waitUntil(async () => frameWindow()?.isVisible() && (await frameWindow().webContents.executeJavaScript("document.getElementById('frame').dataset.rectCount")) === '4', 'Visible table did not receive its complete stake frame');
  const user32 = require(path.join(appRoot,'node_modules','koffi')).load(path.join(process.env.SystemRoot,'System32','user32.dll'));
  const extendedStyle = user32.func('intptr_t __stdcall GetWindowLongPtrW(uintptr_t hwnd, int index)');
  if (!(Number(extendedStyle(native(frameWindow()).id,-20)) & 0x20) || frameWindow().isFocusable()) {
    throw new Error('Table frame must pass mouse clicks through and never take focus');
  }
  const transparentCenter = await frameWindow().webContents.executeJavaScript(`(() => {
    const c=document.getElementById('frame');return c.getContext('2d').getImageData(Math.floor(c.width/2),Math.floor(c.height/2),1,1).data[3]===0;
  })()`);
  if (!transparentCenter) throw new Error('Stake frame painted over the middle of the table');
  const readBadge = () => badgeWindow().webContents.executeJavaScript("({text:document.querySelector('.bi').textContent,color:getComputedStyle(document.body).color,level:document.body.dataset.stakeLevel})");
  const initialBadge = await readBadge();
  table.setTitle('NLH Gold 08 - $2 / $5');
  await waitUntil(async () => (await readBadge()).text === 'NL500', 'Regular Gold 08 did not display NL500');
  const goldBadge = await readBadge();
  await waitUntil(async () => (await frameWindow().webContents.executeJavaScript("document.getElementById('frame').dataset.color")) === '#F3D27A', 'Frame did not update to the NL500 badge color');
  if (goldBadge.color === initialBadge.color || goldBadge.level !== '500') throw new Error('Stake color did not update with changed blinds');
  table.setTitle('NLH Gold 08');
  await waitUntil(async () => badgeWindow().isVisible() && (await readBadge()).text === 'NL500', 'Confirmed abbreviated Gold 08 table lost its badge');
  table.setTitle('NLH Gold 09');
  await waitUntil(() => !badgeWindow().isVisible(), 'Unknown abbreviated table retained a stale stake badge');
  await waitUntil(() => !frameWindow().isVisible(), 'Unknown stake retained a misleading colored frame');
  table.setTitle('Rush & Cash - $0.25 / $0.50');
  await waitUntil(async () => badgeWindow().isVisible() && (await readBadge()).text === 'Z50', 'Reused Rush window retained the old stake text');
  if ((await readBadge()).color === goldBadge.color) throw new Error('Rush stake color stayed gold after stake change');
  table.setTitle('Rush & Cash - $0.10 / $0.25');
  await waitUntil(async () => (await readBadge()).text === 'Z25', 'Original Rush badge did not return');
  originalLog('PASS: stake text/colors update on reused windows, Gold 08 maps to NL500, unknown names show no stale badge');
  table.hide();
  await waitUntil(() => overlays().every((w) => !w.isVisible()), 'Hidden table left a floating overlay');
  await waitUntil(() => frameReport()?.frames.every(f=>!f.visible),'Hidden frame was still reported as visible');
  table.showInactive();
  await waitUntil(() => overlays().some((w) => w.isVisible()), 'Restored table overlay did not reappear');
  table.minimize();
  await waitUntil(() => overlays().every((w) => !w.isVisible()), 'Minimized table left a floating overlay');
  table.restore(); table.showInactive();
  await waitUntil(() => overlays().some((w) => w.isVisible()), 'Unminimized table overlay did not reappear');
  cover.setBounds(table.getBounds()); cover.show(); cover.focus(); cover.moveTop(); testWindows = [covering, target];
  await waitUntil(() => overlays().every((w) => !w.isVisible()), 'Covered table overlay floated above the covering window');
  cover.hide();
  await waitUntil(() => overlays().some((w) => w.isVisible()), 'Uncovered table overlay did not reappear');
  cover.setBounds({...table.getBounds(),width:Math.floor(table.getBounds().width*.3)});
  cover.show();cover.focus();cover.moveTop();
  const clippedFrame = async () => frameWindow()?.isVisible() && await frameWindow().webContents.executeJavaScript(`(() => {
    const c=document.getElementById('frame'),ctx=c.getContext('2d'),r=devicePixelRatio;
    return ctx.getImageData(Math.floor(5*r),Math.floor(5*r),1,1).data[3]===0 &&
      ctx.getImageData(Math.floor((innerWidth-5)*r),Math.floor(5*r),1,1).data[3]>0;
  })()`);
  await waitUntil(clippedFrame,'Frame did not clip behind a partially covering app');
  cover.hide();
  originalLog('PASS: table frame is click-through, has a transparent center, shares badge colors and clips behind covering apps');
  const fixedAnchor = number().getBounds();
  // Exercise actual DWM cloaking, not a fake process-name exemption. This
  // window retains WS_VISIBLE, just like the real hidden Start/Search hosts.
  const koffi = require(path.join(appRoot, 'node_modules', 'koffi'));
  const dwm = koffi.load(path.join(process.env.SystemRoot, 'System32', 'dwmapi.dll'));
  const cloak = dwm.func('int32_t __stdcall DwmSetWindowAttribute(uintptr_t hwnd, uint32_t attribute, const uint32_t *value, uint32_t size)');
  const { createWindowDisplayStateReader } = await import(pathToFileURL(path.join(appRoot, 'src', 'windows-display-state.js')).href);
  const displayState = createWindowDisplayStateReader();
  cover.setBounds(table.getBounds());
  cover.showInactive(); cover.moveTop();
  if (cloak(covering.id, 13 /* DWMWA_CLOAK */, [1], 4) < 0) throw new Error('Could not cloak test cover window');
  await waitUntil(() => displayState(covering).cloaked, 'DWM cloaking was not detected by the real native reader');
  if (!covering.isVisible()) throw new Error('Cloaked fixture must retain WS_VISIBLE to reproduce this bug');
  await waitUntil(() => number().isVisible(), 'DWM-cloaked surface incorrectly hid the anchored number');
  await waitUntil(() => frameWindow().isVisible(),'DWM-cloaked surface incorrectly hid the stake frame');
  if (!number().isVisible() || Math.abs(number().getBounds().x - fixedAnchor.x) > 1 || Math.abs(number().getBounds().y - fixedAnchor.y) > 1) {
    throw new Error('DWM-cloaked surface moved or hid the anchored number');
  }
  if (cloak(covering.id, 13, [0], 4) < 0) throw new Error('Could not uncloak test cover window');
  await waitUntil(() => !number().isVisible(), 'Uncloaked cover stopped hiding the number');
  cover.hide();
  originalLog('PASS: real DWM-cloaked windows do not hide overlays; uncloaked windows still do');
  testWindows = []; table.destroy(); cover.destroy();
  await waitUntil(() => overlays().length === 0, 'Closed table overlay was not cleaned up');
  await waitUntil(() => frameReport()?.frames.length===0,'Closed frame remained in the drawing report');
  if (errors.length) throw new Error(errors.join('; '));
  originalLog('PASS: real overlay follows movement and hides on hide/minimize/cover/close');
  const work = screen.getPrimaryDisplay().workArea;
  const width = Math.floor(work.width / 2) - 20, height = Math.floor(work.height / 2) - 20;
  const tables = [];
  let delayedFrameLoads = 0;
  session.defaultSession.webRequest.onBeforeRequest((details,callback) => {
    if (details.url.endsWith('/table-frame-renderer.js')) {
      delayedFrameLoads++;
      setTimeout(() => callback({}),600);
    } else callback({});
  });
  const numberOverlays = () => BrowserWindow.getAllWindows().filter((bw) => bw.getTitle() === 'Poker RNG');
  for (let i = 0; i < 4; i++) {
    const bw = new BrowserWindow({ x: work.x + (i % 2) * (width + 10), y: work.y + Math.floor(i / 2) * (height + 10), width, height, show: false });
    await bw.loadURL('data:text/html,<title>Rush %26 Cash - $0.10 / $0.25</title>Four table attachment test');
    bw.setTitle('Rush & Cash - $0.10 / $0.25');
    const target = native(bw); target.path = 'C:\\test\\GGPoker.exe';
    tables.push(bw); testWindows.push(target); bw.showInactive();
    await waitUntil(() => numberOverlays().filter((w) => w.isVisible()).length === i + 1, `After opening table ${i + 1}, a table overlay disappeared`);
  }
  if (numberOverlays().filter((w) => w.isVisible()).length !== 4) throw new Error('Four visible tables must have four visible number overlays');
  await waitUntil(() => BrowserWindow.getAllWindows().filter(w=>w.getTitle()==='Poker Stake Frame'&&w.isVisible()).length===4,'Four tables did not retain four stake frames');
  await waitUntil(async () => {
    const frames=BrowserWindow.getAllWindows().filter(w=>w.getTitle()==='Poker Stake Frame');
    const painted=await Promise.all(frames.map(w=>w.webContents.executeJavaScript(`(() => {
      const c=document.getElementById('frame');if(!c)return false;
      const ctx=c.getContext('2d'),r=devicePixelRatio;
      const alpha=(x,y)=>ctx.getImageData(Math.floor(x*r),Math.floor(y*r),1,1).data[3];
      return Number(c.dataset.rectCount)>0 && alpha(3,3)>0 && alpha(innerWidth-4,3)>0 &&
        alpha(3,innerHeight-4)>0 && alpha(innerWidth-4,innerHeight-4)>0 && alpha(innerWidth/2,innerHeight/2)===0;
    })()`)));
    return frames.length===4 && painted.every(Boolean);
  },'A visible stake-frame window has no painted border on one or more tables');
  if(delayedFrameLoads!==4)throw new Error('Four-table startup test did not delay all four renderer loads');
  await waitUntil(() => {
    const report=frameReport();return report?.frames.length===4 && report.frames.every(f=>f.visible&&f.drawn?.painted&&f.drawn.sampledAlpha>0);
  },'Four painted borders were not acknowledged by their renderers');
  session.defaultSession.webRequest.onBeforeRequest(null);
  const firstBounds = tables[0].getBounds();
  let firstNumber = numberOverlays().find((w) => {
    const b = w.getBounds(); return b.x >= firstBounds.x && b.x < firstBounds.x + firstBounds.width &&
      b.y >= firstBounds.y && b.y < firstBounds.y + firstBounds.height;
  });
  const anchoredFirst = firstNumber.getBounds();
  currentMenu.find(item=>item.label==='Settings...').click();
  let settingsWindow;
  await waitUntil(()=>{
    settingsWindow=BrowserWindow.getAllWindows().find(w=>w.getTitle()==='Poker RNG Settings');
    return settingsWindow && !settingsWindow.webContents.isLoading();
  },'Could not open settings for live comfort integration test');
  settingsWindow.hide();
  const originalTableBounds=tables.map(w=>w.getBounds());
  await settingsWindow.webContents.executeJavaScript("window.appSettings.update({appearance:{frameThickness:2,frameOpacity:.4,rngScale:1.2,rngGap:.02},comfort:{clockMode:'shared'}})");
  const sharedClock=()=>BrowserWindow.getAllWindows().find(w=>w.getTitle()==='Poker Session Clock');
  await waitUntil(()=>sharedClock()?.isVisible(),'Shared clock did not appear');
  if(BrowserWindow.getAllWindows().some(w=>w.getTitle()==='Clock'))throw new Error('Shared mode retained per-table clocks');
  await waitUntil(()=>frameReport()?.frames.every(f=>f.drawn?.sampledAlpha>=100&&f.drawn?.sampledAlpha<=104),'Live opacity did not repaint every frame');
  const adjusted=firstNumber.getBounds(), adjustedTable=tables[0].getBounds();
  if(adjusted.width<=anchoredFirst.width||Math.abs(adjusted.x+adjusted.width-adjustedTable.x-adjustedTable.width*.41)>2)throw new Error('Live RNG size/spacing did not apply');
  if(JSON.stringify(tables.map(w=>w.getBounds()))!==JSON.stringify(originalTableBounds))throw new Error('Comfort settings moved actual table slots');
  const sharedFits=await sharedClock().webContents.executeJavaScript(`Array.from(document.querySelectorAll('.clock,.clock-utc,#session-status')).every(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;})`);
  if(!sharedFits)throw new Error('Shared clock or session text is clipped');
  const workArea=screen.getPrimaryDisplay().workArea;
  sharedClock().setPosition(workArea.x+24,workArea.y+24);
  await waitUntil(()=>JSON.parse(fs.readFileSync(path.join(userData,'settings.json'),'utf8')).comfort?.clockPosition?.x===workArea.x+24,'Shared clock position was not remembered');
  tables.forEach(w=>w.hide());
  await waitUntil(()=>!sharedClock().isVisible(),'Shared clock floated after all tables were hidden');
  await new Promise(resolve=>setTimeout(resolve,300));
  const paused=await sharedClock().webContents.executeJavaScript('window.clockComfort.get()');
  await new Promise(resolve=>setTimeout(resolve,1200));
  const pausedAgain=await sharedClock().webContents.executeJavaScript('window.clockComfort.get()');
  if(!paused.paused||paused.seconds!==pausedAgain.seconds)throw new Error('Session counter did not pause without visible tables');
  tables.forEach(w=>w.showInactive());
  await waitUntil(()=>sharedClock().isVisible(),'Shared clock did not return with the tables');
  await waitUntil(()=>numberOverlays().filter(w=>w.isVisible()).length===4,'Restored tables did not recreate all four numbers');
  // Hidden tables may expire their native attachment; reacquire the recreated
  // overlay rather than assuming the previous BrowserWindow survives a pause.
  firstNumber=numberOverlays().find(w=>{const b=w.getBounds();return b.x>=firstBounds.x&&b.x<firstBounds.x+firstBounds.width&&b.y>=firstBounds.y&&b.y<firstBounds.y+firstBounds.height;});
  await settingsWindow.webContents.executeJavaScript("window.appSettings.update({appearance:{reset:true},comfort:{clockMode:'table'}})");
  await waitUntil(()=>!sharedClock()&&BrowserWindow.getAllWindows().filter(w=>w.getTitle()==='Clock'&&w.isVisible()&&!w.webContents.isLoading()).length===4,'Switching back did not restore four clocks');
  settingsWindow.destroy();
  await waitUntil(()=>firstNumber.getBounds().width===anchoredFirst.width,'Appearance reset did not restore original size');
  originalLog('PASS: live appearance repaints all frames; shared clock replaces four clocks, remembers position, fits its text and pauses without tables; saving never moves tables');
  tables[3].setBounds({ ...firstBounds, x: firstBounds.x + Math.floor(firstBounds.width * .45) });
  tables[3].show(); tables[3].focus(); tables[3].moveTop();
  await new Promise((resolve) => setTimeout(resolve, 400));
  await waitUntil(() => firstNumber.isVisible(), 'First table lost its uncovered number in a multi-table layout');
  if (firstNumber.getBounds().x !== anchoredFirst.x || firstNumber.getBounds().y !== anchoredFirst.y) {
    throw new Error('First table number jumped away from its fixed anchor during overlap');
  }
  testWindows = []; tables.forEach((bw) => bw.destroy());
  await waitUntil(() => BrowserWindow.getAllWindows().length === 0, 'Four-table overlays were not cleaned up');
  originalLog('PASS: all four borders actually painted and acknowledged with delayed renderer startup; all four RNGs remain visible');
}
async function testAutomaticLayout() {
  const {boundsApproximatelyEqual}=await import(pathToFileURL(path.join(appRoot,'src','table-layout.js')).href);
  const {calculatePokerWorkspace}=await import(pathToFileURL(path.join(appRoot,'src','poker-workspace.js')).href);
  const tables=[],titles=['Rush & Cash - $0.05 / $0.10','NLH Gold 08','Rush & Cash - $0.10 / $0.25','NLH - $0.10 / $0.25'];
  let moves=0;
  for(const title of titles) {
    const bw=new BrowserWindow({show:false,width:400,height:300});
    await bw.loadURL('data:text/html,<title>Automatic table test</title>Controlled table');bw.setTitle(title);
    const target=new Window(Number(bw.getNativeWindowHandle().readBigUInt64LE()));target.path='C:\\test\\GGPoker.exe';
    const setBounds=target.setBounds.bind(target);target.setBounds=b=>{moves++;return setBounds(b);};
    tables.push(bw);testWindows.push(target);bw.showInactive();
    await waitUntil(()=>frameReport()?.frames.some(f=>f.tableId===target.id),'Controlled table was not attached before opening the next one');
  }
  const workspacePlan=calculatePokerWorkspace(automaticWork,4);
  if(workspacePlan.mode!=='full')throw new Error('Automatic native fixture needs room for four tables and all tools');
  const physicalTargets=workspacePlan.tableRects;
  const targets=physicalTargets.map(b=>screen.screenToDipRect(null,b));
  const sorted=[tables[1],tables[2],tables[3],tables[0]];
  await waitUntil(()=>sorted.every((w,i)=>boundsApproximatelyEqual(w.getBounds(),targets[i],3)),'Startup did not automatically sort four tables by stake into left-first slots').catch(error=>{originalLog(JSON.stringify({expected:targets,actual:sorted.map(w=>w.getBounds()),workspace:frameReport()?.workspace}));throw error;});
  if(tables.some(w=>Math.abs(w.getBounds().width/w.getBounds().height-1.4)>.015))throw new Error('GG tables were stretched instead of fitted proportionally');
  const shared=()=>BrowserWindow.getAllWindows().filter(w=>w.getTitle()==='Poker Session Clock');
  await waitUntil(()=>shared().length===1&&shared()[0].isVisible(),'Default shared clock was not visible');
  if(BrowserWindow.getAllWindows().some(w=>w.getTitle()==='Clock'))throw new Error('Default shared mode left per-table clocks');
  tables[0].setTitle('Rush & Cash - $5 / $10');
  await waitUntil(()=>boundsApproximatelyEqual(tables[0].getBounds(),targets[0],3),'Reused table changing stakes did not automatically move to the highest-stakes slot');
  await new Promise(resolve=>setTimeout(resolve,250));const settledMoves=moves;
  tables[0].setTitle('Rush & Cash - $5 / $10 [6]');
  await new Promise(resolve=>setTimeout(resolve,400));
  if(moves!==settledMoves)throw new Error('Cosmetic title change or unchanged scan moved tables again');
  await waitUntil(()=>frameReport()?.frames.length===4&&frameReport().frames.every(f=>f.visible&&f.drawn?.painted),'Automatic arrangement lost one of the four painted borders');
  const stableTables=tables.map(w=>w.getBounds());
  const utility=new BrowserWindow({show:false,x:100,y:100,width:424,height:600,minWidth:424,maxWidth:424,minHeight:600,maxHeight:600});
  await utility.loadURL('data:text/html,<title>Bankroll Challenge Information</title>Controlled utility');utility.setTitle('Bankroll Challenge Information');
  const utilityNative=new Window(Number(utility.getNativeWindowHandle().readBigUInt64LE()));utilityNative.path='C:\\test\\GGPoker.exe';
  testWindows.push(utilityNative);utility.showInactive();
  const utilityTarget=screen.screenToDipRect(null,workspacePlan.slots.challenge);
  await waitUntil(()=>utility.getBounds().x===utilityTarget.x,'Opened challenge utility did not receive its workspace slot');
  if(JSON.stringify(tables.map(w=>w.getBounds()))!==JSON.stringify(stableTables))throw new Error('Opening a utility rearranged poker tables');
  utility.setPosition(100,100);
  await waitUntil(()=>utility.getBounds().x===utilityTarget.x&&utility.getBounds().y===utilityTarget.y,'Existing utility did not magnetize back after being dragged');
  if(JSON.stringify(tables.map(w=>w.getBounds()))!==JSON.stringify(stableTables))throw new Error('Magnetizing a utility rearranged poker tables');
  testWindows=testWindows.filter(w=>w.id!==utilityNative.id);utility.destroy();
  await new Promise(resolve=>setTimeout(resolve,250));
  if(JSON.stringify(tables.map(w=>w.getBounds()))!==JSON.stringify(stableTables))throw new Error('Closing a utility rearranged poker tables');
  originalLog('PASS: utility open/close and magnetic snap-back never shift tables; native minimum sizes are respected');
  let manualClock=shared()[0];const originalClockBounds=manualClock.getBounds();
  manualClock.setPosition(100,120);
  await waitUntil(()=>boundsApproximatelyEqual(manualClock.getBounds(),originalClockBounds,1),'Shared workspace clock did not magnetize back after being dragged');
  currentMenu.find(item=>item.label==='Settings...').click();
  let workspaceSettings;
  await waitUntil(()=>{workspaceSettings=BrowserWindow.getAllWindows().find(w=>w.getTitle()==='Poker RNG Settings');return workspaceSettings&&!workspaceSettings.webContents.isLoading();},'Could not open workspace settings');
  workspaceSettings.hide();
  await workspaceSettings.webContents.executeJavaScript('window.appSettings.update({workspaceEnabled:false})');
  await waitUntil(()=>shared()[0]&&shared()[0]!==manualClock&&!shared()[0].webContents.isLoading(),'Disabling workspace did not restore the free clock');
  const freeClock=shared()[0];freeClock.setPosition(100,120);
  await waitUntil(()=>JSON.parse(fs.readFileSync(path.join(userData,'settings.json'))).comfort.clockPosition?.x===100,'Free clock placement was not saved');
  await workspaceSettings.webContents.executeJavaScript('window.appSettings.update({workspaceEnabled:true})');
  await waitUntil(()=>shared()[0]&&boundsApproximatelyEqual(shared()[0].getBounds(),originalClockBounds,1),'Enabling workspace left the clock at its old free position');
  workspaceSettings.destroy();manualClock=shared()[0];
  const temporaryTables=[];
  for(let i=0;i<(workspaceFull?8:5);i++){
    const w=new BrowserWindow({show:false,x:50+i*24,y:50+i*20,width:560,height:415});
    await w.loadURL('data:text/html,<title>Rush %26 Cash - $0.10 / $0.25</title>Temporary controlled table');w.setTitle('Rush & Cash - $0.10 / $0.25');
    const nw=new Window(Number(w.getNativeWindowHandle().readBigUInt64LE()));nw.path='C:\\test\\GGPoker.exe';testWindows.push(nw);temporaryTables.push({w,id:nw.id});w.showInactive();
    const count=4+temporaryTables.length;
    if(workspaceFull&&[6,9,12].includes(count)){
      const selected=calculatePokerWorkspace(automaticWork,count,{preferSixReviewLayout:true}),rects=selected.tableRects.map(r=>screen.screenToDipRect(null,r));
      await waitUntil(()=>frameReport()?.frames.length===count&&
        [...tables,...temporaryTables.map(t=>t.w)].every(b=>rects.some(r=>boundsApproximatelyEqual(b.getBounds(),r,3))),`${count}-table workspace did not occupy its selected slots`);
      const clockTarget=screen.screenToDipRect(null,selected.slots.clock);
      await waitUntil(()=>shared()[0]&&boundsApproximatelyEqual(shared()[0].getBounds(),clockTarget,1),'Clock did not follow the selected utility dock');
    }
  }
  await waitUntil(()=>frameReport()?.frames.length===(workspaceFull?12:9)&&frameReport()?.workspace?.mode===(workspaceFull?'full':'unavailable'),'Final table-count workspace mode was not published');
  const temporaryIds=new Set(temporaryTables.map(t=>t.id));testWindows=testWindows.filter(w=>!temporaryIds.has(w.id));temporaryTables.forEach(t=>t.w.destroy());
  await waitUntil(()=>frameReport()?.frames.length===4&&frameReport()?.workspace?.mode==='full','Four-table workspace did not return');
  await waitUntil(()=>shared()[0]&&boundsApproximatelyEqual(shared()[0].getBounds(),originalClockBounds,1),'Returning to four tables did not restore its clock dock');
  originalLog('PASS: workspace transitions follow selected docks; full mode checks six, nine and twelve native table slots');
  const clock=shared()[0];
  const initialStatus=await clock.webContents.executeJavaScript('window.clockComfort.get()');
  if(initialStatus.playing||!initialStatus.paused||initialStatus.seconds!==0)throw new Error('Visible tables must start paused until Playing is explicitly selected');
  const distractions=[];
  for(let i=0;i<3;i++) {
    const w=new BrowserWindow({show:false,width:500,height:350,x:1400,y:100});
    await w.loadURL(`data:text/html,<title>Focus distraction ${i}</title>Controlled distraction`);
    const native=new Window(Number(w.getNativeWindowHandle().readBigUInt64LE()));native.path='C:\\test\\Distraction.exe';
    distractions.push(w);testWindows.push(native);w.showInactive();
  }
  distractions[1].maximize();distractions[2].minimize();
  distractions[1].moveTop();
  await waitUntil(()=>!shared()[0]?.isVisible(),'Covering app did not hide the table-attached shared clock');
  currentMenu.find(item=>item.label==='Start playing / minimize distractions').click();
  await waitUntil(()=>distractions[0].isMinimized()&&distractions[1].isMinimized(),'Playing did not minimize unrelated normal and maximized windows');
  if(tables.some(w=>w.isMinimized()))throw new Error('Playing minimized a protected poker table');
  const recovery=JSON.parse(fs.readFileSync(path.join(userData,'focus-windows.json'),'utf8'));
  if(recovery.entries.length!==2)throw new Error('Pre-minimized or protected windows entered the recovery journal');
  await new Promise(resolve=>setTimeout(resolve,1200));
  const running=await clock.webContents.executeJavaScript('window.clockComfort.get()');
  if(!running.playing||running.paused||running.seconds<1)throw new Error('Playing did not start the active session clock');
  distractions[0].restore();distractions[0].setBounds({x:1450,y:120,width:480,height:330});
  await clock.webContents.executeJavaScript("window.clockComfort.action('start-playing')");
  await new Promise(resolve=>setTimeout(resolve,150));const reopened=distractions[0].getBounds();
  if(distractions[0].isMinimized())throw new Error('Duplicate Start re-minimized a user-reopened app');
  await clock.webContents.executeJavaScript("document.getElementById('toggle-playing').click()");
  await waitUntil(()=>!distractions[1].isMinimized()&&distractions[1].isMaximized(),'Pause did not restore the previous maximized state');
  if(JSON.stringify(distractions[0].getBounds())!==JSON.stringify(reopened))throw new Error('Pause overwrote a window the user had reopened and repositioned');
  if(!distractions[2].isMinimized())throw new Error('Pause restored a window minimized before Playing');
  const pausedStatus=await clock.webContents.executeJavaScript('window.clockComfort.get()');
  await new Promise(resolve=>setTimeout(resolve,1100));
  const stillPaused=await clock.webContents.executeJavaScript('window.clockComfort.get()');
  if(stillPaused.playing||stillPaused.seconds!==pausedStatus.seconds)throw new Error('Sitting-out pause continued counting visible-table time');
  if(JSON.parse(fs.readFileSync(path.join(userData,'focus-windows.json'),'utf8')).entries.length)throw new Error('Successful Pause left stale recovery entries');
  distractions[1].destroy();distractions[2].destroy();
  const lastDistractionId=Number(distractions[0].getNativeWindowHandle().readBigUInt64LE());
  testWindows=testWindows.filter(w=>w.id===lastDistractionId||tables.some(t=>Number(t.getNativeWindowHandle().readBigUInt64LE())===w.id));
  tables.forEach(w=>w.moveTop());
  await waitUntil(()=>shared()[0]?.isVisible(),'Clock did not return after pausing the controlled focus session');
  await clock.webContents.executeJavaScript("document.getElementById('toggle-playing').click()");
  await waitUntil(()=>distractions[0].isMinimized(),'Resume did not begin a new one-time focus pass');
  originalLog('PASS: Playing minimizes only unrelated windows once, counts active time, Pause restores maximized state and respects user-reopened and pre-minimized windows');
  testWindows=testWindows.filter(w=>w.id===lastDistractionId);tables.forEach(w=>w.destroy());
  await waitUntil(()=>!distractions[0].isMinimized(),'Closing the last table did not restore the focus windows');
  await waitUntil(()=>frameReport()?.session?.playing===false,'Closing the last table did not publish a paused session');
  const closedSession=frameReport().session;
  if(closedSession.playing||!closedSession.paused)throw new Error('Closing the last table did not pause the playing session');
  testWindows=[];distractions[0].destroy();
  await waitUntil(()=>!shared()[0]?.isVisible(),'Default shared clock stayed visible after closing every table');
  await waitUntil(()=>frameReport()?.frames.length===0,'Automatic table attachments were not cleaned up');
  originalLog('PASS: real main automatically sorts higher stakes left with no button, reorders stake changes, ignores cosmetic changes and shows one shared clock by default');
}
(async () => {
  await import(pathToFileURL(path.join(appRoot, 'main.js')).href);
  await app.whenReady();
  await new Promise((resolve) => setTimeout(resolve, 1800));
  if (!complete || errors.length) throw new Error(`Main startup failed: ${errors.join('; ')}`);
  const saved = JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8'));
  if(automatic && saved.tableLayout.profiles.find(p=>p.id===saved.tableLayout.activeProfileId)?.monitorId!=='primary')throw new Error('Legacy secondary-monitor selection was not migrated to the main display');
  if (saved.autoRollMs !== 3000 || saved.turnRecognition) throw new Error('Timer defaults were not initialized correctly');
  if ((!lifecycle && (saved.tableLayout.enabled!==true || saved.tableLayout.autoArrange!==true || saved.tableLayout.arrangeOnStartup!==true || saved.comfort.clockMode!=='shared')) || saved.tableLayout.restoreOnStop !== false) {
    throw new Error('Automatic layout and shared-clock defaults were not initialized correctly');
  }
  originalLog('PASS: real main entrypoint completed startup without JavaScript errors');
  if(workspaceFull){const {calculatePokerWorkspace}=await import(pathToFileURL(path.join(appRoot,'src/poker-workspace.js')).href);if(calculatePokerWorkspace(automaticWork,12).mode!=='full'){originalLog('SKIP: twelve-table native workspace needs a larger main-display work area; offline geometry tests cover smaller displays.');app.quit();return;}}
  if(automatic)await testAutomaticLayout();else if (lifecycle) await testAttachment();
  app.quit();
})().catch(fail);
