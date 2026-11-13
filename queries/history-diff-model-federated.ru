# Run in repository `cim-modelops`. Net change for graph G between t1 and t2
# by walking History in `cim-history` (intrarepository federation); writes locally.
# Only triples with events in (t1, t2] can differ. Present at t1 ⇔ first such
# event is a delete; present at t2 ⇔ last such event is an insert.
# Writes nothing when there is no net change.
#
# Placeholders (filled by the app). No VALUES directly in the SERVICE block:
# GraphDB's History plugin then returns nothing.
#   <urn:uuid:GRAPH>     → source named graph
#   "T1"^^xsd:dateTime   → from time
#   "T2"^^xsd:dateTime   → to time

PREFIX hist:    <http://www.ontotext.com/at/>
PREFIX dcat:    <http://www.w3.org/ns/dcat#>
PREFIX dcatcim: <https://cim4.eu/ns/dcatcim#>
PREFIX dct:     <http://purl.org/dc/terms/>
PREFIX xsd:     <http://www.w3.org/2001/XMLSchema#>

INSERT {
  GRAPH ?header {
    ?model a dcatcim:DifferenceSet ;
      dct:conformsTo               ?profile ;
      dct:description              ?desc ;
      dct:identifier               ?uuid ;
      dct:issued                   ?t2 ;
      dct:requires                 ?requires ;
      dcat:previousVersion         ?g ;
      dcatcim:reverseDifferenceSet ?rev ;
      dcatcim:forwardDifferenceSet ?fwd ;
      dct:temporal                 ?period ;
      dcat:isVersionOf             ?grid ;
      dcat:version                 ?version .
    ?period a dct:PeriodOfTime ;
      dcat:startDate ?t1 ;
      dcat:endDate   ?t2 .
  }
  GRAPH ?target { ?s ?p ?o }
}
WHERE {
  SERVICE <repository:cim-history> {
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
    OPTIONAL { GRAPH ?g { ?g dcat:version ?prevVersion } }
  }
  { SELECT (STRUUID() AS ?uuid) {} }

  BIND (STR(xsd:integer(?prevVersion) + 1) AS ?version)
  BIND (IRI(CONCAT("urn:uuid:", ?uuid)) AS ?model)
  BIND (IRI(CONCAT("urn:uuid:", ?uuid, "#differenceModel")) AS ?header)
  BIND (IRI(CONCAT("urn:uuid:", ?uuid, "#reverseDifferences")) AS ?rev)
  BIND (IRI(CONCAT("urn:uuid:", ?uuid, "#forwardDifferences")) AS ?fwd)
  BIND (IRI(CONCAT("urn:uuid:", ?uuid, "#temporal")) AS ?period)
  BIND (IF(?lastInsert, ?fwd, ?rev) AS ?target)
  BIND (CONCAT("Difference model from History, ", STR(?t1), " to ", STR(?t2)) AS ?desc)
}
