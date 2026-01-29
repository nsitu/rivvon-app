# Slyce Mobile Responsiveness Plan

## Current State Analysis

### Issues Identified

#### 1. **Header Component** ([Header.vue](src/components/Header.vue))

- Fixed horizontal layout with `flex gap-3 items-center justify-between`
- Large logo text (4rem) with fixed separator (3px × 4rem)
- Tagline and Rivvon logo displayed inline with no breakpoint handling
- AuthButton positioned at end with no mobile consideration
- **Mobile Impact**: Header wraps poorly, elements overflow on screens < 600px

#### 2. **UploadArea Component** ([UploadArea.vue](src/components/UploadArea.vue))

- Fixed `min-height: 450px` and `margin: 3rem` are too large for mobile
- Horizontal flex layout with `flex gap-4 items-center justify-center`
- No responsive breakpoints defined
- **Mobile Impact**: Upload area takes too much vertical space, horizontal layout causes text wrapping issues

#### 3. **SettingsArea Component** ([SettingsArea.vue](src/components/SettingsArea.vue))

- Three-column layout: FileInfo (20-30%) | Settings (700px min-width 400px) | Tiles (auto)
- `.settings-column` has `min-width: 400px` which exceeds most mobile screens
- Segmented control buttons use fixed padding (1.5rem) and side-by-side layout
- Crop input row with many inline elements: `Crop to [input] × [input] at offset x [input] and y [input]`
- Tile preview grid with 4-column layout
- **Mobile Impact**: Completely unusable on mobile - columns overflow horizontally, inputs impossible to interact with

#### 4. **ResultsArea Component** ([ResultsArea.vue](src/components/ResultsArea.vue))

- Has basic responsive breakpoint at 1024px (flex-direction: column)
- Sidebar fixed at 300px width
- **Mobile Impact**: Better than settings, but sidebar still too wide for small screens

#### 5. **FileInfo Component** ([FileInfo.vue](src/components/FileInfo.vue))

- Table layout for metadata with no responsive handling
- Video player container with crop overlay
- **Mobile Impact**: Table may overflow, video scales but controls may be cramped

#### 6. **DownloadArea Component** ([DownloadArea.vue](src/components/DownloadArea.vue))

- Fixed-width buttons and form inputs
- Toggle switches and text labels inline
- **Mobile Impact**: Minor issues, mostly adequate

#### 7. **Global Styles** ([style.css](style.css))

- Body has `padding: 20px` (adequate for mobile)
- `.slyce` class has fixed `font-size: 4rem` and `letter-spacing: -0.25rem`
- No viewport meta tag in index.html
- **Mobile Impact**: Missing viewport meta is critical - page won't scale correctly on mobile

#### 8. **Tab Navigation** ([HomeView.vue](src/views/HomeView.vue))

- PrimeVue Tabs component with default styling
- No custom responsive handling
- **Mobile Impact**: Should be adequate but may need touch-friendly sizing

---

## Recommendations

### Priority 1: Critical Fixes (Blocking Mobile Usage)

#### 1.1 Add Viewport Meta Tag

