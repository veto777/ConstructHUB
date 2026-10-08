import path from "path";
const root = "/home/veto/ConstructHUB-gator";
export default { root, resolve: { alias: { "@shared": path.join(root, "shared") } }, test: { include: ["server/tutorials/gator.test.ts"], testTimeout: 20000 } };
