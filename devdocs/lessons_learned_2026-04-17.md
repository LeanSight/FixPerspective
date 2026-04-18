# Lecciones Aprendidas — Sesión 2026-04-17

## Qué es FixPerspective

App Next.js (app router) para corregir perspectiva en fotos, típicamente pizarras con post-its. Repo `LeanSight/FixPerspective`, branch `main`. 100% client-side, canvas 2D. Rutas clave: `components/image-canvas.tsx` (edición + preview), `lib/warp.ts` (homografía + `perspectiveTransform` + `exportWarpedImage`), `lib/cleanup.ts` (pipeline de limpieza de fondo), `lib/store.ts` (Zustand con `points`, `heightScale`, `cleanupStrength`).

## Glosario

- **Flat-field correction**: normalizar iluminación desigual dividiendo la imagen por una versión borrosa (el "mapa de iluminación" de fondo) obtenida con `ctx.filter = 'blur(Npx)'`.
- **White-point stretch**: escalar todos los canales RGB de modo que el píxel en el percentil 95 de brillo quede en 255; todo lo anterior se escala proporcionalmente (no es un threshold, es un factor).
- **heightScale**: multiplicador que estira el **alto** del rectángulo de salida en la corrección de perspectiva (compensa foreshortening residual). Default 1.0; el slider va de 0.5 a 3.0 con step 0.05. Definido en `components/image-canvas.tsx:499` (heightScale) y `:512` (cleanupStrength).
- **cleanupStrength**: intensidad de la pipeline de limpieza, rango `[0, 1]` cerrado. `0` = early-return dentro de `applyCleanupPipeline` (identidad exacta). `1` = pipeline completo, output 100 % "clean" sin blend. Valores intermedios `lerp(original, clean, cleanupStrength)` por pixel.
- **warpedCanvas**: canvas offscreen (construido con `document.createElement("canvas")` dentro de un `useRef`, persistente entre renders). Introducido en esta sesión para cachear el resultado de `perspectiveTransform` y saltear la etapa cara cuando solo cambia `cleanupStrength`. **Fue revertido** al final de la sesión (ver "Qué no funcionó").
- **imageSize vs originalSize**: `imageSize = { imageWidth, imageHeight }` son las dimensiones de **display** — `imageWidth = min(800, window.innerWidth - 40)` en desktop, `window.innerWidth - 32` en mobile, `imageHeight` proporcional al ratio nativo. `originalSize = { width, height }` son las dimensiones nativas del archivo subido (p. ej. 3000×4000).

## Intención de la sesión

Lado previo (commit `f33ae18` y anteriores): feature de "Limpieza de Fondo" ya funcionaba, pero movés el slider y se sentía laggy — cada tick re-procesaba todo el pipeline incluyendo `perspectiveTransform` (~200–300 ms sobre 3 M pixels).

Objetivo: eliminar el lag sin tocar la calidad visual del preview ni la del export.

El menú completo de 6 alternativas que se presentó al usuario (ordenadas por ratio impacto/esfuerzo):

| # | Estrategia | Impacto esperado | Complejidad |
|---|-----------|------------------|-------------|
| 1 | Cachear el canvas warped en un ref y dividir el `useEffect` monolítico en dos: uno re-corre `perspectiveTransform` (deps points/heightScale/activeTab), otro re-corre cleanup (deps anteriores + cleanupStrength). | –200–300 ms por tick cuando solo cambia cleanupStrength. | Baja. |
| 2 | Debounce del slider (~150–200 ms). | Suaviza percepción pero agrega delay. | Trivial. Descartado por el usuario — ya había rechazado este approach en sesiones previas. |
| 3 | rAF throttle (coalescing al frame rate). | Colapsa 15–20 eventos/s a ≤60 fps efectivos. | Baja. Complementario a #1, no sustitutivo. |
| 4 | Downsample del preview a display-res (~800 px), manteniendo export en full-res vía ruta separada en `control-panel.tsx:handleExport:38`. | 4×–16× menos pixels por pasada del pipeline de preview. | Media. |
| 5 | Mover el pipeline a un Web Worker. | Libera main thread, NO reduce trabajo total. | Alta — refactor grande. |
| 6 | Reimplementar blur+divide+stretch+saturation como WebGL shader. | ~10× sobre el pipeline JS puro. | Alta — bundle complejo. |

