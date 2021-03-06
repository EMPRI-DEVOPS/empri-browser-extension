import { sendReport } from "./study.js";

browser.storage.sync.get("ghrOn").then((res) => {
  if (typeof res.ghrOn == "undefined") {
    browser.storage.sync.set({
      ghrOn: true,
      mostsigunit: "year",
      studyOptIn: false,
    });
  } else if (!res.ghrOn) {
    browser.browserAction.setIcon({
      path: {
        19: "../images/off-19.png",
        38: "../images/off-38.png",
      },
    });
  }
});

browser.runtime.onInstalled.addListener(async ({ reason, temporary }) => {
  if (temporary) return; // skip during development
  switch (reason) {
    case "install":
      {
        const url = browser.runtime.getURL("pages/welcome.html");
        await browser.tabs.create({ url });
      }
      break;
  }
});


// Synchronise reporting in background script to avoid
// duplicate reporting by parallel active content scripts
var reportRunning = false;
function manageReporting(message, sender, respond) {
  if (message.type != "sendReport") {
    return; // message not for us
  }
  if (reportRunning) {
    return; // already triggered by another sender
  }
  reportRunning = true;
  sendReport()
  .then(() => respond("done"))
  .catch((err) => respond(err))
  .finally(() => {
    reportRunning = false;
  });
  return true; // make caller wait for async response
}
browser.runtime.onMessage.addListener(manageReporting);
