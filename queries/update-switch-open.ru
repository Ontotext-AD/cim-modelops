# Flip Switch.open for the current Switches-tab selection (repository `cim-history`).
# Placeholders filled by the app:
#   {{DELETE_QUADS}}  — GRAPH { <sw> cim:Switch.open <old> . } fragments
#   {{INSERT_QUADS}}  — same with the new open value

PREFIX cim: <https://cim.ucaiug.io/ns#>

DELETE DATA { {{DELETE_QUADS}} } ;
INSERT DATA { {{INSERT_QUADS}} }
