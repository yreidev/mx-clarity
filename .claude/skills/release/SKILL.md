---
name: release
description: 发布 mx-clarity 的新版本：核对、推断版本号、起草 CHANGELOG、打标签推送、等镜像与 GitHub Release，最后按需更新演示站。用户说「发版」「发个新版本」「发个小版本」「release」或 /release 时使用。
---

# 发版

发一版 = 一个提交（`package.json` 的版本号 + `CHANGELOG.md` 新的一节）加一个 `vX.Y.Z` 标签。标签推上去以后都由 CI 完成（`.github/workflows/docker.yml`）：检查 → 构建并推送镜像 → 用 `scripts/release-notes.mjs` 从 CHANGELOG 摘出这一节，发 GitHub Release。这里负责 CI 之前的准备和之后的核对。

`gh` 一律带 `-R yreidev/mx-clarity`：仓库还有个 `upstream` 远端，不带的话 gh 可能会去找上游。

## 1. 核对能不能发

- 在 `main` 上，工作区干净，`git fetch origin` 后与 `origin/main` 一致（领先的提交可以有，发版时一起推上去；落后的话先停下来问用户）
- `main` 最近一次「CI」没有失败：`gh run list -R yreidev/mx-clarity -b main -L 3`
- 本地跑 `pnpm lint`、`pnpm typecheck`、`pnpm test`（构建和 e2e 交给 CI）

任何一项不过就停下，报告给用户，不要自己绕过去。

## 2. 推断版本号，让用户确认

列出上个标签以来的提交：`git log $(git describe --tags --abbrev=0)..HEAD --format='%h %s'`

- 有 `feat`，或标题带 `!`、正文有 `BREAKING CHANGE` → 次版本号（0.2.1 → 0.3.0）。1.0 以后不兼容的改动才升主版本号
- 只有 `fix`、`perf`、`refactor`、`style` 这类 → 修订号（0.2.1 → 0.2.2）
- 只有 `docs`、`test`、`ci`、`chore` → 镜像里没有变化，问用户还要不要发
- 用户要预发布时用 `X.Y.Z-rc.N`：CI 不会给它打 `latest` 和 `X.Y`，Release 标成预发布

用 AskUserQuestion 给出推断的版本号和理由（是哪些提交决定的），推断结果放第一个选项，再给一个相邻的版本号作备选。

## 3. 起草 CHANGELOG 的这一节

在 `CHANGELOG.md` 第一个 `## [` 之前插入，格式见文件开头的说明。要点：

- 标题 `## [X.Y.Z] - YYYY-MM-DD`（今天的日期），下面先写一段总结，脚本会把拉镜像的命令插在这段后面
- 小节按需写 `### 修复`、`### 看得到的变化`、`### 给改主题的人`、`### 升级`，没内容的小节不写
- 写给站长看：每条说清楚读者或站长能看到什么变化。提交标题只是线索，必要时看 diff，不要照抄
- 只改文档、测试、CI 的提交不写
- `### 升级`：没有要站长额外操作的地方就写「从 上一版 升级只需换镜像，环境变量与 admin 里的设置都不用改。」；要改环境变量、admin 设置或 core 版本的，写清楚怎么改

起草好以后，改 `package.json` 的 `version`，跑 `node scripts/release-notes.mjs vX.Y.Z` 生成 Release 正文，**把正文原样给用户看**，问能不能发。用户要改就改了再给他看，直到他确认。这次确认同时也是同意推送。

## 4. 提交、打标签、推送

```bash
git add package.json CHANGELOG.md
git commit -m "chore: 发布 vX.Y.Z"
git tag -a vX.Y.Z -m "mx-clarity X.Y.Z：<那段总结的意思，一句话>"
git push origin main vX.Y.Z
```

## 5. 等 CI

推送后会触发三个 run：`main` 上的「CI」和「镜像」（构建 `edge`），以及标签上的「镜像」。找到标签那次（`headBranch` 是标签名）：

```bash
gh run list -R yreidev/mx-clarity -w docker.yml -L 5 --json databaseId,headBranch,status
```

用 `gh run watch <id> -R yreidev/mx-clarity --exit-status` 在后台等着（大约 15 分钟），跑完会有通知，不要轮询。中途告诉用户在等什么。

失败时先看是哪个 job（`gh run view <id> --log-failed`），报告给用户再动手：

- `check` 失败，镜像没有推：如果是偶发的（e2e 不稳定），`gh run rerun <id> --failed`；是代码问题就先修好，再发下一个修订号。**已经推上去的标签不要删也不要改指**
- 「发版说明对不上」：`check` 的第一步就会失败（标签、`package.json`、CHANGELOG 三者不一致），处理同上
- `release` 失败，镜像已经推了：rerun 用的还是标签那次提交上的脚本，修 main 救不了它。在本地用 `node scripts/release-notes.mjs vX.Y.Z > notes.md` 生成正文，`gh release create vX.Y.Z -R yreidev/mx-clarity --verify-tag --title vX.Y.Z --notes-file notes.md` 补发

## 6. 核对结果

- `gh release view vX.Y.Z -R yreidev/mx-clarity`：Release 在，正文对，正式版标成 Latest
- `docker buildx imagetools inspect` 看 `ghcr.io/yreidev/mx-clarity:X.Y.Z` 和 `yreidev/mx-clarity:X.Y.Z`，两边的 digest 一致；正式版的 `latest` 也是这个 digest

向用户报告 Release 链接和 digest。

## 7. 演示站（先问用户）

演示站 blog.june.ink 跑的是发布的镜像，服务器怎么登录、怎么换镜像写在同目录的 `demo-site.local.md` 里。这个文件不进仓库（`.gitignore`），因为里面有服务器地址；本机没有这个文件就跳过这一步，只提醒用户新镜像已经可以拉了。

更新会让前台不可用几秒到几十秒，**动手前用 AskUserQuestion 问用户现在更不更新**。用户同意后按 `demo-site.local.md` 操作，最后报告结果，并告诉用户怎么回滚。
