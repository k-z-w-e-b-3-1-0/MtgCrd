import { calendarGrid, monthLabel } from "./dom.js";
import { formatDateString, sortEventsInPlace, startOfMonth } from "./utils.js";

let currentMonth = startOfMonth(new Date());
const todayString = formatDateString(new Date());
let scheduleCache = [];

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
  const eventMonthDate = new Date(`${eventData.date}T00:00:00`);
  if (Number.isNaN(eventMonthDate.getTime())) {
    await loadScheduleForCurrentMonth();
    return;
  }

  const isSameMonth =
    eventMonthDate.getFullYear() === currentMonth.getFullYear() &&
    eventMonthDate.getMonth() === currentMonth.getMonth();

  if (!isSameMonth) {
    setCurrentMonth(eventMonthDate);
    await loadScheduleForCurrentMonth();
  } else {
    scheduleCache.push(eventData);
    sortEventsInPlace(scheduleCache);
    renderCalendar();
  }
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

    const dayNumber = document.createElement("header");
    dayNumber.className = "calendar-day-number";
    dayNumber.textContent = String(day);
    cell.append(dayNumber);

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
  container.title = event.agenda || "";

  const time = document.createElement("span");
  time.className = "calendar-event-time";
  time.textContent = event.startTime;

  const title = document.createElement("span");
  title.className = "calendar-event-title";
  title.textContent = event.projectName;

  const facilitator = document.createElement("span");
  facilitator.className = "calendar-event-facilitator";
  facilitator.textContent = `ファシリテーター: ${event.facilitatorName}`;

  container.append(time, title, facilitator);
  return container;
}

function normalizeEventFromApi(event) {
  return {
    id: String(event.id),
    projectId: String(event.projectId),
    projectName: event.projectName,
    facilitatorId: String(event.facilitatorId),
    facilitatorName: event.facilitatorName,
    date: event.date,
    startTime: event.startTime,
    agenda: event.agenda || "",
    agendaSource: event.agendaSource || "custom",
  };
}