**Plan elegido**: `#1 + #4`.

## Qué funcionó

### 1. Split de effects (mitad buena del Slice A)

- **Problema**: `useEffect` monolítico en `components/image-canvas.tsx` tenía `cleanupStrength` en deps junto con `points`, `heightScale`, etc. Cada tick del slider re-disparaba la secuencia `cropImage → perspectiveTransform → applyCleanupPipeline`, aunque solo la última función depende de `cleanupStrength`.
- **Solución aplicada**: dos effects separados. El primero escribe en `warpedCanvasRef` con deps `[image, points, originalSize, activeTab, heightScale]` — se saltea cuando solo cambia `cleanupStrength`. El segundo copia `warpedCanvas → previewCanvas` y aplica `applyCleanupPipeline` con deps `[..., cleanupStrength]`. React garantiza que effects en el mismo componente corren en **orden de declaración** dentro del mismo render, así que cuando puntos cambian, primero se re-warpea y después se cleanea — sin doble-compute.
- **Resultado**: los 73 tests existentes siguieron en verde tras el split, y la lógica es correcta por sí sola.
- **Caveat importante sobre los "~200 ms" que mencioné arriba**: el número es una **estimación de primeros principios** (ops por pixel × cantidad de pixels × throughput estimado de JS), **no una medición**. No se corrió `performance.now()` ni DevTools profiling antes del cambio ni después. La próxima iteración debería medir de verdad antes de optimizar.

### 2. Diagnóstico + menú antes de codear