**File**: [index.html](index.html)

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
```

#### 1.2 Make SettingsArea Responsive

**File**: [SettingsArea.vue](src/components/SettingsArea.vue)

- Convert three-column layout to single-column stack on mobile
- Remove `min-width: 400px` constraint below 768px
- Stack segmented controls vertically on narrow screens
- Convert inline input rows to stacked layouts
- Reduce tile preview grid to 2 columns on mobile

#### 1.3 Make Header Responsive

**File**: [Header.vue](src/components/Header.vue)

- Stack logo/tagline vertically on mobile
- Hide separator on small screens
- Reduce logo font size on mobile
- Move AuthButton to a mobile menu or reduce to icon-only

### Priority 2: Important Improvements

#### 2.1 Improve UploadArea for Mobile

**File**: [UploadArea.vue](src/components/UploadArea.vue)

- Reduce min-height to 250px on mobile
- Reduce margins from 3rem to 1rem
- Stack content vertically instead of horizontal row

#### 2.2 Optimize ResultsArea for Small Screens

**File**: [ResultsArea.vue](src/components/ResultsArea.vue)

- Add breakpoint at 640px for sidebar width reduction
- Consider collapsible sidebar on mobile

#### 2.3 Improve FileInfo Table

**File**: [FileInfo.vue](src/components/FileInfo.vue)

- Use responsive table pattern (stacked on mobile)
- Reduce label/value spacing

### Priority 3: Polish & UX

#### 3.1 Touch-Friendly Interactions

- Increase tap targets to minimum 44px
- Add touch feedback to buttons
- Ensure form inputs are adequately sized

#### 3.2 Typography Scaling

- Use CSS clamp() for fluid typography
- Scale heading sizes appropriately

---

## Implementation Plan

### Phase 1: Foundation (Viewport & Critical CSS)

**Step 1.1**: Add viewport meta tag to index.html

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
```

**Step 1.2**: Add Tailwind breakpoint utilities to tailwind.config.js (if needed)

```javascript
theme: {
  screens: {
    'xs': '475px',
    'sm': '640px',
    'md': '768px',
    'lg': '1024px',
    'xl': '1280px',
  }
}
```

**Step 1.3**: Add global responsive CSS custom properties to style.css

```css
:root {
  --spacing-mobile: 1rem;
  --spacing-desktop: 3rem;
}
```

---

### Phase 2: Header Responsiveness

**Step 2.1**: Update Header.vue with mobile-first layout

- Use `flex-wrap` and media queries
- Hide tagline and separator on mobile (< 640px)
- Reduce logo size using clamp()

**Changes**:

```vue
<template>
  <div class="header-container">
    <div class="header-brand">
      <span class="cascadia slyce">slyce</span>
      <div class="separator hidden sm:block"></div>
      <span class="cascadia tagline hidden sm:inline">Texture Creator for</span>
      <a href="https://rivvon.ca" class="hidden sm:inline">
        <img style="width: 9rem;" src="/rivvon-black.svg" />
      </a>
    </div>
    <AuthButton />
  </div>
</template>

<style scoped>
.header-container {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: center;
  justify-content: space-between;
  padding: 1rem;
  width: 100%;
}

@media (min-width: 640px) {
  .header-container {
    flex-wrap: nowrap;
    gap: 0.75rem;
    padding: 1rem;
  }
}

.header-brand {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.slyce {
  font-size: clamp(2rem, 5vw, 4rem);
  margin-bottom: 0;
}
</style>
```

---

### Phase 3: UploadArea Responsiveness

**Step 3.1**: Update UploadArea.vue

- Stack content vertically on mobile
- Reduce height and margins

**Changes**:

```vue
<style scoped>
.upload-area {
  min-height: 250px;
  margin: 1rem;
  flex-direction: column;
}

@media (min-width: 640px) {
  .upload-area {
    min-height: 450px;
    margin: 3rem;
    flex-direction: row;
  }
}
</style>
```

---

### Phase 4: SettingsArea Responsiveness (Most Complex)

**Step 4.1**: Convert three-column to responsive grid

```css
.three-column-layout {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  padding: 1rem;
}

@media (min-width: 1024px) {
  .three-column-layout {
    flex-direction: row;
    padding: 0;
  }
}

.settings-column {
  flex: 1 1 auto;
  min-width: 0; /* Remove min-width constraint */
  width: 100%;
}

@media (min-width: 1024px) {
  .settings-column {
    flex: 0 1 700px;
    min-width: 400px;
  }
}
```

**Step 4.2**: Make segmented controls stack on mobile

```css
.segmented-control {
  flex-direction: column;
  gap: 0.5rem;
}

@media (min-width: 640px) {
  .segmented-control {
    flex-direction: row;
    gap: 0;
  }
}

.segmented-control label.segment-left,
.segmented-control label.segment-right {
  border-radius: 1rem;
  max-width: 100%;
}

@media (min-width: 640px) {
  .segmented-control label.segment-left {
    border-radius: 1rem 0 0 1rem;
    max-width: 50%;
  }
  .segmented-control label.segment-right {
    border-radius: 0 1rem 1rem 0;
    max-width: 50%;
  }
}
```

