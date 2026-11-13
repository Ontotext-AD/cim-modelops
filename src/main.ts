import { fillQuery, queries } from "./queries";

// Same-origin /graphdb: Vite strips Origin in dev; at cim.ontotext.com/model-ops the real /graphdb is same host (no CORS).
const GRAPHDB = "/graphdb";
const REPO_CIM = `${GRAPHDB}/repositories/cim-history`;
const REPO_DIFF = `${GRAPHDB}/repositories/cim-modelops`;
const GRAPHDB_UI = "https://cim.ontotext.com/graphdb";

interface Binding {
  type: string;
  value: string;
  datatype?: string;
  "xml:lang"?: string;
}

interface Switch {
  g: string;
  sw: string;
  type: string;
  name: string;
  open: boolean;
  title: string;
  desc: string;
}

interface HistoryRow {
  transactionId: Binding;
  time: Binding;
  g: Binding;
  s: Binding;
  p: Binding;
  o: Binding;
  i: Binding;
  username?: Binding;
}

interface ModelRow {
  g: Binding;
  model: Binding;
  kind: Binding;
  version?: Binding;
  issued?: Binding;
  desc?: Binding;
  prev?: Binding;
  profile?: Binding;
  start?: Binding;
  end?: Binding;
}

type Tab = "switches" | "history" | "models";

let switches: Switch[] = [];
const pending = new Map<string, boolean>();
let historyRows: HistoryRow[] = [];
let historyLoaded = false;
let modelsLoaded = false;
let fromIdx: number | null = null;
let toIdx: number | null = null;

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const statusEl = $<HTMLSpanElement>("#status");
const filterEl = $<HTMLInputElement>("#filter");
const listEl = $<HTMLUListElement>("#switches");
const quadsEl = $<HTMLPreElement>("#quads");
const diffBody = $<HTMLTableSectionElement>("#diff tbody");
const submitEl = $<HTMLButtonElement>("#submit");
const historyBody = $<HTMLTableSectionElement>("#history tbody");
const historyCount = $<HTMLSpanElement>("#history-count");
const historyRange = $<HTMLSpanElement>("#history-range");
const historyRefresh = $<HTMLButtonElement>("#history-refresh");
const historyGenDiff = $<HTMLButtonElement>("#history-gen-diff");
const modelsBody = $<HTMLTableSectionElement>("#models tbody");
const modelsCount = $<HTMLSpanElement>("#models-count");
const modelsRefresh = $<HTMLButtonElement>("#models-refresh");
const panelSwitches = $<HTMLDivElement>("#panel-switches");
const panelHistory = $<HTMLDivElement>("#panel-history");
const panelModels = $<HTMLDivElement>("#panel-models");

const ICON_OPEN = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="M4 12a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"/><path d="M16 12a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"/><path d="M7.5 10.5l7.5 -5.5"/></svg>`;
const ICON_CLOSED = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="M4 12a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"/><path d="M16 12a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"/><path d="M8 12h8"/></svg>`;

const stateIcon = (open: boolean) => (open ? ICON_OPEN : ICON_CLOSED);
const stateLabel = (open: boolean) => (open ? "OPEN" : "CLOSED");
const stateHtml = (open: boolean) => `${stateIcon(open)}<span>${stateLabel(open)}</span>`;
const stateClass = (open: boolean) => (open ? "open" : "closed");
const localName = (iri: string) => {
  const hash = iri.lastIndexOf("#");
  if (hash >= 0) return iri.slice(hash + 1);
  const slash = iri.lastIndexOf("/");
  return slash >= 0 ? iri.slice(slash + 1) : iri;
};
const shortGraph = (iri: string) => iri.replace("urn:uuid:", "").slice(0, 8) + "…";
const shortIri = (iri: string) => {
  const name = localName(iri);
  return name && name !== iri ? name : iri.length > 48 ? iri.slice(0, 45) + "…" : iri;
};

