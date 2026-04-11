import { motion } from "framer-motion";
import { getFileType, getFileExtension } from "../../utils/fileUtils";
import { MarkdownViewer } from "./MarkdownViewer";
import { CodeViewer } from "./CodeViewer";
import { JsonViewer } from "./JsonViewer";
import { YamlTomlViewer } from "./YamlTomlViewer";
import { CsvViewer } from "./CsvViewer";
import { TextViewer } from "./TextViewer";
import type { Tab } from "../../types";

interface Props {
  tab: Tab;
}

export function ViewerRouter({ tab }: Props) {
  const ext = getFileExtension(tab.path);
  const fileType = getFileType(ext);

  return (
    <motion.div
      key={tab.id}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.15 }}
      className="content-scroll"
      style={{ height: "100%" }}
    >
      {fileType === "markdown" && <MarkdownViewer tab={tab} />}
      {fileType === "code" && <CodeViewer tab={tab} ext={ext} />}
      {fileType === "json" && <JsonViewer tab={tab} />}
      {fileType === "yaml" && <YamlTomlViewer tab={tab} format="yaml" />}
      {fileType === "toml" && <YamlTomlViewer tab={tab} format="toml" />}
      {fileType === "csv" && <CsvViewer tab={tab} />}
      {fileType === "text" && <TextViewer tab={tab} />}
      {fileType === "unknown" && <TextViewer tab={tab} />}
    </motion.div>
  );
}
