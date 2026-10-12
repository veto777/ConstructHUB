/** True inside a full-screen tool (components/tool/product-shell.tsx provides it): a page drops its own view tabs,
 * since the shell's menu has them. Its own module so pages (and their server-side render tests) stay light. */
import { createContext, useContext } from "react";

export const InToolShell = createContext(false);
export const useInToolShell = () => useContext(InToolShell);
