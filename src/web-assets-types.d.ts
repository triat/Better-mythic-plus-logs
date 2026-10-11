// `with { type: "file" }` imports of the built front resolve to path strings at runtime.
declare module "*/web/dist/assets/app.js" { const path: string; export default path; }
declare module "*/web/dist/assets/app.css" { const path: string; export default path; }
declare module "*/web/dist/wh-config.js" { const path: string; export default path; }
declare module "*/web/dist/fonts/Geist-Variable.woff2" { const path: string; export default path; }
declare module "*/web/dist/fonts/GeistMono-Variable.woff2" { const path: string; export default path; }