function escape(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

function resourceUrl(iri: string, repositoryId = "cim-history") {
  return `${GRAPHDB_UI}/resource?uri=${encodeURIComponent(iri)}&repositoryId=${encodeURIComponent(repositoryId)}`;
}

function formatBinding(b: Binding | undefined, repositoryId = "cim-history"): string {
  if (!b) return "";
  if (b.type === "uri") {
    const label = shortIri(b.value);
    return `<a href="${escape(resourceUrl(b.value, repositoryId))}" target="_blank" rel="noopener" title="${escape(b.value)}">${escape(label)}</a>`;
  }
  if (b.type === "bnode") return `_:${escape(b.value)}`;
  let text = `"${escape(b.value)}"`;
  if (b["xml:lang"]) text += `@${escape(b["xml:lang"])}`;
  else if (b.datatype) text += `^^${escape(shortIri(b.datatype))}`;
  return `<span class="literal" title="${escape(b.value)}">${text}</span>`;
}

function formatTime(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

/** Normalize to an xsd:dateTime lexical form usable in SPARQL. */
function sparqlDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function quad(s: Switch, open: boolean) {
  return `GRAPH <${s.g}> { <${s.sw}> cim:Switch.open ${open} . }`;
}

function changed(): Switch[] {
  return switches.filter((s) => pending.has(s.sw));
}

async function sparqlSelect(repo: string, query: string) {
  const res = await fetch(`${repo}?query=${encodeURIComponent(query)}`, {
    headers: { Accept: "application/sparql-results+json" },
  });
  if (!res.ok) throw new Error(`Query failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function sparqlUpdate(repo: string, update: string) {
  const res = await fetch(`${repo}/statements`, {
    method: "POST",
    headers: { "Content-Type": "application/sparql-update" },
    body: update,
  });
  if (!res.ok) throw new Error(`Update failed: ${res.status} ${await res.text()}`);
}

function buildFullModelUpdate(graph: string, t1Iso: string): string {
  const t1 = sparqlDateTime(t1Iso);
  return fillQuery(queries.historyFullModelFederated, {
    "<urn:uuid:GRAPH>": `<${graph}>`,
    '"T1"^^xsd:dateTime': `"${t1}"^^xsd:dateTime`,
  });
}

function buildDiffModelUpdate(graph: string, t1Iso: string, t2Iso: string): string {
  const t1 = sparqlDateTime(t1Iso);
  const t2 = sparqlDateTime(t2Iso);
  return fillQuery(queries.historyDiffModelFederated, {
    "<urn:uuid:GRAPH>": `<${graph}>`,
    '"T1"^^xsd:dateTime': `"${t1}"^^xsd:dateTime`,
    '"T2"^^xsd:dateTime': `"${t2}"^^xsd:dateTime`,
  });
}

async function load() {
  statusEl.textContent = "Loading…";
  const json = await sparqlSelect(REPO_CIM, queries.selectSwitches);
  switches = json.results.bindings.map((b: Record<string, Binding | undefined>) => ({
    g: b.g!.value,
    sw: b.sw!.value,
    type: localName(b.type!.value),
    name: b.name!.value,
    open: b.open!.value === "true",
    title: b.title?.value ?? "",
    desc: b.desc?.value ?? "",
  }));
  pending.clear();
  statusEl.textContent = `${switches.length} switches from cim`;
  render();
}

function rowTime(idx: number) {
  return new Date(historyRows[idx].time.value).getTime();
}

function canBeFrom(idx: number) {
  if (toIdx == null) return true;
  const to = historyRows[toIdx];
  const row = historyRows[idx];
  return row.g.value === to.g.value && rowTime(idx) < rowTime(toIdx);
}

function canBeTo(idx: number) {
  if (fromIdx == null) return true;
  const from = historyRows[fromIdx];
  const row = historyRows[idx];
  return row.g.value === from.g.value && rowTime(idx) > rowTime(fromIdx);
}

function updateHistoryRangeUi() {
  const from = fromIdx != null ? historyRows[fromIdx] : null;
  const to = toIdx != null ? historyRows[toIdx] : null;
  if (from && to) {
    historyRange.textContent = `${formatTime(from.time.value)} → ${formatTime(to.time.value)} · ${shortGraph(from.g.value)}`;
    historyGenDiff.disabled = false;
  } else {
    historyRange.textContent = from || to ? "Select both From and To" : "";
    historyGenDiff.disabled = true;
  }
}

async function loadHistory() {
  statusEl.textContent = "Loading history…";
  historyCount.textContent = "";
  historyRange.textContent = "";
  historyBody.replaceChildren();
  fromIdx = null;
  toIdx = null;
  historyGenDiff.disabled = true;
  const json = await sparqlSelect(REPO_CIM, queries.selectHistory);
  historyRows = (json.results.bindings as HistoryRow[]).filter(
    (b) => b.time && b.g && b.s && b.p && b.o && b.i && b.transactionId,
  );
  historyBody.replaceChildren(
    ...historyRows.map((b, idx) => {
      const insert = b.i.value === "true";
      const op = insert ? "insert" : "delete";
      const tr = document.createElement("tr");
      tr.className = op;
      tr.dataset.idx = String(idx);

      const fromTd = document.createElement("td");
      fromTd.className = "pick";
      const fromCb = document.createElement("input");
      fromCb.type = "checkbox";
      fromCb.title = "From (must be earlier than To)";
      fromCb.checked = fromIdx === idx;
      fromCb.onchange = () => {
        if (fromCb.checked) {
          if (!canBeFrom(idx)) {
            fromCb.checked = false;
            statusEl.textContent = "From must be earlier than To (same graph)";
            return;
          }
          fromIdx = idx;
        } else {
          fromIdx = null;
        }
        syncHistoryChecks();
        updateHistoryRangeUi();
      };
      fromTd.append(fromCb);

      const toTd = document.createElement("td");
      toTd.className = "pick";
      const toCb = document.createElement("input");
      toCb.type = "checkbox";
      toCb.title = "To (must be later than From)";
      toCb.checked = toIdx === idx;
      toCb.onchange = () => {
        if (toCb.checked) {
          if (!canBeTo(idx)) {
            toCb.checked = false;
            statusEl.textContent = "To must be later than From (same graph)";
            return;
          }
          toIdx = idx;
        } else {
          toIdx = null;
        }
        syncHistoryChecks();
        updateHistoryRangeUi();
      };
      toTd.append(toCb);

      const fullBtn = document.createElement("button");
      fullBtn.type = "button";
      fullBtn.className = "row-action";
      fullBtn.textContent = "Full model";
      fullBtn.title = `Extract full model for ${shortGraph(b.g.value)} at ${b.time.value}`;
      fullBtn.onclick = () => {
        generateFullModel(b).catch((e) => (statusEl.textContent = String(e)));
      };

      const actionTd = document.createElement("td");
      actionTd.className = "actions-cell";
      actionTd.append(fullBtn);

      tr.innerHTML = `
        <td class="time">${escape(formatTime(b.time.value))}</td>
        <td><span class="op ${op}">${op}</span></td>
        <td>${formatBinding(b.s)}</td>
        <td>${formatBinding(b.p)}</td>
        <td>${formatBinding(b.o)}</td>
        <td>${formatBinding(b.g)}</td>
        <td class="user">${escape(b.username?.value ?? "")}</td>
        <td>${formatBinding(b.transactionId)}</td>`;
      tr.prepend(toTd);
      tr.prepend(fromTd);
      tr.append(actionTd);
      return tr;
    }),
  );
  historyLoaded = true;
  historyCount.textContent = `${historyRows.length} event(s)`;
  statusEl.textContent = `${historyRows.length} history events from cim-history`;
  updateHistoryRangeUi();
}

function syncHistoryChecks() {
  historyBody.querySelectorAll<HTMLTableRowElement>("tr").forEach((tr) => {
    const idx = Number(tr.dataset.idx);
    const boxes = tr.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    const fromCb = boxes[0];
    const toCb = boxes[1];
    if (fromCb) {
      fromCb.checked = fromIdx === idx;
      fromCb.disabled = fromIdx !== idx && !canBeFrom(idx);
    }
    if (toCb) {
      toCb.checked = toIdx === idx;
      toCb.disabled = toIdx !== idx && !canBeTo(idx);
    }
    tr.classList.toggle("selected-from", fromIdx === idx);
    tr.classList.toggle("selected-to", toIdx === idx);
  });
}

async function generateFullModel(row: HistoryRow) {
  statusEl.textContent = `Generating full model at ${formatTime(row.time.value)}…`;
  historyGenDiff.disabled = true;
  try {
    await sparqlUpdate(REPO_DIFF, buildFullModelUpdate(row.g.value, row.time.value));
    modelsLoaded = false;
    statusEl.textContent = `Full model written to cim-modelops (${shortGraph(row.g.value)} @ ${formatTime(row.time.value)})`;
  } finally {
    updateHistoryRangeUi();
  }
}

async function generateDiffModel() {
  if (fromIdx == null || toIdx == null) return;
  const from = historyRows[fromIdx];
  const to = historyRows[toIdx];
  if (from.g.value !== to.g.value || rowTime(fromIdx) >= rowTime(toIdx)) {
    statusEl.textContent = "Invalid From/To range";
    return;
  }
  statusEl.textContent = `Generating difference model ${formatTime(from.time.value)} → ${formatTime(to.time.value)}…`;
  historyGenDiff.disabled = true;
  try {
    await sparqlUpdate(REPO_DIFF, buildDiffModelUpdate(from.g.value, from.time.value, to.time.value));
    modelsLoaded = false;
    statusEl.textContent = `Difference model written to cim-modelops (${shortGraph(from.g.value)})`;
  } finally {
    updateHistoryRangeUi();
  }
}

async function loadModels() {
  statusEl.textContent = "Loading models…";
  modelsCount.textContent = "";
  modelsBody.replaceChildren();
  const json = await sparqlSelect(REPO_DIFF, queries.selectModels);
  const rows = json.results.bindings as ModelRow[];
  modelsBody.replaceChildren(
    ...rows.map((b) => {
      const tr = document.createElement("tr");
      const kind = b.kind.value;
      tr.className = kind === "FullModel" ? "kind-full" : "kind-diff";
      const period =
        b.start || b.end
          ? `${b.start ? formatTime(b.start.value) : "—"} → ${b.end ? formatTime(b.end.value) : "—"}`
          : "";
      const m = (x: Binding | undefined) => formatBinding(x, "cim-modelops");
      tr.innerHTML = `
        <td><span class="kind ${kind === "FullModel" ? "full" : "diff"}">${escape(kind)}</span></td>
        <td>${m(b.model)}</td>
        <td>${m(b.g)}</td>
        <td>${escape(b.version?.value ?? "")}</td>
        <td class="time">${b.issued ? escape(formatTime(b.issued.value)) : ""}</td>
        <td class="time">${escape(period)}</td>
        <td>${m(b.profile)}</td>
        <td>${m(b.prev)}</td>
        <td>${escape(b.desc?.value ?? "")}</td>`;
      return tr;
    }),
  );
  modelsLoaded = true;
  modelsCount.textContent = `${rows.length} model(s) in cim-modelops`;
  statusEl.textContent = `${rows.length} model(s) from cim-modelops`;
}

function toggle(s: Switch) {
  const next = !(pending.get(s.sw) ?? s.open);
  if (next === s.open) pending.delete(s.sw);
  else pending.set(s.sw, next);
  render();
}

function renderList() {
  const term = filterEl.value.trim().toLowerCase();
  listEl.replaceChildren(
    ...switches
      .filter((s) => s.name.toLowerCase().includes(term))
      .map((s) => {
        const open = pending.get(s.sw) ?? s.open;
        const li = document.createElement("li");
        li.className = pending.has(s.sw) ? "changed" : "";
        li.innerHTML = `<span class="name">${escape(s.name)}</span><span class="type">${s.type}</span>`;
        const btn = document.createElement("button");
        btn.className = `state ${stateClass(open)}`;
        btn.innerHTML = stateHtml(open);
        btn.title = stateLabel(open);
        btn.onclick = () => toggle(s);
        li.append(btn);
        return li;
      }),
  );
}

function renderQuads() {
  const rows = changed();
  if (!rows.length) {
    quadsEl.textContent = "No changes.";
    return;
  }
  const del = rows.map((s) => `<span class="del">− &lt;${s.sw}&gt; cim:Switch.open ${s.open} &lt;${s.g}&gt;</span>`);
  const ins = rows.map((s) => `<span class="ins">+ &lt;${s.sw}&gt; cim:Switch.open ${!s.open} &lt;${s.g}&gt;</span>`);
  quadsEl.innerHTML = [...del, ...ins].join("\n");
}

function renderDiff() {
  diffBody.replaceChildren(
    ...changed().map((s) => {
      const tr = document.createElement("tr");
      const graphLabel = s.title || shortGraph(s.g);
      const graphTip = s.desc || s.g;
      tr.innerHTML = `<td>${escape(s.name)}</td><td>${s.type}</td>
        <td title="${escape(graphTip)}">${escape(graphLabel)}</td>
        <td><span class="${stateClass(s.open)}">${stateHtml(s.open)}</span></td>
        <td><span class="${stateClass(!s.open)}">${stateHtml(!s.open)}</span></td>`;
      return tr;
    }),
  );
}

function render() {
  renderList();
  renderQuads();
  renderDiff();
  const n = pending.size;
  submitEl.disabled = n === 0;
  submitEl.textContent = n ? `Submit (${n})` : "Submit";
}

async function submit() {
  const rows = changed();
  if (!rows.length) return;
  const update = fillQuery(queries.updateSwitchOpen, {
    "{{DELETE_QUADS}}": rows.map((s) => quad(s, s.open)).join(" "),
    "{{INSERT_QUADS}}": rows.map((s) => quad(s, !s.open)).join(" "),
  });
  submitEl.disabled = true;
  statusEl.textContent = "Submitting…";
  try {
    await sparqlUpdate(REPO_CIM, update);
  } catch (e) {
    statusEl.textContent = String(e);
    alert(String(e));
    render();
    return;
  }
  historyLoaded = false;
  await load();
  statusEl.textContent = `Committed ${rows.length} change(s) at ${new Date().toLocaleTimeString()}`;
}

function setTab(tab: Tab) {
  panelSwitches.hidden = tab !== "switches";
  panelHistory.hidden = tab !== "history";
  panelModels.hidden = tab !== "models";
  $<HTMLButtonElement>("#tab-switches").setAttribute("aria-selected", String(tab === "switches"));
  $<HTMLButtonElement>("#tab-history").setAttribute("aria-selected", String(tab === "history"));
  $<HTMLButtonElement>("#tab-models").setAttribute("aria-selected", String(tab === "models"));
  if (tab === "history" && !historyLoaded) {
    loadHistory().catch((e) => (statusEl.textContent = String(e)));
  }
  if (tab === "models" && !modelsLoaded) {
    loadModels().catch((e) => (statusEl.textContent = String(e)));
  }
}

filterEl.oninput = renderList;
$<HTMLButtonElement>("#reset").onclick = () => {
  pending.clear();
  render();
};
submitEl.onclick = submit;
historyRefresh.onclick = () => {
  historyLoaded = false;
  loadHistory().catch((e) => (statusEl.textContent = String(e)));
};
historyGenDiff.onclick = () => {
  generateDiffModel().catch((e) => (statusEl.textContent = String(e)));
};
modelsRefresh.onclick = () => {
  modelsLoaded = false;
  loadModels().catch((e) => (statusEl.textContent = String(e)));
};
$<HTMLButtonElement>("#tab-switches").onclick = () => setTab("switches");
$<HTMLButtonElement>("#tab-history").onclick = () => setTab("history");
$<HTMLButtonElement>("#tab-models").onclick = () => setTab("models");

load().catch((e) => (statusEl.textContent = String(e)));
