import { calendarGrid, monthLabel } from "./dom.js";
import { formatDateString, sortEventsInPlace, startOfMonth } from "./utils.js";

let currentMonth = startOfMonth(new Date());
const todayString = formatDateString(new Date());
let scheduleCache = [];
let holidaysCache = [];
let selectedEventId = null;
const eventSelectListeners = new Set();
const EVENT_TYPE_MEETING = "meeting";
const EVENT_TYPE_SHARED = "shared";

export async function initializeCalendar() {
  updateMonthLabel();
  await loadScheduleForCurrentMonth();
}

export async function changeMonth(offset) {
  const next = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + offset, 1);
  setCurrentMonth(next);
  await loadScheduleForCurrentMonth();
}

export async function loadScheduleForCurrentMonth() {
  if (!calendarGrid) {
    return [];
  }

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth() + 1;
  const params = new URLSearchParams({ year: String(year), month: String(month) });
  const response = await fetch(`/api/schedule?${params.toString()}`);
  if (!response.ok) {
    throw new Error("スケジュールの取得に失敗しました");
  }

  const data = await response.json();
  scheduleCache = (data.events ?? []).map(normalizeEventFromApi);
  sortEventsInPlace(scheduleCache);
  renderCalendar();
  return scheduleCache;
}

export async function updateCalendarWithEvent(eventData) {
  const normalized = normalizeEventFromApi(eventData);
  const existingIndex = scheduleCache.findIndex((event) => event.id === normalized.id);
  if (existingIndex !== -1) {
    scheduleCache.splice(existingIndex, 1);
  }

  const eventMonthDate = new Date(`${normalized.date}T00:00:00`);
  if (Number.isNaN(eventMonthDate.getTime())) {
    await loadScheduleForCurrentMonth();
    return;
  }

  const isSameMonth =
    eventMonthDate.getFullYear() === currentMonth.getFullYear() &&
    eventMonthDate.getMonth() === currentMonth.getMonth();

  if (!isSameMonth) {
    setCurrentMonth(eventMonthDate);
    selectedEventId = normalized.id;
    await loadScheduleForCurrentMonth();
  } else {
    scheduleCache.push(normalized);
    sortEventsInPlace(scheduleCache);
    selectedEventId = normalized.id;
    renderCalendar();
  }
}

export function onCalendarEventSelect(listener) {
  if (typeof listener !== "function") {
    return () => {};
  }
  eventSelectListeners.add(listener);
  return () => {
    eventSelectListeners.delete(listener);
  };
}

export function setHolidays(holidays) {
  if (!Array.isArray(holidays)) {
    holidaysCache = [];
  } else {
    holidaysCache = holidays
      .map((holiday) => ({
        id: String(holiday.id),
        date: holiday.date,
        name: holiday.name,
      }))
      .filter((holiday) => Boolean(holiday.date) && Boolean(holiday.name));
    holidaysCache.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.name.localeCompare(b.name, "ja")));
  }

  renderCalendar();
}

export function clearSelectedEvent() {
  selectedEventId = null;
  renderCalendar();
}

export function removeEventFromCalendar(eventId) {
  const index = scheduleCache.findIndex((event) => event.id === eventId);
  if (index !== -1) {
    scheduleCache.splice(index, 1);
  }
  if (selectedEventId === eventId) {
    selectedEventId = null;
  }
  renderCalendar();
}

function setCurrentMonth(date) {
  currentMonth = startOfMonth(date);
  updateMonthLabel();
}

function updateMonthLabel() {
  if (!monthLabel) {
    return;
  }
  const formatter = new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "long" });
  monthLabel.textContent = formatter.format(currentMonth);
}

