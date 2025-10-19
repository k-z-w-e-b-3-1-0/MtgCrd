import { agendaInput, templateSelect } from "./dom.js";

let templatesCache = [];

export async function fetchTemplates() {
  if (!templateSelect) {
    return [];
  }

  const response = await fetch("/api/agenda-templates");
  if (!response.ok) {
    throw new Error("アジェンダテンプレートの取得に失敗しました");
  }

  const data = await response.json();
  templatesCache = data.templates ?? [];

  templatesCache.forEach((template) => {
    const option = document.createElement("option");
    option.value = template.id;
    option.textContent = template.name;
    templateSelect.append(option);
  });

  return templatesCache;
}

export function onTemplateChange() {
  if (!templateSelect || !agendaInput) {
    return;
  }

  const template = templatesCache.find((t) => t.id === templateSelect.value);
  if (template && !agendaInput.value.trim()) {
    agendaInput.value = template.body;
  }
}
