# Run in repository `cim-modelops`. Net change for graph G between t1 and t2
# by walking History in `cim-history` (intrarepository federation); writes locally.
# Only triples with events in (t1, t2] can differ. Present at t1 ⇔ first such
# event is a delete; present at t2 ⇔ last such event is an insert.
# Writes nothing when there is no net change.
#
# Placeholders (filled by the app). No VALUES directly in the SERVICE block:
# GraphDB's History plugin then returns nothing.
#   <repository:HISTORY_REPO> → federated history repo id
#   <urn:uuid:GRAPH>          → source named graph
#   "T1"^^xsd:dateTime        → from time
#   "T2"^^xsd:dateTime        → to time
#   <urn:uuid:PRIOR>          → the exported model at T1 that this difference applies to
#   "NEXT_VERSION"            → prior model's dcat:version + 1
#
# Naming (CIMug proposal table), with M = urn:uuid:<new>, M0 = the prior model's UUID,
# t = extraction time as digits (yyyyMMddHHmmssSSS, like History transaction ids):
#   header           M#<M0>_<t>_DifferenceModel
#   forward/reverse  M#forwardDifferences / M#reverseDifferences (fragments of M, no new UUIDs)

PREFIX hist:    <http://www.ontotext.com/at/>
PREFIX dcat:    <http://www.w3.org/ns/dcat#>
PREFIX dcatcim: <https://cim4.eu/ns/dcatcim#>
PREFIX dct:     <http://purl.org/dc/terms/>
PREFIX rdfg:    <http://www.w3.org/2004/03/trix/rdfg-1/>
PREFIX xsd:     <http://www.w3.org/2001/XMLSchema#>

INSERT {
  GRAPH ?header {
    ?model a dcatcim:DifferenceSet ;
      dct:conformsTo               ?profile ;
      dct:description              ?desc ;
      dct:identifier               ?uuid ;
      dct:issued                   ?t2 ;
      dct:requires                 ?requires ;
      dcat:previousVersion         <urn:uuid:PRIOR> ;
      dcatcim:reverseDifferenceSet ?rev ;
      dcatcim:forwardDifferenceSet ?fwd ;
      dct:temporal                 ?period ;
      dcat:isVersionOf             ?grid ;
      dcat:version                 "NEXT_VERSION" .
    ?period a dct:PeriodOfTime ;
      dcat:startDate ?t1 ;
      dcat:endDate   ?t2 .
  }
  GRAPH ?target { ?s ?p ?o }
  # Each difference graph describes itself, as in the CGMES difference-model examples.
  GRAPH ?fwd { ?fwd a rdfg:Graph , dcat:Resource ; dct:title ?fwdTitle . }
  GRAPH ?rev { ?rev a rdfg:Graph , dcat:Resource ; dct:title ?revTitle . }
}
WHERE {
  SERVICE <repository:HISTORY_REPO> {
    {
      SELECT ?g ?t1 ?t2 ?s ?p ?o (MIN(?time) AS ?first) (MAX(?time) AS ?last) WHERE {
        VALUES (?g ?t1 ?t2) {
          ( <urn:uuid:GRAPH> "T1"^^xsd:dateTime "T2"^^xsd:dateTime )
        }
        ?x a hist:history ;
           hist:timestamp ?time ;
           hist:graph ?g ;
           hist:subject ?s ; hist:predicate ?p ; hist:object ?o .
        FILTER (?time > ?t1 && ?time <= ?t2)
        FILTER (?s != ?g)
      }
      GROUP BY ?g ?t1 ?t2 ?s ?p ?o
    }
    ?y1 a hist:history ;
        hist:timestamp ?first ;
        hist:graph ?g ;
        hist:subject ?s ; hist:predicate ?p ; hist:object ?o ;
        hist:insert ?firstInsert .
    ?y2 a hist:history ;
        hist:timestamp ?last ;
        hist:graph ?g ;
        hist:subject ?s ; hist:predicate ?p ; hist:object ?o ;
        hist:insert ?lastInsert .
    FILTER (?firstInsert = ?lastInsert)

    OPTIONAL { GRAPH ?g { ?g dct:conformsTo ?profile } }
    OPTIONAL { GRAPH ?g { ?g dct:requires ?requires } }
    OPTIONAL { GRAPH ?g { ?g dcat:isVersionOf ?grid } }
  }
  { SELECT (STRUUID() AS ?uuid) {} }

  BIND (IRI(CONCAT("urn:uuid:", ?uuid)) AS ?model)
  BIND (REPLACE(STR(<urn:uuid:PRIOR>), "^urn:uuid:", "") AS ?m0)
  BIND (REPLACE(STR(?t2), "[^0-9]", "") AS ?t2Digits)
  BIND (IRI(CONCAT("urn:uuid:", ?uuid, "#", ?m0, "_", ?t2Digits, "_DifferenceModel")) AS ?header)
  BIND (IRI(CONCAT("urn:uuid:", ?uuid, "#reverseDifferences")) AS ?rev)
  BIND (IRI(CONCAT("urn:uuid:", ?uuid, "#forwardDifferences")) AS ?fwd)
  BIND (IRI(CONCAT("urn:uuid:", ?uuid, "#temporal")) AS ?period)
  BIND (IF(?lastInsert, ?fwd, ?rev) AS ?target)
  BIND (CONCAT("Forward Difference Set of ", ?uuid) AS ?fwdTitle)
  BIND (CONCAT("Reverse Difference Set of ", ?uuid) AS ?revTitle)
  BIND (CONCAT("Difference model from History, ", STR(?t1), " to ", STR(?t2)) AS ?desc)
}
