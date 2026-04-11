import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { getFileType, getFileExtension } from "../../utils/fileUtils";
import { pluginManager } from "../../plugins/pluginManager";
import { MarkdownViewer } from "./MarkdownViewer";
import { CodeViewer } from "./CodeViewer";
import { JsonViewer } from "./JsonViewer";
import { YamlTomlViewer } from "./YamlTomlViewer";
import { CsvViewer } from "./CsvViewer";
import { TextViewer } from "./TextViewer";
import type { Tab } from "../../types";
import type { ViewerRegistration } from "../../plugins/api";

interface Props {
  tab: Tab;
}

export function ViewerRouter({ tab }: Props) {
  // Re-render when the plugin registry changes
  const [, setTick] = useState(0);
  useEffect(() => pluginManager.subscribe(() => setTick((n) => n + 1)), []);

  const ext = getFileExtension(tab.path);
  const pluginViewer = pluginManager.getViewerForExtension(ext);

  return (
    <motion.div
      key={tab.id}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.15 }}
      className="content-scroll"
      style={{ height: "100%" }}
    >
      {pluginViewer ? (
        <PluginViewer registration={pluginViewer} tab={tab} />
      ) : (
        <BuiltinViewer tab={tab} ext={ext} />
      )}
    </motion.div>
  );
}

// ── Built-in routing ───────────────────────────────────────────────────────────

function BuiltinViewer({ tab, ext }: { tab: Tab; ext: string }) {
  const fileType = getFileType(ext);
  return (
    <>
      {fileType === "markdown" && <MarkdownViewer tab={tab} />}
      {fileType === "code" && <CodeViewer tab={tab} ext={ext} />}
      {fileType === "json" && <JsonViewer tab={tab} />}
      {fileType === "yaml" && <YamlTomlViewer tab={tab} format="yaml" />}
      {fileType === "toml" && <YamlTomlViewer tab={tab} format="toml" />}
      {fileType === "csv" && <CsvViewer tab={tab} />}
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
