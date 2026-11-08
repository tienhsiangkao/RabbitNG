import test from "node:test";
import assert from "node:assert/strict";
import {
  isBrowserWindow,
  isCoinPokerContainerWindow,
  isKnownNonTablePokerWindowTitle,
  isKnownPokerClientWindow
} from "../src/window-classifier.js";

test("rejects browser executables even when the tab title looks like poker", () => {
  assert.equal(
    isBrowserWindow({
      path: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      getTitle: () => "Rush & Cash - $0.05 / $0.10"
    }),
    true
  );
});

test("rejects browser title suffix when executable metadata is unavailable", () => {
  assert.equal(
    isBrowserWindow({
      path: "",
      getTitle: () => "NLH $0.05 / $0.10 - Google Chrome"
    }),
    true
  );
});

test("rejects browser title suffix with en dash when executable metadata is unavailable", () => {
  assert.equal(
    isBrowserWindow({
      path: "",
      getTitle: () => "NLH $0.05 / $0.10 – Google Chrome"
    }),
    true
  );
});

test("allows the real GGPoker executable", () => {
  assert.equal(
    isBrowserWindow({
      path: "C:\\Users\\admin\\AppData\\Roaming\\GGPCOM\\bin\\Loader\\GGnet.exe",
      getTitle: () => "Rush & Cash - $0.05 / $0.10"
    }),
    false
  );
});

test("identifies real GGPoker executable as a poker client", () => {
  assert.equal(
    isKnownPokerClientWindow({
      path: "C:\\Users\\admin\\AppData\\Roaming\\GGPCOM\\bin\\Loader\\GGnet.exe",
      getTitle: () => "Rush & Cash - $0.05 / $0.10"
    }),
    true
  );
});

test("identifies the CoinPoker executable as a poker client", () => {
  assert.equal(
    isKnownPokerClientWindow({
      path: "C:\\Program Files\\CoinPoker\\CoinPoker.exe",
      getTitle: () => "CoinPoker"
    }),
    true
  );
});

test("identifies only CoinPoker's titled main window as its table container", () => {
  assert.equal(
    isCoinPokerContainerWindow({
      path: "C:\\Program Files\\CoinPoker\\resources\\unity-resources-win-x64\\CoinPoker Game\\CoinPoker.exe",
      getTitle: () => "CoinPoker"
    }),
    true
  );
  assert.equal(
    isCoinPokerContainerWindow({
      path: "C:\\Program Files\\CoinPoker\\resources\\unity-resources-win-x64\\CoinPoker Game\\CoinPoker.exe",
      getTitle: () => ""
    }),
    false
  );
  assert.equal(
    isCoinPokerContainerWindow({
      path: "C:\\Program Files\\CoinPoker\\CoinPoker.exe",
      getTitle: () => "CoinPoker"
    }),
    false
  );
  assert.equal(
    isCoinPokerContainerWindow({
      path: "C:\\Users\\admin\\AppData\\Roaming\\GGPCOM\\bin\\Loader\\GGnet.exe",
      getTitle: () => "CoinPoker"
    }),
    false
  );
});

test("does not treat poker-looking browser titles as poker clients", () => {
  assert.equal(
    isKnownPokerClientWindow({
      path: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      getTitle: () => "Rush & Cash - $0.05 / $0.10"
    }),
    false
  );
});

test("rejects poker-client chat windows even when title contains table stakes", () => {
  assert.equal(
    isKnownNonTablePokerWindowTitle("Rush & Cash $0.05 / $0.10 - Chat"),
    true
  );
});

test("rejects hand history windows even when title contains table markers", () => {
  assert.equal(
    isKnownNonTablePokerWindowTitle("[#] NLH gold 12 - $0.05 / $0.10 [#] - Hand History"),
    true
  );
});

test("rejects lobby and cashier poker windows", () => {
  assert.equal(isKnownNonTablePokerWindowTitle("Tournament Lobby - NLH $0.05 / $0.10"), true);
  assert.equal(isKnownNonTablePokerWindowTitle("Cashier - Rush & Cash"), true);
});

test("does not reject normal table titles as non-table poker windows", () => {
  assert.equal(isKnownNonTablePokerWindowTitle("Rush & Cash $0.05 / $0.10 [6]"), false);
  assert.equal(isKnownNonTablePokerWindowTitle("[#] NLH gold 12 - $0.05 / $0.10 [#]"), false);
});

test("supports custom non-table title keywords from settings", () => {
  assert.equal(
    isKnownNonTablePokerWindowTitle("Rush & Cash $0.05 / $0.10 - Custom Tool", {
      keywords: ["Custom Tool"]
    }),
    true
  );
});
