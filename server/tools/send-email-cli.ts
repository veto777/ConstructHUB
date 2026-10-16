// Entry point for dist/send-email.cjs (see ./send-email.ts).
import { run } from "./send-email";

run(process.argv.slice(2)).then((code) => process.exit(code), (e) => { console.error(String(e?.message ?? e)); process.exit(1); });
