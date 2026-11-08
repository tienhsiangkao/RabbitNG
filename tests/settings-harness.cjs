const path = require("path");
const { pathToFileURL } = require("url");
const { app, BrowserWindow, ipcMain } = require("electron");
const root=path.resolve(process.argv[2]||path.join(__dirname,'..'));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitUntil(predicate, message, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await sleep(25);
  }
  throw new Error(message);
}

app.whenReady().then(async () => {
  let win = null;
  try {
    const layoutModule = await import(
      pathToFileURL(path.join(root, "src", "table-layout.js")).href
    );
    const appearanceModule = await import(pathToFileURL(path.join(root,'src','appearance-settings.js')).href);
    const comfortModule = await import(pathToFileURL(path.join(root,'src','session-comfort.js')).href);
    const focusModule=await import(pathToFileURL(path.join(root,'src','session-focus-model.js')).href);
    let payload = {
      quietMode: true,
      autoStartEnabled: false,
      showOnlyActiveTables: false,
      turnRecognitionEnabled: false,
      showBuyInOverlay: true,
      showClockOverlay: true,
      showStakeFrame: true,
      scanMs: 300,
      autoRollSeconds: 0,
      appearance:appearanceModule.normalizeAppearance(),
      comfort:comfortModule.normalizeComfort(),
      displays: [
        { id: "primary", label: "Monitor 1 (Primary) - 1440x852" },
        { id: "monitor:20", label: "Monitor 2 - 2560x1392" }
      ],
      tableLayout: layoutModule.normalizeTableLayoutSettings({enabled:false,arrangeOnStartup:false})
    };
    let applyRequests = 0;

    ipcMain.handle("settings:get", () => payload);
    ipcMain.handle("settings:update", (_event, patch = {}) => {
      if(patch.sessionFocus)payload.sessionFocus=focusModule.patchSessionFocus(payload.sessionFocus,patch.sessionFocus);
      if(patch.appearance) payload.appearance=appearanceModule.patchAppearance(payload.appearance,patch.appearance);
      if(patch.comfort) payload.comfort=comfortModule.normalizeComfort({...payload.comfort,...patch.comfort});
      if (typeof patch.showStakeFrame === 'boolean') payload = {...payload,showStakeFrame:patch.showStakeFrame};
      if (patch.tableLayout) {
        const layoutPatch = patch.tableLayout;
        let config = layoutModule.normalizeTableLayoutSettings(payload.tableLayout);
        for (const key of ["enabled", "autoArrange", "lockLayout", "arrangeOnStartup", "restoreOnStop"]) {
          if (typeof layoutPatch[key] === "boolean") config = { ...config, [key]: layoutPatch[key] };
        }
        if (
          typeof layoutPatch.activeProfileId === "string" &&
          config.profiles.some((profile) => profile.id === layoutPatch.activeProfileId)
        ) {
          config = { ...config, activeProfileId: layoutPatch.activeProfileId };
        }
        if (typeof layoutPatch.createProfileName === "string") {
          config = layoutModule.createLayoutProfile(config, layoutPatch.createProfileName);
        }
        if (layoutPatch.profile) {
          config = layoutModule.upsertLayoutProfile(config, layoutPatch.profile);
        }
        if (typeof layoutPatch.deleteProfileId === "string") {
          config = layoutModule.deleteLayoutProfile(config, layoutPatch.deleteProfileId);
        }
        if (layoutPatch.applyNow === true) applyRequests++;
        payload = { ...payload, tableLayout: layoutModule.normalizeTableLayoutSettings(config) };
      }
      return payload;
    });

    win = new BrowserWindow({
      show: false,
      width: 520,
      height: 820,
      webPreferences: {
        preload: path.join(root, "settings-preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false
      }
    });
    await win.loadFile(path.join(root, "settings.html"));
    await waitUntil(
      () => win.webContents.executeJavaScript("document.querySelectorAll('#layoutProfile option').length === 1"),
      "Settings UI did not render the initial layout profile"
    );
    await win.webContents.executeJavaScript(`
      const frameToggle = document.getElementById('stakeFrame');
      if (!frameToggle.checked) throw new Error('Stake frame should start enabled');
      frameToggle.checked = false;
      frameToggle.dispatchEvent(new Event('change',{bubbles:true}));
    `);
    await waitUntil(() => payload.showStakeFrame === false,'Stake frame toggle was not saved');
    await win.webContents.executeJavaScript(`
      const scale=document.getElementById('rngScale');
      if(!scale) throw new Error('Missing live appearance control');
      scale.value='125';scale.dispatchEvent(new Event('input',{bubbles:true}));
    `);
    await waitUntil(()=>payload.appearance.rngScale===1.25,'Live size change was not saved');
    await win.webContents.executeJavaScript("document.getElementById('saveFour').click()");
    await waitUntil(()=>payload.appearance.presets.four.rngScale===1.25,'Four table appearance preset not saved');
    await win.webContents.executeJavaScript("document.getElementById('resetAppearance').click()");
    await waitUntil(()=>payload.appearance.rngScale===1,'Appearance reset failed');
    await win.webContents.executeJavaScript("document.getElementById('loadFour').click()");
    await waitUntil(()=>payload.appearance.rngScale===1.25,'Four table appearance preset not loaded');
    await win.webContents.executeJavaScript(`
      const mode=document.getElementById('clockMode');mode.value='shared';mode.dispatchEvent(new Event('change',{bubbles:true}));
      const interval=document.getElementById('breakMinutes');interval.value='45';interval.dispatchEvent(new Event('change',{bubbles:true}));
    `);
    await waitUntil(()=>payload.comfort.clockMode==='shared'&&payload.comfort.breakMinutes===45,'Clock/break preferences were not saved');
    if(applyRequests!==0) throw new Error('Appearance/clock preferences moved tables');

    await win.webContents.executeJavaScript(`
      (() => {
        const enabled = document.getElementById("layoutEnabled");
        enabled.checked = true;
        enabled.dispatchEvent(new Event("change", { bubbles: true }));
      })()
    `);
    await waitUntil(() => payload.tableLayout.enabled === true, "Layout enable toggle was not saved");
    if (applyRequests !== 0) throw new Error('Enabling layout must not arrange tables');
    await win.webContents.executeJavaScript(`
      for (const id of ['layoutStartup', 'layoutRestore']) {
        const input = document.getElementById(id);
        if (input.checked) throw new Error('New layout options must default to off');
        input.checked = true;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    `);
    await waitUntil(() => payload.tableLayout.arrangeOnStartup && payload.tableLayout.restoreOnStop, 'Layout startup/restore settings were not saved');
    if (applyRequests !== 0) throw new Error('Saving layout options must not arrange tables');

    await win.webContents.executeJavaScript(`
      (() => {
        const columns = document.getElementById("layoutColumns");
        columns.value = "3";
        columns.dispatchEvent(new Event("change", { bubbles: true }));
      })()
    `);
    await waitUntil(
      () => layoutModule.getActiveLayoutProfile(payload.tableLayout).columns === 3,
      "Column setting was not saved"
    );

    await win.webContents.executeJavaScript(`
      document.getElementById("newProfileName").value = "Six tables";
      document.getElementById("addProfileBtn").click();
    `);
    await waitUntil(() => payload.tableLayout.profiles.length === 2, "Profile creation failed");
    await waitUntil(
      () => win.webContents.executeJavaScript("document.querySelectorAll('#layoutProfile option').length === 2"),
      "Created profile was not rendered"
    );

    await win.webContents.executeJavaScript(`
      (() => {
        if (${applyRequests} !== 0) throw new Error('Editing or creating profiles must not arrange tables');
        const monitor = document.getElementById("layoutMonitor");
        monitor.value = "monitor:20";
        monitor.dispatchEvent(new Event("change", { bubbles: true }));
        document.getElementById("applyLayoutBtn").click();
      })()
    `);
    await waitUntil(
      () => layoutModule.getActiveLayoutProfile(payload.tableLayout).monitorId === "monitor:20",
      "Monitor selection was not saved"
    );
    await waitUntil(() => applyRequests > 0, "Arrange-now action was not delivered");

    const result = await win.webContents.executeJavaScript(`
      ({
        enabled: document.getElementById("layoutEnabled").checked,
        controlsDisabled: document.getElementById("layoutControls").getAttribute("aria-disabled"),
        profileCount: document.querySelectorAll("#layoutProfile option").length,
        activeProfile: document.getElementById("layoutProfile").value,
        monitor: document.getElementById("layoutMonitor").value,
        columns: Number(document.getElementById("layoutColumns").value)
      })
    `);

    if (
      result.enabled !== true ||
      result.controlsDisabled !== "false" ||
      result.profileCount !== 2 ||
      result.activeProfile !== "six-tables" ||
      result.monitor !== "monitor:20" ||
      result.columns !== 3
    ) {
      throw new Error(`Unexpected settings state: ${JSON.stringify(result)}`);
    }

    await win.webContents.executeJavaScript(`(()=>{const el=document.getElementById('sessionFocus2');el.value='Settings dirty second';el.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    payload.sessionFocus=focusModule.patchSessionFocus(payload.sessionFocus,{lineEdits:{0:'New from panel'}});
    win.webContents.send('settings:updated',payload);
    await waitUntil(async()=>await win.webContents.executeJavaScript("document.getElementById('sessionFocus1').value==='New from panel'"),'External clean row was not merged');
    await win.webContents.executeJavaScript("document.getElementById('saveSessionFocus').click()");
    await waitUntil(()=>payload.sessionFocus.lines[1]==='Settings dirty second','Dirty Settings row not saved');
    if(payload.sessionFocus.lines[0]!=='New from panel')throw Error('Settings clobbered another editor row');
    const {urgentDrills}=await import(pathToFileURL(path.join(root,'src/user-drill-presets.js')).href);
    payload.sessionFocus=focusModule.patchSessionFocus(payload.sessionFocus,{drills:urgentDrills});win.webContents.send('settings:updated',payload);
    await waitUntil(async()=>await win.webContents.executeJavaScript('!!document.getElementById("sessionFocus7")'),'Seventh Settings reminder missing');
    if(!(await win.webContents.executeJavaScript('document.getElementById("sessionFocus6").value.includes("KJo/KTo")')))throw Error('Settings truncated modular detail');
    await win.webContents.executeJavaScript('(()=>{const e=document.getElementById("sessionFocus7");e.value="Full Settings condition "+"x".repeat(450);e.dispatchEvent(new Event("input",{bubbles:true}));document.getElementById("saveSessionFocus").click();})()');
    await waitUntil(()=>payload.sessionFocus.drills[6].detail.length>450,'Long modular Settings detail did not save');
    if(payload.sessionFocus.drills[6].action!==urgentDrills[6].action)throw Error('Settings detail edit erased adjustment');
    console.log(JSON.stringify({ ...result, applyRequests,focusEditorMerge:true }, null, 2));
    app.exit(0);
  } catch (error) {
    console.error(error.stack || error.message);
    if (win && !win.isDestroyed()) win.destroy();
    app.exit(1);
  }
});
