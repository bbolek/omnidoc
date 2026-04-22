interface Props<T extends string> {
  modes: readonly T[];
  value: T;
  onChange: (mode: T) => void;
}

export function ModeToggle<T extends string>({ modes, value, onChange }: Props<T>) {
  return (
    <div
      style={{
        display: "inline-flex",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-sm)",
        overflow: "hidden",
        fontSize: 12,
      }}
    >
      {modes.map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onChange(m)}
          style={{
            padding: "3px 10px",
            background: value === m ? "var(--color-accent)" : "var(--color-bg-subtle)",
            color: value === m ? "var(--color-accent-fg)" : "var(--color-text-muted)",
            border: "none",
            cursor: "pointer",
            fontFamily: "Inter, sans-serif",
            fontWeight: value === m ? 600 : 400,
            transition: "background 0.1s",
            textTransform: "capitalize",
          }}
        >
          {m}
        </button>
      ))}
    </div>
  );
}
