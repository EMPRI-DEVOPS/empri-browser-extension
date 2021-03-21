import { DateTime } from "luxon";
import { v4 as uuidv4 } from "uuid";
import { RunningStats } from "./stats.js";

export class MsuChoiceRecord {
  constructor(daysSince, url, tsType, msu, frequency = 0) {
    this.daysSinceOptIn = daysSince;
    this.url = url;
    this.xpath = tsType;
    this.mostSignificantUnit = msu;
    this.frequency = frequency;
    this.distanceStats = new RunningStats();
  }

  inc(distance) {
    this.frequency++;
    if (Number.isFinite(distance)) { // Ingore Infinite distances (no neighbours)
      this.distanceStats.update(distance);
    }
  }

  matches(other) {
    return (
      this.daysSinceOptIn == other.daysSinceOptIn &&
      this.url == other.url &&
      this.xpath == other.xpath &&
      this.mostSignificantUnit == other.mostSignificantUnit
    );
  }

  toReportFormat() {
    let report = {
      daysSinceOptIn: this.daysSinceOptIn,
      url: this.url,
      xpath: this.xpath,
      mostSignificantUnit: this.mostSignificantUnit,
      frequency: this.frequency
    };
    // include distance stats if
    // - timestamp has siblings (and distances), and
    // - timestamp has been unredacted more than once (to report a stddev)
    if (this.distanceStats.count > 1) {
      report.distanceStats = {
        mean: Math.round(this.distanceStats.mean),
        stddev: Math.round(this.distanceStats.std),
      };
    }
    return report;
  }

  static from(json) {
    let record = Object.assign(new MsuChoiceRecord(), json);
    record.distanceStats = Object.assign(new RunningStats(), record.distanceStats);
    return record;
  }
}

class Report {
  constructor(partId) {
    this.participantIdentifier = partId;
    this.entries = [];
  }
}

// Random participant identifier
function generateParticipantId() {
  return uuidv4();
}

// Init study
// - generate participant id if not set
// - set opt-in date
export function initStudy() {
  console.log("Init Study");
  browser.storage.local
    .get([
      "studyParticipantId",
      "studyOptInDate",
    ])
    .then((res) => {
      if (res.studyParticipantId === undefined) {
        let partId = generateParticipantId();
        console.log(`New participant id: ${partId}`);
        browser.storage.local.set({
          studyParticipantId: partId,
        });
      }
      if (res.studyOptInDate === undefined) {
        let optInDate = DateTime.utc().toFormat("yyyy-MM-dd");
        console.log(`New opt-in date: ${optInDate}`);
        browser.storage.local.set({
          studyOptInDate: optInDate,
        });
      }
    });
}

export function clearStudyData() {
  browser.storage.local.remove("msuChoices");
  browser.storage.local.remove("studyLastReport");
  browser.storage.local.remove("studyParticipantId");
  browser.storage.local.remove("studyOptInDate");
}

export function resetStudyData() {
  clearStudyData();
  initStudy();
}

export function calcDaysSince(date, reference) {
  let refDate;
  if (reference === undefined) {
    refDate = DateTime.utc();
  } else {
    refDate = DateTime.fromFormat(reference, "yyyy-MM-dd");
  }
  let datetime = DateTime.fromFormat(date, "yyyy-MM-dd");
  return -Math.trunc(datetime.diff(refDate, "days").days);
}

export function updateStudyData(urlType, tsType, msu, distance) {
  // increment counter in local storage area
  return browser.storage.local.get([
    "msuChoices",
    "studyOptInDate", // to calc daysSince
  ])
  .then((res) => {
    if (res.msuChoices === undefined) {
      res.msuChoices = [];
    }

    let daysSince = calcDaysSince(res.studyOptInDate);
    let newChoice = new MsuChoiceRecord(daysSince, urlType, tsType, msu);

    // reuse existing matching choice or add new one
    let msuChoices = Array.from(res.msuChoices, MsuChoiceRecord.from);
    let matchingRecord = msuChoices.find(newChoice.matches, newChoice);
    if (matchingRecord === undefined) {
      msuChoices.push(newChoice);
      matchingRecord = newChoice;
    }

    // increment choice frequency
    matchingRecord.inc(distance);

    // store updated stats
    return browser.storage.local.set({ msuChoices: msuChoices });
  })
  .catch((error) => console.error(error));
}

export function buildReport(firstDay = 0) {
  return browser.storage.local.get([
    "msuChoices",
    "studyParticipantId",
  ])
  .then((result) => {
    let msuChoices = result.msuChoices;
    let partID = result.studyParticipantId;
    let report = {participantIdentifier: partID};

    if (msuChoices === undefined) {
      msuChoices = [];
    }

    // filter out entries before firstDay
    let allEntries = Array.from(msuChoices, MsuChoiceRecord.from);
    let newEntries = allEntries.filter((e) => e.daysSinceOptIn >= firstDay);
    report.entries = newEntries.map((e) => e.toReportFormat());

    return report;
  })
  .catch((error) => console.error(error));
}

export function sendReport() {
  return browser.storage.local.get([
    "studyLastReport",
    "studyOptInDate",
  ])
  .then((result) => {
    let lastReport = result.studyLastReport;
    let optInDate = result.studyOptInDate;
    let startDay;

    if (lastReport === undefined) {
      startDay = 0; // first report – send everything
    } else {
      let daysSinceReport = calcDaysSince(lastReport);
      if (daysSinceReport < 1) {
        // already sent a report today – do nothing
        return;
      }
      startDay = calcDaysSince(lastReport, optInDate);
    }
    return buildReport(startDay);
  })
  .then((report) => {
    if (report && report.entries.length > 0) {
      console.log("Try to send report...");
      console.log(report);
      return fetch(API_URL + "/data_point", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization:
            "Basic " +
            btoa(
              process.env.BROWSER_USER + ":" + process.env.BROWSER_PASSWORD
            ),
        },
        body: JSON.stringify(report),
      })
    }
  })
  .then((res) => {
    if (res && res.status == 201) { // reporting succeeded
      // update last report date
      let today = DateTime.utc().toFormat("yyyy-MM-dd");
      return browser.storage.local.set({ studyLastReport: today });
    } else if (res) { // reporting failed somehow
      console.error("Reporting failed:", response);
    }
  });
}
