# Look

*Design notes for how Littlelives looks. Inspired by classic life-simulation games, described
here on our own terms.*

The world has one look: warm, painterly realism with golden-hour light and blue moonlit nights.
All art is original or CC0.

Code: `web/src/render/look.ts` holds the look as data; `web/src/render/babylon/*` applies it.

## Goals

- **A warm, lived-in neighbourhood.** Houses, gardens and people should read as a small,
  cared-for world: a warm, stylised-realistic look rather than photorealism or flat cartoon.
- **Time of day you can feel.** The look is driven by time-of-day keyframes (sun, sky fill,
  image-based light, horizon, zenith, exposure and lamps every few hours), so mornings, golden
  hour, blue hour and night each have their own mood.
- **Only the sun turns warm at sunset.** The sky fill and ambient light stay neutral to cool, and
  the horizon haze stays pale and desaturated. Shadows read blue, greens stay green, and only
  sunlit faces turn golden. The sun fades out around sunrise and sunset, so the switch between
  sun and moon never pops.
- **Warm lamps against cool nights.** At night a moonlight grade turns dark tones blue-grey
  (grass alone would otherwise read dark green) while lamps and lit windows stay warm.
- **Readable at a glance.** The dollhouse view has to show who is where and what they are doing,
  so clarity beats extra effects. There is no bloom or tilt-shift blur.

## Light and grading

| Aspect | Choice |
|---|---|
| Light | Saturated warm sun on an arc, lowered (`sunHeight` 0.8) for long, dramatic shadows. A low peach sunrise, a golden (not red) late afternoon, an orange sunset only as the sun touches the horizon, then a blue dusk with lamps coming on. |
| Nights | A blue moon fill with a strong night grade (0.85), so nights are clearly blue but not murky; warm lamps (`#FFC27A`) and glowing windows. |
| Grading | ACES tone mapping, contrast 1.1, saturation +14. Split toning: warm highlights (hue 38) and cool shadows (hue 222). |
| Effects | A light vignette and soft distance haze. |
| Shadows | Soft, filtered shadows (the shadow map size is the "Shadow detail" setting: 2048 by default). |

## The world

| Element | Design |
|---|---|
| Houses | `house.ts` generates walls from the simulation layout: siding or brick per house, interior paint per room, a tiled wainscot in bathrooms, a stone plinth, corner boards, a frieze, baseboards, windows with muntins, shutters and sills, door casings, painted doors, and gable or hip roofs (34° pitch, 0.4 m overhang, closed gables). |
| Cutaway | Done on the GPU. Each wall vertex stores which view directions it hides, and the vertex shader lowers it to a 0.35 m stub. Roofs show only with walls up and when not zoomed in. |
| Night interiors | Up to 4 warm room lights at room centres or at floor lamps. Windows glow from outside at night only. |
| Garden | A bright yellow-green lawn, foundation shrubs, lot trees, clouds and a sun glow in the sky. |
| Selection marker | A small marker over the selected resident. Its colour follows their mood through a five-step palette (`marker` in `look.ts`). |
| Residents | Stylised-realistic proportions with a face (eyes, brows, mouth) and a walk, sit and gesture rig. Skin roughness 0.48 and hair 0.34 give a soft, slightly glossy finish. |
