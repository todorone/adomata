# Tailwind-friendly lightbox/gallery components for ad creatives

**Research date:** 2026-08-08  
**Scope:** React 19 + TypeScript + Tailwind CSS 4, with clickable creative previews, a near-full-screen dialog, item navigation, mixed image/video media, and optional ad metadata.  
**Source policy:** primary sources only: official project documentation, official GitHub repositories/source, npm package metadata, and W3C accessibility guidance.

## Executive recommendation

Build a small in-house `CreativeLightbox` on the existing `@base-ui/react` Dialog wrapper and Tailwind utilities. Do not add a generic gallery dependency for V1.

This repo already has the important foundations: React 19 and Tailwind 4 in [`apps/client/package.json`](../../apps/client/package.json), a local Base UI Dialog in [`apps/client/src/ui/dialog.tsx`](../../apps/client/src/ui/dialog.tsx), and a Creative surface that already models image/video assets, asset selection, missing media, and ad metadata in [`apps/client/src/components/fleet-board.tsx`](../../apps/client/src/components/fleet-board.tsx). The new component can therefore be a focused presentation layer over existing data rather than a new gallery model.

The in-house approach is the best match for this product because a Creative is not just a photo gallery: it is one Ad with mixed media plus headline, body, description, CTA, destination, and an explicit warning that performance belongs to the Ad as a whole. The existing implementation already has `selectedAssetKey`, `mediaUrl(...)`, and the correct server-proxied media boundary. A lightbox library would still require an adapter for these product-specific semantics and would bring its own CSS and interaction model.

Keep **Yet Another React Lightbox (YARL)** as the fallback if the team decides that gesture handling, zoom, preload behavior, or a mature navigation surface is worth adopting. It is the strongest drop-in candidate: current, MIT-licensed, TypeScript-native, React 19-compatible, zero runtime dependencies, and modular video/captions/thumbnails/custom-slide support. Its cost is integration with its stylesheet and its slide-centric API.

There is no strong third-party option in this shortlist that is actually Tailwind-native. YARL, react-photo-view, PhotoSwipe, react-image-gallery, and fslightbox-react all require or assume their own CSS. “Tailwind-friendly” therefore means “can be wrapped or extended with Tailwind,” not “the component is composed from Tailwind utilities.” The Tailwind-first choices are the existing Base UI primitive and the shadcn-style copy-owned composition.

## Repo fit and requirements

The relevant current repo facts are:

- The client uses React `19.2.8`, TypeScript, Tailwind `4.3.3`, `tailwind-merge`, Lucide icons, and `@base-ui/react` `1.6.0` ([client manifest](../../apps/client/package.json)).
- The local Dialog wrapper already provides a portal, backdrop, close button, focus-oriented Base UI primitive, and Tailwind class overrides ([`dialog.tsx`](../../apps/client/src/ui/dialog.tsx)). Its default `max-w-lg` can be overridden for a near-full-screen creative surface.
- The current Creative detail already renders images and videos, lets users choose among media assets, shows copy/CTA/destination, and preserves media-unavailable states ([`fleet-board.tsx`](../../apps/client/src/components/fleet-board.tsx)).
- This is a Vite client, not Next.js; a library should not require framework-specific image components or server rendering machinery.
- All client-facing text must remain Ukrainian. Any library UI labels must be overridden or hidden; the product should own labels such as “Попередній креатив”, “Наступний креатив”, “Закрити”, and asset names.

The V1 lightbox should support:

1. A real keyboard-accessible button around each preview/thumbnail.
2. Open at the clicked asset, with previous/next navigation and swipe support on touch devices.
3. A dialog that occupies nearly the viewport while leaving a usable close control and room for metadata.
4. Both `<img>` and native `<video controls>` media, with a poster or fallback for unavailable video.
5. Optional metadata rendered by the product, not forced into a generic caption string.
6. Correct focus return, Escape handling, inert background content, accessible names, and meaningful alt text.
7. No per-asset performance attribution: carousel/asset-feed numbers remain attributed to the Ad.

## Decision matrix

Scores are an engineering judgment from the cited primary sources and this repo’s constraints, not vendor claims. `High` means a good fit with little adaptation; `Medium` means viable but with material integration work or caveats; `Low` means a poor V1 fit.

