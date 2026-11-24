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
  fwd?: Binding;
  rev?: Binding;
}

/** One History transaction and the triples it changed. */
interface Transaction {
  id: string;
  time: string;
  g: string;
  rows: HistoryRow[];
}

/** The base SSH FullModel in cim-history: version 1 of the model chain. */
interface BaseModel {
  g: string;
  title: string;
  desc: string;
  version: string;
  issued: string;
}

type ExportKind = "full" | "diff";

/** The model a new export builds on (dcat:previousVersion) and its version. */
interface Prior {
  iri: string;
  version: number;
}

type Tab = "switches" | "history" | "models";

let switches: Switch[] = [];
const pending = new Map<string, boolean>();
let historyRows: HistoryRow[] = [];
let transactions: Transaction[] = [];
let modelRows: ModelRow[] = [];
let baseModel: BaseModel | null = null;
let historyLoaded = false;
let modelsLoaded = false;
let transactionCount: number | null = null;
let modelCount: number | null = null;
/** Transaction picked as From for a Diff export. */
let fromTxId: string | null = null;
const expandedTx = new Set<string>();

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const statusEl = $<HTMLSpanElement>("#status");
const filterEl = $<HTMLInputElement>("#filter");
const listEl = $<HTMLUListElement>("#switches");
const quadsEl = $<HTMLPreElement>("#quads");
const diffBody = $<HTMLTableSectionElement>("#diff tbody");
const submitEl = $<HTMLButtonElement>("#submit");
const historyBody = $<HTMLTableSectionElement>("#history tbody");
const historyHint = $<HTMLParagraphElement>("#history-hint");
const modelsBody = $<HTMLTableSectionElement>("#models tbody");
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
/** Models → Graph: a model graph has no name of its own, so the link says what it opens (its IRI is the tooltip). */
const GRAPH_LINK_TEXT = "contents";

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

function buildFullModelUpdate(graph: string, t1Iso: string, prior: string, version: number): string {
  const t1 = sparqlDateTime(t1Iso);
  return fillQuery(queries.historyFullModelFederated, {
    "<repository:HISTORY_REPO>": HISTORY_SERVICE,
    "<urn:uuid:GRAPH>": `<${graph}>`,
    '"T1"^^xsd:dateTime': `"${t1}"^^xsd:dateTime`,
    "<urn:uuid:PRIOR>": `<${prior}>`,
    '"NEXT_VERSION"': `"${version}"`,
  });
}

