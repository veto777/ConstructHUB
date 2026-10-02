import { createRoot } from "react-dom/client";
import App from "./App";
import { queryClient } from "./lib/queryClient";
import { installClientErrorReporting } from "./lib/report-client-errors";
import "./index.css";

// Uncaught errors and unhandled rejections reach the issue desk (/admin/issues).
installClientErrorReporting();

const container = document.getElementById("root")!;
const mount = () => createRoot(container).render(<App />);

// A marketing page arrives prerendered (script/prerender.ts): the full page is
// already on screen. React replaces it on its first render (createRoot clears
// the container — nothing is duplicated), so ask "who is this?" first: the
// first render is then the page itself, not the loading spinner the app shows
// while /api/auth/me is pending. The wait is capped so a slow API never holds
// the page back.
if (container.hasAttribute("data-prerendered")) {
  const me = queryClient.prefetchQuery({ queryKey: ["/api/auth/me"] });
  const cap = new Promise((resolve) => setTimeout(resolve, 2500));
  void Promise.race([me, cap]).finally(mount);
} else {
  mount();
}
