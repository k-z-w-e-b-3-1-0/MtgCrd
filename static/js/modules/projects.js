import {
  customMemberForm,
  customMemberNamesInput,
  customMemberProjectSelect,
  customProjectForm,
  customProjectMembersInput,
  customProjectNameInput,
  facilitatorHelp,
  facilitatorSelect,
  projectIdInput,
  projectInput,
  projectOptionsList,
} from "./dom.js";
import {
  clearProjectNotice,
  initializeProjectStatus,
  showError,
  showProjectNotice,
  updateProjectStatus,
} from "./feedback.js";
import { parseMemberNames } from "./utils.js";

let projectsCache = [];

export function initializeProjectManagement() {
  initializeProjectStatus();
  if (customMemberProjectSelect) {
    customMemberProjectSelect.disabled = true;
  }
  updateFacilitatorOptions(null);
  setFacilitatorHelpText("");
}

export async function fetchProjects(options = {}) {
  const previousProjectId = options.preferredProjectId ?? (projectIdInput ? projectIdInput.value : "");
  const previousProjectName = options.preferredProjectName ?? (projectInput ? projectInput.value : "");
  const previousMemberProjectId =
    options.preferredMemberProjectId ?? (customMemberProjectSelect ? customMemberProjectSelect.value : "");

  const response = await fetch("/api/projects");
  if (!response.ok) {
    throw new Error("プロジェクトの取得に失敗しました");
  }

  const data = await response.json();
  projectsCache = Array.isArray(data.projects) ? data.projects : [];

  updateProjectStatus(data.meta, projectsCache.length);
  rebuildProjectInputs({ projectId: previousProjectId, projectName: previousProjectName, memberProjectId: previousMemberProjectId });

  if (options.noticeMessage) {
    showProjectNotice(options.noticeMessage);
  } else if (!options.keepNotice) {
    clearProjectNotice();
  }

  return projectsCache;
}

function rebuildProjectInputs({ projectId, projectName, memberProjectId }) {
  populateProjectOptions();
  setProjectSelection(projectId, projectName);

  if (customMemberProjectSelect) {
    populateMemberProjectSelect(customMemberProjectSelect, "メンバーを追加するプロジェクトを選択", memberProjectId);
    customMemberProjectSelect.disabled = projectsCache.length === 0;
  }
}

function populateProjectOptions() {
  if (!projectOptionsList) {
    return;
  }

  projectOptionsList.replaceChildren();
  projectsCache.forEach((project) => {
    const option = document.createElement("option");
    option.value = project.name;
    option.dataset.projectId = project.id;
    projectOptionsList.append(option);
  });
}

function populateMemberProjectSelect(selectElement, placeholderText, selectedId) {
  if (!selectElement) {
    return;
  }

  const placeholderOption = document.createElement("option");
  placeholderOption.value = "";
  placeholderOption.textContent = placeholderText;
  placeholderOption.disabled = true;

  selectElement.replaceChildren(placeholderOption);

  projectsCache.forEach((project) => {
    const option = document.createElement("option");
    option.value = project.id;
    option.textContent = project.name;
    selectElement.append(option);
  });

  if (selectedId && projectsCache.some((project) => project.id === selectedId)) {
    selectElement.value = selectedId;
  } else {
    selectElement.value = "";
    placeholderOption.selected = true;
  }

  selectElement.disabled = projectsCache.length === 0;
}

export function handleProjectInputChange() {
  return syncProjectInputWithHiddenId();
}

export function setProjectSelection(projectId, projectName = "") {
  const project = projectId ? projectsCache.find((p) => p.id === projectId) : null;

  if (projectInput) {
    projectInput.value = project ? project.name : projectName;
  }

  if (projectIdInput) {
    projectIdInput.value = project ? project.id : projectId ?? "";
  }

  updateFacilitatorOptions(project ?? null);
  return project ?? null;
}

export function getProjectById(projectId) {
  if (!projectId) {
    return null;
  }
  return projectsCache.find((project) => project.id === projectId) || null;
}

export function setFacilitatorHelp(message) {
  setFacilitatorHelpText(message);
}

function syncProjectInputWithHiddenId() {
  if (!projectInput) {
    return null;
  }

  const value = projectInput.value.trim();
  const project = projectsCache.find((item) => item.name === value) || null;
  if (projectIdInput) {
    projectIdInput.value = project ? project.id : "";
  }
  updateFacilitatorOptions(project);
  return project;
}

function updateFacilitatorOptions(project) {
  if (!facilitatorSelect) {
    return;
  }

  facilitatorSelect.replaceChildren();

  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = "メンバーを選択してください";
  defaultOption.disabled = true;
  defaultOption.selected = true;
  facilitatorSelect.append(defaultOption);

  if (!project) {
    facilitatorSelect.disabled = true;
    return;
  }

  project.members.forEach((member) => {
    const option = document.createElement("option");
    option.value = member.id;
    option.textContent = member.name;
    facilitatorSelect.append(option);
  });
  facilitatorSelect.disabled = project.members.length === 0;
}

function setFacilitatorHelpText(message) {
  if (facilitatorHelp) {
    facilitatorHelp.textContent = message;
  }
}

export function handleRefreshProjects() {
  fetchProjects({ noticeMessage: "プロジェクト情報を更新しました。" }).catch((error) => {
    console.error(error);
    showError("プロジェクト情報の更新に失敗しました。");
  });
}

export async function handleCustomProjectSubmit(event) {
  event.preventDefault();

  const name = customProjectNameInput ? customProjectNameInput.value.trim() : "";
  const memberNames = parseMemberNames(customProjectMembersInput ? customProjectMembersInput.value : "");

  if (!name) {
    showError("カスタムプロジェクト名を入力してください。");
    return;
  }

  if (memberNames.length === 0) {
    showError("メンバー名を 1 行以上入力してください。");
    return;
  }

  try {
    const response = await fetch("/api/projects/custom", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, members: memberNames }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "カスタムプロジェクトの追加に失敗しました");
    }

    if (customProjectForm) {
      customProjectForm.reset();
    }

    await fetchProjects({
      preferredProjectId: data.project?.id,
      preferredMemberProjectId: data.project?.id,
    });

    showProjectNotice(`カスタムプロジェクト「${data.project?.name ?? name}」を追加しました。`);
  } catch (error) {
    console.error(error);
    showError(error.message);
  }
}

export async function handleCustomMemberSubmit(event) {
  event.preventDefault();

  const projectId = customMemberProjectSelect ? customMemberProjectSelect.value : "";
  const memberNames = parseMemberNames(customMemberNamesInput ? customMemberNamesInput.value : "");

  if (!projectId) {
    showError("メンバーを追加するプロジェクトを選択してください。");
    return;
  }

  if (memberNames.length === 0) {
    showError("メンバー名を 1 行以上入力してください。");
    return;
  }

  try {
    const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/custom-members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ members: memberNames }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "メンバーの追加に失敗しました");
    }

    if (customMemberForm) {
      customMemberForm.reset();
      customMemberProjectSelect.value = projectId;
    }

    await fetchProjects({
      preferredProjectId: projectId,
      preferredMemberProjectId: projectId,
    });

    const addedCount = (data.addedMembers ?? memberNames).length;
    showProjectNotice(`「${data.project?.name ?? "プロジェクト"}」に ${addedCount} 名のメンバーを追加しました。`);
  } catch (error) {
    console.error(error);
    showError(error.message);
  }
}