Escribir root cause, trabajo por tick estimado y una tabla de alternativas con trade-offs **antes** de implementar evita saltar a la solución "obvia". En esta sesión el reflejo natural habría sido debounce (#2), que el usuario ya había descartado en sesiones previas. El menú surfaceó ese veto de forma explícita.

## Qué no funcionó

### 1. Bundlear dos optimizaciones sin validación manual entre slices

- **Hipótesis**: 73/73 tests GREEN tras Slice A y tras Slice B = comportamiento preservado.
- **Realidad**: dos regresiones tras commit `418dc74`: (a) preview visualmente roto, (b) slider `heightScale` afectando el eje horizontal. Los tests son ciegos al rendering de canvas (solo cubren funciones puras: `computeRealOutputSize`, `flatFieldCorrect`, etc.).
- **Lección**: cuando la capa que rompés no está cubierta por el suite (canvas pixel output), verificación manual en navegador **entre cada slice** es obligatoria. Validar Slice A antes de B hubiera contenido el impacto a un solo revert.

### 2. Cambiar canvasSize de full-res a display-res como "cambio aislado"

- **Hipótesis**: pasar `imageSize` (800 × proporcional) en vez de `originalSize` (3000 × 4000) como `canvasSize` a `perspectiveTransform` era una simple escala uniforme — aspect ratio preservado, la salida sería visualmente equivalente pero 9–16× más barata de computar.
- **Realidad**: el preview quedó "echado a perder" visualmente tras el commit `418dc74`. Se reportó además que `heightScale` empezó a actuar sobre el eje horizontal, pero ese segundo síntoma **no fue causado por este commit** — ver actualización abajo.
- **[Actualización post-revert + Slice A aislado: commit `938136e`]** Tras rehacer solamente el split de effects (Slice A) sin tocar `canvasSize`, el bug de "heightScale afecta el eje horizontal" **persistió**. Es un bug pre-existente, no inducido por Slice B. Root cause identificada:
  - `computeRealOutputSize` multiplica `realHeight` por `heightScale` (`lib/warp.ts:196`).
  - `perspectiveTransform` pasa el resultado por `fitRectToCanvas` que cuando el rect excede `canvas.height` escala **proporcionalmente** ambos ejes para preservar aspect (`lib/warp.ts:10-18`).
  - Consecuencia: al subir `heightScale`, el alto topa a `canvas.height`, el scaling proporcional reduce el width visible → "ajuste vertical afecta horizontal".
  - El export nunca tuvo el bug: `exportWarpedImage` crea su propio canvas del tamaño exacto `computeRealOutputSize` sin `fitRectToCanvas`.
  - **Fix en `938136e`**: en el preview, `heightScale` se aplica como CSS `style.height = imageSize.imageHeight * heightScale` del canvas element. El call a `perspectiveTransform` para preview usa `heightScale = 1.0`. El export sigue con heightScale pixel-level (ruta independiente). Además, `heightScale` sale de las deps de los effects de warp y cleanup → el slider ya no retrigger ninguno (bonus: ahora es gratis en CPU).
- **Diff exacto del cambio revertido** (`git show 418dc74 -- components/image-canvas.tsx` para los 3 hunks completos):

  ```diff
  - const fullResSize = { width: originalSize.width, height: originalSize.height }
  + const previewSize = { width: imageSize.imageWidth, height: imageSize.imageHeight }

  - croppedCtx.drawImage(image, 0, 0, fullResSize.width, fullResSize.height)
  - cropImage(croppedCtx, image, points, fullResSize)
  - perspectiveTransform(warpedCtx, cropped, points, fullResSize, heightScale)
  + croppedCtx.drawImage(image, 0, 0, previewSize.width, previewSize.height)
  + cropImage(croppedCtx, image, points, previewSize)
  + perspectiveTransform(warpedCtx, cropped, points, previewSize, heightScale)
  ```

  Y las dimensiones de los 3 canvas ref pasaron de `image.width/height` a `imgW/imgH` (`maxWidth=800`). El propio `imageSize.imageWidth` es idéntico a `imgW`, así que `previewSize.width = 800` y `previewSize.height = img.height * 800 / img.width`.

- **Hipótesis abiertas sobre el daño visual adicional de `418dc74`** (no investigadas; sólo relevantes si se retoma el downsample del preview):
  1. `identifyCorners(quadPoints)` en `lib/warp.ts:761` reclasifica TL/TR/BR/BL buscando el punto más cercano a cada esquina del bounding box. Con coordenadas chicas (800 vs 3000) empates numéricos o un punto ligeramente fuera pueden resolverse al revés.
  2. Precisión numérica de `perspectiveProjectionMatrix` (Gaussian elimination) con floats de magnitud reducida.
  3. Intercambio accidental width/height al reemplazar `fullResSize` por `previewSize` (re-leer los 3 hunks arriba).
- **Lección**: dos bugs separados se presentaron como uno. El `heightScale × fitRectToCanvas` era latente antes de la sesión — fitRectToCanvas está diseñado para contener rects con OOB source points, no para coexistir con un stretch deliberado. Generalmente: cuando dos mecanismos de saneamiento (fitRectToCanvas protegiendo overflow, heightScale provocándolo intencionalmente) comparten un código path, el segundo se rompe silencioso. Futuros cambios de `canvasSize` en preview deben recordar que `heightScale` ahora es CSS-level y el warp interno siempre usa 1.0 — eso desacopla un eje de riesgo.

### 3. Procedimiento de verificación manual (lo que faltó ejecutar entre slices)

Concreto y ejecutable para la próxima iteración:

1. `npm run dev` en `FixPerspective/` (o `launch.cmd` en Windows). Abrir el navegador en `http://localhost:3000`. Si el puerto 3000 está ocupado, Next.js muestra el puerto alternativo en stdout.
2. Subir una foto real con perspectiva visible. **No hay fotos de prueba en el repo** — los commits `55cd8b9` y `418dc74` fueron probados con fotos del teléfono, no reproducibles. Características mínimas para surfacear los bugs de esta sesión:
   - ≥3 MP (bajo eso la performance no se satura y no detectás lag).
   - Bordes rectilíneos identificables (sino no podés marcar el quad con confianza).
   - ≥4 regiones de color distinto (post-its o similar) → detectás rotación de ejes en el warp aunque la forma general parezca ok.
   - Iluminación desigual visible (sombra de cabeza o vignette del flash) → sin esto el slider de cleanup no tiene nada que corregir y no detectás regresiones en esa capa.
3. **Marcar las 4 esquinas del quad** en el tab **Edit**: hay 4 puntos azules numerados (defaults en 0.2/0.8 del ancho y alto). Se mueven arrastrándolos con el mouse o touch. Ver `components/image-canvas.tsx` handlers `handleMouseDown`/`handleMouseMove`/`handleTouchStart`/`handleTouchMove`.
4. Cambiar al tab **Previsualizar Corrección de Perspectiva**. Verificar que se ve la imagen warped correcta (rectangular, post-its no deformados).
5. **Prueba de `heightScale`**: mover el slider etiquetado **Ajuste Vertical** (primer slider del panel) de `1.00x` hacia `2.00x`. La imagen del preview debe **estirarse en el eje vertical** (canvas element se vuelve más alto vía CSS, contenido del bitmap sin cambios). El slider debe sentirse **instantáneo** — ya no dispara perspectiveTransform ni applyCleanupPipeline tras el fix `938136e`. El export con heightScale=2 produce un archivo con alto duplicado a nivel pixel.
6. **Prueba de `cleanupStrength`**: con `Ajuste Vertical` en `1.00x`, mover el slider etiquetado **Limpieza de Fondo** (segundo slider) de `0%` a `100%`. El fondo debe blanquearse progresivamente, los colores de los post-its deben conservarse y "potenciarse" (saturación × 1.3 en el extremo, ver `lib/cleanup.ts:boostSaturation` con factor `1 + 0.3 * strength` dentro de `applyCleanupPipeline`).
7. **Prueba de performance**: con foto ≥3 MP, arrastrar el slider continuo. Dos formas de medir:

   - **Visual** (rápida, sin scripting): DevTools → Performance, grabar 3–5 s de arrastre. Contar long tasks (spans rojos >50 ms, métrica estándar de `PerformanceObserver('longtask')`).
   - **Programática** (para snapshot antes/después): pegar en DevTools Console antes del arrastre, y leer `window.__pt` después:

     ```js
     window.__pt = []
     const o = new PerformanceObserver(l => window.__pt.push(...l.getEntries().map(e => e.duration)))
     o.observe({ entryTypes: ['longtask'] })
     // arrastrar slider ~5s, después:
     console.log('long tasks:', window.__pt.length, 'máx:', Math.max(...window.__pt), 'p95:', window.__pt.sort((a,b)=>a-b)[Math.floor(window.__pt.length*0.95)])
     ```

   Criterio de aceptación: p95 de long tasks <100 ms y ningún task individual >300 ms durante arrastre sostenido.
8. **Export**: con el slider en `100%`, click en **Export Image**. Abrir el archivo descargado y confirmar que tiene resolución full (alineada con `image.width × computeRealOutputSize.height` de `lib/warp.ts`, no con display-res de 800 px).

**Criterio de cierre de un slice de perf**: los 6 pasos anteriores pasan. Si falla cualquiera, el slice está roto aunque los tests automatizados estén en verde.

### 4. ATs sobre "slider feels snappy" son imposibles en jsdom

Alternativas descartadas: (a) spies sobre `perspectiveTransform` para asertar que no se llama con solo cambio de `cleanupStrength` → prohibido por bdd-skill (verificación por interacción en dominio); (b) pixel-level assertions sobre canvas → jsdom no soporta `ctx.getImageData`/`ctx.filter` fiel. **Regla operativa**: para slices de perf en canvas, manual-verify documentado + ejecutado es la frontera externa; tests GREEN no es condición suficiente.

## Hallazgos técnicos clave

1. **jsdom no expone `ImageData` como global** — el test debe construir objetos plano `{data, width, height}` con cast `as ImageData` y las funciones de `lib/cleanup.ts` deben consumir ese shape en vez de hacer `new ImageData(...)`. Evidencia: error `ReferenceError: ImageData is not defined` al correr `lib/__tests__/cleanup.test.ts`, resuelto en sesión previa modificando el return de los 3 helpers + el blend de `applyCleanupPipeline` (`lib/cleanup.ts:22`, `:47`, `:56`, `:100` — ver cada `return { data: out, width: src.width, height: src.height } as ImageData`).

2. **jsdom no soporta `ctx.filter = 'blur(Npx)'`** — `applyCleanupPipeline` (el orquestador) usa esa API GPU-accelerada para el mapa de iluminación. En tests no se puede ejercitar, solo manual. Esto justifica que `lib/__tests__/cleanup.test.ts` cubra solo los 3 helpers puros (`flatFieldCorrect`, `stretchWhitePoint`, `boostSaturation`) y deje el orquestador para verificación en browser.

3. **`canvas.className="hidden"` no impide que un `useEffect` escriba al contexto** — antes del refactor, el effect monolítico pintaba en `previewCanvas` tanto en activeTab=preview (con warp+cleanup) como en activeTab=edit (con `drawImage + drawPath`). En edit mode ese pintado era trabajo tirado porque el canvas estaba hidden por CSS. El split lo elimina como bonus.

4. **Slider de Radix UI emite ~15–20 eventos por segundo al arrastrar** con `step=0.05`. Si cada handler dispara un pipeline de 200+ ms, el main thread queda saturado 3–4× por segundo → experiencia visiblemente laggy. Solución correcta: hacer el trabajo por tick MÁS barato. Solución parche: debounce. Esta sesión descartó el parche por dejar delay perceptible.

5. **Commits de performance sin reproducción pixel-level son apuestas** — 73/73 tests GREEN tras cada slice era engañoso: ninguno ejercita `perspectiveTransform` ni el rendering final. Los únicos tests que existen del warp son sobre funciones puras de geometría (`computeRealOutputSize`, `fitRectToCanvas`, `lineIntersect`, `identifyCorners`), todos en `lib/__tests__/warp.test.ts`. Para correr la suite: `npm test` desde `FixPerspective/` (script declarado en `package.json` como `vitest run`). Agregar un test que cubra el rendering de canvas requeriría polyfill de canvas (p. ej. `canvas` npm package) — no está en scope.

## Arquitectura antes y después (del intento fallido)

### Antes de la sesión (pre-`55cd8b9`)

```
useEffect(() => {
  drawEditCanvas(canvasRef, ...)
  if (activeTab === "preview") {
    cropImage(croppedCtx, image, points, fullResSize)              // fullResSize = originalSize
    perspectiveTransform(previewCtx, croppedCanvas, points, fullResSize, heightScale)
    applyCleanupPipeline(previewCtx, cleanupStrength)
  } else {
    previewCtx.drawImage(image, ...) + drawPath(...)               // dead work, preview hidden
  }
}, [..., activeTab, heightScale, cleanupStrength, ...])
```

Canvases a resolución de archivo (3000×4000). Cada tick del slider re-ejecuta la rama entera.

### Propuesto en Slice A+B (post-`418dc74`, revertido)

```
useEffect(editCanvasDraw, [...sin cleanupStrength])
useEffect(warp,    [image, points, imageSize, activeTab, heightScale])           // → warpedCanvasRef
useEffect(cleanup, [image, points, imageSize, activeTab, heightScale, cleanupStrength])  // → previewCanvas + cleanup
```

Preview/cropped/warped a display-res (~800 px). Export intocado vía `control-panel.tsx:38 (handleExport)` → `document.createElement("canvas")` (`:49`) a `image.width` → `exportWarpedImage(highResCanvas, ...)`. Habría ahorrado ~200 ms por tick en cleanup + 4–16× en el pipeline de preview. Falló por la regresión visual (ver "Qué no funcionó #2").

### Post-revert (estado actual)

Monolito + full-res restaurados. Lag sigue presente. Plan para la próxima iteración: (a) rehacer Slice A aislado, (b) verificar con los 8 pasos de arriba, (c) evaluar Slice B con otra estrategia — mantener aspect ratio explícito desde `originalSize`, o downsample **solo durante drag** del slider y re-renderizar full-res al soltarlo (Radix expone `onValueCommit` aparte de `onValueChange`).
