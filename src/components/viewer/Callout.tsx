import { useState, Children, isValidElement, cloneElement } from "react";
import type { ReactNode } from "react";
import {
  Info,
  Lightbulb,
  AlertTriangle,
  AlertOctagon,
  CheckCircle2,
  HelpCircle,
  Quote,
  FileText,
  Star,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

export type CalloutType =
  | "note"
  | "info"
  | "tip"
  | "success"
  | "check"
  | "important"
  | "warning"
  | "caution"
  | "danger"
  | "error"
  | "question"
  | "quote"
  | "abstract";

const ICONS: Record<CalloutType, typeof Info> = {
  note: Info,
  info: Info,
  tip: Lightbulb,
  success: CheckCircle2,
  check: CheckCircle2,
  important: Star,
  warning: AlertTriangle,
  caution: AlertTriangle,
  danger: AlertOctagon,
  error: AlertOctagon,
  question: HelpCircle,
  quote: Quote,
  abstract: FileText,
};

const LABELS: Record<CalloutType, string> = {
  note: "Note",
  info: "Info",
  tip: "Tip",
  success: "Success",
  check: "Success",
  important: "Important",
  warning: "Warning",
  caution: "Caution",
  danger: "Danger",
  error: "Error",
  question: "Question",
  quote: "Quote",
  abstract: "Abstract",
};

const TYPE_ALIASES: Record<string, CalloutType> = {
  NOTE: "note",
  INFO: "info",
  TIP: "tip",
  HINT: "tip",
  SUCCESS: "success",
  CHECK: "check",
  DONE: "check",
  IMPORTANT: "important",
  WARNING: "warning",
  CAUTION: "caution",
  ATTENTION: "warning",
  DANGER: "danger",
  ERROR: "error",
  FAILURE: "error",
  FAIL: "error",
  BUG: "error",
  QUESTION: "question",
  HELP: "question",
  FAQ: "question",
  QUOTE: "quote",
  CITE: "quote",
  ABSTRACT: "abstract",
  SUMMARY: "abstract",
  TLDR: "abstract",
};

export interface CalloutMatch {
  type: CalloutType;
  title: string | null;
  foldable: "collapsed" | "expanded" | null;
  remainingFirstLine: string;
}

// Detect `[!TYPE]`, `[!TYPE]-`, `[!TYPE]+`, optionally followed by a custom title.
// Returns null if no callout syntax is present at the start of the string.
export function parseCalloutMarker(firstLine: string): CalloutMatch | null {
  const match = firstLine.match(/^\s*\[!([A-Za-z]+)\]([+-]?)\s*(.*)$/);
  if (!match) return null;
  const rawType = match[1].toUpperCase();
  const mapped = TYPE_ALIASES[rawType];
  if (!mapped) return null;

  const foldMarker = match[2];
  const rest = match[3].trim();

  return {
    type: mapped,
    title: rest.length > 0 ? rest : null,
    foldable: foldMarker === "-" ? "collapsed" : foldMarker === "+" ? "expanded" : null,
    remainingFirstLine: "",
  };
}

// Extract callout info from blockquote children. The markdown pipeline renders
// `> [!NOTE]\n> body` as a <blockquote> with one or more <p> children. The
// first child's first text node carries the `[!TYPE]` marker.
export function extractCalloutFromChildren(
  children: ReactNode,
): { match: CalloutMatch; content: ReactNode } | null {
  const kids = Children.toArray(children);

  // Find the first element child that likely contains text
  let firstElIdx = -1;
  for (let i = 0; i < kids.length; i++) {
    const k = kids[i];
    if (isValidElement(k)) {
      firstElIdx = i;
      break;
    }
    if (typeof k === "string" && k.trim() !== "") {
      firstElIdx = i;
      break;
    }
  }
  if (firstElIdx === -1) return null;

  const first = kids[firstElIdx];

  // Inspect first text of the first child
  let firstText = "";
  let innerKids: ReactNode[] = [];
  let isParagraph = false;
  if (isValidElement(first)) {
    isParagraph = true;
    const p = first as React.ReactElement<{ children?: ReactNode }>;
    innerKids = Children.toArray(p.props.children);
    const firstInner = innerKids[0];
    if (typeof firstInner === "string") {
      firstText = firstInner;
    } else {
      return null;
    }
  } else if (typeof first === "string") {
    firstText = first;
  } else {
    return null;
  }

  // The blockquote's first line may have a trailing \n if multi-line paragraph.
  const lineBreakIdx = firstText.indexOf("\n");
  const firstLine = lineBreakIdx === -1 ? firstText : firstText.slice(0, lineBreakIdx);
  const remainderAfterFirstLine = lineBreakIdx === -1 ? "" : firstText.slice(lineBreakIdx + 1);

  const match = parseCalloutMarker(firstLine);
  if (!match) return null;

  // Rebuild the first child without the `[!TYPE]` marker
  let newFirstChild: ReactNode = null;
  if (isParagraph && isValidElement(first)) {
    const restInner: ReactNode[] = [];
    if (remainderAfterFirstLine.length > 0) restInner.push(remainderAfterFirstLine);
    for (let i = 1; i < innerKids.length; i++) restInner.push(innerKids[i]);
    if (restInner.length > 0) {
      const p = first as React.ReactElement<{ children?: ReactNode }>;
      newFirstChild = cloneElement(p, p.props, ...restInner);
    } else {
      newFirstChild = null;
    }
  } else {
    if (remainderAfterFirstLine.length > 0) newFirstChild = remainderAfterFirstLine;
  }

  const content: ReactNode[] = [];
  if (newFirstChild) content.push(newFirstChild);
  for (let i = firstElIdx + 1; i < kids.length; i++) content.push(kids[i]);

  return { match, content };
}

interface Props {
  match: CalloutMatch;
  children: ReactNode;
}

export function Callout({ match, children }: Props) {
  const Icon = ICONS[match.type];
  const defaultLabel = LABELS[match.type];
  const title = match.title ?? defaultLabel;

  const collapsible = match.foldable !== null;
  const [open, setOpen] = useState<boolean>(match.foldable !== "collapsed");

  const header = (
    <>
      <span className="callout-icon">
        <Icon size={16} />
      </span>
      <span>{title}</span>
      {collapsible && (
        <span className="callout-fold-indicator">
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
      )}
    </>
  );

  return (
    <div className={`callout callout-${match.type}`} data-callout-type={match.type}>
      {collapsible ? (
        <button
          type="button"
          className="callout-title callout-title-btn"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          {header}
        </button>
      ) : (
        <div className="callout-title">{header}</div>
      )}
      {(!collapsible || open) && <div className="callout-content">{children}</div>}
    </div>
  );
}
