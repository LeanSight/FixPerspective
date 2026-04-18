# Propuesta: ajuste "Intensidad de Negros" para el cleanup de pizarras

Feature pendiente, planificada y con intento previo revertido. Este documento
describe **qué se quiere lograr** y **qué evitar** al retomarla.

## Qué es FixPerspective (contexto mínimo)

App Next.js que corrige perspectiva en fotos (pizarras con post-its y
trazos de lápiz es el caso de uso canónico). Procesamiento 100 %
client-side con canvas 2D. Rutas referenciadas:

- `FixPerspective/lib/cleanup.ts` — helpers puros (`flatFieldCorrect`,
  `stretchWhitePoint`, `boostSaturation`) + orquestador `applyCleanupPipeline(ctx, strength)`.
  Operan sobre `{data: Uint8ClampedArray, width, height}` (shape de `ImageData`); retornan nuevo, no mutan.
- `FixPerspective/lib/warp.ts` — contiene `exportWarpedImage(canvas, points, quality, heightScale, cleanupStrength)`.
- `FixPerspective/components/control-panel.tsx:handleExport` — handler del botón Export.
- `FixPerspective/lib/store.ts` — zustand unificado con `points`, `heightScale`, `cleanupStrength`.
  El feature nuevo añade `blackPointStrength` en el mismo objeto (no store separado).
- `FixPerspective/lib/translations.ts` — 8 idiomas: `en`, `es`, `fr`, `de`, `tr`, `ru`, `ja`, `zh`.

**GOOS-sin-mocks** (convención de testing del proyecto, ref.
`devdocs/lessons_learned_2026-04-17.md`): tests derivados de invariant
de dominio articulado en G/W/T; aserciones sobre output y estado
observable, nunca sobre interacciones. Helpers puros calzan exacto:
input → output verificable sin mocks.

## Problema concreto del usuario

Fotos reales de una pizarra de vidrio con trazos a lápiz gris oscuro +
post-its de colores. Tras aplicar la Limpieza de Fondo al 100 %:

- Fondo queda blanco o casi blanco — **✓ funciona**.
- Post-its de colores mantienen color con saturación levemente
  potenciada — **✓ funciona**.
- Trazos de lápiz **quedan en gris medio (≈ brillo 120–180)**, no negro
  — ✗ output se percibe "lavado".

Workflow manual del usuario: descarga el PNG exportado → editor externo
→ **baja brillo + sube contraste**. Esto es un **levels adjustment**
que una app de escaneo aplica automáticamente.

## Behavior deseado

Slider independiente "Intensidad de Negros" (`blackPointStrength`,
rango `[0, 1]`, default `0`, reset con `resetPoints`). Separado del
slider de Limpieza de Fondo, con su propio control visible en el panel
del tab Preview.

Cuando el valor se mueve de `0` a `1`:

- Se calcula `blackPoint` como el **valor de brillo** (número en `[0, 255]`)
  en el percentil bajo del histograma — en el intento previo el mapeo
  era `percentile = 15 × blackPointStrength`, i.e. slider al 100 % usa
  percentil 15. La función `brightness(r,g,b)` sugerida es `Math.min(r,g,b)`
  (preserva dominancia de canal de píxeles saturados: un píxel rojo
  `[200, 50, 50]` tiene min=50 y se considera "oscuro").
- Cada canal R/G/B del píxel se remapea con la misma fórmula afín usando
  ese `blackPoint`:
  `out[c] = clamp((in[c] − blackPoint) × 255 / (255 − blackPoint))`.
  Nota: `blackPoint` es el valor del brillo, no un parámetro distinto.
- El brillo máximo del frame queda en `255`; intermedios escalan lineal.

Invariants verificables (ya codificados en los 5 tests del commit
`15bd5d2`):

- Percentil N mapea a 0: `expect(out.data[idx_del_percentil]).toBe(0)`.
- Brillo máximo se mantiene: `expect(out.data[idx_brillo_max]).toBe(255)`.
- AT regresión: píxel de "lápiz gris" (brillo 180) tras
  `stretchBlackPoint` queda < 50; píxel blanco (255) queda en 255 exacto.
- Edge cases: percentile=0 sobre imagen con min=0 es identity;
  percentile=100 es safe contra div-by-zero (todo el output queda en 0
  o el input sin cambios — ambos finitos, nunca `NaN`/`Infinity`).
- Alpha canal preservado.

Se aplica **después** del blend del pipeline de cleanup (sobre el
resultado ya con fondo blanqueado), tanto en preview como en export:

```
original → flat-field → white-point → saturation → blend(strength)
                                                       ↓
                                              stretch-black-point(blackPointStrength)
                                                       ↓
                                                   output
```

