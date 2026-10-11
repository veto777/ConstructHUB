/** Isolated education component test fixture. Not a route or shipped app entry point. */
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LessonOutline, useScrollToHash } from "@/components/master-class/lesson";
import { useChecklist } from "@/components/guides/progress";
import { ModuleLessons, type LessonModuleKey } from "@/components/master-class/lesson-body";
import { LESSON_MODULES } from "../lessons";
import "@/index.css";

let failLessons = false;
let lessonError = "503: Test lesson request failed";
let failAccount = false;
const client = new QueryClient({ defaultOptions: { queries: {
  retry: false, staleTime: Infinity,
  queryFn: async ({ queryKey }) => {
    if (queryKey[0] === "/api/auth/me") {
      await new Promise((resolve) => setTimeout(resolve, 150));
      if (failAccount) throw new Error("503: Test account unavailable");
      return { id: 101 };
    }
    if (failLessons) throw new Error(lessonError);
    const module = queryKey[1] as LessonModuleKey;
    return { module, ...LESSON_MODULES[module], footer: LESSON_MODULES[module].footer ?? [] };
  },
} } });
client.setQueryData<{ id: number } | null>(["/api/auth/me"], { id: 101 });

function LateAnchor() {
  const [visible, setVisible] = useState(false);
  useScrollToHash(true);
  useEffect(() => {
    let frame = requestAnimationFrame(() => { frame = requestAnimationFrame(() => setVisible(true)); });
    return () => cancelAnimationFrame(frame);
  }, []);
  return visible ? <div id="lesson-late-test" style={{ marginTop: 1200 }}>Late lesson target</div> : null;
}

function VersionProbe() {
  const [version, setVersion] = useState("v1");
  const itemIds = version === "v1" ? ["stable", "retired"] : ["new", "stable"];
  const list = useChecklist("browser-version-test", { version, previousVersions: ["v1"], itemIds });
  return <div>
    <button onClick={() => setVersion("v2")}>Revise content</button>
    <p data-testid="version-count">{list.count} of {itemIds.length} done</p>
    {itemIds.map((id) => <label key={id}><input type="checkbox" data-testid={`version-${id}`} checked={list.isDone(id)} onChange={() => list.toggle(id)} />{id}</label>)}
  </div>;
}

function Fixture() {
  const [module, setModule] = useState<LessonModuleKey>("gmb");
  const [mounted, setMounted] = useState(true);
  const [late, setLate] = useState(false);
  const lessons = LESSON_MODULES[module].lessons.map(({ id, title }) => ({ id, title }));
  return <main className="app-theme mx-auto max-w-5xl space-y-5 p-4">
    <h1 className="text-xl font-semibold">Master Class · isolated component test</h1>
    <p>Uses actual course components and lesson content. This is not the Sam Rivera lane database.</p>
    <nav className="flex flex-wrap gap-3" aria-label="Test controls">
      <button onClick={() => client.setQueryData<{ id: number } | null>(["/api/auth/me"], { id: 101 })}>Learner A</button>
      <button onClick={() => client.setQueryData<{ id: number } | null>(["/api/auth/me"], { id: 202 })}>Learner B</button>
      <button onClick={() => client.setQueryData<{ id: number } | null>(["/api/auth/me"], null)}>Sign out</button>
      <button onClick={() => client.getQueryCache().find({ queryKey: ["/api/auth/me"] })?.setState({ status: "error", error: new Error("Test account unavailable") })}>Fail account</button>
      <button onClick={() => { failAccount = true; void client.refetchQueries({ queryKey: ["/api/auth/me"] }); }}>Break account network</button>
      <button onClick={() => { failAccount = false; }}>Restore account network</button>
      <button onClick={() => { failLessons = true; lessonError = "503: Test lesson refresh failed"; void client.refetchQueries({ queryKey: ["/api/master-class/lessons", module] }); }}>Fail refresh</button>
      <button onClick={() => { failLessons = true; lessonError = "403: Access revoked"; void client.refetchQueries({ queryKey: ["/api/master-class/lessons", module] }); }}>Revoke access</button>
      <button onClick={() => { failLessons = true; void client.resetQueries({ queryKey: ["/api/master-class/lessons", module] }); }}>Fail lessons</button>
      <button onClick={() => { failLessons = false; }}>Restore lessons</button>
      <button onClick={() => setMounted(!mounted)}>Remount</button>
      <button onClick={() => { window.location.hash = "lesson-late-test"; setLate(true); }}>Late anchor</button>
      {(["gmb", "licensing", "vetting", "seo", "website"] as const).map((key) => <button key={key} onClick={() => setModule(key)}>{key}</button>)}
    </nav>
    {mounted && <>
      <LessonOutline lessons={lessons} storageKey={`mc:${module}`} />
      <ModuleLessons module={module} lessons={lessons} storageKey={`mc:${module}`} open />
    </>}
    <VersionProbe />
    {late && <LateAnchor />}
  </main>;
}

createRoot(document.getElementById("root")!).render(<QueryClientProvider client={client}><Fixture /></QueryClientProvider>);
