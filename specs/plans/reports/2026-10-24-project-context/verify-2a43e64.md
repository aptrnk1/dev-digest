# Final verify (2a43e64)
```
PASS server gate (uncached, run at this tree): typecheck · arch · test 405
PASS server it (146s) · Test Files 13 passed, Tests 65 passed
[server it exit=0]
PASS client typecheck (5s)
PASS client test (39s) · Test Files 46 passed, Tests 215 passed
[client gate exit=0]
PASS reviewer-core typecheck (4s)
PASS reviewer-core test (3s) · Test Files 3 passed, Tests 31 passed
[reviewer-core gate exit=0]
PASS mcp typecheck (5s)
PASS mcp arch (1s) · no dependency violations found (39 modules, 115 dependencies cruised)
PASS mcp test (7s) · Test Files 18 passed, Tests 115 passed
[mcp gate exit=0]
e2e: skipped — macOS 12 host cannot launch agent-browser Chrome (e2e/INSIGHTS 2026-10-18); run on CI
```