Export debe respetar `blackPointStrength` pixel-level (ruta de
`exportWarpedImage` en `lib/warp.ts`) para que el archivo descargado
coincida con el preview.

## Intento previo (revertido con `git reset --hard 71090ce`)

`71090ce` = commit destino (al que se volvió). Los commits revertidos
siguen accesibles vía `git show <hash>` (reflog default 90 días).

Dos commits que se revirtieron:

- **`15bd5d2`** — `feat: stretchBlackPoint helper`. Agregaba función
  pura `stretchBlackPoint(data, percentile)` con 5 tests (GOOS-sin-mocks:
  percentil mapea a 0, edge cases percentile 0/100, alpha preservado,
  AT de regresión "lápiz gris se oscurece + blanco preserva").
- **`6d9b98b`** — `feat: slider Intensidad de Negros con profiling hook`.
  Cableaba el helper al store (`blackPointStrength`), agregaba el slider
  debajo de "Limpieza de Fondo", extendía `applyCleanupPipeline` y
  `exportWarpedImage` para recibir el nuevo param, agregaba las
  traducciones en los 8 idiomas.

Al implementarlo, el feature funcionaba visualmente (se veía el efecto
deseado al mover el slider), pero el slider se sentía laggy: cada tick
disparaba la pipeline completa. **"Tick" = cada evento `onValueChange`
de Radix Slider**, que dispara al arrastrar. Sumando cleanup +
stretchBlackPoint, el trabajo por tick era ~1 s sobre una foto de 3 MP,
medido en browser con `performance.now()` alrededor de
`applyCleanupPipeline`.

### Intento de optimización (commits `1849311` + `06be84d`, también revertidos)

Roles de los dos commits: `1849311` fue **tidy-first** — extrae el helper
compartido `findPercentileBrightness(data, channelSelector, percentile)`
con la **misma implementación sort-based** para preservar comportamiento
(2 helpers que tenían estructura duplicada ahora delegan al shared). Los
82 tests pasaron idéntico. Después `06be84d` reemplazó la sort por el
histograma dentro del helper extraído — un solo lugar a cambiar.


Diagnóstico empírico con benchmark Node: los dos sorts
(`stretchWhitePoint` y `stretchBlackPoint`) consumían **86 % del tiempo
JS total** — cada uno ~450–500 ms por llamada en un array de 3 M
`uint8`. El costo era el `Array.from(Uint8Array).sort()`, O(N log N)
con constante alta en V8.

Reemplazo aplicado: **counting-sort via histograma de 256 buckets**
(pues los brillos son `uint8`). Ganancia empírica medida:

- `stretchWhitePoint`: 435 ms → 26 ms (~16.8× faster).
- `stretchBlackPoint`: 491 ms → 84 ms (~5.8× faster).
- Pipeline JS total: 1069 ms → 253 ms (4.2× overall).

84/84 tests en verde tras la optimización, incluidos 2 fuzz tests
(GOOS-sin-mocks) que comparaban el output byte-a-byte contra la
implementación sort-based de referencia sobre 20 distribuciones
aleatorias cada uno.

Feature revertida por decisión directa del usuario (`"deshace el arreglo"`
→ reset a `71090ce`). **Sin motivo técnico documentado**; no precedida
por reporte de bug. Este documento captura el aprendizaje para el
próximo intento.

## Presupuesto de performance para el próximo intento

Target accionable: **p95 por tick del slider < 100 ms**. A 15–20
eventos/s que emite Radix Slider (step 0.05), eso deja ≥50 % del main
thread libre y el slider se siente fluido.

Caminos probados que ayudan:

- Counting-sort en lugar de `Array.sort` — factor 5–17× sobre
  `stretchWhitePoint`/`stretchBlackPoint`.
- Split de `useEffect` para no re-ejecutar `perspectiveTransform`
  cuando solo cambia un slider del pipeline (ya aplicado en commit
  `598d836`, aún vigente).

Caminos sin probar que podrían ayudar si el counting-sort no alcanza:

- Downsample del preview a display-res (~800 px en vez de full-res).
  Factor 9–16× menos píxeles a procesar. Precaución: intento previo
  (`418dc74`) rompió la geometría por interacción con `heightScale`;
  el fix de `heightScale` vía CSS (`938136e`) + el fix de
  `fitRectToCanvas` por eje (`9916864`) eliminaron esa clase de
  regresión, por lo que un segundo intento de downsample debería ser
  seguro ahora.
- Reemplazar `boostSaturation` (loop HSL a ~50 ms) por un boost RGB
  simple (≈ 3× más rápido, costo de fidelidad mínimo).

