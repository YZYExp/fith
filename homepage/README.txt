RECURSION — VITE / REACT / TYPESCRIPT HOMEPAGE

An independent pnpm project in homepage/. Requires Node.js >=22.12.0 and
pnpm 10.33.0. The root fitting-html package and its lockfile are unchanged.

DEVELOP AND PREVIEW
  cd homepage
  pnpm install --frozen-lockfile
  pnpm dev

Open the Local URL printed by Vite. For the production preview:
  pnpm build
  pnpm preview

Rendered snapshots are in preview/desktop.png (full page) and
preview/mobile.png (first screen). These are review images, not deployed
assets; regenerate them when the layout changes.

pnpm build checks TypeScript and produces static files in homepage/dist/.
Opening the source index.html directly does not run the React application.

MAINTAIN
  src/App.tsx                    Page composition
  src/components/                Header, hero, artwork, and page sections
  src/components/FeedbackLoop.tsx Interactive stages, managed with React state
  src/content.ts                 Typed stage descriptions
  src/styles.css                 Theme, layouts, and responsive styles
  index.html                     Document title, metadata, and favicon
  public/                        Files copied unchanged to dist/

DEPLOY TO GITHUB PAGES
1. Merge the PR into main.
2. Open Settings > Pages and select GitHub Actions as the source.
3. Open Actions > Homepage > Run workflow, select main, and run it.
4. The manual run builds homepage/dist and publishes only that directory.
5. Visit https://0x0079.github.io/fitting-html/ after deployment succeeds.

The Homepage workflow builds and uploads a homepage-build artifact on
homepage pull requests and changes to main. Deployment only runs when the
workflow is manually started from main. This PR does not change Pages
settings or publish the site. If the repository is private, Pages
availability depends on the owner's GitHub plan.

Vite's relative base ('./') also supports publishing dist at
/fitting-html/homepage/ if you prefer to upload the built files there.
Never deploy the unbuilt React/TypeScript source as branch-based Pages.

CONTENT
This is an original editorial design about recursive self-improvement,
with independently written introductory copy and links to the Anthropic
Institute article. It is not a verified reproduction or summary of that
article, and uses no Anthropic logo or assets.

JavaScript is required for the React page. A noscript message links readers
to the original article. Motion respects prefers-reduced-motion.
