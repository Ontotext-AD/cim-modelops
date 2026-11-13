/**
 * SPARQL used by the demo — each string is the contents of a file under ../queries/.
 * Edit the .rq / .ru files to change GraphDB interaction; this module only loads them.
 *
 * Parameterized updates use simple placeholders (see fillQuery):
 *   <urn:uuid:GRAPH>   → source named graph IRI
 *   "T1"^^xsd:dateTime → from / snapshot timestamp
 *   "T2"^^xsd:dateTime → to timestamp
 *   {{DELETE_QUADS}} / {{INSERT_QUADS}} → switch flip bodies
 */

import selectSwitches from "../queries/select-switches.rq?raw";
import selectHistory from "../queries/select-history.rq?raw";
import selectModels from "../queries/select-models.rq?raw";
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
  /** History → Full model (federated write into cim-modelops) */
  historyFullModelFederated,
  /** History From/To → DifferenceSet (federated write into cim-modelops) */
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