function renderCalendar() {
  if (!calendarGrid) {
    return;
  }

  calendarGrid.replaceChildren();
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const firstDayOffset = new Date(year, month, 1).getDay();
  const totalDays = new Date(year, month + 1, 0).getDate();

  for (let i = 0; i < firstDayOffset; i += 1) {
    const emptyCell = document.createElement("div");
    emptyCell.className = "calendar-cell calendar-cell--empty";
    calendarGrid.append(emptyCell);
  }

  for (let day = 1; day <= totalDays; day += 1) {
    const dateString = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const cell = document.createElement("article");
    cell.className = "calendar-cell";
    if (dateString === todayString) {
      cell.classList.add("calendar-cell--today");
    }

    const holiday = getHolidayForDate(dateString);
    if (holiday) {
      cell.classList.add("calendar-cell--holiday");
    }

    const dayNumber = document.createElement("header");
    dayNumber.className = "calendar-day-number";
    dayNumber.textContent = String(day);
    cell.append(dayNumber);

    if (holiday) {
      const holidayLabel = document.createElement("span");
      holidayLabel.className = "calendar-holiday-label";
      holidayLabel.textContent = holiday.name;
      cell.append(holidayLabel);
    }

    const eventsForDay = scheduleCache.filter((event) => event.date === dateString);
    if (eventsForDay.length > 0) {
      const eventsContainer = document.createElement("div");
      eventsContainer.className = "calendar-events";
      eventsForDay.forEach((event) => {
        eventsContainer.append(createEventElement(event));
      });
      cell.append(eventsContainer);
    }

    calendarGrid.append(cell);
  }

  const filledCells = firstDayOffset + totalDays;
  const trailing = filledCells % 7 === 0 ? 0 : 7 - (filledCells % 7);
  for (let i = 0; i < trailing; i += 1) {
    const emptyCell = document.createElement("div");
    emptyCell.className = "calendar-cell calendar-cell--empty";
    calendarGrid.append(emptyCell);
  }
}

function createEventElement(event) {
  const container = document.createElement("div");
  container.className = "calendar-event";
  container.dataset.eventId = event.id;
  container.tabIndex = 0;
  container.title = event.agenda || "";
  if (event.id === selectedEventId) {
    container.classList.add("calendar-event--selected");
  }

  const time = document.createElement("span");
  time.className = "calendar-event-time";
  time.textContent = event.startTime;

  const title = document.createElement("span");
  title.className = "calendar-event-title";
  title.textContent = event.projectName || (event.eventType === EVENT_TYPE_SHARED ? "共有イベント" : "ミーティング");

  container.append(time, title);

  if (event.eventType === EVENT_TYPE_MEETING) {
    const facilitator = document.createElement("span");
    facilitator.className = "calendar-event-facilitator";
    const facilitatorName = event.facilitatorName || "未指定";
    facilitator.textContent = `ファシリテーター: ${facilitatorName}`;
    container.append(facilitator);
    if (event.facilitatorMention) {
      const mention = document.createElement("span");
      mention.className = "calendar-event-mention";
      mention.textContent = `メンション: ${event.facilitatorMention}`;
      container.append(mention);
    }
  } else {
    const typeLabel = document.createElement("span");
    typeLabel.className = "calendar-event-type";
    typeLabel.textContent = "共有イベント";
    container.append(typeLabel);
    if (event.facilitatorMention) {
      const mention = document.createElement("span");
      mention.className = "calendar-event-mention";
      mention.textContent = `メンション: ${event.facilitatorMention}`;
      container.append(mention);
    }
  }

  container.addEventListener("click", () => {
    handleEventSelection(event.id);
  });
  container.addEventListener("keydown", (keyboardEvent) => {
    if (keyboardEvent.key === "Enter" || keyboardEvent.key === " ") {
      keyboardEvent.preventDefault();
      handleEventSelection(event.id);
    }
  });
  return container;
}

function normalizeEventFromApi(event) {
  return {
    id: String(event.id),
    eventType: event.eventType === EVENT_TYPE_SHARED ? EVENT_TYPE_SHARED : EVENT_TYPE_MEETING,
    projectId: event.projectId ? String(event.projectId) : "",
    projectName: event.projectName || "",
    facilitatorId: event.facilitatorId ? String(event.facilitatorId) : "",
    facilitatorName: event.facilitatorName || "",
    date: event.date,
    startTime: event.startTime,
    agenda: event.agenda || "",
    agendaSource: event.agendaSource || "custom",
    facilitatorMention: event.facilitatorMention || "",
    createdAt: event.createdAt || new Date().toISOString(),
    updatedAt: event.updatedAt || null,
  };
}

function handleEventSelection(eventId) {
  selectedEventId = eventId;
  renderCalendar();
  const event = scheduleCache.find((item) => item.id === eventId);
  if (!event) {
    return;
  }
  eventSelectListeners.forEach((listener) => {
    try {
      listener({ ...event });
    } catch (error) {
      console.error(error);
    }
  });
}

function getHolidayForDate(date) {
  return holidaysCache.find((holiday) => holiday.date === date) || null;
}
