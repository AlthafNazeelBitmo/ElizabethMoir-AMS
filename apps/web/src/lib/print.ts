import { useEffect } from "react";
import { applyTheme } from "./theme.js";

/**
 * Paper is white. Whatever theme the screen is in, a printed report is set
 * in the light palette, and the browser's own header carries the report's
 * name rather than the application's.
 *
 * Both are done for the duration of printing only: the theme class comes
 * off the root before the print layout is made and goes back afterwards,
 * and the document title is swapped the same way. Print-to-PDF takes its
 * default file name from that title, so a saved report is named after
 * what it is.
 */
export function usePrintSetup(title: string | null): void {
  useEffect(() => {
    const before = () => {
      applyTheme("light");
      if (title) {
        previousTitle = document.title;
        document.title = title;
      }
    };
    const after = () => {
      applyTheme();
      if (previousTitle !== null) {
        document.title = previousTitle;
        previousTitle = null;
      }
    };
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, [title]);
}

let previousTitle: string | null = null;
