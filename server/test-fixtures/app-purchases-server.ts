import express from "express";
import { APP_NO_PURCHASE_ROUTES, registerAppPurchaseGuard } from "../app-purchases";
const app = express();
registerAppPurchaseGuard(app);
// Successful downstream handlers prove each listed route still passes through
// for browsers, without buying anything or reaching payment/carrier providers.
app.post([...APP_NO_PURCHASE_ROUTES], (_req,res) => res.json({ website: true }));
app.get("/api/crm/voice/numbers", (_req,res) => res.json({ numbers: [] }));
app.post("/api/crm/invoices/:id/payment-link", (_req,res) => res.json({ physicalService:true }));
const server=app.listen(0,"127.0.0.1",()=>process.send?.({port:(server.address() as import("net").AddressInfo).port}));
process.on("SIGTERM",()=>server.close(()=>process.exit(0)));
