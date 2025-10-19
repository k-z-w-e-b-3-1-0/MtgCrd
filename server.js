const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const DATA_DIR = path.join(__dirname, "data");
const STATIC_DIR = path.join(__dirname, "static");
const TEMPLATE_INDEX = path.join(__dirname, "templates", "index.html");
const SCHEDULE_FILE = path.join(DATA_DIR, "schedule.json");
const CUSTOM_DATA_FILE = path.join(DATA_DIR, "custom_data.json");

const redmineBaseUrl = process.env.REDMINE_BASE_URL ? process.env.REDMINE_BASE_URL.trim() : "";
const redmineApiKey = process.env.REDMINE_API_KEY ? process.env.REDMINE_API_KEY.trim() : "";

const localProjects = loadLocalProjects();
const agendaTemplates = loadAgendaTemplates();
let schedule = loadSchedule();
let customData = loadCustomData();
let lastProjectMeta = buildInitialProjectMeta();

sortScheduleInPlace(schedule);

const port = Number.parseInt(process.env.PORT || "3000", 10);

const server = http.createServer(async (req, res) => {
  const method = req.method || "GET";
  const requestUrl = new URL(req.url || "/", `http://${req.headers.host}`);
  const pathname = decodeURIComponent(requestUrl.pathname);

  try {
    if (method === "GET" && pathname === "/") {
      return await serveFile(res, TEMPLATE_INDEX, "text/html; charset=utf-8");
    }

    if (method === "GET" && pathname === "/api/projects") {
      return await handleProjectsRequest(res);
    }

    if (method === "POST" && pathname === "/api/projects/custom") {
      const body = await readJsonBody(req);
      return await handleCustomProjectCreate(body, res);
    }

    const customMemberMatch = pathname.match(/^\/api\/projects\/([^/]+)\/custom-members$/);
    if (method === "POST" && customMemberMatch) {
      const projectId = customMemberMatch[1];
      const body = await readJsonBody(req);
      return await handleCustomMemberCreate(decodeURIComponent(projectId), body, res);
    }

    if (method === "GET" && pathname === "/api/agenda-templates") {
      return sendJson(res, { templates: agendaTemplates });
    }

    if (method === "GET" && pathname === "/api/schedule") {
      return handleScheduleQuery(requestUrl, res);
    }

    if (method === "POST" && pathname === "/api/schedule") {
      const body = await readJsonBody(req);
      return await handleScheduleCreate(body, res);
    }

    if (method === "POST" && pathname === "/api/assign") {
      return sendJson(
        res,
        { error: "スケジューラー API に統合されました。/api/schedule を利用してください。" },
        410,
      );
    }

    if (method === "GET" && pathname.startsWith("/static/")) {
      return await serveStaticAsset(res, pathname);
    }

    return notFound(res);
  } catch (error) {
    console.error(error);
    return sendJson(res, { error: "サーバーで問題が発生しました。" }, 500);
  }
});

server.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});

async function handleProjectsRequest(res) {
  const { projects, meta } = await getProjectData();
  return sendJson(res, { projects, meta });
}

async function handleCustomProjectCreate(body, res) {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const memberInput = Array.isArray(body.members) ? body.members : [];
  const memberNames = sanitizeMemberNames(memberInput);

  if (!name) {
    return sendJson(res, { error: "プロジェクト名を入力してください。" }, 400);
  }

  if (memberNames.length === 0) {
    return sendJson(res, { error: "メンバーを 1 名以上入力してください。" }, 400);
  }

  const project = addCustomProject(name, memberNames);
  const { meta } = await getProjectData();
  return sendJson(res, { project, meta }, 201);
}

async function handleCustomMemberCreate(projectId, body, res) {
  const memberInput = Array.isArray(body.members) ? body.members : [];
  const memberNames = sanitizeMemberNames(memberInput);

  if (!projectId) {
    return sendJson(res, { error: "プロジェクト ID が指定されていません。" }, 400);
  }

  if (memberNames.length === 0) {
    return sendJson(res, { error: "メンバーを 1 名以上入力してください。" }, 400);
  }

  const { projectMap } = await getProjectData();
  if (!projectMap.has(projectId)) {
    return sendJson(res, { error: "指定されたプロジェクトが見つかりません。" }, 404);
  }

  const addedMembers = addCustomMembers(projectId, memberNames);
  if (addedMembers.length === 0) {
    return sendJson(res, { error: "追加可能な新しいメンバーが見つかりませんでした。" }, 400);
  }

  const { projectMap: updatedMap, meta } = await getProjectData();
  const project = updatedMap.get(projectId);
  return sendJson(res, { project, addedMembers, meta }, 201);
}

