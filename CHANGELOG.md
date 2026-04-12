# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- MIT license ([LICENSE](LICENSE)); declared in `package.json` and `src-tauri/Cargo.toml`.
- PDF viewer — opens `.pdf` files in a tab with vertically-scrollable pages rendered via `pdfjs-dist`, a toolbar for previous/next page, page number input, zoom in/out, fit-to-width, selectable/copyable text, and `PageUp`/`PageDown` keyboard navigation. Backed by a new `read_file_bytes` Tauri command that returns raw file bytes via `tauri::ipc::Response` (#24).

### Fixed
- Folder explorer was not resizable: the `AppShell` wrapper animated its width to an undefined `--sidebar-width` CSS variable (falling back to 260px), clipping the inner sidebar and the resize handle. Wrapper width is now bound to the stored `sidebarWidth` directly (#24).

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

[Unreleased]: https://github.com/bbolek/md-viewer/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/bbolek/md-viewer/releases/tag/v0.1.0
