import {
  agendaInput,
  dateInput,
  facilitatorSelect,
  form,
  projectSelect,
  resultSection,
  summaryContainer,
  templateSelect,
  timeInput,
} from "./dom.js";
import { renderSlackStatus, showError } from "./feedback.js";
import { updateCalendarWithEvent } from "./calendar.js";
import { onProjectChange } from "./projects.js";
import { escapeHtml, formatDateString, formatDisplayDate } from "./utils.js";

export function setDefaultDateTime() {
  if (!dateInput || !timeInput) {
    return;
  }

  const now = new Date();
  dateInput.value = formatDateString(now);
  timeInput.value = "09:30";
}

export async function handleFormSubmit(event) {
  event.preventDefault();

  if (!form) {
    return;
  }

  const formData = new FormData(form);
  const payload = Object.fromEntries(formData.entries());

  try {
    const response = await fetch("/api/schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "不明なエラーが発生しました");
    }

    const eventData = data.event;
    await updateCalendarWithEvent(eventData);

    renderSummary(eventData);
    renderSlackStatus(data.slackStatus);
    if (resultSection) {
      resultSection.hidden = false;
    }

    resetFormAfterSubmission(eventData);
  } catch (error) {
    console.error(error);
    showError(error.message);
  }
}

function resetFormAfterSubmission(eventData) {
  if (!form || !projectSelect || !facilitatorSelect || !templateSelect || !agendaInput || !dateInput || !timeInput) {
    return;
  }

  form.reset();
  projectSelect.value = eventData.projectId;
  onProjectChange();
  facilitatorSelect.value = eventData.facilitatorId;
  templateSelect.value = "";
  agendaInput.value = "";
  dateInput.value = eventData.date;
  timeInput.value = eventData.startTime;
}

function renderSummary(event) {
  if (!summaryContainer || !event) {
    return;
  }

  const dateLabel = formatDisplayDate(event.date);
  const agendaLabel = event.agendaSource === "custom" ? "自由入力" : event.agendaSource;
  summaryContainer.innerHTML = `
    <h3>${escapeHtml(event.projectName)}</h3>
    <p><strong>日時:</strong> ${escapeHtml(`${dateLabel} ${event.startTime}`)}</p>
    <p><strong>ファシリテーター:</strong> ${escapeHtml(event.facilitatorName)}</p>
    <p><strong>アジェンダ (${escapeHtml(agendaLabel)}):</strong></p>
    <pre>${escapeHtml(event.agenda)}</pre>
  `;
}