async function getProjectData() {
  const { baseProjects, meta: sourceMeta } = await loadProjectsFromSources();
  const combinedProjects = applyCustomizations(baseProjects);
  const projectMap = new Map(combinedProjects.map((project) => [project.id, project]));

  const meta = {
    ...sourceMeta,
    counts: {
      projects: combinedProjects.length,
      customProjects: customData.projects.length,
      customMembers: countCustomMembers(customData),
    },
  };

  lastProjectMeta = meta;
  return { projects: combinedProjects, projectMap, meta };
}

async function loadProjectsFromSources() {
  const redmineEnabled = Boolean(redmineBaseUrl);
  const meta = {
    sourceType: "local",
    fetchedAt: new Date().toISOString(),
    redmine: {
      enabled: redmineEnabled,
      host: redmineEnabled ? getRedmineHost(redmineBaseUrl) : null,
      error: null,
    },
  };

  if (!redmineEnabled) {
    return { baseProjects: localProjects, meta };
  }

  try {
    const projects = await fetchRedmineProjectsWithMembers();
    meta.sourceType = "redmine";
    return { baseProjects: projects, meta };
  } catch (error) {
    console.error("Redmine からの取得に失敗しました", error);
    meta.redmine.error = error.message;
    meta.sourceType = "local";
    return { baseProjects: localProjects, meta };
  }
}

function applyCustomizations(baseProjects) {
  const overrides = customData.memberOverrides || {};
  const combined = baseProjects.map((project) => {
    const cloned = cloneProject(project);
    const extraMembers = overrides[cloned.id] || [];
    cloned.members = mergeMembers(cloned.members, extraMembers);
    return cloned;
  });

  customData.projects.forEach((project) => {
    combined.push(cloneProject(project));
  });

  return combined;
}

function mergeMembers(primaryMembers, extraMembers) {
  const map = new Map();
  primaryMembers.forEach((member) => {
    const cloned = cloneMember(member);
    map.set(cloned.id, cloned);
  });

  extraMembers.forEach((member) => {
    const cloned = cloneMember(member);
    if (!map.has(cloned.id)) {
      map.set(cloned.id, cloned);
    }
  });

  return Array.from(map.values());
}

async function fetchRedmineProjectsWithMembers() {
  if (!redmineBaseUrl) {
    return localProjects;
  }

  const projects = await fetchAllRedmineProjects();
  const results = [];
  for (const project of projects) {
    let members = [];
    try {
      members = await fetchProjectMembers(project.id);
    } catch (error) {
      console.error(`Redmine メンバー取得に失敗しました (project: ${project.id})`, error);
    }
    results.push({
      id: String(project.id),
      name: project.name,
      members,
    });
  }
  return results;
}

async function fetchAllRedmineProjects() {
  const projects = [];
  let offset = 0;
  const limit = 100;
  let total = Infinity;

  while (offset < total) {
    const url = new URL("/projects.json", redmineBaseUrl);
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("offset", String(offset));
    url.searchParams.set("status", "*");

    const data = await fetchRedmineJson(url);
    const batch = Array.isArray(data.projects) ? data.projects : [];
    batch.forEach((project) => {
      projects.push({
        id: project.id,
        name: project.name,
      });
    });

    total = typeof data.total_count === "number" ? data.total_count : batch.length;
    offset += limit;
    if (batch.length === 0) {
      break;
    }
  }

  return projects;
}

async function fetchProjectMembers(projectId) {
  const url = new URL(`/projects/${projectId}.json`, redmineBaseUrl);
  url.searchParams.set("include", "memberships");

  const data = await fetchRedmineJson(url);
  const memberships = data.project && Array.isArray(data.project.memberships) ? data.project.memberships : [];

  const members = memberships
    .map((membership) => normalizeRedmineMember(membership))
    .filter((member) => member !== null);

  return dedupeMembersById(members);
}

