# Look and visual styles

*Design notes for how Littlelives looks. Inspired by classic life-simulation games, described
here on our own terms.*

The world can be drawn in three styles: **Classic** (the default), **Bright** and **Retro**.
A style changes only lighting, sky, post-processing, colour grading and material response.
Gameplay, models and asset keys are the same in every style, and switching is live. All art is
original or CC0.

Code: `web/src/render/styles.ts` holds the presets as data; `web/src/render/babylon/*` applies
them.

## Shared goals

- **A warm, lived-in neighbourhood.** Houses, gardens and people should read as a small,
  cared-for world: a warm, stylised-realistic look rather than photorealism or flat cartoon.
- **Time of day you can feel.** Every style is driven by time-of-day keyframes (sun, sky fill,
  image-based light, horizon, zenith, exposure and lamps every few hours), so mornings, golden
  hour, blue hour and night each have their own mood.
- **Only the sun turns warm at sunset.** The sky fill and ambient light stay neutral to cool, and
  the horizon haze stays pale and desaturated. Shadows read blue, greens stay green, and only
  sunlit faces turn golden. The sun fades out around sunrise and sunset, so the switch between
  sun and moon never pops.
- **Warm lamps against cool nights.** At night a moonlight grade turns dark tones blue-grey
  (grass alone would otherwise read dark green) while lamps and lit windows stay warm.
- **Readable at a glance.** The dollhouse view has to show who is where and what they are doing,
  so clarity beats extra effects. Expensive or distracting effects are style choices that can be
  switched off. Bloom and tilt-shift also follow the quality setting (`render/quality.ts`).

## The three styles

### Classic (default)

*Warm, painterly realism with golden-hour light, bloom and a miniature focus.*

| Aspect | Choice |
|---|---|
| Light | Saturated warm sun on an arc, lowered (`sunHeight` 0.8) for long, dramatic shadows. A low peach sunrise, a golden (not red) late afternoon, an orange sunset only as the sun touches the horizon, then a blue dusk with lamps coming on. |
| Nights | A blue moon fill with a strong night grade (0.85), so nights are clearly blue but not murky; warm lamps (`#FFC27A`) and glowing windows. |
| Grading | ACES tone mapping, contrast 1.1, saturation +14. Split toning: warm highlights (hue 38) and cool shadows (hue 222). |
| Effects | Visible bloom (threshold 0.72, weight 0.3), a light vignette, soft distance haze, and a subtle tilt-shift blur for the miniature look. |
| Shadows | Soft, filtered shadows (the shadow map size comes from the quality setting: 2048 at medium and high). |

### Bright

*Clean, colourful and soft, with gentle shadows and a pastel sky.*

| Aspect | Choice |
|---|---|
| Light | A higher sun (`sunHeight` 1.05) for shorter, gentler shadows; soft, even light and a pastel sky. |
| Nights | A lighter night grade (0.7) and paler, creamier lamps (`#FFD8A8`). |
| Grading | Neutral tone mapping, nearly flat contrast (1.02), saturation +18, only a hint of split toning. |
| Effects | Faint bloom (threshold 0.92, weight 0.14), almost no vignette or haze, no tilt-shift, a little sharpening for crisp silhouettes. |
| Shadows | Soft. |

### Retro

*Muted colours, hard light and chunky pixels, like the early-2000s classics.*

| Aspect | Choice |
|---|---|
| Light | A fixed afternoon sun (no arc) with hard shadows. |
| Nights | Darker nights with a gentler grade (0.55) and amber lamps. |
| Grading | ACES tone mapping, higher contrast (1.18), saturation −22, warm split toning in both highlights and shadows for a faded look. |
| Effects | No bloom or tilt-shift; light film grain; rendered at half resolution with nearest-neighbour upscaling and nearest-neighbour texture filtering for chunky pixels. |
| Shadows | Hard-edged. |

## The world in every style

| Element | Design |
|---|---|
| Houses | `house.ts` generates walls from the simulation layout: siding or brick per house, interior paint per room, a tiled wainscot in bathrooms, a stone plinth, corner boards, a frieze, baseboards, windows with muntins, shutters and sills, door casings, painted doors, and gable or hip roofs (34° pitch, 0.4 m overhang, closed gables). |
| Cutaway | Done on the GPU. Each wall vertex stores which view directions it hides, and the vertex shader lowers it to a 0.35 m stub. Roofs show only with walls up and when not zoomed in. |
| Night interiors | Up to 4 warm room lights at room centres or at floor lamps. Windows glow from outside at night only. |
| Garden | A bright yellow-green lawn, foundation shrubs, lot trees, clouds and a sun glow in the sky. |
| Selection marker | A small marker over the selected resident. Its colour follows their mood through a five-step palette per style (`marker` in `styles.ts`). |
| Residents | Stylised-realistic proportions with a face (eyes, brows, mouth) and a walk, sit and gesture rig. Skin roughness 0.48 and hair 0.34 give a soft, slightly glossy finish. |
