const path = require("path");
const { app, BrowserWindow, ipcMain } = require("electron");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const committedValues = new Map();
const rollIds = new Map();
const clickedValues = new Map();
const committedIds = new Map();
let intervalRequests = 0;
function sendRoll(win, value) {
  const sender = win.webContents || win;
  const rollId = (rollIds.get(sender.id) || 0) + 1;
  rollIds.set(sender.id, rollId);
  sender.send("roll-now", { value, rollId });
  return rollId;
}

ipcMain.on("rng-value", (event, value, rollId) => {
  if (rollId !== rollIds.get(event.sender.id)) return;
  committedValues.set(event.sender.id, Number(value));
  committedIds.set(event.sender.id, rollId);
});
ipcMain.on("rng-clicked", (event, reason) => {
  if (reason === "interval") intervalRequests++;
  const current = committedValues.get(event.sender.id) ?? 0;
  const value = reason === "initial" ? 37 : current;
  if (reason === "manual") clickedValues.set(event.sender.id, value);
  sendRoll(event.sender, value);
});

async function readDisplay(win) {
  return win.webContents.executeJavaScript(`
    (() => {
      const num = document.getElementById("num");
      return {
        value: Number(Array.from(num.querySelectorAll(".d")).map((node) => node.textContent).join("")),
        color: getComputedStyle(num).color,
        rolling: num.classList.contains("rolling"),
        cardBackground: getComputedStyle(document.querySelector(".card")).backgroundColor,
        cardBorder: getComputedStyle(document.querySelector(".card")).borderStyle,
        cardShadow: getComputedStyle(document.querySelector(".card")).boxShadow
      };
    })()
  `);
}

app.whenReady().then(async () => {
  const windows = [];
  try {
    for (let index = 0; index < 4; index++) {
      const win = new BrowserWindow({
        show: false,
        width: 64,
        height: 48,
        frame: false,
        transparent: true,
        focusable: true,
        webPreferences: {
          preload: path.join(__dirname, "..", "preload.cjs"),
          contextIsolation: true,
          nodeIntegration: false,
          backgroundThrottling: false
        }
      });
      await win.loadFile(path.join(__dirname, "..", "index.html"));
      windows.push(win);
    }

    windows[0].showInactive();
    windows[0].focus();
    await sleep(500);
    await windows[0].webContents.executeJavaScript(`
      window.__nativeClickCount = 0;
      document.getElementById("hotspot").addEventListener("click", () => window.__nativeClickCount++);
    `);
    const clickInitial = await readDisplay(windows[0]);
    windows[0].webContents.sendInputEvent({ type: "mouseDown", x: 32, y: 24, button: "left", clickCount: 1 });
    windows[0].webContents.sendInputEvent({ type: "mouseUp", x: 32, y: 24, button: "left", clickCount: 1 });
    await sleep(500);
    const clickFinal = await readDisplay(windows[0]);
    const clickDiagnostics = await windows[0].webContents.executeJavaScript(`
      ({
        count: window.__nativeClickCount,
        element: document.elementFromPoint(32, 24)?.id || document.elementFromPoint(32, 24)?.className || null
      })
    `);
    windows[0].hide();
    if (clickDiagnostics.count !== 1 || clickFinal.value !== clickedValues.get(windows[0].webContents.id) || clickFinal.rolling) {
      throw new Error(`Direct click did not complete a new RNG roll: ${JSON.stringify({ clickInitial, clickFinal, clickDiagnostics, focused: windows[0].isFocused() })}`);
    }

    const initial = await Promise.all(windows.map(readDisplay));
    const targets = initial.map((state, index) => (state.value + 17 + index) % 100);

    windows.forEach((win, index) => sendRoll(win, targets[index]));
    await sleep(120);
    const during = await Promise.all(windows.map(readDisplay));
    await sleep(450);
    const final = await Promise.all(windows.map(readDisplay));

    for (let index = 0; index < windows.length; index++) {
      if (!during[index].rolling || during[index].value === initial[index].value) {
        throw new Error(`Overlay ${index + 1} did not visibly roll`);
      }
      if (final[index].rolling || final[index].value !== targets[index]) {
        throw new Error(`Overlay ${index + 1} did not commit target ${targets[index]}`);
      }
      if (committedValues.get(windows[index].webContents.id) !== targets[index]) {
        throw new Error(`Overlay ${index + 1} did not report its committed value`);
      }
      if (
        final[index].cardBackground !== "rgba(18, 18, 18, 0.68)" ||
        final[index].cardBorder !== "solid" ||
        final[index].cardShadow === "none"
      ) {
        throw new Error(`Overlay ${index + 1} card styling was not restored`);
      }
    }

    // Production-sized cards must still contain both digits after the former
    // one-second fallback deadline and after table-size notifications.
    windows.forEach((win) => win.webContents.send("table-size", { width: 1000, height: 700 }));
    await sleep(1100);
    for (const win of windows) {
      const fits = await win.webContents.executeJavaScript(`
        (() => {
          const number = document.getElementById('num').getBoundingClientRect();
          const card = document.querySelector('.card').getBoundingClientRect();
          return number.left >= card.left && number.right <= card.right && number.top >= card.top && number.bottom <= card.bottom;
        })()
      `);
      if (!fits) throw new Error('Digits were clipped inside a production-sized card');
    }

    sendRoll(windows[0], 50);
    await sleep(150);
    const newestId = sendRoll(windows[0], 0);
    await sleep(320);
    if ((await readDisplay(windows[0])).value !== 0) throw new Error('Rapid authoritative target was not committed');
    windows[0].webContents.send("roll-now", { value: 99, rollId: newestId - 1 });
    await sleep(450);
    if ((await readDisplay(windows[0])).value !== 0) throw new Error('Stale target replaced a newer roll');

    const beforeTimer = committedIds.get(windows[0].webContents.id);
    windows[0].webContents.send("set-auto-roll-interval", 1000);
    await sleep(1650);
    windows[0].webContents.send("set-auto-roll-interval", 0);
    if (intervalRequests < 1 || committedIds.get(windows[0].webContents.id) <= beforeTimer) {
      throw new Error('Configured timer did not generate and commit a new roll');
    }
    console.log(JSON.stringify({ clickInitial, clickFinal, initial, targets, during, final, intervalRequests }, null, 2));
    app.exit(0);
  } catch (error) {
    console.error(error.stack || error.message);
    app.exit(1);
  }
});
