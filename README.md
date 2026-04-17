# Omnidoc

> A beautiful, fast, cross-platform universal document viewer.
> Markdown, PDF, Office docs, spreadsheets, code, data, images — one app, one keystroke.

Omnidoc is a native desktop app built with [Tauri 2](https://v2.tauri.app/) and React.
It opens in a blink, renders beautifully, ships as a ~10 MB installer, and runs on
Windows, macOS (Intel + Apple Silicon), and Linux.

---

## Contents

- [Highlights](#highlights)
- [Supported formats](#supported-formats)
- [Features](#features)
  - [Workspace & navigation](#workspace--navigation)
  - [Markdown](#markdown)
  - [Code & data](#code--data)
  - [Office & PDF](#office--pdf)
  - [Terminal](#terminal)
  - [Themes & typography](#themes--typography)
  - [Productivity](#productivity)
  - [Plugins](#plugins)
- [Install](#install)
- [Development](#development)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Architecture](#architecture)
- [Contributing](#contributing)
- [License](#license)

---

## Highlights

- 🚀 **Native performance** — Tauri + Rust backend, tiny binary, instant cold start.
- 📚 **Universal format support** — 20+ file types, from Markdown to `.xlsx` to `.pdf`.
- 🎨 **7 built-in themes** — GitHub Light/Dark, Dracula, Nord, Tokyo Night, Solarized Light, Catppuccin Mocha — plus custom themes via plugins.
- 🧩 **Plugin API** — register custom viewers, commands, sidebar panels, status-bar items, and themes with a tiny JS file.
- ⚡ **Built for keyboards** — full keyboard navigation, fuzzy file search, arrow-key tree navigation.
- 🧘 **Zen mode** — hide all chrome, center the content, focus on the reading.
- 📝 **Markdown editing** — not just viewing. Formatting toolbar, live preview, dirty indicator.
- 🔌 **Live file watching** — files change on disk, Omnidoc reloads them.
- 💻 **Integrated terminal** — full PTY-backed shell (`Ctrl+` `` ` ``), one terminal per workspace folder, auto-switching as you move between folders.

## Supported formats

| Category        | Extensions                                                                 | Renderer                             |
|-----------------|----------------------------------------------------------------------------|--------------------------------------|
| **Markdown**    | `.md`, `.markdown`, `.mdx`                                                 | `react-markdown` + GFM + math + breaks |
| **PDF**         | `.pdf`                                                                     | `pdfjs-dist` (vertically scrollable) |
| **Word**        | `.docx`                                                                    | `docx-preview`                       |
| **Excel**       | `.xlsx`, `.xls`, `.xlsm`                                                   | `xlsx-js-style` with styled tables   |
| **PowerPoint**  | `.pptx`                                                                    | `pptx-preview`                       |
| **CSV / TSV**   | `.csv`, `.tsv`                                                             | PapaParse + virtualized grid         |
| **JSON**        | `.json`, `.jsonc`, `.ndjson`                                               | Collapsible tree + raw view          |
| **YAML**        | `.yaml`, `.yml`                                                            | `js-yaml` + syntax-highlighted tree  |
| **TOML**        | `.toml`                                                                    | `smol-toml` + syntax-highlighted tree|
| **HTML / SVG**  | `.html`, `.htm`, `.svg`                                                    | Sandboxed iframe                     |
| **Images**      | `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.bmp`, `.ico`, `.avif`, `.svg`  | Dedicated viewer — Fit/Actual, drag-pan       |
| **Video**       | `.mp4`, `.webm`, `.ogv`, `.mov`, `.m4v`                                    | Native `<video>` with controls       |
| **Archives**    | `.zip`                                                                     | Tree of contents + one-click Extract |
| **Subtitles**   | `.vtt`, `.srt`                                                             | Cue-by-cue viewer                    |
| **Code**        | `.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.rs`, `.go`, `.java`, `.cpp`, `.c`, `.rb`, `.php`, `.sh`, `.css`, `.scss`, `.sql`, `.swift`, `.kt`, `.dart`, `.lua`, `.r`, `.hs`, `.ex`, `.clj`, `.vue`, `.svelte`, …          | Shiki syntax highlighting, 100+ languages |
| **Plain text**  | `.txt`, `.log`, `.env`, `.gitignore`, …                                    | Monospace viewer with line numbers   |
| **Anything else** | fall-through                                                             | Text viewer, or a plugin-registered viewer |

Within Markdown, Omnidoc additionally renders:

- GitHub-flavored Markdown (tables, task lists, strikethrough, autolinks)
- KaTeX math (`$inline$` and `$$block$$`)
- Mermaid diagrams (flowcharts, sequence, class, state, ER, …)
- Shiki-highlighted fenced code blocks (100+ languages, per-theme highlighting)
- Obsidian-style callouts / admonitions (`> [!NOTE]`, `> [!WARNING]`, `> [!TIP]`, …)
- Raw HTML (when the `rehype-raw` pipeline is enabled)
- YAML frontmatter (rendered in its own sidebar panel with inline editing)
- Collapsible headings (chevron toggles on H1–H4, `Ctrl+Click` to collapse all)

## Features

### Workspace & navigation

- **Folder explorer** with git status indicators (modified/untracked/staged/renamed/deleted/ignored), polled every 5 s
- **Arrow-key tree navigation** — Up/Down, Left/Right to collapse/expand, Home/End, Enter to open
- **File tree operations** — create file/folder, rename (F2), delete (with confirm)
- **Cut / Copy / Paste** in the file tree — `Ctrl/Cmd+X`, `Ctrl/Cmd+C`, `Ctrl/Cmd+V` or the context menu. Paste auto-renames on collisions (`name (copy).ext`); Cut moves and updates any open tab paths
- **Starred files** — collapsible "Starred" section, persisted
- **Tabs** — pinnable, reorderable, session-restored on startup
- **Breadcrumb** — shows the active file's path; click a folder segment to reveal it in the tree; click the filename to copy the path
- **Fuzzy file search** across the open workspace
- **Recent files** — quick reopen from the welcome screen

### Markdown

- **Preview / Source / Edit** toggle
- **Edit mode** with formatting toolbar: bold, italic, strikethrough, headings, lists, blockquote, code, link, hr
  - `Ctrl+B`, `Ctrl+I` shortcuts; `Ctrl+S` to save; dirty indicator on tab
- **Table of contents** sidebar with scroll-sync highlighting
- **YAML frontmatter panel** with inline editing, tag pills, date formatting, draft badge
- **Tags panel** — crawls the workspace for `#tags` and frontmatter tags, with filter and file drill-down
- **Folding** — chevron toggles on H1–H4 headings, per-file fold state, `Ctrl+Click` to toggle all
- **Export to PDF** via print stylesheet (hides chrome, serif typography, page break before h1)
- **Presentation mode** (`Ctrl+Shift+P` or the "Present" toolbar button) — renders the document as a fullscreen slide deck split on `---` horizontal rules. Arrow/space keys navigate, `Escape` exits, the first heading on each slide becomes the centered title, and YAML frontmatter / `---` inside fenced code blocks are not treated as slide breaks. The Tauri window enters fullscreen on start and restores its previous state on exit.
- **Callouts** — Obsidian-style `> [!TYPE]` blockquotes (`NOTE`, `TIP`, `IMPORTANT`, `WARNING`, `DANGER`, `CAUTION`, `SUCCESS`, `INFO`, `QUOTE`, `EXAMPLE`) with icons, custom titles, and `[!TYPE]-` for collapsible
- **KaTeX math** and **Mermaid** rendering

### Code & data

- **Shiki** syntax highlighting with per-theme palettes (Omnidoc themes include matching Shiki themes)
- **Toggleable line numbers** across code blocks and text files (persisted)
- **JSON viewer** — collapsible tree with raw / tree toggle, path-copy
- **YAML / TOML viewer** — parsed tree with syntax highlighting
- **CSV / TSV viewer** — virtualized grid for large files
- **Excel** — styled table rendering with sheet tabs
- Copy-to-clipboard on every code block

### Office & PDF

- **PDF** — vertical scroll, zoom in/out/fit-width, page number input, Prev/Next toolbar, `PageUp`/`PageDown`, selectable & copyable text
- **DOCX** — styled rendering close to the original document
- **XLSX** — sheet tabs, cell styles preserved
- **PPTX** — slide-by-slide viewer

### Terminal

A first-class integrated terminal — no "run commands in a subprocess and print the output" toy, but a real PTY-backed shell that feels like your OS terminal emulator.

- **Real PTY** — spawned via `portable-pty` on the Rust side, with live resize tied to the xterm.js viewport (`ResizeObserver` + window resize)
- **Shell auto-detection** — PowerShell 7 → PowerShell → `cmd.exe` on Windows, `$SHELL` → `bash` on macOS / Linux
- **xterm.js frontend** — full ANSI, 256-color / truecolor, clickable web links, 5000-line scrollback
- **Toggle panel** — `Ctrl+` `` ` `` shows/hides the terminal panel at the bottom of the workspace
- **New terminal** — `Ctrl+Shift+` `` ` `` spawns a fresh PTY stacked in the tab strip
- **Persistent output** — terminals stay alive when you switch tabs (hidden, not unmounted), so long-running processes keep running
- **Exit status reporting** — when a shell exits, the status code is surfaced in the UI

#### Binding terminals to folders

Every terminal is bound to a workspace folder, and Omnidoc uses that binding as the backbone of its terminal UX:

- **Rooted `cwd`** — a new terminal opens with its working directory set to the folder it's bound to, so `ls` / `dir` / `git status` just work
- **Auto-switching** — when you change the active folder in the sidebar, Omnidoc auto-switches to the terminal bound to that folder (if one exists). Multi-folder workspaces get one terminal per folder without you having to juggle tabs
- **Folder-colored tabs** — each terminal tab inherits the accent color of its bound folder, so you can see at a glance which repo / project each shell belongs to
- **Unbound terminals** — terminals spawned without a workspace folder (`folderPath = null`) persist independently and aren't tied to any directory
- **Session-restored** — folder bindings are persisted in the workspace file (`.omnidoc-workspace.json`) alongside your tabs, so your terminal layout comes back on restart

### Images

- **Fit / Actual size** toggle in the toolbar
- **Click-and-drag pan** once the image overflows the viewport
- Global content zoom (`Ctrl+=` / `Ctrl+-` / `Ctrl+0`) applies on top of either mode
- Info panel shows file name, dimensions, file size, and format
- Subtle checkerboard background so transparent images are visible

### Video

- Native HTML5 `<video>` playback with the host webview's built-in controls
- Codec support follows the platform webview (H.264/AAC `.mp4` and VP8/VP9 `.webm` everywhere; Apple codecs on macOS)
- Toolbar shows filename, dimensions, duration, file size, and format

### Archives

- **Zip viewer** renders a collapsible directory tree of the archive contents
- Totals panel: files, folders, uncompressed size, and compression ratio
- **Extract** toolbar button prompts for a destination folder and unpacks everything there
- Zip-slip protection enforced server-side (entries with absolute or parent-traversal paths are skipped)
- `deflate`-only — password-protected (ZipCrypto/AES) and `zstd`/`bzip2` archives are not supported

### Themes & typography

- **7 built-in themes**: GitHub Light, GitHub Dark, Dracula, Nord, Tokyo Night, Solarized Light, Catppuccin Mocha
- **System / Light / Dark** color-scheme preference (respects OS setting)
- **Token-based theming** — a theme is a flat object of ~30 CSS variables; trivial to write new ones (including via plugins)
- **Inter** for UI, **Fira Code** for monospace (both bundled via `@fontsource`)
- **Content zoom** — `Ctrl+=` / `Ctrl+-` / `Ctrl+0`; wheel-zoom with `Ctrl`/`Cmd`

### Productivity

- **Zen mode** (`Ctrl+Shift+Z`) — hides all chrome, centers content
- **Split view** (via `allotment`) — sidebar and viewer resizable
- **Session restore** — reopens your tabs and workspace on startup, with a loader overlay so the UI doesn't flash through each tab
- **Live file watching** — external changes reload automatically
- **Drag-and-drop** files or folders onto the window
- **Dark/light window chrome** matched to theme (custom titlebar, frameless)

### Plugins

A minimal, powerful plugin API inspired by Obsidian. Drop a folder into
`<app_data_dir>/plugins/`, hit refresh in the Plugins panel, and your plugin loads.

A plugin can register:

- **Viewers** for new extensions (HTML-string `render` or a React component)
- **Commands** (optionally bound to a shortcut)
- **Sidebar panels** (icon + mount function, full DOM access)
- **Status-bar items**
- **Themes**

```js
// window.__omnidocAPI is also available for IIFE-style plugins
(function (api) {
  api.registerViewer({
    extensions: ["log"],
    label: "Log Viewer",
    render: (content, path) => `<pre>${escape(content)}</pre>`,
  });

  api.registerCommand({
    id: "my-plugin.word-count",
    label: "Show word count",
    handler: () => api.showToast("Words: " + api.getActiveFileContent()?.split(/\s+/).length),
  });
})(window.__omnidocAPI);
```

See [`docs/plugin-example/main.js`](docs/plugin-example/main.js) for a full working example
(custom viewer + command + sidebar panel + theme).

## Install

Grab the latest installer for your platform from the
[Releases page](https://github.com/bbolek/omnidoc/releases):

| Platform            | File                                |
|---------------------|-------------------------------------|
| Windows             | `.msi` (recommended) or `.exe` (NSIS) |
| macOS (Intel)       | `.dmg` (x86_64)                     |
| macOS (Apple Silicon) | `.dmg` (aarch64)                  |
| Linux               | `.AppImage` (portable) or `.deb`    |

## Development

### Prerequisites

- **Node.js** 20+
- **Rust** (stable toolchain) — see [rustup.rs](https://rustup.rs/)
- Platform-specific Tauri prereqs: see [the Tauri guide](https://v2.tauri.app/start/prerequisites/)
  - Linux: `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`, `patchelf`

### Run

```bash
npm install
npm run tauri dev       # native window with HMR
```

The frontend dev server runs at `http://localhost:1420` — opening that URL in a browser
gives you the pure React app without native integrations (useful for quick UI work).

### Build

```bash
npm run tauri build     # produces platform-specific installers in src-tauri/target/release/bundle/
```

### Scripts

| Command             | Description                                 |
|---------------------|---------------------------------------------|
| `npm run dev`       | Vite dev server (frontend only)             |
| `npm run build`     | TypeScript check + Vite production bundle   |
| `npm run preview`   | Preview the Vite production bundle          |
| `npm run tauri`     | Tauri CLI passthrough (`dev`, `build`, …)   |

### Release

Pushes to `main` trigger the GitHub Actions release workflow
(`.github/workflows/release.yml`), which builds on Windows / macOS (x64 + arm64) /
Linux and uploads signed draft release artifacts.

## Keyboard shortcuts

| Shortcut           | Action                                 |
|--------------------|----------------------------------------|
| `Ctrl+O`           | Open file                              |
| `Ctrl+Shift+O`     | Open folder                            |
| `Ctrl+W`           | Close tab                              |
| `Ctrl+Tab`         | Next tab                               |
| `Ctrl+Shift+P`     | Presentation mode (Markdown slide deck) |
| `Ctrl+P`           | Fuzzy file search                      |
| `Ctrl+` `` ` ``    | Toggle integrated terminal             |
| `Ctrl+Shift+` `` ` `` | New terminal (in active folder)     |
| `Ctrl+F`           | Find in current document               |
| `Ctrl+S`           | Save (in edit mode)                    |
| `Ctrl+B`           | Bold (markdown edit)                   |
| `Ctrl+I`           | Italic (markdown edit)                 |
| `Ctrl+=` / `Ctrl+-`/ `Ctrl+0` | Zoom in / out / reset        |
| `Ctrl+Shift+Z`     | Zen mode                               |
| `F2`               | Rename file / folder                   |
| `Up` / `Down`      | Navigate file tree                     |
| `Left` / `Right`   | Collapse / expand folder               |
| `Enter`            | Open file / toggle folder              |
| `PageUp` / `PageDown` | PDF: previous / next page           |

## Architecture

```
omnidoc/
├── src/                        # React frontend (TypeScript)
│   ├── components/
│   │   ├── viewer/             # One component per file format
│   │   ├── sidebar/            # File tree, TOC, tags, frontmatter, plugins
│   │   ├── layout/             # Titlebar, breadcrumb, status bar, tabs
│   │   ├── editor/             # Markdown editor + toolbar
│   │   ├── search/             # Fuzzy file search
│   │   ├── terminal/           # xterm.js panel + folder-bound terminal tabs
│   │   ├── welcome/            # Welcome screen
│   │   └── ui/                 # Shared primitives (Toast, Dialog, …)
│   ├── store/                  # Zustand stores (files, theme, UI, plugins, starred)
│   ├── themes/                 # Built-in theme definitions
│   ├── plugins/                # Plugin API + manager
│   ├── hooks/
│   ├── utils/
│   └── index.css               # Global CSS (all styling lives here)
├── src-tauri/                  # Rust backend
│   ├── src/
│   │   ├── commands/           # fs, search, export, themes, plugins, watcher, terminal
│   │   └── lib.rs              # Tauri setup + command registry
│   ├── capabilities/           # Tauri v2 permission manifests
│   └── tauri.conf.json
├── docs/
│   └── plugin-example/         # Reference plugin
└── .github/workflows/          # CI / release
```

**Frontend stack**

- **React 18** + **TypeScript 5**
- **Vite 6** for build
- **Zustand** for state (one store per concern, all persisted via `persist` middleware)
- **Framer Motion** for micro-animations
- **Allotment** for resizable splits
- **Lucide** for icons
- **Shiki** for syntax highlighting (same engine VS Code uses)
- **react-markdown** + remark/rehype plugins (GFM, math, breaks, raw, KaTeX)
- **Mermaid**, **KaTeX**, **PDF.js**, **docx-preview**, **xlsx-js-style**, **pptx-preview**, **PapaParse**, **js-yaml**, **smol-toml**
- **xterm.js** (`@xterm/xterm` + `fit` + `web-links` addons) for the integrated terminal

**Backend (Rust / Tauri)**

- `tauri-plugin-fs`, `-dialog`, `-shell`, `-os`
- `notify` for filesystem watching
- `encoding_rs` for charset detection
- `portable-pty` for the integrated terminal (PTY spawn, resize, I/O streaming over Tauri events)
- Custom commands: `read_file_bytes`, `write_file`, `get_git_status`, file tree enumeration, search, export, plugin loading, theme compilation, `terminal_spawn` / `terminal_write` / `terminal_resize` / `terminal_kill`

**State**

Everything user-facing is persisted via Zustand under these `localStorage` keys:

- `omnidoc-theme` — current theme + color scheme
- `omnidoc-ui` — sidebar position/visibility/width, line-number toggle, zen mode, …
- `omnidoc-files` — recent files, open folder, last session tabs
- `omnidoc-starred` — starred file paths
- `omnidoc-plugins` — enable/disable choices per plugin

## Contributing

PRs welcome! A few conventions:

- All styling lives in `src/index.css` — no CSS-in-JS, no CSS modules. Theme tokens are declared in `src/themes/*` and consumed via CSS variables.
- Each file type gets its own viewer component under `src/components/viewer/`. Office viewers are lazy-loaded.
- State goes in a Zustand store. Only persist what's actually user-facing (`partialize`).
- Keep the Tauri command surface small and well-typed.
- Bump `CHANGELOG.md` under `[Unreleased]`.

See [`CHANGELOG.md`](CHANGELOG.md) for the full release history.

## License

[MIT](LICENSE) — © 2026 Omnidoc contributors