**Step 4.3**: Wrap inline input rows

```css
.flex.gap-2.justify-start.items-center {
  flex-wrap: wrap;
}
```

Or add a wrapper class:

```vue
<div class="input-row">
  <!-- inputs -->
</div>

<style>
.input-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
}
</style>
```

**Step 4.4**: Reduce tile grid columns on mobile

```css
.tile-container-columns {
  grid-template-columns: 1fr 1fr;
}

@media (min-width: 768px) {
  .tile-container-columns {
    grid-template-columns: 1fr 1fr 1fr 1fr;
  }
}

.tile-container-rows {
  column-count: 2;
}

@media (min-width: 768px) {
  .tile-container-rows {
    column-count: 4;
  }
}
```

---

### Phase 5: ResultsArea & FileInfo

**Step 5.1**: Improve ResultsArea sidebar

```css
.results-sidebar {
  flex: 0 0 100%;
  width: 100%;
}

@media (min-width: 640px) {
  .results-sidebar {
    flex: 0 0 250px;
  }
}

@media (min-width: 1024px) {
  .results-sidebar {
    flex: 0 0 300px;
  }
}
```

**Step 5.2**: Make FileInfo table responsive

```css
@media (max-width: 640px) {
  table {
    display: block;
  }

  tbody,
  tr,
  td {
    display: block;
    width: 100%;
  }

  tr {
    margin-bottom: 0.5rem;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid #eee;
  }

  .file-info-label {
    justify-content: flex-start;
    font-weight: 600;
    margin-bottom: 0.25rem;
  }

  .file-info-value {
    padding-left: 1.5rem;
  }
}
```

---

### Phase 6: Testing & Refinement

**6.1 Test Breakpoints**:

- 320px (iPhone SE)
- 375px (iPhone X/12)
- 390px (iPhone 13/14)
- 428px (iPhone 14 Pro Max)
- 768px (iPad portrait)
- 1024px (iPad landscape)

**6.2 Test Interactions**:

- Touch targets are 44px minimum
- Form inputs are accessible
- Video player controls work
- Drag-and-drop has touch fallback

**6.3 Performance**:

- Test on actual mobile devices
- Check for layout shift (CLS)
- Verify touch responsiveness

---

## Summary of Files to Modify

| File                                                | Priority | Complexity | Changes                      |
| --------------------------------------------------- | -------- | ---------- | ---------------------------- |
| [index.html](index.html)                            | P1       | Low        | Add viewport meta            |
| [style.css](style.css)                              | P1       | Low        | Global responsive utilities  |
| [SettingsArea.vue](src/components/SettingsArea.vue) | P1       | High       | Complete responsive overhaul |
| [Header.vue](src/components/Header.vue)             | P1       | Medium     | Stack layout, hide elements  |
| [UploadArea.vue](src/components/UploadArea.vue)     | P2       | Low        | Reduce sizes, stack content  |
| [ResultsArea.vue](src/components/ResultsArea.vue)   | P2       | Low        | Smaller sidebar breakpoint   |
| [FileInfo.vue](src/components/FileInfo.vue)         | P2       | Medium     | Responsive table pattern     |
| [Tile.vue](src/components/Tile.vue)                 | P3       | Low        | Reduce min-size on mobile    |

---

## Estimated Effort

- **Phase 1 (Foundation)**: 30 minutes
- **Phase 2 (Header)**: 1 hour
- **Phase 3 (UploadArea)**: 30 minutes
- **Phase 4 (SettingsArea)**: 2-3 hours
- **Phase 5 (Results & FileInfo)**: 1.5 hours
- **Phase 6 (Testing)**: 1-2 hours

**Total**: ~7-9 hours of development work