## Requirements para retomar

- Helper puro `stretchBlackPoint(src: ImageData, percentile: number): ImageData`
  con los 5 tests de `15bd5d2`. Contrato: recibe `{data, width, height}`
  con `data` RGBA como `Uint8ClampedArray`; **retorna un nuevo objeto del
  mismo shape**, no muta `src`. Ver `git show 15bd5d2:lib/cleanup.ts` y
  `git show 15bd5d2:lib/__tests__/cleanup.test.ts` para copiar el código
  verbatim. Los commits siguen en el object store de git (reflog).
- Slider en el panel del tab Preview, debajo del de "Limpieza de Fondo".
  Etiquetado vía `translations.ts` con la key `blackPointAdjust`. Las
  8 cadenas del commit revertido se recuperan con
  `git show 6d9b98b:lib/translations.ts | grep blackPointAdjust`.
- Store field `blackPointStrength: number` en el mismo zustand state
  que `cleanupStrength` (no un store separado). Setter
  `setBlackPointStrength`. Reset: `resetPoints` debe limpiarlo a 0
  junto con los demás campos del pipeline (no es un reset específico
  del blackpoint — es el mismo botón que resetea todo lo editable).
- `applyCleanupPipeline` corre el black-point stretch post-blend
  siempre que `strength > 0` **O** `blackPointStrength > 0` (OR
  inclusivo; el stretch se puede aplicar solo, sin el cleanup, si el
  usuario prefiere).
- `exportWarpedImage` respeta el valor (passthrough a la misma
  pipeline). La firma en HEAD actual ya acepta
  `cleanupStrength`; el feature extiende con un 6º param
  `blackPointStrength = 0`.
- Benchmark Node empírico: `scripts/benchmark-cleanup.mjs` **no existe
  en HEAD actual** — se creó en `06be84d` y el reset lo removió.
  Restaurar con `git show 06be84d:scripts/benchmark-cleanup.mjs >
  scripts/benchmark-cleanup.mjs`, ejecutar con
  `node scripts/benchmark-cleanup.mjs`. Complemento: `console.time`
  hook dentro de `applyCleanupPipeline` para medir ticks en browser;
  comparar contra presupuesto de 100 ms es manual (abrir DevTools
  Console mientras arrastrás el slider).
- **Counting-sort desde el primer commit del feature**: el orden
  interno de los slices puede ser (tidy) + (feature con histograma de
  entrada) en vez de (feature con sort) + (optimización). Esto evita
  shipear código intermedio con performance conocida-mala que
  requiere la optimización sí o sí para ser usable.

## Código de referencia del helper (histograma-based)

Pegable directo en `lib/cleanup.ts` (junto a `stretchWhitePoint`). Incluye
la optimización del counting-sort desde el primer commit:

```ts
function findPercentileBrightness(
  data: Uint8ClampedArray,
  channelSelector: (r: number, g: number, b: number) => number,
  percentile: number,
): number {
  const pixelCount = data.length / 4
  const hist = new Uint32Array(256)
  for (let p = 0; p < data.length; p += 4) {
    hist[channelSelector(data[p], data[p + 1], data[p + 2])]++
  }
  const targetIdx = Math.min(
    pixelCount - 1,
    Math.max(0, Math.floor((percentile / 100) * (pixelCount - 1))),
  )
  let cum = 0
  for (let v = 0; v < 256; v++) {
    cum += hist[v]
    if (cum > targetIdx) return v
  }
  return 255
}

export function stretchBlackPoint(src: ImageData, percentile: number): ImageData {
  const data = src.data
  const blackPoint = findPercentileBrightness(data, Math.min, percentile)
  const out = new Uint8ClampedArray(data.length)
  if (blackPoint >= 255) {
    out.set(data)
    return { data: out, width: src.width, height: src.height } as ImageData
  }
  const scale = 255 / (255 - blackPoint)
  for (let p = 0; p < data.length; p += 4) {
    out[p] = Math.min(255, Math.max(0, Math.round((data[p] - blackPoint) * scale)))
    out[p + 1] = Math.min(255, Math.max(0, Math.round((data[p + 1] - blackPoint) * scale)))
    out[p + 2] = Math.min(255, Math.max(0, Math.round((data[p + 2] - blackPoint) * scale)))
    out[p + 3] = data[p + 3]
  }
  return { data: out, width: src.width, height: src.height } as ImageData
}
```

Tests de referencia (copiar verbatim desde `git show 15bd5d2:lib/__tests__/cleanup.test.ts`).

## Checklist de implementación (orden recomendado)

