import { fillQuery, queries } from "./queries";

// Dev: Vite proxies /graphdb → localhost:7200.
// Production (GitHub Pages): absolute GraphDB URL — needs CORS for ontotext-ad.github.io.
const DEV = import.meta.env.DEV;
const GRAPHDB = DEV ? "/graphdb" : "https://cim.ontotext.com/graphdb";
const REPO_CIM_ID = DEV ? "cim" : "cim-history";
const REPO_DIFF_ID = DEV ? "cim-diff-models" : "cim-modelops";
const REPO_CIM = `${GRAPHDB}/repositories/${REPO_CIM_ID}`;
const REPO_DIFF = `${GRAPHDB}/repositories/${REPO_DIFF_ID}`;
const GRAPHDB_UI = DEV ? "http://localhost:7200" : "https://cim.ontotext.com/graphdb";
const HISTORY_SERVICE = `<repository:${REPO_CIM_ID}>`;

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
  swDesc: string;
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
  sName?: Binding;
  sDesc?: Binding;
}

interface ModelRow {
  g: Binding;
  model: Binding;
  kind: Binding;
  version?: Binding;
  issued?: Binding;
  title?: Binding;
  desc?: Binding;
  prev?: Binding;
  profile?: Binding;
  start?: Binding;
  end?: Binding;
  fwd?: Binding;
  rev?: Binding;
}

type Tab = "switches" | "history" | "models";

let switches: Switch[] = [];
const pending = new Map<string, boolean>();
let historyRows: HistoryRow[] = [];
let historyLoaded = false;
let modelsLoaded = false;
let transactionCount: number | null = null;
let modelCount: number | null = null;
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
const modelsLink = $<HTMLAnchorElement>("#models-link");
const historyLink = $<HTMLAnchorElement>("#history-link");

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
/** "name: description", dropping whichever part is missing. */
const nameDesc = (name?: string, desc?: string) => [name, desc].filter(Boolean).join(": ");
const switchLabel = (s: Switch) => nameDesc(s.name, s.swDesc);
/** History username, hiding GraphDB's placeholder for unauthenticated writes. */
const displayUser = (u?: string) => (!u || u === "<free access user>" ? "" : u);

function escape(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

/** GraphDB Workbench resource view. role=context shows the named graph's contents. */
function resourceUrl(iri: string, repositoryId = REPO_CIM_ID, role?: "context") {
  const url = `${GRAPHDB_UI}/resource?uri=${encodeURIComponent(iri)}&repositoryId=${encodeURIComponent(repositoryId)}`;
  return role ? `${url}&role=${role}` : url;
}

function resourceLink(iri: string, label: string, repositoryId = REPO_CIM_ID, role?: "context") {
  return `<a href="${escape(resourceUrl(iri, repositoryId, role))}" target="_blank" rel="noopener" title="${escape(iri)}">${escape(label)}</a>`;
}

function formatBinding(b: Binding | undefined, repositoryId = REPO_CIM_ID): string {
  if (!b) return "";
  if (b.type === "uri") return resourceLink(b.value, shortIri(b.value), repositoryId);
  if (b.type === "bnode") return `_:${escape(b.value)}`;
  let text = `"${escape(b.value)}"`;
  if (b["xml:lang"]) text += `@${escape(b["xml:lang"])}`;
  else if (b.datatype) text += `^^${escape(shortIri(b.datatype))}`;
  return `<span class="literal" title="${escape(b.value)}">${text}</span>`;
}

/** Normalize to an xsd:dateTime lexical form usable in SPARQL. */
function sparqlDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  // Keep milliseconds: History timestamps have them, and dropping them moves the
  // time before the selected transaction, which then falls outside the range.
  return d.toISOString();
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
    "<repository:HISTORY_REPO>": HISTORY_SERVICE,
    "<urn:uuid:GRAPH>": `<${graph}>`,
    '"T1"^^xsd:dateTime': `"${t1}"^^xsd:dateTime`,
  });
}

function buildDiffModelUpdate(graph: string, t1Iso: string, t2Iso: string): string {
  const t1 = sparqlDateTime(t1Iso);
  const t2 = sparqlDateTime(t2Iso);
  return fillQuery(queries.historyDiffModelFederated, {
    "<repository:HISTORY_REPO>": HISTORY_SERVICE,
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
    swDesc: b.swDesc?.value ?? "",
    open: b.open!.value === "true",
    title: b.title?.value ?? "",
    desc: b.desc?.value ?? "",
  }));
  pending.clear();
  statusEl.textContent = `${switches.length} switches in ${REPO_CIM_ID}`;
  render();
}

function renderCounts() {
  modelsLink.textContent =
    modelCount == null ? "Loading models…" : `${modelCount} model(s) in ${REPO_DIFF_ID}`;
  historyLink.textContent =
    transactionCount == null ? "Loading transactions…" : `${transactionCount} transactions in ${REPO_CIM_ID}`;
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
    historyRange.textContent = `${from.time.value} → ${to.time.value} · ${shortGraph(from.g.value)}`;
    historyGenDiff.disabled = false;
  } else {
    historyRange.textContent = from || to ? "Select both From and To" : "";
    historyGenDiff.disabled = true;
  }
}