| Option | Click/open + navigation | Image/video/custom media | Metadata/custom UI | Tailwind fit | Weight/dependency signal | React/TS + maintenance | License | V1 verdict |
|---|---|---|---|---|---|---|---|---|
| **In-house Base UI Dialog + small gallery** | High; explicit state and buttons | High; native media and existing Creative model | High; arbitrary JSX | **Highest**; utilities are the styling system | **Best**; no new package; existing dependency | High; fully owned | Existing repo terms | **Recommended** |
| [YARL](https://github.com/igordanchenko/yet-another-react-lightbox) | High; keyboard, touch, controller API | High; image by default, optional Video plugin, custom slides | High; captions plugin, custom slide/header/footer/controls | Medium; ships required CSS, but custom render slots and class/style hooks are available | **Excellent**; npm reports 0 dependencies; optional features are plugins | **Excellent**; built-in types, React 16.8–19; npm `3.32.2` published 2026-07-30 and GitHub pushed 2026-08-03 | MIT | **Best drop-in fallback** |
| [react-photo-view](https://github.com/MinJieLiu/react-photo-view) | High; provider gallery, keyboard, touch, controlled `PhotoSlider` | High; custom `<video>`/HTML through render | High; custom toolbar/overlay and CSS class hooks | Medium; own CSS is required, but overlay/toolbar can use Tailwind | **Excellent**; official docs claim 7KB gzipped; npm reports 0 dependencies | Medium; TypeScript and SSR support, but npm `1.2.7` was last published 2025-01-05; GitHub remains active | Apache-2.0 | Good lightweight image-first alternative; audit accessibility |
| [react-photoswipe-gallery](https://github.com/dromru/react-photoswipe-gallery) + [PhotoSwipe](https://github.com/dimsemenov/PhotoSwipe) | High; proven gesture/lightbox navigation | Medium; PhotoSwipe is photo-first; custom HTML is possible, but the docs warn that other content has issues | Medium; wrapper captions and PhotoSwipe UI API; arbitrary metadata needs custom UI registration | Medium-low; PhotoSwipe CSS/classes, not Tailwind-native | Medium; two packages and required image dimensions; dynamic import is possible | High; wrapper types and recent `4.1.2` publish 2026-06-15; core `5.4.4` published 2024-05-24, v6 is under development | MIT | Strong image gallery; overkill and awkward for mixed ad creatives |
| [react-image-gallery](https://github.com/xiaolin/react-image-gallery) | High inside its own gallery; fullscreen mode and thumbnails | Medium-high; custom slides support video/iframes/content | Medium-high; descriptions, custom controls/renderers, CSS custom properties | Medium; own CSS plus `additionalClass`/custom classes | **Good**; npm reports no runtime dependencies | High; TypeScript types, React 16–19; npm `2.1.2` published 2026-02-26, GitHub pushed 2026-05-23 | MIT | Viable gallery, but not as natural for a separate thumbnail-triggered dialog |
| [fslightbox-react](https://github.com/banthagroup/fslightbox-react) | High; fullscreen overlay, slide switching, swipe | High; images, HTML video, YouTube, custom React sources | **Low-medium** in basic package; captions, thumbnails, and custom toolbar are documented as Pro features | Low-medium; internal CSS/classes rather than Tailwind composition | Very small package and no declared runtime deps; basic feature boundary matters | Medium; React peer support, but no published `types` field; GitHub/npm activity is current | MIT for basic package | Reject for V1 unless Pro licensing/features are acceptable |
| [shadcn/ui Dialog + Carousel](https://ui.shadcn.com/docs/components/aria/dialog) + [Carousel](https://ui.shadcn.com/docs/components/radix/carousel) | High after composing state | High; arbitrary JSX in slide items | **Highest**; local copied code and slots | **Highest**; Tailwind-first, React 19/Tailwind 4 docs | Dialog already exists; Carousel adds `embla-carousel-react` and generated code | High; source is owned by the repo; Base UI accessibility is documented | Depends on copied source and existing repo terms | **Same recommendation in shadcn vocabulary** |
| [lightGallery](https://github.com/sachinchoolur/lightGallery) | High; very full-featured | High; image/video/HTML and plugins | High | Medium; own CSS/SCSS | Feature-rich but npm package is much larger; plugin CSS and license key workflow | High; React/TypeScript support and active repo | **GPLv3 or paid commercial license** | Exclude for proprietary SaaS unless procurement approves commercial license |

## Candidate findings

### 1. YARL — strongest adoptable library

YARL’s official README says it supports React 19, 18, 17, and 16.8+, keyboard/mouse/touch navigation, limited preloading, responsive images, optional video and zoom, custom UI/custom slides, built-in TypeScript declarations, RTL, and MIT licensing ([README](https://github.com/igordanchenko/yet-another-react-lightbox), [npm metadata](https://www.npmjs.com/package/yet-another-react-lightbox)). npm metadata checked on the research date reports `3.32.2`, zero runtime dependencies, and peer ranges covering React 19 and its type packages.

The API maps well to the requested interaction: controlled `open`/`close`, a `slides` array, an `index`, navigation callbacks, configurable finite/looping carousel, preloading, Escape/backdrop behavior, and a controller ref ([documentation](https://yet-another-react-lightbox.com/documentation)). The Video plugin renders native `<video>` slides with `controls`, `poster`, dimensions, multiple sources, and the normal media attributes ([Video plugin](https://yet-another-react-lightbox.com/plugins/video)). The Captions plugin supports a title and description, while `render.slideFooter`, `render.controls`, custom buttons, and custom slide types leave room for ad-specific metadata ([Captions](https://yet-another-react-lightbox.com/plugins/captions), [custom slides](https://yet-another-react-lightbox.com/examples/custom-slides), [advanced API](https://yet-another-react-lightbox.com/advanced)). The Thumbnails plugin supports image/video thumbnails, positions, custom rendering, and a show/hide toggle ([Thumbnails](https://yet-another-react-lightbox.com/plugins/thumbnails)).

The Tailwind caveat is important: YARL requires its own stylesheet, and plugin stylesheets are separate. It provides a root `className`, style slots, custom render functions, and custom controls, but its internal layout is still YARL’s CSS contract rather than a set of Tailwind primitives ([API documentation](https://yet-another-react-lightbox.com/documentation)). That is acceptable if YARL owns the media viewport and the product supplies a Tailwind-rendered footer/metadata panel; it is less attractive if every pixel of the dialog must look like the current design system.

Integration effort would be modest: map each `mediaAsset` to an image or video slide, set `index` when opening, use `on.view` to keep the selected asset in sync, add `Captions` only for simple title/description, and use `render.slideFooter` or a custom module for the richer Ad metadata. Verify YARL’s focus behavior and translated labels in an accessibility test because the application’s required labels are Ukrainian.

### 2. react-photo-view — smallest-feeling image-first option

The official project describes touch gestures, pan/zoom, keyboard navigation, custom `<video>` or arbitrary HTML previews, custom node expansion, TypeScript, SSR, and a 7KB gzipped size claim ([project docs](https://react-photo-view.vercel.app/en-US), [GitHub](https://github.com/MinJieLiu/react-photo-view)). Its `PhotoProvider` automatically groups `PhotoView` children into a gallery, while `PhotoSlider` exposes controlled `visible`, `index`, `onClose`, and `onIndexChange` state ([getting started](https://react-photo-view.vercel.app/en-US/docs/getting-started), [API](https://react-photo-view.vercel.app/en-US/docs/api)). The provider also exposes `overlayRender`, `toolbarRender`, `className`, `maskClassName`, `photoWrapClassName`, `photoClassName`, custom loading/error nodes, and a custom portal target.

It is attractive for simple image previews and a custom metadata overlay. The main caveats are the stale npm release (`1.2.7`, published 2025-01-05) despite later repository activity, its image-centric mental model, and the need to audit its generated overlay semantics. The docs’ basic example uses `alt=""` on the image; that is not sufficient as the only accessible name when the image itself is the functional trigger. The trigger should be a labelled native button or an otherwise correctly labelled control per [W3C functional-image guidance](https://www.w3.org/WAI/tutorials/images/functional/).

### 3. PhotoSwipe + React wrapper — excellent core, wrong abstraction for this data

PhotoSwipe is a mature, framework-independent MIT-licensed image gallery. The official docs provide dynamic imports, responsive `srcset`, array data sources, zoom, swipe navigation, and a focus trap with focus restoration ([homepage](https://photoswipe.com/), [getting started](https://photoswipe.com/getting-started/), [options](https://photoswipe.com/options/), [data sources](https://photoswipe.com/data-sources/)). The React wrapper supplies `Gallery`/`Item`, custom trigger render props, captions, a separate `dataSource` that can contain more items than the visible thumbnails, access to the PhotoSwipe instance, and an options pass-through ([wrapper README](https://github.com/dromru/react-photoswipe-gallery)).

The drawbacks are material here. PhotoSwipe requires width and height for each image, ships a separate CSS system, and its own custom-content documentation says it is mainly designed for photos and that other content such as iframes has issues ([custom content](https://photoswipe.com/custom-content/)). Captions are not built in to core and the official caption page explicitly warns that caption accessibility must be provided outside the lightbox or through proper alt/label/figcaption markup ([caption guidance](https://photoswipe.com/caption/)). Supporting native video, unavailable media, and an arbitrary metrics/copy panel would be more custom PhotoSwipe event/UI work than the repo’s existing Dialog composition.

### 4. react-image-gallery — solid gallery, less suitable as a lightbox primitive

The official README documents thumbnails, fullscreen modes, keyboard navigation, swipe, RTL, CSS custom-property theming, and custom slides for videos/iframes/other content ([README](https://github.com/xiaolin/react-image-gallery)). It has TypeScript types, React 16–19 peer support, MIT licensing, `renderItem`, `renderThumbInner`, custom nav/control renderers, descriptions, `originalAlt`, `thumbnailAlt`, and `additionalClass`/custom class hooks. npm metadata reports no runtime dependencies and `2.1.2` published 2026-02-26.

It is a good general gallery but its primary component is the gallery itself. The requested product flow is “click a Creative preview in an existing board, then open a controlled near-full-screen dialog at that asset.” Wrapping `ImageGallery` in the existing Dialog duplicates fullscreen behavior; letting it own fullscreen makes the board-to-dialog state and product-specific metadata less direct. Keep it as a reasonable fallback if the desired surface becomes a standalone gallery rather than a lightbox opened from an Ad row.

### 5. fslightbox-react — small basic package, but important features are paywalled

The official repository calls this the basic React Fullscreen Lightbox and supports images, HTML video, YouTube, custom React sources, slide switching, and React 16.8+ ([repository](https://github.com/banthagroup/fslightbox-react), [sources documentation](https://fslightbox.com/react/documentation/sources)). npm metadata reports `2.1.0`, MIT, React peer dependencies, and a recent publish on 2026-08-06.

For this request, the basic/Pro split is disqualifying until confirmed commercially. The official docs mark thumbnails as a Pro feature ([thumbs](https://fslightbox.com/react/documentation/thumbs)), captions as Pro ([captions](https://fslightbox.com/react/documentation/captions)), and custom toolbar buttons as Pro ([toolbar](https://fslightbox.com/react/documentation/toolbar)). The open-source repository also does not advertise a published TypeScript declaration entry in npm metadata. It may be useful for a very small media-only overlay, but it is not the low-effort path once thumbnails and additional ad data are requirements.

### 6. shadcn/ui Dialog + Carousel — a pattern, not a dependency

shadcn/ui’s strongest property is ownership: the component source is copied into the application and styled with Tailwind. Its current Dialog docs include a Base UI variant and describe a modal that makes the content underneath inert, with custom close controls, scrollable content, and RTL support ([Dialog](https://ui.shadcn.com/docs/components/aria/dialog)). Its Carousel is built on Embla and provides swipe/motion, previous/next controls, orientation, events, and plugins ([Carousel](https://ui.shadcn.com/docs/components/radix/carousel)). shadcn’s Tailwind 4 documentation explicitly targets Tailwind 4 and React 19 ([Tailwind v4](https://ui.shadcn.com/docs/tailwind-v4)).

For this repo, the Dialog half already exists as a Base UI wrapper. A full carousel package is probably unnecessary for V1: a few asset thumbnails plus explicit previous/next buttons are less code and easier to make semantically correct than adding Embla. If later requirements include kinetic swiping, looping, or a large thumbnail rail, add only the local carousel component or Embla after that need is demonstrated.

Base UI’s own Dialog documentation covers controlled state, portal/backdrop/popup anatomy, focus trapping, Escape behavior, scroll locking, focus return, accessible title/description, and a visible close control ([Dialog](https://base-ui.com/react/components/dialog)); its accessibility guidance explains that the primitives handle ARIA, keyboard navigation, and focus management but that the application still owns labels and content semantics ([accessibility](https://base-ui.com/react/overview/accessibility)). This is the cleanest foundation for an in-house lightbox.

### 7. lightGallery — feature-rich but licensing makes it unsuitable

lightGallery has an unusually broad feature set: responsive lightbox, animated thumbnails, image/video/YouTube/Vimeo/HTML support, fullscreen, zoom, keyboard navigation, accessibility support, responsive images, plugins, and React/TypeScript integrations ([official repository](https://github.com/sachinchoolur/lightGallery)). It is active and its repository is mature.

However, the project’s official license states that proprietary commercial sites, projects, and applications require a commercial license; the open-source path is GPLv3-compatible only ([license](https://github.com/sachinchoolur/lightGallery/blob/master/LICENSE)). npm metadata reports `2.9.0` and `GPLv3`. Adomata is a proprietary SaaS, so this is not a default option. The same licensing concern also applies to Fancybox’s GPL/commercial model, so neither should be pulled in casually.

## Accessibility requirements for the in-house version

Use the libraries as implementation references, but validate the product component against the WAI-ARIA patterns:

- A modal dialog keeps focus inside, makes outside content inert, closes on Escape, and returns focus to the invoking control. It should have a visible close button and an accessible title/label ([W3C Dialog Modal Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)). Base UI already supplies most of this behavior.
- Previous/next controls should be native buttons with Ukrainian labels. If a thumbnail rail is a carousel, give the group an accessible label, expose the current item, and do not auto-rotate. The W3C carousel pattern requires explicit previous/next controls and meaningful slide names or position information ([W3C Carousel Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/carousel/)).
- A thumbnail that opens the lightbox is a functional control. Its accessible name should describe the action and creative/asset, not rely on an empty image alt or a filename ([W3C Functional Images](https://www.w3.org/WAI/tutorials/images/functional/)).
- The active image needs meaningful alt text when it conveys creative content. Decorative thumbnail images can use empty alt only when the surrounding button supplies the accessible name.
- Video needs native controls, a meaningful accessible label, and a poster/fallback when the source is unavailable. Metadata should remain in the DOM as text, not be encoded only in the image.

## Recommended shape

1. Keep the existing inline Creative detail as the no-interruption board surface.
2. Make the primary image/video and each media thumbnail a native button that opens one controlled Dialog at the clicked `asset.key`.
3. Use the existing `Dialog` parts with an overridden near-viewport layout, e.g. a `max-w-none`/`h-[calc(100dvh-...)]` class arrangement owned by the product.
4. Render one selected media asset in the main region. Use explicit Previous/Next buttons and an optional horizontal thumbnail rail; wrap at the ends only if that behavior is useful and labelled.
5. Render metadata in a Tailwind panel or footer: creative title, body/headline/description, CTA, destination link, asset label, and the existing “results belong to the Ad” note. Do not duplicate or reattribute KPI values.
6. Keep `mediaKey === null` and `mediaUnavailable` as first-class fallback states. Do not let a failed image/video hide the Ad’s copy or numbers.
7. Add one focused component test covering open-at-index, next/previous, close, and inaccessible media fallback; add a browser test for keyboard focus/Escape if the component becomes a primary workflow.

The first implementation should not add Embla or a lightbox package. If the in-house interaction grows to require zoom physics, responsive `srcset` selection, or substantial gesture handling, re-evaluate YARL first. YARL’s custom slide/footer/module APIs are the most likely to preserve the product’s metadata and mixed-media model without forcing a large new dependency.

## Final ranking

1. **In-house Base UI Dialog + small Tailwind gallery** — best product and repo fit; recommended.
2. **YARL** — best ready-made fallback and the clearest combination of current maintenance, zero dependencies, React 19/types, optional video, captions, thumbnails, and custom slides.
3. **react-photo-view** — attractive for a very small image-first viewer; verify accessibility and metadata behavior.
4. **react-image-gallery** — good standalone gallery, less direct for a board-triggered dialog.
5. **react-photoswipe-gallery + PhotoSwipe** — excellent photo tooling, but mixed creative content and metadata require more adapter code.
6. **fslightbox-react** — basic media overlay is viable, but requested thumbnails/captions/toolbar features are Pro and TypeScript ergonomics are weaker.
7. **lightGallery** — technically capable but licensing is unsuitable by default for this proprietary SaaS.