async function fetchRedmineJson(url) {
  const headers = { Accept: "application/json" };
  if (redmineApiKey) {
    headers["X-Redmine-API-Key"] = redmineApiKey;
  }

  const response = await fetch(url, { headers });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Redmine API error (${response.status}): ${text}`);
  }
  return response.json();
}

function normalizeRedmineMember(membership) {
  if (membership && membership.user) {
    return {
      id: String(membership.user.id),
      name: membership.user.name,
    };
  }

  if (membership && membership.group) {
    return {
      id: `group-${membership.group.id}`,
      name: `${membership.group.name} (グループ)`,
    };
  }

  return null;
}

function dedupeMembersById(members) {
  const map = new Map();
  members.forEach((member) => {
    if (!map.has(member.id)) {
      map.set(member.id, member);
    }
  });
  return Array.from(map.values());
}

function addCustomProject(name, memberNames) {
  const id = generateCustomProjectId();
  const members = memberNames.map((memberName) => createCustomMember(id, memberName));
  const project = {
    id,
    name,
    members,
  };

  customData.projects.push(project);
  saveCustomData();
  return cloneProject(project);
}

function addCustomMembers(projectId, memberNames) {
  const project = customData.projects.find((entry) => entry.id === projectId);
  const added = [];

  if (project) {
    const existingNames = new Set(project.members.map((member) => member.name.toLowerCase()));
    memberNames.forEach((memberName) => {
      const normalized = memberName.toLowerCase();
      if (existingNames.has(normalized)) {
        return;
      }
      const member = createCustomMember(projectId, memberName);
      project.members.push(member);
      existingNames.add(normalized);
      added.push(member);
    });
    saveCustomData();
    return added.map((member) => cloneMember(member));
  }

  const overrides = customData.memberOverrides[projectId] || [];
  const existingNames = new Set(overrides.map((member) => member.name.toLowerCase()));
  memberNames.forEach((memberName) => {
    const normalized = memberName.toLowerCase();
    if (existingNames.has(normalized)) {
      return;
    }
    const member = createCustomMember(projectId, memberName);
    overrides.push(member);
    existingNames.add(normalized);
    added.push(member);
  });
  customData.memberOverrides[projectId] = overrides;
  if (added.length > 0) {
    saveCustomData();
  }
  return added.map((member) => cloneMember(member));
}

function sanitizeMemberNames(input) {
  return input
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value, index, array) => value && array.findIndex((candidate) => candidate.toLowerCase() === value.toLowerCase()) === index);
}

function createCustomMember(projectId, name) {
  return {
    id: generateCustomMemberId(projectId),
    name,
  };
}

function generateCustomProjectId() {
  return `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function generateCustomMemberId(projectId) {
  return `${projectId}-member-${Math.random().toString(36).slice(2, 8)}`;
}

function loadLocalProjects() {
  const raw = readJsonFile(path.join(DATA_DIR, "projects.json"));
  return raw.map((project) => ({
    id: String(project.id),
    name: project.name,
    members: (project.members || []).map((member) => ({
      id: String(member.id),
      name: member.name,
    })),
  }));
}

function loadAgendaTemplates() {
  const raw = readJsonFile(path.join(DATA_DIR, "agenda_templates.json"));
  return raw.map((template) => ({
    id: String(template.id),
    name: template.name,
    items: template.items || [],
    body: (template.items || []).map((item) => `- ${item}`).join("\n"),
  }));
}

function loadSchedule() {
  try {
    const raw = readJsonFile(SCHEDULE_FILE);
    return raw.map(normalizeEventFromFile);
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

function loadCustomData() {
  try {
    const raw = readJsonFile(CUSTOM_DATA_FILE);
    return normalizeCustomData(raw);
  } catch (error) {
    if (error.code === "ENOENT") {
      return { projects: [], memberOverrides: {} };
    }
    throw error;
  }
}

function normalizeCustomData(raw) {
  const projects = Array.isArray(raw.projects) ? raw.projects : [];
  const normalizedProjects = projects
    .map((project) => {
      const id = project && project.id ? String(project.id) : generateCustomProjectId();
      const name = project && typeof project.name === "string" ? project.name : "";
      const members = Array.isArray(project.members)
        ? project.members
            .map((member) => {
              const memberId = member && member.id ? String(member.id) : generateCustomMemberId(id);
              const memberName = member && typeof member.name === "string" ? member.name : "";
              return memberName ? { id: memberId, name: memberName } : null;
            })
            .filter((member) => member !== null)
        : [];
      if (!name) {
        return null;
      }
      return { id, name, members };
    })
    .filter((project) => project !== null);

  const memberOverrides =
    raw && typeof raw.memberOverrides === "object" && raw.memberOverrides
      ? Object.entries(raw.memberOverrides).reduce((acc, [projectId, members]) => {
          const normalizedMembers = Array.isArray(members)
            ? members
                .map((member) => {
                  const memberId = member && member.id ? String(member.id) : generateCustomMemberId(projectId);
                  const memberName = member && typeof member.name === "string" ? member.name : "";
                  return memberName ? { id: memberId, name: memberName } : null;
                })
                .filter((member) => member !== null)
            : [];
          acc[String(projectId)] = normalizedMembers;
          return acc;
        }, {})
      : {};

  return { projects: normalizedProjects, memberOverrides };
}

function saveCustomData() {
  const json = JSON.stringify(customData, null, 2);
  fs.writeFileSync(CUSTOM_DATA_FILE, `${json}\n`, "utf8");
}

function normalizeEventFromFile(event) {
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
    createdAt: event.createdAt || new Date().toISOString(),
  };
}

function readJsonFile(filePath) {
  const fileContent = fs.readFileSync(filePath, "utf8");
  return JSON.parse(fileContent);
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const buffer = Buffer.concat(chunks);
  if (!buffer.length) {
    return {};
  }
  try {
    return JSON.parse(buffer.toString("utf8"));
  } catch (error) {
    throw new Error("Invalid JSON body");
  }
}

function handleScheduleQuery(requestUrl, res) {
  const now = new Date();
  const yearParam = requestUrl.searchParams.get("year");
  const monthParam = requestUrl.searchParams.get("month");
  const year = parseInt(yearParam ?? `${now.getFullYear()}`, 10);
  const month = parseInt(monthParam ?? `${now.getMonth() + 1}`, 10);

  if (!isValidYear(year) || !isValidMonth(month)) {
    return sendJson(res, { error: "year または month の値が不正です。" }, 400);
  }

  const events = schedule.filter((event) => {
    const [eventYear, eventMonth] = event.date.split("-").map((value) => Number.parseInt(value, 10));
    return eventYear === year && eventMonth === month;
  });

  return sendJson(res, { events });
}

async function handleScheduleCreate(body, res) {
  const projectId = typeof body.projectId === "string" ? body.projectId.trim() : "";
  const facilitatorId = typeof body.facilitatorId === "string" ? body.facilitatorId.trim() : "";
  const templateId = typeof body.templateId === "string" ? body.templateId.trim() : "";
  const customAgenda = typeof body.customAgenda === "string" ? body.customAgenda.trim() : "";
  const date = typeof body.date === "string" ? body.date.trim() : "";
  const startTime = typeof body.startTime === "string" ? body.startTime.trim() : "";

  const { projectMap } = await getProjectData();
  const project = projectMap.get(projectId);
  if (!project) {
    return sendJson(res, { error: "指定されたプロジェクトが見つかりません。" }, 400);
  }

  const facilitator = project.members.find((member) => member.id === facilitatorId);
  if (!facilitator) {
    return sendJson(res, { error: "ファシリテーターに選択されたメンバーがプロジェクトに存在しません。" }, 400);
  }

  if (!isValidDateInput(date)) {
    return sendJson(res, { error: "日付を YYYY-MM-DD 形式で指定してください。" }, 400);
  }

  if (!isValidTimeInput(startTime)) {
    return sendJson(res, { error: "開始時刻を HH:MM 形式で指定してください。" }, 400);
  }

  const template = templateId ? agendaTemplates.find((item) => item.id === templateId) : null;
  let agendaBody = customAgenda;
  let agendaSource = "custom";

  if (template && !agendaBody) {
    agendaBody = template.body;
    agendaSource = template.name;
  } else if (!agendaBody) {
    return sendJson(res, { error: "アジェンダを入力するかテンプレートを選択してください。" }, 400);
  }

  const event = {
    id: generateEventId(date, startTime),
    projectId,
    projectName: project.name,
    facilitatorId,
    facilitatorName: facilitator.name,
    date,
    startTime,
    agenda: agendaBody,
    agendaSource,
    createdAt: new Date().toISOString(),
  };

  schedule.push(event);
  sortScheduleInPlace(schedule);
  saveSchedule(schedule);

  let slackStatus = null;
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (webhookUrl) {
    try {
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildSlackPayload(event)),
      });
      slackStatus = response.ok ? "Slack への送信に成功しました" : "Slack への送信に失敗しました";
    } catch (error) {
      console.error("Slack webhook error", error);
      slackStatus = "Slack への送信でエラーが発生しました";
    }
  }

  return sendJson(res, { event, slackStatus }, 201);
}

