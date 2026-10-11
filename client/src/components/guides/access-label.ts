import type { CourseAccess } from "../master-class/access";
import type { Access } from "./library";

export function accessLabel(a: Access, access: CourseAccess | undefined, failed = false): string {
  switch (a.kind) {
    case "free": return "Free";
    case "account": return "Free with an account";
    case "master-class": {
      if (failed) return "Access unavailable";
      if (!access) return "Checking access…";
      const unlocked = a.scope === "licensing" ? access.unlocked.licensing : access[a.scope];
      if (unlocked) return "Unlocked on your account";
      if (a.scope === "all" && access.any) return "Some modules unlocked";
      return a.scope === "licensing" ? "Master Class · Licensing module" : "Master Class";
    }
    case "plan": return a.plan ? `Free to read · connecting needs the ${a.plan} plan` : "Free to read";
  }
}
