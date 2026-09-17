// `with { type: "file" }` imports of the built front resolve to path strings at runtime.
declare module "*/web/dist/assets/app.js" { const path: string; export default path; }
declare module "*/web/dist/assets/app.css" { const path: string; export default path; }
declare module "*/web/dist/wh-config.js" { const path: string; export default path; }