function buildSlackPayload(event) {
  const dateTime = `${event.date} ${event.startTime}`;
  const lines = [
    `*${event.projectName}* のミーティング`,
    `日時: ${dateTime}`,
    `ファシリテーター: ${event.facilitatorName}`,
    "アジェンダ:",
    event.agenda,
  ];

  return { text: lines.join("\n") };
}

function serveFile(res, filePath, contentType) {
  try {
    const stream = fs.createReadStream(filePath);
    stream.on("open", () => {
      res.writeHead(200, { "Content-Type": contentType });
      stream.pipe(res);
    });
    stream.on("error", () => {
      notFound(res);
    });
  } catch (error) {
    notFound(res);
  }
}

async function serveStaticAsset(res, pathname) {
  const sanitizedPath = path.normalize(path.join(__dirname, pathname));
  if (!sanitizedPath.startsWith(STATIC_DIR)) {
    return notFound(res);
  }
  const extension = path.extname(sanitizedPath).toLowerCase();
  const contentType = getContentType(extension);
  return serveFile(res, sanitizedPath, contentType);
}

function getContentType(extension) {
  switch (extension) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "application/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    default:
      return "application/octet-stream";
  }
}

function sendJson(res, payload, statusCode = 200) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function notFound(res) {
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not Found");
}

