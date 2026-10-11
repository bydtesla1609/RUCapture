# RUCapture 使用与维护

## 用户注册与登录

入口：<https://rucapture.pages.dev>，本阶段最多 300 个账号，免费体验。

1. 点击“注册”，填写用户名和密码，无需邀请码。用户名为 3–24 位英文字母、数字或下划线，以字母开头；密码至少 6 位，包含英文和数字。
2. 注册后下载账号恢复码，妥善保管。忘记密码时使用用户名、恢复码设置新密码。
3. 第一阶段用户直接用原用户名和密码登录，无需重新注册。旧入口 <https://ruchecklist-trial.pages.dev> 继续兼容，同一账号的数据一致。
4. 登录时可勾选“自动登录”，保持 30 天；不勾选使用浏览器会话，服务器最长保留 24 小时。浏览器若启用“恢复上次会话”，可能保留会话 Cookie；公共设备请主动退出。

管理员仍是原第一枚邀请码对应的账号。普通用户通过左下角账户菜单“与管理员反馈”联系管理员；管理员在“公告与答疑”回复或发布公告。普通用户不能查看他人聊天、任务或附件。

## 网站同步

连接凭据统一保存在账号库的 `trial_collectors`，由试用入口验证后传给账号内接口；不再向各分库重复写入 `collector_hash`，避免 D1 跨库批量操作导致连接接口 500。已有账号和凭据继续使用，无需迁移数据库或为此更新扩展。发布这一修复时，正式入口与旧试用入口应同步更新其 `trial-worker.mjs` 和 `worker.mjs`，并验证生成凭据、读取配置、导入及重新连接后的旧凭据失效。

在电脑浏览器打开“来源与同步”，按清单安装扩展、连接当前账号、逐个添加网站并同步。网页内开启云端同步需要扩展 v1.9.3；更新原扩展文件后重新加载，再连接新入口，不必卸载。原有网站授权和卡片不会因网页更名而清空。

支持作业平台及微人大课表/考试，其他网站通过通用识别预览确认。扩展使用用户自行登录的网页，不替用户提交作业。手机无需安装扩展，可查看、编辑、记录、归档、反馈及操作轴线。

云端采集需每人独立授权：在清单第 4 步勾选说明并点击开启，无需另开设置页。支持的平台约每 60 分钟同步，电脑关机也可更新；微人大课表/考试、YOJ 和通用网页仍由浏览器同步。登录过期会提醒重新登录。关闭云端会删除对应授权，保留已导入卡片。

## 容量与隐私

账户密码由 Supabase Auth 处理；服务密钥不进入网页或扩展。浏览器会话使用 HttpOnly、Secure 和 SameSite。网站登录 Cookie/令牌仅在明确授权云端采集后加密保存。不要把密码、恢复码或 Cookie 发到反馈聊天中。

每人附件合计 5 MiB、单个文件 1 MiB；每张卡片最多 20 个附件。第一批账号保留原数据库，新增账号分为三个存储组。未读反馈、公告和已保存布局均由账号隔离。任务支持手动归档与完成满七天自动归档；课程和记录不自动归档。

使用 Cloudflare Pages / D1 和 Supabase Free，无付费套餐升级。免费额度及可用性有限：维护者需关注数据库空间、每日请求与读写量，额度紧张时先关闭新注册。参考 [Cloudflare D1 限额](https://developers.cloudflare.com/d1/platform/limits/) 和 [Supabase Free](https://supabase.com/pricing)。

## 维护与部署

- 原数据升级前导出备份并验证恢复。仅对已有的试用数据库执行 `migrations/0009_public_accounts.sql` 一次，其他原任务表不改动。
- `node public-upgrade.mjs` 生成 `dist/public-store-a.sql`（31–120）、`b`（121–210）、`c`（211–300）。分别写入三个新 D1，禁止套用到原个人数据库。
- 参考 `wrangler.public.example.jsonc` 配置原账号库 `DB` 和三个 `STORE_*`；先将 `REGISTRATION_OPEN` 设为 `false`。第一管理员账号须已在原系统存在，公开注册永远跳过 slot 1。
- 新旧 Pages 使用相同的 `SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY` 和 `CLOUD_ENCRYPTION_KEY`。值只通过私密配置设置，禁止写进 Git、网页或日志；禁止为已有授权任意换密钥。
- `npm run build:public` 后部署 `dist/public`；旧入口使用 `build:trial` 继续部署。两份代码绑定相同数据资源。
- 定时 Worker 参考 `wrangler.trial.worker.example.jsonc`，绑定四个 D1 及自身的 `CLOUD_DISPATCH`，保留原加密密钥。每分钟分派最多 5 个账号到独立调用；只有该 Worker 启用 `CLOUD_INTERNAL`，网站 Pages 不配置此标志。
- 确认旧账号、注册、恢复码、隔离、布局、附件、扩展、云端及新入口验证后开放注册。关闭新注册只需将两个入口的 `REGISTRATION_OPEN` 改为 `false`，原用户仍可登录。
- 验证命令：`npm test`、`npm run check`、`npm run test:public-ui`、`npm run test:capture-ui`、`npm run test:trial-ui`、`npm run test:community-ui`、`npm run test:extension`。UI 测试使用隔离浏览器和合成数据，不读取真实用户登录资料。


## 小时同步与增量读取升级（2026-10-10 已发布至正式入口）

先备份原数据库，再运行 `node sync-upgrade.mjs` 生成四份 `dist/sync-upgrade-*.sql`。在对应的 `trial`、`store-a`、`store-b`、`store-c` 数据库分别执行，勿交叉套用；个人部署使用 `sync-upgrade-personal.sql`。SQL 只在现有 settings 表加入变化标记并建立触发器，不重建任务表、不修改账号密码和授权，可重复执行。未执行时新版页面回退完整读取，不会把没有标记误认为无变化。

随后发布新网站与定时 Worker。300 人定时配置仍每分钟触发，但每次分派 5 个账号，每账号一小时一轮；个人 Worker 的 cron 为 `0 * * * *`。原数据库绑定、Supabase 项目和加密密钥保持一致。扩展包更新到 v1.9.5；现有用户需自行替换并重新加载。

免费容量要以 Cloudflare 真实请求量、D1 rows_read/rows_written 和 CPU 日志验收。隔离测试确认调度次数、空闲不扫描任务、跨设备变更与账号隔离；不把这些测试等同于 300 人线上并发验收。
