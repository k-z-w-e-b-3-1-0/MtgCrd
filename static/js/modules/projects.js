import {
  customMemberForm,
  customMemberNamesInput,
  customMemberProjectSelect,
  customProjectForm,
  customProjectMembersInput,
  customProjectNameInput,
  facilitatorSelect,
  projectSelect,
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
}

export async function fetchProjects(options = {}) {
  const previousProjectId = options.preferredProjectId ?? (projectSelect ? projectSelect.value : "");
  const previousMemberProjectId =
    options.preferredMemberProjectId ?? (customMemberProjectSelect ? customMemberProjectSelect.value : "");

  const response = await fetch("/api/projects");
  if (!response.ok) {
    throw new Error("プロジェクトの取得に失敗しました");
  }

  const data = await response.json();
  projectsCache = Array.isArray(data.projects) ? data.projects : [];

  updateProjectStatus(data.meta, projectsCache.length);
  rebuildProjectSelects(previousProjectId, previousMemberProjectId);

  if (options.noticeMessage) {
    showProjectNotice(options.noticeMessage);
  } else if (!options.keepNotice) {
    clearProjectNotice();
  }

  return projectsCache;
}

function rebuildProjectSelects(projectId, memberProjectId) {
  populateProjectSelect(projectSelect, "プロジェクトを選択してください", projectId);
  onProjectChange();

  if (customMemberProjectSelect) {
    populateProjectSelect(customMemberProjectSelect, "メンバーを追加するプロジェクトを選択", memberProjectId);
    customMemberProjectSelect.disabled = projectsCache.length === 0;
  }
}

function populateProjectSelect(selectElement, placeholderText, selectedId) {
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

export function onProjectChange() {
  if (!facilitatorSelect || !projectSelect) {
    return;
  }

  const project = projectsCache.find((p) => p.id === projectSelect.value);
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
  facilitatorSelect.disabled = false;
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

