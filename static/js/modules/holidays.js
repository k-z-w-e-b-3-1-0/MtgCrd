import {
  holidayDateInput,
  holidayForm,
  holidayListContainer,
  holidayNameInput,
} from "./dom.js";
import { showError } from "./feedback.js";
import { setHolidays } from "./calendar.js";
import { formatDisplayDate } from "./utils.js";

let holidaysCache = [];

export function initializeHolidayManagement() {
  if (holidayForm) {
    holidayForm.addEventListener("submit", handleHolidaySubmit);
  }
  if (holidayListContainer) {
    holidayListContainer.addEventListener("click", handleHolidayListClick);
  }
}

export async function fetchHolidays() {
  try {
    const response = await fetch("/api/holidays");
    if (!response.ok) {
      throw new Error("休日の取得に失敗しました");
    }
    const data = await response.json();
    holidaysCache = Array.isArray(data.holidays) ? data.holidays : [];
    sortHolidays();
    renderHolidayList();
    setHolidays(holidaysCache);
    return holidaysCache;
  } catch (error) {
    console.error(error);
    showError(error.message);
    holidaysCache = [];
    renderHolidayList();
    setHolidays(holidaysCache);
    return [];
  }
}

async function handleHolidaySubmit(event) {
  event.preventDefault();

  const date = holidayDateInput ? holidayDateInput.value : "";
  const name = holidayNameInput ? holidayNameInput.value.trim() : "";

  if (!date || !name) {
    showError("休日の日付と名称を入力してください。");
    return;
  }

  try {
    const response = await fetch("/api/holidays", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date, name }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "休日の登録に失敗しました");
    }

    if (holidayForm) {
      holidayForm.reset();
    }
    await fetchHolidays();
  } catch (error) {
    console.error(error);
    showError(error.message);
  }
}

async function handleHolidayListClick(event) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const button = target.closest("button[data-holiday-id]");
  if (!(button instanceof HTMLElement)) {
    return;
  }

  const id = button.dataset.holidayId;
  if (!id) {
    return;
  }

  try {
    const response = await fetch(`/api/holidays/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "休日の削除に失敗しました");
    }

    await fetchHolidays();
  } catch (error) {
    console.error(error);
    showError(error.message);
  }
}

function renderHolidayList() {
  if (!holidayListContainer) {
    return;
  }

  holidayListContainer.replaceChildren();

  if (holidaysCache.length === 0) {
    const emptyMessage = document.createElement("p");
    emptyMessage.className = "holiday-list-empty";
    emptyMessage.textContent = "登録された休日はありません。";
    holidayListContainer.append(emptyMessage);
    return;
  }

  holidaysCache.forEach((holiday) => {
    const item = document.createElement("div");
    item.className = "holiday-list-item";

    const label = document.createElement("div");
    label.className = "holiday-list-item__label";
    label.innerHTML = `
      <span>${holiday.name}</span>
      <span class="holiday-list-item__date">${formatDisplayDate(holiday.date)}</span>
    `;

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "secondary outline";
    removeButton.dataset.holidayId = holiday.id;
    removeButton.textContent = "削除";

    item.append(label, removeButton);
    holidayListContainer.append(item);
  });
}

function sortHolidays() {
  holidaysCache.sort((a, b) => {
    if (a.date < b.date) return -1;
    if (a.date > b.date) return 1;
    return a.name.localeCompare(b.name, "ja");
  });
}
