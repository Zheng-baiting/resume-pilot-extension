# Resume Pilot 桌面控制中心（v2 开发预览）

桌面端负责本地岗位库、简历条件排序、去重队列、按企业限额和按招聘域名限速；浏览器插件继续负责使用真实浏览器登录状态进入官网、核验岗位、填写表单和让用户处理验证码。

## 本地运行

在仓库根目录执行：

```powershell
npm install
npm run desktop:dev
```

开发时可设置 `RESUME_PILOT_DATA_DIR`，将测试数据固定保存在项目的 `tmp` 目录。生产安装包将使用应用自己的用户数据目录。

## 当前功能

- 保存不含身份信息的求职条件。
- 导入插件同步或 JSON 格式的公开岗位元数据。
- 复用扩展的城市与岗位评分规则。
- 剔除地点、招聘类型、经验或截止日期不符合的岗位。
- 按最低分、总队列上限和每家企业上限生成队列。
- 同一招聘域名一次只处理一个岗位。
- 遇到 HTTP 429 时按域名指数退避，不连续刷新。
- 提供 Chrome Native Messaging 协议、主机实现和安装配置模板。

## 安全说明

- 插件同步前会剔除姓名、电话、邮箱、学校、简历正文、附件和已记住答案。
- v2 安装版将 Native Messaging 作为桌面通信所需权限；本地主机仍通过固定扩展 ID 白名单限制访问。
- 当前仓库不会自动安装本地通信组件，也不会修改注册表。
- `native-host/manifest.template.json` 中的主机路径和扩展 ID 必须由未来的安装程序填写。

## 测试

```powershell
npm run test:desktop
```

Electron 界面冒烟测试需要提供 Playwright 模块入口：

```powershell
$env:PLAYWRIGHT_MODULE='file:///path/to/playwright/index.mjs'
node desktop/tests/electron-smoke.mjs
```