function isValidYear(value) {
  return Number.isInteger(value) && value >= 2000 && value <= 2100;
}

function isValidMonth(value) {
  return Number.isInteger(value) && value >= 1 && value <= 12;
}

function isValidDateInput(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [year, month, day] = value.split("-").map((part) => Number.parseInt(part, 10));
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function isValidTimeInput(value) {
  if (!/^\d{2}:\d{2}$/.test(value)) {
    return false;
  }
  const [hour, minute] = value.split(":").map((part) => Number.parseInt(part, 10));
  return hour >= 0 && hour < 24 && minute >= 0 && minute < 60;
}

function generateEventId(date, startTime) {
  const base = `${date}-${startTime}`.replace(/[^0-9]/g, "");
  const random = Math.random().toString(36).slice(2, 8);
  return `evt-${base}-${random}`;
}

function sortScheduleInPlace(list) {
  list.sort((a, b) => {
    const keyA = `${a.date}T${a.startTime}`;
    const keyB = `${b.date}T${b.startTime}`;
    if (keyA < keyB) return -1;
    if (keyA > keyB) return 1;
    return a.projectName.localeCompare(b.projectName, "ja");
  });
}

function saveSchedule(list) {
  const json = JSON.stringify(list, null, 2);
  fs.writeFileSync(SCHEDULE_FILE, `${json}\n`, "utf8");
}

function cloneProject(project) {
  return {
    id: String(project.id),
    name: project.name,
    members: (project.members || []).map((member) => cloneMember(member)),
  };
}

function cloneMember(member) {
  return {
    id: String(member.id),
    name: member.name,
  };
}

function countCustomMembers(data) {
  const overridesCount = Object.values(data.memberOverrides || {}).reduce(
    (total, members) => total + members.length,
    0,
  );
  const customProjectMembers = (data.projects || []).reduce(
    (total, project) => total + (Array.isArray(project.members) ? project.members.length : 0),
    0,
  );
  return overridesCount + customProjectMembers;
}

function getRedmineHost(url) {
  try {
    return new URL(url).host;
  } catch (error) {
    return null;
  }
}

function buildInitialProjectMeta() {
  return {
    sourceType: "local",
    fetchedAt: null,
    redmine: {
      enabled: Boolean(redmineBaseUrl),
      host: redmineBaseUrl ? getRedmineHost(redmineBaseUrl) : null,
      error: null,
    },
    counts: {
      projects: localProjects.length + customData.projects.length,
      customProjects: customData.projects.length,
      customMembers: countCustomMembers(customData),
    },
  };
}

