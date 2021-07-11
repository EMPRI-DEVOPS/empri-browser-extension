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
  return browser.storage.local.get([
    "studyParticipantId",
    "studyOptInDate",
  ])
  .then((res) => {
    let partId = res.studyParticipantId;
    let optInDate = res.studyOptInDate;
    let dirty = false;

    if (partId === undefined) {
      partId = generateParticipantId();
      console.log(`New participant id: ${partId}`);
      dirty = true;
    }
    if (res.studyOptInDate === undefined) {
      optInDate = DateTime.utc().toFormat("yyyy-MM-dd");
      console.log(`New opt-in date: ${optInDate}`);
      dirty = true;
    }

    if (dirty) {
      return browser.storage.local.set({
          studyParticipantId: partId,
          studyOptInDate: optInDate,
      });
    }
  })
  .catch((error) => console.error(error));
}

export function clearStudyData() {
  return browser.storage.local.remove([
    "msuChoices",
    "studyLastReport",
    "studyParticipantId",
    "studyOptInDate",
    "viewCounts",
  ])
  .catch((error) => console.error(error));
}

export function resetStudyData() {
  clearStudyData()
  .then(() => initStudy())
  .catch((error) => console.error(error));
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

export function updateViewCount(urlType) {
  // increment counter in local storage area
  return browser.storage.local.get([
    "studyOptInDate", // to calc daysSince
    "viewCounts",
  ])
  .then((res) => {
    let daysSince = calcDaysSince(res.studyOptInDate);
    let viewCounts = res.viewCounts;
    if (viewCounts === undefined) {
      viewCounts = {};
    }

    if (!viewCounts.hasOwnProperty(daysSince)) {
      viewCounts[daysSince] = {};
    }
    if (!viewCounts[daysSince].hasOwnProperty(urlType)) {
      viewCounts[daysSince][urlType] = 0;
    }
    viewCounts[daysSince][urlType]++;

    // store updated counts
    return browser.storage.local.set({ viewCounts: viewCounts });
  })
  .catch((error) => console.error(error));
}

export function buildReport(firstDay = 0, untilDay = Infinity) {
  return browser.storage.local.get([
    "msuChoices",
    "studyParticipantId",
    "viewCounts",
  ])
  .then((result) => {
    let msuChoices = result.msuChoices;
    let partID = result.studyParticipantId;
    let vcs = result.viewCounts;
    let report = {
      participantIdentifier: partID,
      viewCounts: {}
    };

    if (msuChoices === undefined) {
      msuChoices = [];
    }

    // filter out entries before firstDay
    let allEntries = Array.from(msuChoices, MsuChoiceRecord.from);
    let newEntries = allEntries.filter((e) => dayInRange(e.daysSinceOptIn, firstDay, untilDay));
    report.entries = newEntries.map((e) => e.toReportFormat());

    // filter out view counts
    for (var day in vcs) {
      if (vcs.hasOwnProperty(day)) {
        if (dayInRange(day, firstDay, untilDay)) {
            report.viewCounts[day] = vcs[day];
        }
      }
    }

    return report;
  })
  .catch((error) => console.error(error));
}

function dayInRange(day, since, until) {
  return day >= since && day < until;
}

export function sendReport() {
  // Report all data starting from the day of the last report
  // until but not including today's data.
  return browser.storage.local.get([
    "studyLastReport", // data up to but not inclding this day has been sent
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
      // Start report from the day last report occurred
      // Example: optIn 03/21, lastReport 03/23 => startDay=2
      startDay = calcDaysSince(lastReport, optInDate);
    }
    // Report until but not including today's data
    let todaysDaysSince = calcDaysSince(optInDate);
    return buildReport(startDay, todaysDaysSince);
  })
  .then((report) => {
    if (report && (
        report.entries.length > 0 ||
        Object.keys(report.viewCounts).length > 0
    )) {
      console.log("Try to send report...");
      console.log(report);
      return fetch(API_URL + "/v2/data_point", {
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
      console.error("Reporting failed:", res);
    }
    return true; // indicate nothing was reported
  })
  .then((notReported) => {
    if (!notReported) {
      // reset view counts for next report
      console.log("Reset view count");
      return browser.storage.local.set({ viewCounts: {} });
    }
  })
  .catch((error) => console.error(error));
}


export function requestDeletion() {
  return browser.storage.local.get([
    "studyParticipantId",
    "studyLastReport",
  ])
  .then((result) => {
    let partId = result.studyParticipantId;
    let lastSent = result.studyLastReport;
    let isReported = (lastSent != undefined);

    if (!isReported) {
      console.log("No reports sent yet.");
      return false;
    }

    return fetch(API_URL + "/v2/participant/" + partId, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Authorization:
          "Basic " +
          btoa(
            process.env.BROWSER_USER + ":" + process.env.BROWSER_PASSWORD
          ),
      },
    })
  })
  .then((res) => {
    if (res === false) { // nothing to delete
      return { result: "notsent" };
    } else if (res && res.status == 204) { // deletion succeeded
      return { result: "deleted" };
    } else if (res) { // deletion failed somehow
      return {
        result: "error",
        status: res.status,
      };
    }
  });
}
