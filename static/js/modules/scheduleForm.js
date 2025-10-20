import {
  agendaInput,
  cancelEditButton,
  dateInput,
  deleteButton,
  editingNotice,
  eventIdInput,
  eventTypeInputs,
  facilitatorMentionInput,
  facilitatorSelect,
  form,
  projectIdInput,
  projectInput,
  resultSection,
  submitButton,
  summaryContainer,
  templateSelect,
  timeInput,
} from "./dom.js";
import { renderSlackStatus, showError } from "./feedback.js";
import {
  clearSelectedEvent,
  onCalendarEventSelect,
  removeEventFromCalendar,
  updateCalendarWithEvent,
} from "./calendar.js";
import {
  getProjectById,
  handleProjectInputChange,
  setFacilitatorHelp,
  setProjectSelection,
} from "./projects.js";
import { escapeHtml, formatDateString, formatDisplayDate } from "./utils.js";

const DEFAULT_SUBMIT_LABEL = "予定を保存";
const UPDATE_SUBMIT_LABEL = "予定を更新";

const EVENT_TYPE_MEETING = "meeting";
const EVENT_TYPE_SHARED = "shared";

let editing = false;

export function setDefaultDateTime() {
  if (!dateInput || !timeInput) {
    return;
  }

  const now = new Date();
  dateInput.value = formatDateString(now);
  timeInput.value = "09:30";
}

export function initializeScheduleForm() {
  onCalendarEventSelect((event) => {
    enterEditMode(event);
  });

  if (cancelEditButton) {
    cancelEditButton.addEventListener("click", () => {
      exitEditMode();
    });
  }

  if (eventTypeInputs.length > 0) {
    eventTypeInputs.forEach((input) => {
      input.addEventListener("change", () => {
        updateEventTypeState();
      });
    });
  }

  if (projectInput) {
    const handleProjectInput = () => {
      handleProjectInputChange();
      updateEventTypeState({ keepFacilitator: true });
    };
    projectInput.addEventListener("input", handleProjectInput);
    projectInput.addEventListener("change", handleProjectInput);
  }

  if (deleteButton) {
    deleteButton.addEventListener("click", handleDeleteRequest);
  }

  handleProjectInputChange();
  updateEventTypeState();
  
  updateSubmitButtonLabel();
}