Cada paso = un commit. Tidy-first donde aplique. Tests GREEN antes de avanzar.

1. **Slice 1 — helper puro + tests**
   - Editar `lib/cleanup.ts`: pegar el código de arriba (helper + wrapper).
   - Si `stretchWhitePoint` aún usa sort propio: refactorizar también para
     delegar a `findPercentileBrightness(data, Math.max, p)`. Tidy primero.
   - Editar `lib/__tests__/cleanup.test.ts`: los 5 tests de
     `git show 15bd5d2:lib/__tests__/cleanup.test.ts`.
   - Opcional fuerte: agregar 2 fuzz tests vs implementación sort-based
     de referencia (`git show 06be84d:lib/__tests__/cleanup.test.ts` los
     contiene) — robustecen el invariant y son cheap.
   - Commit: `feat: stretchBlackPoint helper (histogram-based)`.

2. **Slice 2 — store + setter**
   - Editar `lib/store.ts`: añadir `blackPointStrength: number` al interface
     + al objeto inicial (`0`), `setBlackPointStrength` setter, y en
     `resetPoints` incluir `blackPointStrength: 0` en el set.
   - Editar `lib/__tests__/store.test.ts`: seguir el patrón de los tests
     de `cleanupStrength` (AT set/get, default 0, reset).
   - Commit: `feat: blackPointStrength en store`.

3. **Slice 3 — pipeline acepta el nuevo param**
   - Editar `lib/cleanup.ts`: firma de `applyCleanupPipeline` pasa a
     `(ctx, strength, blackPointStrength = 0)`. Guard inicial cambia a
     `if (strength <= 0 && blackPointStrength <= 0) return`. Aplicar el
     black-point **después** del blend del cleanup, sobre `current`.
   - Editar `lib/warp.ts`: firma de `exportWarpedImage` agrega
     `blackPointStrength = 0` como 6º param y pasa al call de
     `applyCleanupPipeline`. La condición que decide si llama pipeline
     pasa a `cleanupStrength > 0 || blackPointStrength > 0`.
   - Commit: `feat: applyCleanupPipeline y exportWarpedImage aceptan blackPointStrength`.

4. **Slice 4 — slider UI + traducciones**
   - Editar `lib/translations.ts`: agregar key `blackPointAdjust` al type
     `Translation` y su traducción en los 8 idiomas.
     `git show 6d9b98b:lib/translations.ts | grep blackPointAdjust` tiene
     las 8 strings listas (`Black Point` / `Intensidad de Negros` / `Point Noir` /
     `Schwarzpunkt` / `Siyah Noktası` / `Точка чёрного` / `黒レベル` / `黑场`).
   - Editar `components/image-canvas.tsx`: destructurar `blackPointStrength`
     y `setBlackPointStrength` de `useImageWarpStore()`. Agregar un
     `<Slider>` debajo del slider de Limpieza de Fondo (mismo bloque
     dentro del `{activeTab === "preview" && ...}`), `min={0} max={1} step={0.05}`.
     Agregar `blackPointStrength` a las deps del cleanup effect y pasarlo
     a `applyCleanupPipeline(previewCtx, cleanupStrength, blackPointStrength)`.
   - Editar `components/control-panel.tsx`: destructurar `blackPointStrength`
     del store y pasarlo como 6º arg a `exportWarpedImage(...)`.
   - Commit: `feat: slider Intensidad de Negros en preview + export`.

5. **Verificación**
   - `npm test` en `FixPerspective/` → todos los tests GREEN.
   - `npm run dev`, abrir `http://localhost:3000`, cargar foto de pizarra.
   - **Profile**: abrir DevTools → Console antes de mover el slider. Con
     `console.time('cleanup-pipeline')` envuelto al call, cada tick debe
     imprimir un número. Arrastrar el slider de 0 a 1 sostenidamente 3 s;
     leer la mediana de los tiempos impresos.
   - **Criterio de aceptación** (ship OK si los tres se cumplen):
     1. Mediana del tick sostenido < 100 ms sobre una foto ≥ 3 MP.
     2. El deslizamiento del slider se ve continuo, sin stutter visible.
     3. Export del PNG al 100 % de blackPointStrength produce blanco-puro
        en fondo y lápiz/tinta en negro-casi-puro (diff manual contra
        cleanup al 100 % sin blackpoint — debe notarse la diferencia).
   - Si (1) falla: restaurar `scripts/benchmark-cleanup.mjs` desde
     `git show 06be84d:scripts/benchmark-cleanup.mjs` para aislar la
     etapa costosa (probablemente aún el sort o `boostSaturation`).
