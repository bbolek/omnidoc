import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { getFileType, getFileExtension } from "../../utils/fileUtils";
import { pluginManager } from "../../plugins/pluginManager";
import { useUiStore } from "../../store/uiStore";
import { Minimap } from "./Minimap";
import { MarkdownViewer } from "./MarkdownViewer";
import { HtmlViewer } from "./HtmlViewer";
import { CodeViewer } from "./CodeViewer";
import { JsonViewer } from "./JsonViewer";
import { YamlTomlViewer } from "./YamlTomlViewer";
import { CsvViewer } from "./CsvViewer";
import { TextViewer } from "./TextViewer";
import { PdfViewer } from "./PdfViewer";
import { ImageViewer } from "./ImageViewer";
import { VideoViewer } from "./VideoViewer";
import { ArchiveViewer } from "./ArchiveViewer";
import { VttViewer } from "./VttViewer";
import type { Tab } from "../../types";
import type { ViewerRegistration } from "../../plugins/api";

// Office viewers are lazy-loaded so their heavy parsing libraries
// (docx-preview, xlsx, pptx-preview) only ship to users who open these files.
const DocxViewer = lazy(() =>
  import("./DocxViewer").then((m) => ({ default: m.DocxViewer }))
);
const XlsxViewer = lazy(() =>
  import("./XlsxViewer").then((m) => ({ default: m.XlsxViewer }))
);
const PptxViewer = lazy(() =>
  import("./PptxViewer").then((m) => ({ default: m.PptxViewer }))
);

function OfficeFallback({ label }: { label: string }) {
  return (
    <div style={{ padding: 24, fontSize: 13, color: "var(--color-text-muted)" }}>
      Loading {label}…
    </div>
  );
}

interface Props {
  tab: Tab;
}

export function ViewerRouter({ tab }: Props) {
  // Re-render when the plugin registry changes
  const [, setTick] = useState(0);
  useEffect(() => pluginManager.subscribe(() => setTick((n) => n + 1)), []);

  const ext = getFileExtension(tab.path);
  const pluginViewer = pluginManager.getViewerForExtension(ext);
  const minimapVisible = useUiStore((s) => s.minimapVisible);
  const scrollRef = useRef<HTMLDivElement>(null);

  return (
    <div style={{ position: "relative", height: "100%" }}>
      <motion.div
        key={tab.id}
        ref={scrollRef}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.15 }}
        className="content-scroll"
        style={{ height: "100%", paddingRight: minimapVisible ? 60 : undefined }}
      >
        {pluginViewer ? (
          <PluginViewer registration={pluginViewer} tab={tab} />
        ) : (
          <BuiltinViewer tab={tab} ext={ext} />
        )}
      </motion.div>
      {minimapVisible && <Minimap scrollRef={scrollRef} />}
    </div>
  );
}

// ── Built-in routing ───────────────────────────────────────────────────────────

function BuiltinViewer({ tab, ext }: { tab: Tab; ext: string }) {
  const fileType = getFileType(ext);
  return (
    <>
      {fileType === "vtt" && <VttViewer tab={tab} />}
      {fileType === "markdown" && <MarkdownViewer tab={tab} />}
      {fileType === "html" && <HtmlViewer tab={tab} />}
      {fileType === "code" && <CodeViewer tab={tab} ext={ext} />}
      {fileType === "json" && <JsonViewer tab={tab} />}
      {fileType === "yaml" && <YamlTomlViewer tab={tab} format="yaml" />}
      {fileType === "toml" && <YamlTomlViewer tab={tab} format="toml" />}
      {fileType === "csv" && <CsvViewer tab={tab} />}
      {fileType === "pdf" && <PdfViewer tab={tab} />}
      {fileType === "image" && <ImageViewer tab={tab} />}
      {fileType === "video" && <VideoViewer tab={tab} />}
      {fileType === "archive" && <ArchiveViewer tab={tab} />}
      {fileType === "docx" && (
        <Suspense fallback={<OfficeFallback label="document" />}>
          <DocxViewer tab={tab} />
        </Suspense>
      )}
      {fileType === "xlsx" && (
        <Suspense fallback={<OfficeFallback label="workbook" />}>
          <XlsxViewer tab={tab} />
        </Suspense>
      )}
      {fileType === "pptx" && (
        <Suspense fallback={<OfficeFallback label="presentation" />}>
          <PptxViewer tab={tab} />
        </Suspense>
      )}
      {fileType === "text" && <TextViewer tab={tab} />}
      {fileType === "unknown" && <TextViewer tab={tab} />}
    </>
  );
}

// ── Plugin viewer ──────────────────────────────────────────────────────────────

function PluginViewer({ registration, tab }: { registration: ViewerRegistration; tab: Tab }) {
  // Component-based plugin viewer (plugin has bundled React)
  if (registration.component) {
    const Component = registration.component as (props: { content: string; filePath: string }) => JSX.Element;
    return (
      <div className="plugin-viewer" style={{ padding: "24px 32px", height: "100%" }}>
        <Component content={tab.content} filePath={tab.path} />
      </div>
    );
  }

  // HTML-string plugin viewer
  if (registration.render) {
    return <HtmlPluginViewer registration={registration} tab={tab} />;
  }

  return (
    <div style={{ padding: 32, color: "var(--color-text-muted)", fontSize: 13 }}>
      Plugin viewer for <code>{tab.name}</code> provided no render method.
    </div>
  );
}

function HtmlPluginViewer({ registration, tab }: { registration: ViewerRegistration; tab: Tab }) {
  const html = useMemo(
    () => registration.render!(tab.content, tab.path),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tab.content, tab.path]
  );

  return (
    <div
      className="plugin-viewer markdown-body"
      style={{ padding: "24px 32px", height: "100%" }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
