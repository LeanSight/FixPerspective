# AXIOMAS DEL PROYECTO

Última destilación: 2026-04-17 (sesiones: perf-cleanup-slider revertida + Slice A re-aplicado + heightScale fix + brecha de test GOOS-sin-mocks)
Branch: main

## Axiomas del dominio

- **jsdom con `environment: "jsdom"` no ejecuta `ctx.getImageData`, `ctx.putImageData` ni `ctx.filter` de forma fiel** — canvas pixel output no es testeable automáticamente en este repo.
- **jsdom no expone `ImageData` como global** — los helpers de `lib/cleanup.ts` devuelven `{ data, width, height } as ImageData` para que los tests construyan fixtures planos.
- **`fitRectToCanvas` ahora clipa por eje independiente cuando solo uno overflowea** (commit `9916864`, 2026-04-17). Antes aplicaba scaling proporcional siempre, lo que convertía cualquier stretch de un eje (`heightScale > 1`) en un shrink del otro. La función nueva: sin overflow → sin cambio; un eje overflowea → clip de ese eje sin tocar el otro; ambos overflowean → fallback proporcional (preserva aspect para OOB).
- **Tests pueden codificar el bug como spec y dar falsa confianza**: los 3 tests pre-existentes de `fitRectToCanvas` asertaban la reducción proporcional en escenarios de un-eje-overflow como *comportamiento esperado*. Pasaban en verde pero cementaban el bug. Lección operativa: cada test debe derivarse de un **invariant de dominio articulado en lenguaje funcional**, no del output actual de la implementación. Articular el invariant primero (GOOS-sin-mocks), escribir el test después.
- **Radix UI Slider emite ~15–20 eventos/s al arrastrar** con step 0.05 — cualquier handler de canvas costoso debe ejecutarse en <50 ms por tick.

## Decisiones activas

| Decisión | Por qué (irreducible) | Invalida si |
|----------|----------------------|-------------|
| Pipeline de cleanup en `applyCleanupPipeline` NO es testeable en jsdom; solo los 3 helpers puros (`flatFieldCorrect`, `stretchWhitePoint`, `boostSaturation`) llevan tests unitarios. | Orquestador usa `ctx.filter = 'blur(Npx)'` que jsdom ignora. | Migramos a un canvas polyfill que sí ejecuta `ctx.filter`, o a una implementación del blur en JS puro. |
| Export usa canvas propio con `image.width` en `control-panel.tsx:handleExport`, independiente del canvas del preview. | Permite cambiar preview a display-res sin tocar calidad del archivo exportado. | Se unifica preview y export en un solo canvas — cambio de arquitectura mayor. |
| Tests automatizados NO son condición suficiente para cerrar un slice de perf o de geometría que toca rendering de canvas. Verificación manual en navegador es obligatoria antes de continuar al siguiente slice. | Los tests solo cubren funciones puras de geometría; ninguno ejercita el pipeline visual completo, el `fitRectToCanvas`-in-context, ni los CSS transforms del preview. | Se agrega al repo un fake que soporte `getImageData`/`putImageData` o snapshots de canvas, cerrando la brecha. |
| `heightScale` del preview se aplica como CSS `style.height` del canvas element, no vía `perspectiveTransform`. `heightScale=1` se pasa al warp del preview siempre. | Originalmente era workaround del bug `fitRectToCanvas`. Tras `9916864` ya no es necesario para corrección, pero se mantiene por **performance**: el slider no re-triggerea warp ni cleanup (0 ms por tick vs. ~100–300 ms). | El export y el preview deben converger pixel-exacto (hoy pueden diferir en aliasing vertical: CSS stretch vs resampling pixel-level). Si eso pasa a ser requisito, habría que re-introducir `heightScale` en `perspectiveTransform` y aceptar el costo por tick. |
| Nuevos tests en este repo deben derivarse de un **invariant de dominio articulado en Given/When/Then**, no del output actual de la implementación. Validación: cada test debe tener una frase funcional-del-dominio explicable al usuario ("subir `heightScale` no debe angostar el width"). | Los 3 tests pre-existentes de `fitRectToCanvas` cementaban el bug como spec por omisión de este paso — articulaban la implementación, no el comportamiento deseado. | El equipo decide (anti-patrón: no-articular-invariant-before-writing). |

