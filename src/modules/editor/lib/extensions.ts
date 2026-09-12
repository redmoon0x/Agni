import { detectMonoFontFamily } from "@/lib/fonts";
import {
  HighlightStyle,
  indentUnit,
  syntaxHighlighting,
} from "@codemirror/language";
import { search } from "@codemirror/search";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";

// Editor themes (esp. atomone, the default) only style a handful of tags —
// enough for JS/Python but not type-heavy languages like Rust, which lean on
// typeName/namespace/macroName/lifetimes. `fallback: true` means this only
// paints tags the active theme leaves uncolored, never overrides it. Reuses
// the --tok-* palette already defined for markdown code blocks.
const fallbackHighlightStyle = HighlightStyle.define(
  [
    { tag: [tags.typeName, tags.namespace], color: "var(--tok-type)" },
    {
      tag: [
        tags.variableName,
        tags.self,
        tags.special(tags.variableName),
        tags.definition(tags.variableName),
      ],
      color: "var(--tok-name)",
    },
    {
      tag: [tags.macroName, tags.function(tags.variableName)],
      color: "var(--tok-name)",
      fontWeight: "500",
    },
    { tag: [tags.bool, tags.atom], color: "var(--tok-bool)" },
    {
      tag: [
        tags.operator,
        tags.derefOperator,
        tags.arithmeticOperator,
        tags.logicOperator,
        tags.bitwiseOperator,
        tags.compareOperator,
        tags.updateOperator,
      ],
      color: "var(--tok-operator)",
    },
    {
      tag: [
        tags.punctuation,
        tags.bracket,
        tags.paren,
        tags.brace,
        tags.squareBracket,
        tags.separator,
      ],
      color: "var(--tok-punctuation)",
    },
    {
      tag: [tags.meta, tags.annotation, tags.processingInstruction],
      color: "var(--tok-meta)",
    },
  ],
);

// Compartments allow runtime reconfiguration without rebuilding state.
export const languageCompartment = new Compartment();
export const readOnlyCompartment = new Compartment();
export const wrapCompartment = new Compartment();
export const vimCompartment = new Compartment();
// Holds the optional external-linter extension (gutter + linter source). Empty
// unless the user turns on inline diagnostics, so it costs nothing by default.
export const lintCompartment = new Compartment();

// Only what basicSetup doesn't already cover, to avoid duplicate extensions.
// basicSetup gives us line numbers, fold gutter, history, indentOnInput,
// bracketMatching, closeBrackets, autocompletion, highlightActiveLine,
// highlightSelectionMatches and the search keymap.
export function buildSharedExtensions(): Extension[] {
  return [
    indentUnit.of("  "),
    EditorState.tabSize.of(2),
    search({ top: true }),
    syntaxHighlighting(fallbackHighlightStyle, { fallback: true }),
    EditorView.theme({
      "&, &.cm-editor, &.cm-editor.cm-focused": {
        backgroundColor: "transparent !important",
        color: "var(--foreground)",
        outline: "none",
        padding: "8px",
      },
      ".cm-scroller": {
        fontFamily: detectMonoFontFamily(),
        fontSize: "13px",
        lineHeight: "1.55",
        backgroundColor: "transparent !important",
      },
      ".cm-content": {
        caretColor: "var(--foreground)",
        backgroundColor: "transparent !important",
      },
      ".cm-gutters": {
        backgroundColor: "transparent !important",
        color: "var(--muted-foreground)",
      },
      ".cm-gutter": { backgroundColor: "transparent !important" },
      ".cm-lineNumbers .cm-gutterElement": {
        opacity: "0.55",
      },
      ".cm-foldGutter": { width: "10px" },
      ".cm-foldGutter .cm-gutterElement": {
        color: "var(--muted-foreground)",
        opacity: "0.5",
      },
      ".cm-activeLine": {
        borderTopRightRadius: "5px",
        borderBottomRightRadius: "5px",
        backgroundColor:
          "color-mix(in srgb, var(--foreground) 4%, transparent)",
      },
      ".cm-lineNumbers .cm-activeLineGutter": {
        borderTopLeftRadius: "5px",
        borderBottomLeftRadius: "5px",
        userSelect: "none",
      },
      ".cm-cursor, .cm-dropCursor": {
        borderLeftColor: "var(--foreground)",
      },
      // Vim normal-mode block cursor — translucent foreground, no rose hue.
      ".cm-fat-cursor": {
        background:
          "color-mix(in srgb, var(--foreground) 35%, transparent) !important",
        outline:
          "1px solid color-mix(in srgb, var(--foreground) 55%, transparent) !important",
        color: "var(--foreground) !important",
      },
      "&:not(.cm-focused) .cm-fat-cursor": {
        background: "transparent !important",
        outline:
          "1px solid color-mix(in srgb, var(--foreground) 35%, transparent) !important",
      },
      ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection":
        {
          backgroundColor:
            "color-mix(in srgb, var(--foreground) 18%, transparent) !important",
        },
      ".cm-panels": {
        backgroundColor: "var(--popover)",
        color: "var(--popover-foreground)",
        borderColor: "var(--border)",
      },
    }),
  ];
}
