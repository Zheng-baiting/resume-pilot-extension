# Resume Pilot 桌面控制中心（v2）

桌面端负责本地岗位库、简历条件排序、去重队列、按企业限额和按招聘域名限速；浏览器插件继续负责使用真实浏览器登录状态进入官网、核验岗位、填写表单和让用户处理验证码。

## 本地运行

在仓库根目录执行：

```powershell
npm install
npm run desktop:dev
```

开发时可设置 `RESUME_PILOT_DATA_DIR`，将测试数据固定保存在项目的 `tmp` 目录。生产安装包将使用应用自己的用户数据目录。

## 普通用户使用流程

1. 安装 `resume-pilot-desktop-*-setup.exe`；安装程序会按当前用户范围注册 Edge/Chrome Native Messaging 主机。
2. 打开桌面端，在“求职条件”中设置目标岗位、城市、行业和待遇。
3. 打开 Edge 的 `edge://extensions`，开启开发人员模式，加载仓库根目录的解压缩扩展。
4. 打开招聘官网，在扩展的“3. 填当前页”点击“连接桌面端”，确认显示“桌面控制中心已连接”。
5. 导入 PDF/DOCX 简历，检查识别结果，在“找企业”中确认岗位与城市条件。
6. 首次使用“试运行：填写但不提交”，最多处理岗位设为 1；确认无误后再选择确认提交或全自动模式。
7. 遇到登录、验证码或未配置必填项，处理后点击“处理后继续”；扩展不会绕过验证码或编造资料。

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
- 安装包只写入当前用户（HKCU）的 Edge/Chrome Native Messaging 注册项，不需要管理员权限；卸载时会删除本项目写入的注册项。
- Native Messaging 主机通过固定扩展 ID 白名单限制访问，安装包会同时放置主机程序和清单文件。

## 测试

```powershell
npm run test:desktop
```

Electron 界面冒烟测试需要提供 Playwright 模块入口：

```powershell
$env:PLAYWRIGHT_MODULE='file:///path/to/playwright/index.mjs'
node desktop/tests/electron-smoke.mjs
```