async function loadHistory() {
  transactionCount = null;
  renderCounts();
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

      const subjectLabel = nameDesc(b.sName?.value, b.sDesc?.value);
      tr.innerHTML = `
        <td class="time">${formatBinding(b.transactionId)}</td>
        <td class="time">${escape(b.time.value)}</td>
        <td><span class="op ${op}">${op}</span></td>
        <td>${subjectLabel ? resourceLink(b.s.value, subjectLabel) : formatBinding(b.s)}</td>
        <td>${formatBinding(b.p)}</td>
        <td>${formatBinding(b.o)}</td>
        <td class="user">${escape(displayUser(b.username?.value))}</td>`;
      tr.prepend(toTd);
      tr.prepend(fromTd);
      tr.append(actionTd);
      return tr;
    }),
  );
  historyLoaded = true;
  historyCount.textContent = `${historyRows.length} event(s)`;
  transactionCount = new Set(historyRows.map((b) => b.transactionId.value)).size;
  renderCounts();
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
  statusEl.textContent = `Generating full model at ${row.time.value}…`;
  historyGenDiff.disabled = true;
  try {
    await sparqlUpdate(REPO_DIFF, buildFullModelUpdate(row.g.value, row.time.value));
    modelsLoaded = false;
    statusEl.textContent = `Full model written to ${REPO_DIFF_ID} (${shortGraph(row.g.value)} @ ${row.time.value})`;
    setTab("models");
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
  statusEl.textContent = `Generating difference model ${from.time.value} → ${to.time.value}…`;
  historyGenDiff.disabled = true;
  try {
    await sparqlUpdate(REPO_DIFF, buildDiffModelUpdate(from.g.value, from.time.value, to.time.value));
    modelsLoaded = false;
    statusEl.textContent = `Difference model written to ${REPO_DIFF_ID} (${shortGraph(from.g.value)})`;
  } finally {
    updateHistoryRangeUi();
  }
}

/** Download a model's graphs as TriG. A DifferenceSet also includes its forward/reverse difference graphs. */
async function downloadTrig(row: ModelRow) {
  const graphs = [row.g, row.fwd, row.rev].filter((b): b is Binding => !!b).map((b) => b.value);
  const params = graphs.map((g) => `context=${encodeURIComponent(`<${g}>`)}`).join("&");
  statusEl.textContent = `Downloading ${shortGraph(row.model.value)} as TriG…`;
  const res = await fetch(`${REPO_DIFF}/statements?${params}`, {
    headers: { Accept: "application/x-trig" },
  });
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${await res.text()}`);
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = `${row.kind.value}-${row.model.value.replace(/^urn:uuid:/, "").replace(/[^\w.-]+/g, "_")}.trig`;
  a.click();
  URL.revokeObjectURL(url);
  statusEl.textContent = `Downloaded ${a.download}`;
}

async function loadModels() {
  modelCount = null;
  renderCounts();
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
          ? `${b.start?.value ?? "—"} → ${b.end?.value ?? "—"}`
          : "";
      const m = (x: Binding | undefined) => formatBinding(x, REPO_DIFF_ID);
      // dct:title and dct:description are both optional; fall back to the IRI only if neither is set.
      const modelLabel = nameDesc(b.title?.value, b.desc?.value);
      tr.innerHTML = `
        <td class="kind-cell"><span class="kind ${kind === "FullModel" ? "full" : "diff"}">${escape(kind)}</span></td>
        <td>${modelLabel ? resourceLink(b.model.value, modelLabel, REPO_DIFF_ID) : m(b.model)}</td>
        <td>${resourceLink(b.g.value, shortIri(b.g.value), REPO_DIFF_ID, "context")}</td>
        <td>${escape(b.version?.value ?? "")}</td>
        <td class="time">${escape(b.issued?.value ?? "")}</td>
        <td class="time">${escape(period)}</td>
        <td>${b.profile ? resourceLink(b.profile.value, b.profile.value, REPO_DIFF_ID) : ""}</td>
        <td>${m(b.prev)}</td>`;
      const dlBtn = document.createElement("button");
      dlBtn.type = "button";
      dlBtn.className = "row-action";
      dlBtn.textContent = "Download TriG";
      dlBtn.title = `Download ${b.model.value} as TriG`;
      dlBtn.onclick = () => {
        downloadTrig(b).catch((e) => (statusEl.textContent = String(e)));
      };
      const actionTd = document.createElement("td");
      actionTd.className = "actions-cell";
      actionTd.append(dlBtn);
      tr.append(actionTd);
      return tr;
    }),
  );
  modelsLoaded = true;
  modelsCount.textContent = `${rows.length} model(s) in ${REPO_DIFF_ID}`;
  modelCount = rows.length;
  renderCounts();
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
        li.innerHTML = `<span class="name">${escape(switchLabel(s))}</span><span class="type">${s.type}</span>`;
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
      tr.innerHTML = `<td>${escape(switchLabel(s))}</td><td>${s.type}</td>
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
  await Promise.all([load(), loadHistory()]);
  statusEl.textContent = `Committed ${rows.length} change(s) at ${new Date().toISOString()}`;
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
for (const link of [modelsLink, historyLink]) {
  link.onclick = (e) => {
    e.preventDefault();
    setTab(link.dataset.tab as Tab);
  };
}

// Load every tab up front so the header counts are always shown, whichever tab is open.
load().catch((e) => (statusEl.textContent = String(e)));
loadHistory().catch((e) => (statusEl.textContent = String(e)));
loadModels().catch((e) => (statusEl.textContent = String(e)));
