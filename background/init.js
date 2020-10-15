browser.storage.sync.get("ghrOn").then((res) => {
  if (typeof res.ghrOn == "undefined") {
    browser.storage.sync.set({
      ghrOn: true,
    });
  } else if (!res.ghrOn) {
    browser.browserAction.setIcon({ path: "../icons/off.svg" });
  }
});
