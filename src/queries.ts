/**
 * SPARQL used by the demo — each string is the contents of a file under ../queries/.
 * Edit the .rq / .ru files to change GraphDB interaction; this module only loads them.
 *
 * Parameterized updates use simple placeholders (see fillQuery):
 *   <urn:uuid:GRAPH>            → source named graph IRI
 *   "T1"^^xsd:dateTime          → from / snapshot timestamp
 *   "T2"^^xsd:dateTime          → to timestamp
 *   <repository:HISTORY_REPO>   → federated history repo (cim-history / cim)
 *   {{DELETE_QUADS}} / {{INSERT_QUADS}} → switch flip bodies
 *   {{IRIS}}                    → space-separated IRIs to label
 *   <urn:uuid:PRIOR> / "NEXT_VERSION" → prior model in the chain and the new model's version
 *   <http://www.ontotext.com/at/TX> / {{FILTER}} → transaction graph and name filter (Workbench link)
 */

import selectSwitches from "../queries/select-switches.rq?raw";
import selectHistory from "../queries/select-history.rq?raw";
import selectModels from "../queries/select-models.rq?raw";
import selectLabels from "../queries/select-labels.rq?raw";
import selectBaseModel from "../queries/select-base-model.rq?raw";
import constructBaseModel from "../queries/construct-base-model.rq?raw";
import transactionSwitches from "../queries/transaction-switches.rq?raw";
import historyFullModelFederated from "../queries/history-full-model-federated.ru?raw";
import historyDiffModelFederated from "../queries/history-diff-model-federated.ru?raw";
import updateSwitchOpen from "../queries/update-switch-open.ru?raw";

export const queries = {
  /** Switches tab — list breakers/disconnectors */
  selectSwitches,
  /** History tab — list history events */
  selectHistory,
  /** Models tab — list FullModel / DifferenceSet in cim-modelops */
  selectModels,
  /** Models tab — dct:title / dct:description of Prior Version models in cim-history */
  selectLabels,
  /** Models tab — the base SSH FullModel in cim-history */
  selectBaseModel,
  /** Models tab — base SSH model content before any transaction, for download */
  constructBaseModel,
  /** History → Transaction link — query opened in GraphDB Workbench */
  transactionSwitches,
  /** History → Full model (federated write into cim-modelops) */
  historyFullModelFederated,
  /** History → Diff from the From transaction (federated write into cim-modelops) */
  historyDiffModelFederated,
  /** Switches tab Submit — flip Switch.open */
  updateSwitchOpen,
} as const;

/** Replace demo placeholders in a SPARQL template. Longer keys first so nested tokens stay safe. */
export function fillQuery(template: string, vars: Record<string, string>): string {
  const keys = Object.keys(vars).sort((a, b) => b.length - a.length);
  let out = template;
  for (const key of keys) {
    out = out.split(key).join(vars[key]!);
  }
  return out;
}
