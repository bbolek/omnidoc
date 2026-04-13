/**
 * Obsidian Toolkit — Omnidoc plugin
 * ---------------------------------
 * Brings a handful of Obsidian's most-loved note-taking features to Omnidoc:
 *
 *   1. "Outgoing Links" sidebar panel
 *        Parses the active markdown file and lists every [[wiki-link]],
 *        #tag, and [text](url) link.  Clicking a wiki-link resolves it
 *        against the folder of the active note and opens <name>.md.
 *
 *   2. Reading-time status-bar item
 *        Shows "~N min read · M words" for the active markdown file.
 *
 *   3. Command: "Copy backlink to active note"
 *        Copies `[[note-name]]` to the clipboard so you can paste it
 *        into another note and build a web of links.
 *
 *   4. Command: "Copy frontmatter"
 *        Extracts the YAML frontmatter block from the active file and
 *        places it on the clipboard.
 *
 *   5. Command: "Note info"
 *        Fires a toast summarising headings, wiki-links, tags, URLs,
 *        words and lines for the active note.
 *
 * Install by copying this folder to <app_data_dir>/plugins/obsidian-toolkit/
 * and reloading the Plugins panel.
 */
(function (api) {
  "use strict";

  // ── Parsing helpers ────────────────────────────────────────────────────────

  var WIKI_LINK_RE = /\[\[([^\[\]\n|]+)(?:\|([^\[\]\n]+))?\]\]/g;
  var TAG_RE = /(^|[\s(])#([A-Za-z][\w\-/]*)/g;
  var URL_LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
  var HEADING_RE = /^(#{1,6})\s+(.+)$/gm;
  var FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

  function isMarkdown(path) {
    if (!path) return false;
    var ext = path.split(".").pop().toLowerCase();
    return ext === "md" || ext === "mdx" || ext === "markdown";
  }

  function dirname(path) {
    if (!path) return "";
    var i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
    return i < 0 ? "" : path.slice(0, i);
  }

  function basenameNoExt(path) {
    if (!path) return "";
    var name = path.split(/[\\/]/).pop() || "";
    var dot = name.lastIndexOf(".");
    return dot > 0 ? name.slice(0, dot) : name;
  }

  function joinPath(dir, name) {
    if (!dir) return name;
    var sep = dir.indexOf("\\") >= 0 && dir.indexOf("/") < 0 ? "\\" : "/";
    return dir + sep + name;
  }

  // Strip fenced/inline code so we don't pick up links from code blocks.
  function stripCode(src) {
    return src
      .replace(/```[\s\S]*?```/g, "")
      .replace(/`[^`\n]*`/g, "");
  }

  function parseWikiLinks(src) {
    var out = [];
    var seen = Object.create(null);
    var m;
    WIKI_LINK_RE.lastIndex = 0;
    while ((m = WIKI_LINK_RE.exec(src)) !== null) {
      var target = m[1].trim();
      var alias = m[2] ? m[2].trim() : null;
      // Strip optional #heading / ^block from the target when resolving.
      var bare = target.split(/[#^]/)[0].trim();
      if (!bare) continue;
      var key = bare.toLowerCase();
      if (seen[key]) continue;
      seen[key] = true;
      out.push({ target: bare, display: alias || target });
    }
    return out;
  }

  function parseTags(src) {
    var out = [];
    var seen = Object.create(null);
    var m;
    TAG_RE.lastIndex = 0;
    while ((m = TAG_RE.exec(src)) !== null) {
      var t = m[2];
      if (seen[t]) continue;
      seen[t] = true;
      out.push(t);
    }
    return out;
  }

  function parseUrlLinks(src) {
    var out = [];
    var seen = Object.create(null);
    var m;
    URL_LINK_RE.lastIndex = 0;
    while ((m = URL_LINK_RE.exec(src)) !== null) {
      var url = m[2];
      if (seen[url]) continue;
      seen[url] = true;
      out.push({ text: m[1], url: url });
    }
    return out;
  }

  function countHeadings(src) {
    var n = 0;
    HEADING_RE.lastIndex = 0;
    while (HEADING_RE.exec(src) !== null) n++;
    return n;
  }

  function extractFrontmatter(src) {
    var m = FRONTMATTER_RE.exec(src);
    return m ? m[1] : null;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    // Fallback
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } finally { document.body.removeChild(ta); }
    return Promise.resolve();
  }

  // ── 1. Outgoing Links sidebar panel ────────────────────────────────────────

  var LINK_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" width="18" height="18">' +
    '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>' +
    '<path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>' +
    "</svg>";

  api.registerSidebarPanel({
    id: "obsidian-toolkit.outgoing-links",
    label: "Outgoing Links",
    iconSvg: LINK_ICON,
    mount: function (container) {
      var activePath = api.getActiveFilePath();

      function render(path, content) {
        activePath = path;
        var src = content ? stripCode(content) : "";
        var wiki = isMarkdown(path) ? parseWikiLinks(src) : [];
        var tags = isMarkdown(path) ? parseTags(src) : [];
        var urls = parseUrlLinks(src);

        var html = '<div class="otk-root">';
        html += section(
          "Wiki-links",
          wiki.length,
          wiki
            .map(function (l) {
              return (
                '<button class="otk-item otk-wiki" data-target="' +
                escapeHtml(l.target) +
                '" title="Open ' + escapeHtml(l.target) + '.md">' +
                '<span class="otk-bracket">[[</span>' +
                escapeHtml(l.display) +
                '<span class="otk-bracket">]]</span>' +
                "</button>"
              );
            })
            .join("")
        );

        html += section(
          "Tags",
          tags.length,
          tags
            .map(function (t) {
              return '<span class="otk-tag">#' + escapeHtml(t) + "</span>";
            })
            .join("")
        );

        html += section(
          "URL links",
          urls.length,
          urls
            .map(function (u) {
              return (
                '<a class="otk-item otk-url" href="' +
                escapeHtml(u.url) +
                '" target="_blank" rel="noopener noreferrer">' +
                '<span class="otk-url-text">' + escapeHtml(u.text) + "</span>" +
                '<span class="otk-url-host">' + escapeHtml(hostname(u.url)) + "</span>" +
                "</a>"
              );
            })
            .join("")
        );

        if (!path) {
          html +=
            '<div class="otk-empty">Open a markdown file to see its links.</div>';
        } else if (!wiki.length && !tags.length && !urls.length) {
          html +=
            '<div class="otk-empty">No links found in this file.</div>';
        }

        html += "</div>";
        container.innerHTML = STYLE + html;

        // Wire click handlers for wiki-links
        var buttons = container.querySelectorAll(".otk-wiki");
        Array.prototype.forEach.call(buttons, function (btn) {
          btn.addEventListener("click", function () {
            var target = btn.getAttribute("data-target");
            openWikiTarget(target);
          });
        });
      }

      function section(title, count, body) {
        if (!count) return "";
        return (
          '<div class="otk-section">' +
          '<div class="otk-heading">' +
          escapeHtml(title) +
          '<span class="otk-count">' + count + "</span>" +
          "</div>" +
          '<div class="otk-body">' + body + "</div>" +
          "</div>"
        );
      }

      function hostname(url) {
        try { return new URL(url).hostname; } catch (_) { return url; }
      }

      function openWikiTarget(target) {
        if (!activePath) {
          api.showToast("No active file to resolve link against", "warning");
          return;
        }
        var dir = dirname(activePath);
        // Try .md first, then .markdown
        var candidates = [
          joinPath(dir, target + ".md"),
          joinPath(dir, target + ".markdown"),
          joinPath(dir, target),
        ];
        // Optimistically open the first candidate — Omnidoc will show an
        // error toast if the file doesn't exist, which is the right UX.
        api.openFile(candidates[0]);
      }

      var unsubscribe = api.onFileOpen(function (path, content) {
        render(path, content);
      });

      render(activePath, api.getActiveFileContent() || "");

      return function () {
        unsubscribe();
        container.innerHTML = "";
      };
    },
  });

  // ── 2. Reading-time status bar item ────────────────────────────────────────

  api.registerStatusBarItem({
    id: "obsidian-toolkit.reading-time",
    mount: function (container) {
      container.innerHTML = STATUS_STYLE + '<span class="otk-status"></span>';
      var label = container.querySelector(".otk-status");

      function render(path, content) {
        if (!isMarkdown(path) || !content) {
          label.textContent = "";
          label.style.display = "none";
          return;
        }
        var words = content.trim().split(/\s+/).filter(Boolean).length;
        // Obsidian-ish: ~225 wpm, minimum 1 minute
        var minutes = Math.max(1, Math.round(words / 225));
        label.textContent =
          "~" + minutes + " min read · " + words.toLocaleString() + " words";
        label.style.display = "";
      }

      var unsubscribe = api.onFileOpen(function (path, content) {
        render(path, content);
      });

      render(api.getActiveFilePath(), api.getActiveFileContent() || "");

      return function () {
        unsubscribe();
        container.innerHTML = "";
      };
    },
  });

  // ── 3. Command: copy backlink ──────────────────────────────────────────────

  api.registerCommand({
    id: "obsidian-toolkit.copy-backlink",
    label: "Obsidian: Copy backlink to active note",
    handler: function () {
      var path = api.getActiveFilePath();
      if (!path) {
        api.showToast("No file open", "warning");
        return;
      }
      var link = "[[" + basenameNoExt(path) + "]]";
      copyToClipboard(link).then(function () {
        api.showToast("Copied " + link + " to clipboard", "success");
      });
    },
  });

  // ── 4. Command: copy frontmatter ───────────────────────────────────────────

  api.registerCommand({
    id: "obsidian-toolkit.copy-frontmatter",
    label: "Obsidian: Copy frontmatter",
    handler: function () {
      var content = api.getActiveFileContent();
      if (!content) {
        api.showToast("No file open", "warning");
        return;
      }
      var fm = extractFrontmatter(content);
      if (!fm) {
        api.showToast("No YAML frontmatter in this file", "warning");
        return;
      }
      copyToClipboard(fm).then(function () {
        api.showToast("Frontmatter copied to clipboard", "success");
      });
    },
  });

  // ── 5. Command: note info ──────────────────────────────────────────────────

  api.registerCommand({
    id: "obsidian-toolkit.note-info",
    label: "Obsidian: Show note info",
    handler: function () {
      var path = api.getActiveFilePath();
      var content = api.getActiveFileContent();
      if (!content) {
        api.showToast("No file open", "warning");
        return;
      }
      var stripped = stripCode(content);
      var headings = countHeadings(content);
      var wiki = isMarkdown(path) ? parseWikiLinks(stripped).length : 0;
      var tags = isMarkdown(path) ? parseTags(stripped).length : 0;
      var urls = parseUrlLinks(stripped).length;
      var words = content.trim().split(/\s+/).filter(Boolean).length;
      var lines = content.split("\n").length;
      var summary =
        headings + " headings · " +
        wiki + " wiki-links · " +
        tags + " tags · " +
        urls + " URLs · " +
        words.toLocaleString() + " words · " +
        lines.toLocaleString() + " lines";
      api.showToast(summary, "info");
    },
  });

  // ── Styles (scoped via otk- prefix) ────────────────────────────────────────

  var STYLE = [
    "<style>",
    ".otk-root{padding:12px;font-family:Inter,system-ui,sans-serif;font-size:12px;color:var(--color-text);}",
    ".otk-section{margin-bottom:16px;}",
    ".otk-heading{display:flex;align-items:center;gap:6px;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--color-text-muted);font-weight:600;margin-bottom:6px;}",
    ".otk-count{background:var(--color-bg-inset);color:var(--color-text-muted);border-radius:10px;padding:1px 7px;font-size:10px;font-weight:500;}",
    ".otk-body{display:flex;flex-direction:column;gap:3px;}",
    ".otk-item{all:unset;cursor:pointer;display:flex;align-items:baseline;gap:4px;padding:5px 8px;border-radius:var(--radius-sm,4px);color:var(--color-text);font-size:12px;line-height:1.4;}",
    ".otk-item:hover{background:var(--color-sidebar-hover);color:var(--color-accent);}",
    ".otk-bracket{color:var(--color-text-muted);font-family:var(--font-mono);}",
    ".otk-url{text-decoration:none;flex-direction:column;align-items:flex-start;gap:2px;}",
    ".otk-url-text{font-weight:500;word-break:break-word;}",
    ".otk-url-host{font-size:10px;color:var(--color-text-muted);}",
    ".otk-tag{display:inline-block;background:var(--color-accent-subtle,rgba(127,127,127,.12));color:var(--color-accent);border-radius:10px;padding:2px 8px;margin:2px 4px 2px 0;font-size:11px;font-family:var(--font-mono);}",
    ".otk-body:has(.otk-tag){flex-direction:row;flex-wrap:wrap;}",
    ".otk-empty{padding:8px;color:var(--color-text-muted);font-style:italic;}",
    "</style>",
  ].join("");

  var STATUS_STYLE = [
    "<style>",
    ".otk-status{font-size:11px;color:var(--color-statusbar-text,var(--color-text-muted));padding:0 8px;white-space:nowrap;}",
    "</style>",
  ].join("");
})(window.__omnidocAPI);
