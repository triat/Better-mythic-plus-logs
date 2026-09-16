// Built by `just web-build`. `bun build --compile` embeds these three files;
// `bun src/cli.ts` reads them from disk. Never import this module statically —
// go through defaultAssetLoader in web-static.ts.
import indexHtml from "../web/dist/index.html" with { type: "file" };
import appJs from "../web/dist/assets/app.js" with { type: "file" };
import appCss from "../web/dist/assets/app.css" with { type: "file" };

// bun-types types every `*.html` import as an HTMLBundle (Bun's HTML bundler); with
// `type: "file"` Bun actually returns the path string, so cast that one.
export const WEB_ASSETS = { index: indexHtml as unknown as string, appJs, appCss };
