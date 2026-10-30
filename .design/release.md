# 发版：tag 触发的 GitHub release 和 npm 包

状态：**已实施**（`.github/workflows/release.yml`、`ci.yml` 的包检查、`scripts/npm-bootstrap.sh`）；还没有发过第一个版本，npm 上的包名要等第一次占位才有。参照 Tingly Design 的发版方案（那边发的是 bundle 和两个包名，这里只有一个包）。

## 发什么

一个 npm 包 `fith`，内容就是 `npm pack` 的产物：`dist/`（库、CLI、`dist/extension/` 里打好的扩展）、`README`、`LICENSE`。同一个 tgz 也作为 GitHub release 的附件，另附 sha256，所以需要钉版本的使用者可以从任一处取到同一份文件。入口、可选 peer（`playwright`、`opentype.js`）见 `architecture.md` §7。

## 怎么触发

推一个 `vX.Y.Z` tag 就发这个版本，tag 就是版本号：build 先把它写进 `package.json`，所以 main 上的 `version` 不用手改（它只是本地开发时的值）。带后缀（`-rc.1`、`-beta`）发到 npm 的 `rc` dist-tag，GitHub release 标成 prerelease；不带后缀走 `latest`。格式不对直接失败。同一步还把 `repository` 写成运行这次发版的仓库（`github.repository`）：npm 的 provenance 要求包里的仓库地址和构建它的仓库一致，写死会在仓库迁移（`YZYExp/fith` → `0x0079/fith`）后让发布失败。

三个 job 依次跑：

1. **build**：构建、扩展打包、全量测试，`npm pack`，再把 tgz 装进一个空项目（带可选 peer `playwright`；`opentype.js` 只为 `fith/outline` 装），检查四个入口都能 import、`fith` 命令不带参数时退出 1 并打印用法（顺带验证 shebang 和 `bin`）。`.github/scripts/smoke-package.sh`，PR 的 CI 也跑同一个脚本，所以包有问题在合并前就会红。
2. **github**：在 tag 上建 release，附 tgz 和 sha256；已存在就只补文件。
3. **npm**：在 `production` environment 里先确认 npm ≥ 11.5.1，再预先做一次 OIDC 交换（被拒时把 npm 给的原因打出来，此时什么都还没发），然后发布同一个 tgz，带 provenance（`.github/scripts/npm-publish.sh`）。这个版本已在 npm 上就跳过，所以发了一半失败后重跑是安全的。

npm 排在 GitHub release 之后：npm 发出去就撤不回，前面任何一步失败都不该走到这里。

没有把 `extension-e2e` 放进发版：它要完整 Chromium 和显示，只在 push 的 CI 上跑，发版 tag 指向的提交必须是 main 上已经绿过的。

## 鉴权：一次一密，只走 Trusted Publishing

仓库里没有任何 npm token，workflow 里也没有 `NPM_TOKEN` / `NODE_AUTH_TOKEN`。npm job 申请 GitHub Actions 的 OIDC id-token（`id-token: write`），npm ≥ 11.5.1 拿它换一个只能用于这一次发布、用完即废的凭据。每次发版现换，没有长期密钥可泄露。

- **npm 那边**：`fith` 包有一条 trusted publisher：GitHub Actions、仓库（owner/repo）、workflow `release.yml`、environment `production`，允许 `npm publish`（2026-09-03 之后新建的配置默认只允许 stage publish，那样 `npm publish` 会报笼统的 "package not found"）。字段是精确匹配：改 workflow 文件名、environment 名，或把仓库迁到别的 owner，都会让发布失败，直到 npm 上同步改。
- **发布权限**：包设为 "Require two-factor authentication and disallow tokens"（`npm access set mfa=publish`）。CI 之外，只有开了 2FA 的维护者在本机输入一次性密码才能发；泄露的 token 发不了包。
- **为什么不用 token**：npm 已经停用 classic token，granular token 最长 90 天，放在 GitHub secret 里迟早发不了，还多一个泄露面。
- **`production` environment**：建议在 GitHub 上配 required reviewers，每次发 npm 前有人点一下。

### 第一次发布前：手工占位

trusted publisher 只能加在已经存在的包上，而 CI 只能用 OIDC 发布，所以包名要先由维护者在本机占位。`scripts/npm-bootstrap.sh [owner/repo]` 做完三步，每步 npm 都会要一次性密码：

1. 发一个空的 `0.0.0` 占位版本（dist-tag `placeholder`），只为让包名存在；
2. `npm trust github` 加上面那条 trusted publisher（需要 npm ≥ 11.15）；
3. `npm access set mfa=publish`。

之后每个真实版本都由 CI 发布，占位版本不再碰。脚本可以重跑；仓库迁走后用新的 `owner/repo` 再跑一次，就加上新仓库的 trusted publisher。

## 未决

- 仓库还在 `YZYExp/fith`，规划迁到 `0x0079/fith`：占位时 trusted publisher 要绑实际跑发版的仓库，迁移后补一条。
- 第一个版本号、是否先发 `-rc`。
- `dist/extension/` 随包发布是否合适（体积小，但扩展的主要分发渠道是应用商店）。
