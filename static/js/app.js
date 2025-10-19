import {
  customMemberForm,
  customProjectForm,
  form,
  nextMonthButton,
  prevMonthButton,
  projectSelect,
  refreshProjectsButton,
  templateSelect,
} from "./modules/dom.js";
import { showError } from "./modules/feedback.js";
import {
  fetchProjects,
  handleCustomMemberSubmit,
  handleCustomProjectSubmit,
  handleRefreshProjects,
  initializeProjectManagement,
  onProjectChange,
} from "./modules/projects.js";
import { changeMonth, initializeCalendar } from "./modules/calendar.js";
import { handleFormSubmit, setDefaultDateTime } from "./modules/scheduleForm.js";
import { fetchTemplates, onTemplateChange } from "./modules/templates.js";

initialize().catch((error) => {
  console.error(error);
  showError("初期化に失敗しました。ページを再読み込みしてください。");
});

async function initialize() {
  setDefaultDateTime();
  attachEventListeners();
  initializeProjectManagement();
  await Promise.all([fetchProjects(), fetchTemplates()]);
  await initializeCalendar();
}

function attachEventListeners() {
  if (projectSelect) {
    projectSelect.addEventListener("change", onProjectChange);
  }
  if (templateSelect) {
    templateSelect.addEventListener("change", onTemplateChange);
  }
  if (form) {
    form.addEventListener("submit", handleFormSubmit);
  }
  if (prevMonthButton) {
    prevMonthButton.addEventListener("click", () => {
      changeMonth(-1).catch((error) => {
        console.error(error);
        showError("スケジュールの読み込みに失敗しました。");
      });
    });
  }
  if (nextMonthButton) {
    nextMonthButton.addEventListener("click", () => {
      changeMonth(1).catch((error) => {
        console.error(error);
        showError("スケジュールの読み込みに失敗しました。");
      });
    });
  }
  if (refreshProjectsButton) {
    refreshProjectsButton.addEventListener("click", handleRefreshProjects);
  }
  if (customProjectForm) {
    customProjectForm.addEventListener("submit", handleCustomProjectSubmit);
  }
  if (customMemberForm) {
    customMemberForm.addEventListener("submit", handleCustomMemberSubmit);
  }
}
