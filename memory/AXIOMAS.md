# AXIOMAS DEL PROYECTO

Última destilación: 2026-04-17 (sesión: perf-cleanup-slider revertida)
Branch: main

## Axiomas del dominio

- **jsdom con `environment: "jsdom"` no ejecuta `ctx.getImageData`, `ctx.putImageData` ni `ctx.filter` de forma fiel** — canvas pixel output no es testeable automáticamente en este repo. Verificado cuando `cleanup.test.ts` falló con `ReferenceError: ImageData is not defined` hasta cambiar el shape de retorno.
- **jsdom no expone `ImageData` como global** — los helpers de `lib/cleanup.ts` devuelven `{ data, width, height } as ImageData` para que los tests construyan fixtures planos.
- **`perspectiveTransform + computeRealOutputSize + fitRectToCanvas` tienen acoplamientos no obvios con `canvasSize`** — cambiar solo las dimensiones del canvas de entrada (aún preservando aspect ratio) produjo un comportamiento donde `heightScale` afectó el eje horizontal en vez del vertical. No basta con "mismo aspecto = salida escalada uniforme".
- **Radix UI Slider emite ~15–20 eventos/s al arrastrar** con step 0.05 — cualquier handler de canvas costoso debe ejecutarse en <50 ms por tick para no saturar el main thread.

## Decisiones activas

| Decisión | Por qué (irreducible) | Invalida si |
|----------|----------------------|-------------|
| Pipeline de cleanup en `applyCleanupPipeline` NO es testeable en jsdom; solo los 3 helpers puros (`flatFieldCorrect`, `stretchWhitePoint`, `boostSaturation`) llevan tests unitarios. | Orquestador usa `ctx.filter = 'blur(Npx)'` que jsdom ignora. | Migramos a un canvas polyfill que sí ejecuta `ctx.filter`, o a una implementación del blur en JS puro. |
| Export usa canvas propio con `image.width` en `control-panel.tsx:handleExport`, independiente del canvas del preview. | Permite cambiar preview a display-res sin tocar calidad del archivo exportado. | Se unifica preview y export en un solo canvas — cambio de arquitectura mayor. |
| Tests automatizados NO son condición suficiente para cerrar un slice de perf que toca rendering de canvas. Verificación manual en navegador es obligatoria antes de continuar al siguiente slice. | Los tests solo cubren funciones puras de geometría; ninguno ejercita el pipeline visual completo. | Se agrega al repo un fake que soporte `getImageData`/`putImageData` o snapshots de canvas, cerrando la brecha. |

## Restricciones verificadas

- **Node/npm están en `C:\Users\agust\AppData\Local\pnpm\`** — no en `C:\Program Files\nodejs\`. Para llamar npm desde Git Bash hay que usar la ruta absoluta (`/c/Users/agust/AppData/Local/pnpm/npm.CMD`). Verificado con `cmd //c "where node & where npm"` el 2026-04-16.
- **El remote `origin` es `https://github.com/LeanSight/FixPerspective.git` (fork), `upstream` es `https://github.com/Faiziev/FixPerspective.git`** — push directo al upstream da 403 para el usuario `avillena`. Verificado el 2026-04-16 al intentar push inicial.
- **Tests en `vitest.config.ts` corren con `environment: "jsdom"` sin setup file** — `globals: true` no está habilitado, `ImageData` no está en el scope global. No cambiar sin revisar los ~70 tests existentes.

## Anti-patrones confirmados

- **Bundlear 2 optimizaciones de canvas en commits sucesivos sin verificación manual entre slices** → los 73 tests en verde enmascararon una regresión visual (heightScale afectando el eje equivocado). Alternativa: commit → refresh en navegador → confirmar visualmente → recién commit siguiente.
- **Cambiar canvas dimensions (p. ej. full-res → display-res) y asumir "misma aspect ratio = mismo output modulo scale"** → `perspectiveTransform` tiene sensibilidad no documentada al tamaño absoluto de la canvasSize. Reproducir visualmente antes de asumir equivalencia.
- **Usar debounce como primer instinto para lag de slider** → introduce delay perceptible que el usuario de este proyecto ya había descartado cualitativamente. Preferir hacer el trabajo por tick barato (cache + downsample) antes que diferirlo.
- **Lanzar un background task en Windows con `| tail -N`, `| head -N` o `| grep`** → el pipe queda abierto indefinidamente si algún subprocess del árbol no cierra stdout, el harness de Claude Code nunca recibe el evento "completed". Regla global ya documentada en CLAUDE.md user-scope — vale recordarla acá porque afecta todo comando de tests/build que disparemos con `run_in_background: true`.

## Dependencias

- [AXIOMA: jsdom no ejecuta canvas pixel APIs fielmente] → [DECISIÓN: pipeline de cleanup solo cubre helpers puros con tests]
- [AXIOMA: jsdom no ejecuta canvas pixel APIs fielmente] → [DECISIÓN: verificación manual obligatoria en slices de perf]
- [AXIOMA: perspectiveTransform tiene acople no-obvio con canvasSize] → [ANTI-PATRÓN: asumir escalado uniforme al cambiar dimensiones]
- [AXIOMA: Radix Slider emite 15–20 eventos/s] → [DECISIÓN: target <50 ms por tick para el handler de cleanup]
- [RESTRICCIÓN: remote origin apunta al fork LeanSight] → no hace falta `git push upstream`; `git push` default va al fork.
