import { mapreplacer, mapreviver } from "./utils.js";
import { getDaysSinceOptIn, resetStudyData } from "./study.js";

(() => {
  let placeholder = document.querySelector("#placeholder");
  let msuTable = placeholder.parentElement;
  let partIdCell = document.querySelector("#participantId");
  let optInDateCell = document.querySelector("#optInDate");
  let daysSinceCell = document.querySelector("#daysSinceOptIn");

  function loadStudyData() {
    browser.storage.local
      .get([
        "msuChoices",
      ])
      .then((res) => {
        let msuChoices = res.msuChoices;
        if (msuChoices === undefined) {
          return;  // load nothing
        }
        placeholder.remove();
        msuChoices = JSON.parse(msuChoices, mapreviver);
        msuChoices.forEach(addMsuChoiceRows);
      });
      browser.storage.sync
        .get([
          "studyParticipantId",
          "studyOptInDate",
        ])
        .then((res) => {
          if (res.studyParticipantId) {
            partIdCell.innerHTML = res.studyParticipantId;
          }
          if (res.studyOptInDate) {
            optInDateCell.innerHTML = res.studyOptInDate;
            getDaysSinceOptIn(function(days) {
              daysSinceCell.innerHTML = days;
            });
          }
        });
  }

  function addMsuChoiceRows(msuChoices, tsType) {
    var group = document.createElement("tbody");
    msuChoices.forEach((frequency, msu) => {
      var row = document.createElement("tr");
      var tsCol = document.createElement("td");
      tsCol.innerHTML = tsType;
      row.appendChild(tsCol);
      var msuCol = document.createElement("td");
      msuCol.innerHTML = msu;
      row.appendChild(msuCol);
      var freqCol = document.createElement("td");
      freqCol.innerHTML = frequency;
      row.appendChild(freqCol);
      group.appendChild(row);
    });
    msuTable.appendChild(group);
  }


  document.addEventListener("DOMContentLoaded", loadStudyData);
  document.querySelector("#studypurge").addEventListener("click", resetStudyData);
})();