function buildDiffModelUpdate(graph: string, t1Iso: string, t2Iso: string, prior: string, version: number): string {
  const t1 = sparqlDateTime(t1Iso);
  const t2 = sparqlDateTime(t2Iso);
  return fillQuery(queries.historyDiffModelFederated, {
    "<repository:HISTORY_REPO>": HISTORY_SERVICE,
    "<urn:uuid:GRAPH>": `<${graph}>`,
    '"T1"^^xsd:dateTime': `"${t1}"^^xsd:dateTime`,
    '"T2"^^xsd:dateTime': `"${t2}"^^xsd:dateTime`,
    "<urn:uuid:PRIOR>": `<${prior}>`,
    '"NEXT_VERSION"': `"${version}"`,
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

const ms = (iso: string) => new Date(iso).getTime();

/**
 * A model belongs to the transaction it was exported at: its dct:issued is that
 * transaction's time. Models exported before milliseconds were kept have a
 * whole-second dct:issued, so those match on the second.
 */
function sameInstant(issued: string, txTime: string) {
  if (ms(issued) === ms(txTime)) return true;
  return !/\.\d+/.test(issued) && Math.floor(ms(txTime) / 1000) * 1000 === ms(issued);
}

const modelKind = (m: ModelRow): ExportKind => (m.kind.value === "FullModel" ? "full" : "diff");
const versionOf = (m: ModelRow) => parseInt(m.version?.value ?? "", 10) || 0;

/** The model of this kind already exported at a transaction (at most one: exports aren't repeated). */
function txModel(tx: Transaction, kind: ExportKind) {
  return modelRows.find((m) => modelKind(m) === kind && m.issued && sameInstant(m.issued.value, tx.time));
}

/**
 * The newest exported model: the head of the chain (highest version, then latest issued).
 * The chain is one line, with no branching (CIM ModelOps PoC), so every export builds on
 * the head and only transactions after it can be exported.
 */
function headModel(): ModelRow | null {
  const sorted = [...modelRows].sort(
    (a, b) => versionOf(b) - versionOf(a) || ms(b.issued?.value ?? "") - ms(a.issued?.value ?? ""),
  );
  return sorted[0] ?? null;
}

/** What a new export builds on: the head model, else the base SSH model (version 1). */
function headPrior(): Prior {
  const head = headModel();
  if (head) return { iri: head.model.value, version: versionOf(head) };
  return { iri: baseModel!.g, version: parseInt(baseModel!.version, 10) || 1 };
}

/** The transaction the head model was exported at (only it can be From). */
function isHeadTx(tx: Transaction) {
  const head = headModel();
  return !!head?.issued && sameInstant(head.issued.value, tx.time);
}

/** Exports only go forward: a transaction later than the head model. */
function canExportAt(tx: Transaction) {
  const head = headModel();
  if (!head?.issued) return true;
  return ms(tx.time) > ms(head.issued.value) && !isHeadTx(tx);
}

/** Tooltip for an export button that can't be used because the chain has moved past it. */
function pastHeadTitle() {
  const head = headModel();
  return head ? `Only transactions after the newest model (v${versionOf(head)}, ${head.issued?.value}) can be exported` : "";
}

/** GraphDB Workbench link that opens a query on the transaction's switch states, using the Switches filter. */
function transactionQueryUrl(txIri: string) {
  const term = filterEl.value.trim();
  const filter = term ? `filter(contains(?name, "${term.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"))` : "";
  // Drop the file's comment header so Workbench shows just the query.
  const template = queries.transactionSwitches.replace(/^(#.*\n)+\n?/, "");
  const query = fillQuery(template, {
    // Whole seconds only: GraphDB rejects the transaction graph with milliseconds (GDB-15823).
    "<http://www.ontotext.com/at/TX>": `<${txIri.replace(/(\d{14})\d+$/, "$1")}>`,
    "{{FILTER}}": filter,
  });
  return `${GRAPHDB_UI}/sparql?repositoryId=${encodeURIComponent(REPO_CIM_ID)}&query=${encodeURIComponent(query)}`;
}

async function loadHistory() {
  transactionCount = null;
  renderCounts();
  historyBody.replaceChildren();
  fromTxId = null;
  const json = await sparqlSelect(REPO_CIM, queries.selectHistory);
  historyRows = (json.results.bindings as HistoryRow[]).filter(
    (b) => b.time && b.g && b.s && b.p && b.o && b.i && b.transactionId,
  );
  // Group the changed triples by transaction, newest first (the query is ordered by time).
  const byId = new Map<string, Transaction>();
  for (const b of historyRows) {
    const id = b.transactionId.value;
    if (!byId.has(id)) byId.set(id, { id, time: b.time.value, g: b.g.value, rows: [] });
    byId.get(id)!.rows.push(b);
  }
  transactions = [...byId.values()];
  historyLoaded = true;
  transactionCount = transactions.length;
  renderCounts();
  renderHistory();
}

function downloadLink(label: string, model: ModelRow) {
  const a = document.createElement("a");
  a.href = "#";
  a.className = "download";
  a.textContent = label;
  a.title = `Download ${model.model.value} as TriG`;
  a.onclick = (e) => {
    e.preventDefault();
    downloadTrig(model).catch((err) => (statusEl.textContent = String(err)));
  };
  return a;
}

function exportButton(label: string, title: string, enabled: boolean, onClick: () => Promise<void>) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "row-action";
  btn.textContent = label;
  btn.title = title;
  btn.disabled = !enabled;
  btn.onclick = () => {
    btn.disabled = true;
    onClick().catch((e) => {
      statusEl.textContent = String(e);
      renderHistory();
    });
  };
  return btn;
}

/** Two-level History table: one row per transaction, its changed triples below it (collapsed by default). */
function renderHistory() {
  // Export state comes from the Models list; until it has loaded, nothing can be exported or picked.
  const ready = modelsLoaded && baseModel != null;
  renderHistoryHint(ready);
  // From can only be the head model's transaction; drop a stale pick after the head moves.
  const fromTx = transactions.find((t) => t.id === fromTxId && isHeadTx(t)) ?? null;
  if (!fromTx) fromTxId = null;
  historyBody.replaceChildren(
    ...transactions.flatMap((tx) => {
      const expanded = expandedTx.has(tx.id);
      const full = txModel(tx, "full");
      const diff = txModel(tx, "diff");
      const tr = document.createElement("tr");
      tr.className = "tx";
      tr.classList.toggle("selected-from", fromTxId === tx.id);

      const toggleTd = document.createElement("td");
      toggleTd.className = "toggle-cell";
      const toggleBtn = document.createElement("button");
      toggleBtn.type = "button";
      toggleBtn.className = "toggle";
      toggleBtn.textContent = expanded ? "▾" : "▸";
      toggleBtn.setAttribute("aria-expanded", String(expanded));
      toggleBtn.setAttribute("aria-label", `${expanded ? "Hide" : "Show"} changes of ${tx.time}`);
      toggleBtn.onclick = () => {
        if (expanded) expandedTx.delete(tx.id);
        else expandedTx.add(tx.id);
        renderHistory();
      };
      toggleTd.append(toggleBtn);

      const fromTd = document.createElement("td");
      fromTd.className = "pick";
      const fromCb = document.createElement("input");
      fromCb.type = "checkbox";
      const canBeFrom = ready && isHeadTx(tx);
      fromCb.disabled = !canBeFrom;
      fromCb.checked = fromTxId === tx.id;
      fromCb.title = canBeFrom
        ? "Start a difference model from the newest model, exported here"
        : full || diff
          ? "Only the newest model can be a From"
          : "Export a model at this transaction first";
      fromCb.onchange = () => {
        fromTxId = fromCb.checked ? tx.id : null;
        renderHistory();
      };
      fromTd.append(fromCb);

      const txTd = document.createElement("td");
      txTd.className = "time";
      const txLink = document.createElement("a");
      txLink.href = transactionQueryUrl(tx.id);
      txLink.target = "_blank";
      txLink.rel = "noopener";
      txLink.textContent = localName(tx.id);
      txLink.title = "Open a query on this transaction in GraphDB (uses the Switches filter)";
      // The filter may have changed since rendering, so build the link when it is followed.
      txLink.onclick = () => (txLink.href = transactionQueryUrl(tx.id));
      txTd.append(txLink);

      const timeTd = document.createElement("td");
      timeTd.className = "time";
      timeTd.textContent = tx.time;

      // The collapsed row sums up the transaction column by column, under the same
      // Op / Subject / Predicate / Object headers its expanded triples use.
      const summaryCell = (text: string) => {
        const td = document.createElement("td");
        td.className = "summary";
        td.textContent = text;
        return td;
      };
      const distinct = (values: string[]) => [...new Set(values)].join(", ");
      const summaryTds = [
        Object.assign(summaryCell(`${tx.rows.length} change${tx.rows.length === 1 ? "" : "s"}`), {
          className: "summary change-count",
        }),
        summaryCell(distinct(tx.rows.map((b) => b.sName?.value ?? shortIri(b.s.value)))),
        summaryCell(distinct(tx.rows.map((b) => shortIri(b.p.value)))),
        summaryCell(""),
      ];

      const exportTd = document.createElement("td");
      exportTd.className = "actions-cell";
      const forward = ready && canExportAt(tx);
      // Full and Diff each get a fixed-width slot, so they line up whether they're a link or a button.
      const slot = (el: HTMLElement) => {
        const span = document.createElement("span");
        span.className = "export-slot";
        span.append(el);
        return span;
      };
      exportTd.append(
        slot(full
          ? downloadLink("Full", full)
          : exportButton(
              "Full",
              forward || !ready ? `Export a Full model at ${tx.time}` : pastHeadTitle(),
              forward,
              () => exportFull(tx),
            )),
        slot(diff
          ? downloadLink("Diff", diff)
          : exportButton(
              "Diff",
              !forward && ready
                ? pastHeadTitle()
                : fromTx
                  ? `Export a Difference model from ${fromTx.time} to ${tx.time}`
                  : "Select the newest model as From first",
              forward && !!fromTx && fromTx.g === tx.g,
              () => exportDiff(fromTx!, tx),
            )),
      );

      tr.append(toggleTd, fromTd, txTd, timeTd, ...summaryTds, exportTd);
      const details = tx.rows.map((b) => {
        const op = b.i.value === "true" ? "insert" : "delete";
        const subjectLabel = nameDesc(b.sName?.value, b.sDesc?.value);
        const row = document.createElement("tr");
        row.className = `detail ${op}`;
        row.hidden = !expanded;
        row.innerHTML = `
          <td></td><td></td><td></td><td></td>
          <td><span class="op ${op}">${op}</span></td>
          <td>${subjectLabel ? resourceLink(b.s.value, subjectLabel) : formatBinding(b.s)}</td>
          <td>${formatBinding(b.p)}</td>
          <td>${formatBinding(b.o)}</td>
          <td></td>`;
        return row;
      });
      return [tr, ...details];
    }),
  );
}

/** One line above History, shown only when no transaction can be exported, saying why. */
function renderHistoryHint(ready: boolean) {
  const head = headModel();
  const nothingToExport = ready && !transactions.some(canExportAt);
  historyHint.hidden = !nothingToExport;
  if (!nothingToExport) return;
  historyHint.textContent = transactions.length
    ? `Nothing to export yet: the newest model (v${head ? versionOf(head) : 1}) is at the latest transaction. Make a change on the Switches tab first.`
    : "No transactions yet. Make a change on the Switches tab first.";
}

async function exportFull(tx: Transaction) {
  const prior = headPrior();
  const version = prior.version + 1;
  statusEl.textContent = `Exporting Full model v${version} at ${tx.time}…`;
  await sparqlUpdate(REPO_DIFF, buildFullModelUpdate(tx.g, tx.time, prior.iri, version));
  await loadModels();
  statusEl.textContent = `Full model v${version} written to ${REPO_DIFF_ID} (${shortGraph(tx.g)} @ ${tx.time})`;
  setTab("models");
}

async function exportDiff(fromTx: Transaction, tx: Transaction) {
  if (!isHeadTx(fromTx)) throw new Error(`From must be the newest model's transaction`);
  const prior = headPrior();
  const version = prior.version + 1;
  statusEl.textContent = `Exporting Difference model v${version}, ${fromTx.time} → ${tx.time}…`;
  await sparqlUpdate(REPO_DIFF, buildDiffModelUpdate(tx.g, fromTx.time, tx.time, prior.iri, version));
  await loadModels();
  // The query writes nothing when the switches end up as they were at From.
  statusEl.textContent = txModel(tx, "diff")
    ? `Difference model v${version} written to ${REPO_DIFF_ID} (${fromTx.time} → ${tx.time})`
    : `No net change between ${fromTx.time} and ${tx.time}, so no Difference model was written`;
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
  saveFile(await res.blob(), trigFileName(row.kind.value, row.model.value));
}

const trigFileName = (kind: string, iri: string) =>
  `${kind}-${iri.replace(/^urn:uuid:/, "").replace(/[^\w.-]+/g, "_")}.trig`;

function saveFile(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
  statusEl.textContent = `Downloaded ${name}`;
}

/**
 * Download the base SSH model as it was before any transaction, as TriG.
 * GraphDB returns the rebuilt triples as Turtle; they go into the model's graph,
 * with the prefix lines kept at the top.
 */
async function downloadBase(base: BaseModel) {
  statusEl.textContent = `Downloading ${shortGraph(base.g)} as TriG…`;
  const query = fillQuery(queries.constructBaseModel, { "<urn:uuid:GRAPH>": `<${base.g}>` });
  const res = await fetch(`${REPO_CIM}?query=${encodeURIComponent(query)}`, {
    headers: { Accept: "text/turtle" },
  });
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${await res.text()}`);
  const lines = (await res.text()).split("\n");
  const isPrefix = (l: string) => /^\s*(@prefix|@base|prefix|base)\b/i.test(l);
  const trig = `${lines.filter(isPrefix).join("\n")}\n\n<${base.g}> {\n${lines
    .filter((l) => !isPrefix(l))
    .join("\n")
    .trim()}\n}\n`;
  saveFile(new Blob([trig], { type: "application/trig" }), trigFileName("FullModel", base.g));
}

/** The base SSH FullModel (cim-history). dct:issued can be both a date and a dateTime; keep the longer one. */
async function loadBaseModel(): Promise<BaseModel | null> {
  const json = await sparqlSelect(REPO_CIM, queries.selectBaseModel);
  const rows = json.results.bindings as Record<string, Binding | undefined>[];
  if (!rows.length) return null;
  const pick = (k: string) =>
    rows.map((r) => r[k]?.value ?? "").reduce((a, b) => (b.length > a.length ? b : a), "");
  return {
    g: rows[0].g!.value,
    title: pick("title"),
    desc: pick("desc"),
    version: pick("version"),
    issued: pick("issued"),
  };
}

/** Download link cell for the Models table, styled like the History tab's download links. */
function downloadCell(onClick: () => Promise<void>, title: string) {
  const a = document.createElement("a");
  a.href = "#";
  a.className = "download";
  a.textContent = "TriG";
  a.title = title;
  a.onclick = (e) => {
    e.preventDefault();
    onClick().catch((err) => (statusEl.textContent = String(err)));
  };
  const td = document.createElement("td");
  td.className = "actions-cell";
  td.append(a);
  return td;
}

/** Readable label (dct:title, else dct:description) and repository for each Prior Version. */
async function priorVersionLabels(rows: ModelRow[], base: BaseModel | null) {
  const labels = new Map<string, { label: string; repo: string; version?: string }>();
  for (const r of rows) {
    const label = r.title?.value || r.desc?.value;
    if (label) labels.set(r.model.value, { label, repo: REPO_DIFF_ID, version: r.version?.value });
  }
  // Prior versions not in cim-modelops (the base SSH model) live in cim-history.
  const missing = [...new Set(rows.map((r) => r.prev?.value))].filter(
    (iri): iri is string => !!iri && !labels.has(iri),
  );
  if (missing.length) {
    const json = await sparqlSelect(
      REPO_CIM,
      fillQuery(queries.selectLabels, { "{{IRIS}}": missing.map((iri) => `<${iri}>`).join(" ") }),
    );
    for (const b of json.results.bindings as Record<string, Binding | undefined>[]) {
      const label = b.title?.value || b.desc?.value;
      if (label) {
        const version = b.s!.value === base?.g ? base.version : undefined;
        labels.set(b.s!.value, { label, repo: REPO_CIM_ID, version });
      }
    }
  }
  return labels;
}

/** "v1 · title": the prior's version number lines up with the Version column; the title links to it. */
function priorVersionCell(iri: string, prior: { label: string; repo: string; version?: string }) {
  const number = prior.version ? `<span class="prior-version">v${escape(prior.version)}</span> · ` : "";
  return number + resourceLink(iri, prior.label, prior.repo);
}

async function loadModels() {
  modelsLoaded = false;
  modelCount = null;
  renderCounts();
  if (historyLoaded) renderHistory();
  modelsBody.replaceChildren();
  const [json, base] = await Promise.all([sparqlSelect(REPO_DIFF, queries.selectModels), loadBaseModel()]);
  const rows = json.results.bindings as ModelRow[];
  const priorLabels = await priorVersionLabels(rows, base);
  modelRows = rows;
  baseModel = base;
  modelsBody.replaceChildren(
    ...rows.map((b) => {
      const tr = document.createElement("tr");
      const kind = b.kind.value;
      tr.className = kind === "FullModel" ? "kind-full" : "kind-diff";
      const m = (x: Binding | undefined) => formatBinding(x, REPO_DIFF_ID);
      // dct:title and dct:description are both optional; fall back to the IRI only if neither is set.
      const modelLabel = nameDesc(b.title?.value, b.desc?.value);
      const prior = b.prev ? priorLabels.get(b.prev.value) : undefined;
      tr.innerHTML = `
        <td class="kind-cell"><span class="kind ${kind === "FullModel" ? "full" : "diff"}">${escape(kind)}</span></td>
        <td>${modelLabel ? resourceLink(b.model.value, modelLabel, REPO_DIFF_ID) : m(b.model)}</td>
        <td class="graph-cell">${resourceLink(b.g.value, GRAPH_LINK_TEXT, REPO_DIFF_ID, "context")}</td>
        <td>${escape(b.version?.value ?? "")}</td>
        <td class="time">${escape(b.issued?.value ?? "")}</td>
        <td>${prior ? priorVersionCell(b.prev!.value, prior) : m(b.prev)}</td>`;
      tr.append(downloadCell(() => downloadTrig(b), `Download ${b.model.value} as TriG`));
      return tr;
    }),
    // The base SSH model from cim-history: the first link of the chain, version 1.
    ...(base ? [baseModelRow(base)] : []),
  );
  modelsLoaded = true;
  modelCount = rows.length;
  renderCounts();
  if (historyLoaded) renderHistory();
}

function baseModelRow(base: BaseModel) {
  const tr = document.createElement("tr");
  tr.className = "kind-full base";
  const label = nameDesc(base.title, base.desc) || shortIri(base.g);
  tr.innerHTML = `
    <td class="kind-cell"><span class="kind full">FullModel</span></td>
    <td>${resourceLink(base.g, label, REPO_CIM_ID)} <span class="base-note">(base, in ${escape(REPO_CIM_ID)})</span></td>
    <td class="graph-cell">${resourceLink(base.g, GRAPH_LINK_TEXT, REPO_CIM_ID, "context")}</td>
    <td>${escape(base.version)}</td>
    <td class="time">${escape(base.issued)}</td>
    <td></td>`;
  tr.append(downloadCell(() => downloadBase(base), "Download the base model as it was before any transaction, as TriG"));
  return tr;
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

const TABS: Tab[] = ["switches", "history", "models"];

/** The tab named in the URL fragment (e.g. …/modelops#history), so a reload keeps it. */
function tabFromHash(): Tab {
  const name = location.hash.slice(1);
  return (TABS as string[]).includes(name) ? (name as Tab) : "switches";
}

/** Show a tab and record it in the URL fragment, without loading anything. */
function showTab(tab: Tab) {
  // replaceState: no scroll jump to the element with that id, and no extra Back-button entries.
  if (location.hash !== `#${tab}`) history.replaceState(null, "", `#${tab}`);
  panelSwitches.hidden = tab !== "switches";
  panelHistory.hidden = tab !== "history";
  panelModels.hidden = tab !== "models";
  $<HTMLButtonElement>("#tab-switches").setAttribute("aria-selected", String(tab === "switches"));
  $<HTMLButtonElement>("#tab-history").setAttribute("aria-selected", String(tab === "history"));
  $<HTMLButtonElement>("#tab-models").setAttribute("aria-selected", String(tab === "models"));
}

function setTab(tab: Tab) {
  showTab(tab);
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
// Top-bar Refresh reloads every tab, so the header counts stay current too.
$<HTMLButtonElement>("#refresh").onclick = () => {
  historyLoaded = false;
  modelsLoaded = false;
  load().catch((e) => (statusEl.textContent = String(e)));
  loadHistory().catch((e) => (statusEl.textContent = String(e)));
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

// A fragment typed into the address bar switches tabs too.
window.addEventListener("hashchange", () => setTab(tabFromHash()));

// Open the tab named in the URL; every tab is loaded below anyway.
showTab(tabFromHash());

// Load every tab up front so the header counts are always shown, whichever tab is open.
load().catch((e) => (statusEl.textContent = String(e)));
loadHistory().catch((e) => (statusEl.textContent = String(e)));
loadModels().catch((e) => (statusEl.textContent = String(e)));
