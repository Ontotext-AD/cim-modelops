# Run in repository `cim-modelops`. Reconstructs a FullModel at t1 by walking
# the History log in `cim-history` (intrarepository federation); writes locally.
# Triple present at t1 ⇔ its first event after t1 is a delete, or it has no
# events after t1 and is present now.
#
# Placeholders (filled by the app; both VALUES blocks must stay in sync).
# No VALUES directly in the SERVICE block: GraphDB's History plugin then returns nothing.
#   <urn:uuid:GRAPH>     → source named graph
#   "T1"^^xsd:dateTime   → snapshot time

PREFIX hist: <http://www.ontotext.com/at/>
PREFIX dcat: <http://www.w3.org/ns/dcat#>
PREFIX dct:  <http://purl.org/dc/terms/>
PREFIX xsd:  <http://www.w3.org/2001/XMLSchema#>

INSERT {
  GRAPH ?newG {
    ?s ?p ?o .
    ?newG a dcat:Dataset ;
      dct:identifier       ?uuid ;
      dct:issued           ?t1 ;
      dct:conformsTo       ?profile ;
      dct:requires         ?requires ;
      dcat:isVersionOf     ?grid ;
      dcat:previousVersion ?g ;
      dcat:version         ?version ;
      dct:description      ?desc .
  }
}
WHERE {
  SERVICE <repository:cim-history> {
    {
      {
        SELECT ?g ?t1 ?s ?p ?o (MIN(?time) AS ?firstAfter) WHERE {
          VALUES (?g ?t1) {
            ( <urn:uuid:GRAPH> "T1"^^xsd:dateTime )
          }
          ?x a hist:history ;
             hist:timestamp ?time ;
             hist:graph ?g ;
             hist:subject ?s ; hist:predicate ?p ; hist:object ?o .
          FILTER (?time > ?t1)
          FILTER (?s != ?g)
        }
        GROUP BY ?g ?t1 ?s ?p ?o
      }
      ?y a hist:history ;
         hist:timestamp ?firstAfter ;
         hist:graph ?g ;
         hist:subject ?s ; hist:predicate ?p ; hist:object ?o ;
         hist:insert false .
    }
    UNION
    {
      SELECT ?g ?t1 ?s ?p ?o WHERE {
        VALUES (?g ?t1) {
          ( <urn:uuid:GRAPH> "T1"^^xsd:dateTime )
        }
        GRAPH ?g { ?s ?p ?o }
        FILTER (?s != ?g)
        FILTER NOT EXISTS {
          ?x a hist:history ;
             hist:timestamp ?time ;
             hist:graph ?g ;
             hist:subject ?s ; hist:predicate ?p ; hist:object ?o .
          FILTER (?time > ?t1)
        }
      }
    }

    OPTIONAL { GRAPH ?g { ?g dct:conformsTo ?profile } }
    OPTIONAL { GRAPH ?g { ?g dct:requires ?requires } }
    OPTIONAL { GRAPH ?g { ?g dcat:isVersionOf ?grid } }
    OPTIONAL { GRAPH ?g { ?g dcat:version ?prevVersion } }
  }
  { SELECT (STRUUID() AS ?uuid) {} }

  BIND (STR(xsd:integer(?prevVersion) + 1) AS ?version)
  BIND (IRI(CONCAT("urn:uuid:", ?uuid)) AS ?newG)
  BIND (CONCAT("Full model from History at ", STR(?t1)) AS ?desc)
}
