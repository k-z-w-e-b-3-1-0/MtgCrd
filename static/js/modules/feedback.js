import {
  errorDialog,
  errorMessage,
  projectNotice,
  projectStatus,
  slackStatus,
} from "./dom.js";

let projectNoticeTimeout = null;

export function showError(message) {
  if (errorMessage) {
    errorMessage.textContent = message;
  }

  if (errorDialog && typeof errorDialog.showModal === "function") {
    errorDialog.showModal();
  } else {
    window.alert(message);
  }
}

export function initializeProjectStatus() {
  updateProjectStatus(null, 0);
}

export function updateProjectStatus(meta, fallbackProjectCount = 0) {
  if (!projectStatus) {
    return;
  }

  if (!meta) {
    projectStatus.textContent = "プロジェクト情報を読み込み中…";
    return;
  }

  const hostLabel = meta.redmine && meta.redmine.host ? ` (${meta.redmine.host})` : "";
  let sourceMessage = "ローカルデータを使用しています";
  if (meta.sourceType === "redmine") {
    sourceMessage = `Redmine${hostLabel} から取得しました`;
  } else if (meta.redmine && meta.redmine.enabled) {
    sourceMessage = meta.redmine.error
      ? `Redmine${hostLabel} からの取得に失敗したためローカルデータを使用しています: ${meta.redmine.error}`
      : `Redmine${hostLabel} の設定が無効のためローカルデータを使用しています`;
  }

  const counts = meta.counts || {};
  const detailParts = [`総プロジェクト: ${counts.projects ?? fallbackProjectCount}`];
  if ((counts.customProjects ?? 0) > 0) {
    detailParts.push(`カスタム: ${counts.customProjects}`);
  }
  if ((counts.customMembers ?? 0) > 0) {
    detailParts.push(`追加メンバー: ${counts.customMembers}`);
  }

  projectStatus.textContent = `${sourceMessage} / ${detailParts.join(" / ")}`;
}

export function showProjectNotice(message) {
  if (!projectNotice) {
    return;
  }

  projectNotice.textContent = message;
  if (projectNoticeTimeout) {
    window.clearTimeout(projectNoticeTimeout);
  }
  projectNoticeTimeout = window.setTimeout(() => {
    if (projectNotice) {
      projectNotice.textContent = "";
    }
    projectNoticeTimeout = null;
  }, 5000);
}

export function clearProjectNotice() {
  if (!projectNotice) {
    return;
  }

  projectNotice.textContent = "";
  if (projectNoticeTimeout) {
    window.clearTimeout(projectNoticeTimeout);
    projectNoticeTimeout = null;
  }
}

export function renderSlackStatus(status) {
  if (!slackStatus) {
    return;
  }
  slackStatus.textContent = status ? status : "";
}