export async function handleFormSubmit(event) {
  event.preventDefault();

  if (!form) {
    return;
  }

  const formData = new FormData(form);
  const payload = Object.fromEntries(formData.entries());
  const eventId = eventIdInput ? eventIdInput.value.trim() : "";

  payload.eventType = payload.eventType === EVENT_TYPE_SHARED ? EVENT_TYPE_SHARED : EVENT_TYPE_MEETING;
  payload.projectName = typeof payload.projectName === "string" ? payload.projectName.trim() : "";
  payload.projectId = typeof payload.projectId === "string" ? payload.projectId.trim() : "";
  payload.facilitatorId = typeof payload.facilitatorId === "string" ? payload.facilitatorId.trim() : "";
  payload.facilitatorMention = typeof payload.facilitatorMention === "string" ? payload.facilitatorMention.trim() : "";
  payload.customAgenda = typeof payload.customAgenda === "string" ? payload.customAgenda : "";
  payload.templateId = typeof payload.templateId === "string" ? payload.templateId.trim() : "";
  payload.date = typeof payload.date === "string" ? payload.date.trim() : "";
  payload.startTime = typeof payload.startTime === "string" ? payload.startTime.trim() : "";

  if (!payload.facilitatorId) {
    payload.facilitatorId = "";
  }

  if (eventId) {
    delete payload.eventId;
  }

  try {
    const endpoint = eventId ? `/api/schedule/${encodeURIComponent(eventId)}` : "/api/schedule";
    const response = await fetch(endpoint, {
      method: eventId ? "PUT" : "POST",
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

    prepareFormAfterSubmission(eventData, Boolean(eventId));
  } catch (error) {
    console.error(error);
    showError(error.message);
  }
}

function prepareFormAfterSubmission(eventData, wasEditing) {
  if (
    !form ||
    !projectInput ||
    !projectIdInput ||
    !facilitatorSelect ||
    !templateSelect ||
    !agendaInput ||
    !dateInput ||
    !timeInput
  ) {
    return;
  }

  if (wasEditing) {
    enterEditMode(eventData);
    return;
  }

  form.reset();
  if (eventIdInput) {
    eventIdInput.value = "";
  }

  setSelectedEventType(eventData.eventType || EVENT_TYPE_MEETING);
  setProjectSelection(eventData.projectId, eventData.projectName);

  if (eventData.eventType === EVENT_TYPE_MEETING) {
    facilitatorSelect.value = eventData.facilitatorId || "";
  } else {
    facilitatorSelect.value = "";
  }

  templateSelect.value = "";
  agendaInput.value = "";
  if (facilitatorMentionInput) {
    facilitatorMentionInput.value = eventData.facilitatorMention || "";
  }
  dateInput.value = eventData.date;
  timeInput.value = eventData.startTime;

  updateEventTypeState({ keepFacilitator: eventData.eventType === EVENT_TYPE_MEETING });
}

function renderSummary(event) {
  if (!summaryContainer || !event) {
    return;
  }

  const title = event.projectName || (event.eventType === EVENT_TYPE_SHARED ? "共有イベント" : "ミーティング");
  const typeLabel = event.eventType === EVENT_TYPE_SHARED ? "共有イベント" : "ミーティング";
  const dateLabel = formatDisplayDate(event.date);
  const agendaLabel = event.agendaSource === "custom" ? "自由入力" : event.agendaSource;
  const mentionSpan = event.facilitatorMention
    ? ` <span class="summary-mention">${escapeHtml(event.facilitatorMention)}</span>`
    : "";

  let facilitatorHtml = "";
  if (event.eventType === EVENT_TYPE_MEETING) {
    const facilitatorName = event.facilitatorName ? escapeHtml(event.facilitatorName) : "";
    if (facilitatorName) {
      facilitatorHtml = `<p><strong>ファシリテーター:</strong> ${facilitatorName}${mentionSpan}</p>`;
    } else {
      facilitatorHtml = `<p><strong>ファシリテーター:</strong> 未指定</p>`;
      if (event.facilitatorMention) {
        facilitatorHtml += `<p><strong>メンション:</strong> ${escapeHtml(event.facilitatorMention)}</p>`;
      }
    }
  } else if (event.facilitatorMention) {
    facilitatorHtml = `<p><strong>メンション:</strong> ${escapeHtml(event.facilitatorMention)}</p>`;
  }

  summaryContainer.innerHTML = `
    <h3>${escapeHtml(title)}</h3>
    <p><strong>種別:</strong> ${escapeHtml(typeLabel)}</p>
    <p><strong>日時:</strong> ${escapeHtml(`${dateLabel} ${event.startTime}`)}</p>
    ${facilitatorHtml}
    <p><strong>アジェンダ (${escapeHtml(agendaLabel)}):</strong></p>
    <pre>${escapeHtml(event.agenda || "")}</pre>
  `;
}

function enterEditMode(event) {
  if (
    !form ||
    !projectInput ||
    !projectIdInput ||
    !facilitatorSelect ||
    !templateSelect ||
    !agendaInput ||
    !dateInput ||
    !timeInput
  ) {
    return;
  }

  editing = true;
  if (eventIdInput) {
    eventIdInput.value = event.id;
  }

  setSelectedEventType(event.eventType || EVENT_TYPE_MEETING);
  setProjectSelection(event.projectId, event.projectName);
  if (event.eventType === EVENT_TYPE_MEETING) {
    facilitatorSelect.value = event.facilitatorId || "";
  } else {
    facilitatorSelect.value = "";
  }
  templateSelect.value = "";
  agendaInput.value = event.agenda;
  dateInput.value = event.date;
  timeInput.value = event.startTime;
  if (facilitatorMentionInput) {
    facilitatorMentionInput.value = event.facilitatorMention || "";
  }

  updateEventTypeState({ keepFacilitator: event.eventType === EVENT_TYPE_MEETING });
  updateSubmitButtonLabel();
  if (editingNotice) {
    editingNotice.hidden = false;
  }
  if (deleteButton) {
    deleteButton.hidden = false;
  }
}

function exitEditMode() {
  if (!form) {
    return;
  }

  editing = false;
  if (eventIdInput) {
    eventIdInput.value = "";
  }

  form.reset();
  setSelectedEventType(EVENT_TYPE_MEETING);
  setProjectSelection("", "");
  setDefaultDateTime();
  if (facilitatorMentionInput) {
    facilitatorMentionInput.value = "";
  }
  if (editingNotice) {
    editingNotice.hidden = true;
  }
  if (deleteButton) {
    deleteButton.hidden = true;
  }
  clearSelectedEvent();
  updateEventTypeState();
  updateSubmitButtonLabel();
}

function updateSubmitButtonLabel() {
  if (!submitButton) {
    return;
  }
  submitButton.textContent = editing ? UPDATE_SUBMIT_LABEL : DEFAULT_SUBMIT_LABEL;
}

function getSelectedEventType() {
  const selected = eventTypeInputs.find((input) => input.checked);
  return selected && selected.value === EVENT_TYPE_SHARED ? EVENT_TYPE_SHARED : EVENT_TYPE_MEETING;
}

function setSelectedEventType(eventType) {
  const target = eventType === EVENT_TYPE_SHARED ? EVENT_TYPE_SHARED : EVENT_TYPE_MEETING;
  if (eventTypeInputs.length === 0) {
    return;
  }
  eventTypeInputs.forEach((input) => {
    input.checked = input.value === target;
  });
}

function updateEventTypeState(options = {}) {
  const { keepFacilitator = false } = options;
  const eventType = getSelectedEventType();
  const isMeeting = eventType === EVENT_TYPE_MEETING;

  if (facilitatorSelect) {
    facilitatorSelect.required = isMeeting;
    if (!isMeeting) {
      if (!keepFacilitator) {
        facilitatorSelect.value = "";
      }
      facilitatorSelect.disabled = true;
    } else {
      const previousFacilitator = keepFacilitator ? facilitatorSelect.value : "";
      const currentProjectId = projectIdInput ? projectIdInput.value : "";
      if (currentProjectId) {
        const project = getProjectById(currentProjectId);
        if (project) {
          setProjectSelection(project.id, projectInput ? projectInput.value : project.name);
        } else {
          handleProjectInputChange();
        }
      } else {
        handleProjectInputChange();
      }
      if (keepFacilitator && previousFacilitator) {
        facilitatorSelect.value = previousFacilitator;
      }
      facilitatorSelect.disabled = facilitatorSelect.options.length <= 1;
    }
  }

  const helpMessage = isMeeting
    ? "プロジェクトを選ぶとメンバーが表示されます。"
    : "共有イベントではファシリテーターの選択は不要です。";
  setFacilitatorHelp(helpMessage);
}

async function handleDeleteRequest() {
  if (!eventIdInput) {
    return;
  }

  const eventId = eventIdInput.value.trim();
  if (!eventId) {
    return;
  }

  const hasConfirm = typeof window !== "undefined" && typeof window.confirm === "function";
  const confirmed = hasConfirm ? window.confirm("選択中の予定を削除しますか？") : true;
  if (!confirmed) {
    return;
  }

  try {
    const response = await fetch(`/api/schedule/${encodeURIComponent(eventId)}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "予定の削除に失敗しました");
    }

    removeEventFromCalendar(eventId);
    exitEditMode();
    renderSlackStatus(null);
    if (summaryContainer) {
      summaryContainer.innerHTML = "<p>予定を削除しました。</p>";
    }
    if (resultSection) {
      resultSection.hidden = false;
    }
  } catch (error) {
    console.error(error);
    showError(error.message);
  }
}
