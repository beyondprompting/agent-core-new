// convex/convex.config.ts
import { defineApp } from "convex/server";
import agent from "@convex-dev/agent/convex.config";
import rag from "@convex-dev/rag/convex.config";
import workflow from "@convex-dev/workflow/convex.config";

import workpool from "@convex-dev/workpool/convex.config";

const app = defineApp();
app.use(agent);
app.use(rag);
app.use(workflow);
app.use(workpool, { name: "qaVisualImportPool" });
app.use(workpool, { name: "qaVisualImagePool" });
app.use(workpool, { name: "qaVisualAnalysisPool" });

export default app;
