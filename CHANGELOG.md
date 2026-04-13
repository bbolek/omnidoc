# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- **Rebranded from `md-viewer` to `Omnidoc`.** Reflects the app's expanded scope — it now handles PDFs, Office documents (DOCX/XLSX/PPTX), data formats (CSV/JSON/YAML/TOML), code, images, and more in addition to Markdown. Product name, crate/package name, window title, Tauri identifier (`com.omnidoc.app`), persisted store keys (`omnidoc-*`), CSS keyframes, plugin API globals (`window.__omnidocAPI`), and custom events (`omnidoc:*`) have all been renamed. **Note:** because persisted `localStorage` keys changed, user preferences (theme, pinned tabs, starred files, plugin enable state, recent files) will reset on first launch after upgrading.

### Added
- Titlebar now shows the currently opened workspace folder (name + folder icon, full path on hover) next to the active file name, so it's always clear which folder the session is rooted in. Falls back gracefully to just the file name when a single file is opened without a workspace.
- Startup loader overlay covers the app while the previous session's tabs are being re-opened, so the UI no longer flashes through each tab as it mounts.

### Fixed
- Zen mode left the viewer content pushed to one side: CSS hid the `.sidebar` inner element, but the `motion.div` wrapper around it kept its inline `width: sidebarWidth`, so the sidebar's horizontal slot was still reserved in the flex row and the viewer never centred. The wrapper (and the activity bar) are now not rendered at all in zen mode, so the viewer takes the full width and the `max-width: 700px` markdown body centres as intended.
- PDF viewer collapsed every page into a thin strip (only the top edge of each page visible) and could not be scrolled vertically when the page was taller than the viewport (single-page documents at fit-width, or any multi-page document). The scroll container used a flex column with `align-items: center`, which is a doubly-hostile layout for an `overflow: auto` scroller: children are free to shrink below their explicit height on the main axis (so pages were squashed into thin strips), and the cross-axis centering hides the overflow-start edge from scroll (so you can't scroll back to the top of an oversized child). Switched the scroller to plain block layout with pages centred via `margin: 0 auto` and spaced with `margin-bottom`, which scrolls reliably on both axes without the flex hazards.
- PDF viewer rendered every page as a thin squashed strip on multi-page documents: each `PdfPage` fired its `page.render()` call as soon as it mounted, so 17 concurrent renders ran against the same document and pdf.js's shared worker state produced corrupt/collapsed output. Renders are now serialized through a shared promise chain on `PdfViewer`, so pages render one at a time.
- PDF viewer did not scroll vertically: the scroll container was `flex: 1` with the default `min-height: auto`, so it grew to fit all pages instead of constraining to the parent height and `overflow: auto` never triggered. Setting `min-height: 0` lets the container clip and scroll its pages.
- PDF viewer rendered only empty placeholder cards: the render effect was resetting `pageRefs.current` to an array of nulls after React had already populated it via ref callbacks, so `renderAll()` skipped every page. The reset is removed; React keeps the ref array in sync.
- Markdown preview collapsed single newlines into one line, so consecutive lines like `**Date:** …`, `**Project:** …` ran together. Added `remark-breaks` so single newlines render as `<br>`, matching the source layout.
- Restored vertical spacing around headings in the markdown preview. The folding-aware heading wrapper zeroed the heading's own margins to avoid doubling, but never applied any margin to the wrapper, leaving headings flush against the next paragraph. Margins now live on the wrapper div.

## [0.2.0] - 2026-04-12

### Added
- PDF viewer — opens `.pdf` files in a tab with vertically-scrollable pages rendered via `pdfjs-dist`, a toolbar for previous/next page, page number input, zoom in/out, fit-to-width, selectable/copyable text, and `PageUp`/`PageDown` keyboard navigation. Backed by a new `read_file_bytes` Tauri command that returns raw file bytes via `tauri::ipc::Response` (#24, #46).

### Fixed
- Folder explorer was not resizable: the `AppShell` wrapper animated its width to an undefined `--sidebar-width` CSS variable (falling back to 260px), clipping the inner sidebar and the resize handle. Wrapper width is now bound to the stored `sidebarWidth` directly (#24, #46).

## [0.1.1] - 2026-04-12

### Added
- MIT license ([LICENSE](LICENSE)); declared in `package.json` and `src-tauri/Cargo.toml` (#45).

## [0.1.0] - 2026-04-12

### Added
- Preview / Source toggle on the markdown viewer, with Shiki-highlighted source view (#1).
- Markdown **Edit** mode with formatting toolbar (bold, italic, strike, headings, lists, blockquote, code, link, hr), tooltips, `Ctrl+B`/`Ctrl+I`/`Ctrl+S` shortcuts, tab-dirty indicator, and `write_file` Tauri command (#4).
- Arrow-key navigation in the folder explorer — Up/Down, Left/Right to collapse/expand, Home/End, Enter to open/toggle (#8).
- File tree operations — create file/folder, rename (F2), delete with confirm; inline rename input; tabs updated or closed on rename/delete (#39).
- Starred files — collapsible "Starred" section, hover/context-menu toggle, persisted via `starredStore` (#39).
- Git status indicators — colour-coded modified/untracked/staged/renamed/deleted/ignored states, folder colour from dirtiest child, polled every 5 s (#39).
- Folding sections — chevron buttons on h1–h4 headings, `Ctrl+Click` to toggle all, per-file fold state (#40).
- Toggleable line numbers for code blocks and text viewer, persisted via `uiStore` (#40).
- Zen / Focus mode — `Ctrl+Shift+Z` or titlebar button, hides chrome, centers content (#41).
- Callouts / admonitions — Obsidian-style `> [!TYPE]` blockquotes (NOTE, TIP, WARNING, DANGER, etc.) with icons, custom titles, and collapsible variants (#41).
- Export to PDF via print stylesheet — hides chrome, applies serif typography, page breaks before h1 (#41).
- YAML Frontmatter sidebar panel with inline editing, tag pills, date formatting, draft badge (#42).
- Tags sidebar panel — crawls the open folder for `#tags` and frontmatter tags, with filter and file drill-down (#42).
- Breadcrumb bar showing the active file's path relative to the open folder; folder segments reveal in the tree, filename copies path to clipboard (#42).

### Fixed
- Markdown viewer: removed redundant scroll wrapper causing horizontal scroll; wide code blocks now scroll within themselves (#1).
- TypeScript TS2448: moved `navigate` to a `useCallback` declared before its `useEffect` consumer (#2).
- Windows build: regenerated `icon.ico` as 32-bit multi-size PNG-compressed ICO to satisfy RC.EXE (#3).
- Theme picker: dot indicator now reflects `isActive` instead of the theme scheme, so light themes no longer look selected (#5).
- Zoom: code blocks and Mermaid diagrams now scale with `--content-zoom`; wheel zoom works on macOS via `ctrlKey || metaKey` (#6).
- Titlebar: window-control hover fills the full titlebar height (#7).
- Folder explorer: guarded expand against double-click race, added loading placeholder, memoized `TreeNavContext`, added `AnimatePresence` key (#9).
- Windows build: enabled tokio `process` feature required by `get_git_status` (#43).
- Zen mode: collapsed app-shell grid rows so hidden chrome no longer reserves empty space; hid breadcrumb in zen mode (#44).

[Unreleased]: https://github.com/bbolek/md-viewer/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/bbolek/md-viewer/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/bbolek/md-viewer/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/bbolek/md-viewer/releases/tag/v0.1.0
