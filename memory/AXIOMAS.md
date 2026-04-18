# AXIOMAS DEL PROYECTO

Última destilación: 2026-04-17 (sesiones: perf-cleanup-slider revertida + Slice A re-aplicado + heightScale fix)
Branch: main

## Axiomas del dominio

- **jsdom con `environment: "jsdom"` no ejecuta `ctx.getImageData`, `ctx.putImageData` ni `ctx.filter` de forma fiel** — canvas pixel output no es testeable automáticamente en este repo.
- **jsdom no expone `ImageData` como global** — los helpers de `lib/cleanup.ts` devuelven `{ data, width, height } as ImageData` para que los tests construyan fixtures planos.
- **`heightScale × fitRectToCanvas` tienen coupling latente destructivo en el preview**: cuando `realHeight × heightScale > canvas.height`, `fitRectToCanvas` escala **ambos ejes proporcionalmente**, reduciendo el width. Resultado visible: subir heightScale no estira vertical (ya topa), angosta horizontal. `exportWarpedImage` no lo sufre porque crea canvas del tamaño exacto sin fitting. Verificado en commit `938136e` (2026-04-17) con el fix CSS-level.
- **Radix UI Slider emite ~15–20 eventos/s al arrastrar** con step 0.05 — cualquier handler de canvas costoso debe ejecutarse en <50 ms por tick.

## Decisiones activas

| Decisión | Por qué (irreducible) | Invalida si |
|----------|----------------------|-------------|
| Pipeline de cleanup en `applyCleanupPipeline` NO es testeable en jsdom; solo los 3 helpers puros (`flatFieldCorrect`, `stretchWhitePoint`, `boostSaturation`) llevan tests unitarios. | Orquestador usa `ctx.filter = 'blur(Npx)'` que jsdom ignora. | Migramos a un canvas polyfill que sí ejecuta `ctx.filter`, o a una implementación del blur en JS puro. |
| Export usa canvas propio con `image.width` en `control-panel.tsx:handleExport`, independiente del canvas del preview. | Permite cambiar preview a display-res sin tocar calidad del archivo exportado. | Se unifica preview y export en un solo canvas — cambio de arquitectura mayor. |
| Tests automatizados NO son condición suficiente para cerrar un slice de perf o de geometría que toca rendering de canvas. Verificación manual en navegador es obligatoria antes de continuar al siguiente slice. | Los tests solo cubren funciones puras de geometría; ninguno ejercita el pipeline visual completo, el `fitRectToCanvas`-in-context, ni los CSS transforms del preview. | Se agrega al repo un fake que soporte `getImageData`/`putImageData` o snapshots de canvas, cerrando la brecha. |
| `heightScale` del preview se aplica como CSS `style.height` del canvas element, no vía `perspectiveTransform`. `heightScale=1` se pasa al warp del preview siempre. | El pixel-level heightScale en el preview disparaba `fitRectToCanvas` scale-down → bug del eje horizontal. CSS evita el coupling, cuesta 0 ms de cómputo, y el slider ya no triggerea effects. | El export y el preview deben converger pixel-exacto (hoy difieren en aliasing vertical: CSS stretch vs resampling). Si eso pasa a ser requisito, habría que resizar el canvas preview a las dims reales (recreate bitmap por tick). |

## Restricciones verificadas

- **Node/npm están en `C:\Users\agust\AppData\Local\pnpm\`** — no en `C:\Program Files\nodejs\`. Para llamar npm desde Git Bash hay que usar la ruta absoluta (`/c/Users/agust/AppData/Local/pnpm/npm.CMD`). Verificado con `cmd //c "where node & where npm"` el 2026-04-16.
- **El remote `origin` es `https://github.com/LeanSight/FixPerspective.git` (fork), `upstream` es `https://github.com/Faiziev/FixPerspective.git`** — push directo al upstream da 403 para el usuario `avillena`. Verificado el 2026-04-16 al intentar push inicial.
- **Tests en `vitest.config.ts` corren con `environment: "jsdom"` sin setup file** — `globals: true` no está habilitado, `ImageData` no está en el scope global. No cambiar sin revisar los ~70 tests existentes.

## Anti-patrones confirmados

- **Bundlear 2 optimizaciones de canvas en commits sucesivos sin verificación manual entre slices** → los 73 tests en verde enmascararon una regresión visual. Alternativa: commit → refresh en navegador → confirmar visualmente → recién commit siguiente.
- **Atribuir un bug al commit más reciente sin validar post-revert** → tras revertir `418dc74` el síntoma "heightScale afecta horizontal" persistió, revelando que era latente. Lección: tras revert, re-ejecutar el procedimiento manual; si el bug sigue, el revert no curó nada.
- **Combinar fitting (`fitRectToCanvas`) con stretching (`heightScale`) en el mismo code path** → el saneamiento diseñado para evitar overflow re-interpreta el stretch intencional como overflow y lo proporcionaliza. Alternativa: separar los dos ejes de preocupación (pixel-level para export, CSS-level para preview stretch).
- **Usar debounce como primer instinto para lag de slider** → introduce delay perceptible que el usuario de este proyecto ya había descartado cualitativamente. Preferir hacer el trabajo por tick barato (cache + downsample) antes que diferirlo.
- **Lanzar un background task en Windows con `| tail -N`, `| head -N` o `| grep`** → el pipe queda abierto indefinidamente si algún subprocess del árbol no cierra stdout. Regla global ya documentada en CLAUDE.md user-scope.

## Dependencias

- [AXIOMA: jsdom no ejecuta canvas pixel APIs fielmente] → [DECISIÓN: pipeline de cleanup solo cubre helpers puros con tests]
- [AXIOMA: jsdom no ejecuta canvas pixel APIs fielmente] → [DECISIÓN: verificación manual obligatoria en slices de perf]
- [AXIOMA: heightScale × fitRectToCanvas tienen coupling latente] → [DECISIÓN: heightScale del preview via CSS, no via warp pipeline]
- [AXIOMA: Radix Slider emite 15–20 eventos/s] → [DECISIÓN: target <50 ms por tick para el handler de cleanup]
- [RESTRICCIÓN: remote origin apunta al fork LeanSight] → no hace falta `git push upstream`; `git push` default va al fork.