## Restricciones verificadas

- **Node/npm están en `C:\Users\agust\AppData\Local\pnpm\`** — no en `C:\Program Files\nodejs\`. Para llamar npm desde Git Bash hay que usar la ruta absoluta (`/c/Users/agust/AppData/Local/pnpm/npm.CMD`). Verificado con `cmd //c "where node & where npm"` el 2026-04-16.
- **El remote `origin` es `https://github.com/LeanSight/FixPerspective.git` (fork), `upstream` es `https://github.com/Faiziev/FixPerspective.git`** — push directo al upstream da 403 para el usuario `avillena`. Verificado el 2026-04-16 al intentar push inicial.
- **Tests en `vitest.config.ts` corren con `environment: "jsdom"` sin setup file** — `globals: true` no está habilitado, `ImageData` no está en el scope global. No cambiar sin revisar los ~70 tests existentes.

## Anti-patrones confirmados

- **Bundlear 2 optimizaciones de canvas en commits sucesivos sin verificación manual entre slices** → los 73 tests en verde enmascararon una regresión visual. Alternativa: commit → refresh en navegador → confirmar visualmente → recién commit siguiente.
- **Atribuir un bug al commit más reciente sin validar post-revert** → tras revertir `418dc74` el síntoma "heightScale afecta horizontal" persistió, revelando que era latente. Lección: tras revert, re-ejecutar el procedimiento manual; si el bug sigue, el revert no curó nada.
- **Combinar fitting (`fitRectToCanvas`) con stretching (`heightScale`) en el mismo code path sin discriminar ejes** → el saneamiento re-interpreta el stretch intencional como overflow y lo proporcionaliza. Resuelto en `9916864` (clip por eje) pero la lección general: cuando una función toma "ambos ejes juntos" y trata a cada uno distinto, separar los ejes explícitamente.
- **Escribir tests que asertan el output actual de la implementación en vez del invariant de dominio** → los tests pasan pero cementan el bug, eliminando su chance de ser detectado por la suite de regresión. Alternativa (GOOS-sin-mocks): articular primero el Given/When/Then del invariant en lenguaje funcional; solo después traducirlo a assertions. Si la assertion recuerda al output de la impl en vez del intent del usuario, el test está mal concebido.
- **Usar debounce como primer instinto para lag de slider** → introduce delay perceptible que el usuario de este proyecto ya había descartado cualitativamente. Preferir hacer el trabajo por tick barato (cache + downsample) antes que diferirlo.
- **Lanzar un background task en Windows con `| tail -N`, `| head -N` o `| grep`** → el pipe queda abierto indefinidamente si algún subprocess del árbol no cierra stdout. Regla global ya documentada en CLAUDE.md user-scope.

## Dependencias

- [AXIOMA: jsdom no ejecuta canvas pixel APIs fielmente] → [DECISIÓN: pipeline de cleanup solo cubre helpers puros con tests]
- [AXIOMA: jsdom no ejecuta canvas pixel APIs fielmente] → [DECISIÓN: verificación manual obligatoria en slices de perf]
- [AXIOMA: fitRectToCanvas clipa por eje independiente] → [commit `9916864` + test composicional de regresión]
- [AXIOMA: tests pueden codificar bug como spec] → [DECISIÓN: tests nuevos se derivan de invariant articulado en G/W/T, no del output de la impl]
- [AXIOMA: Radix Slider emite 15–20 eventos/s] → [DECISIÓN: target <50 ms por tick para el handler de cleanup]
- [RESTRICCIÓN: remote origin apunta al fork LeanSight] → no hace falta `git push upstream`; `git push` default va al fork.
