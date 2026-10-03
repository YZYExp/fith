RECURSION — STATIC HOMEPAGE

The site lives in homepage/index.html. CSS, JavaScript, artwork, and the
favicon are embedded in the HTML. There is no build step or external asset
dependency. Open index.html directly in a browser to preview it.

DEPLOY FROM THIS REPOSITORY
1. Merge the homepage pull request into main.
2. Open the repository's Settings > Pages.
3. Choose Deploy from a branch, select main and / (root), and Save.
4. Wait for the Pages deployment to finish.
5. Visit https://0x0079.github.io/fitting-html/homepage/.

GitHub Pages does not offer /homepage as a branch source directory. Selecting
the repository root serves this folder at /homepage/. If the repository is
private, Pages availability depends on the owner's GitHub plan.

TO SERVE THE HOMEPAGE AT THE SITE ROOT INSTEAD
Configure a GitHub Actions Pages workflow to upload only the homepage folder
as its Pages artifact, and choose GitHub Actions as the Pages source. The
included .nojekyll file is suitable for publishing this folder as static
output. No deployment settings are changed by this pull request.

CUSTOMIZE
Edit the title, description, brand, headings, and content in index.html.
Colors are CSS variables in :root. Feedback-loop descriptions are in the
stages array at the bottom. Update the initial stage-panel HTML too so it
matches the first stage when JavaScript is disabled.

CONTENT
This is an original editorial design about recursive self-improvement,
with independently written introductory copy and links to the Anthropic
Institute article. It is not a verified reproduction or summary of that
article, and uses no Anthropic logo or assets.
