import assert from "node:assert/strict";

await import("../resume-import.js");

const resumeText = `个人简历
关于我
通信工程专业在读，熟悉 H3C 数通、路由交换、OSPF、VLAN、ACL、NAT 和网络排错。
参与 RAG、LangChain、Gradio、CNN 与 ResNet 项目。
意向岗位：网络工程师、数通工程师、通信运维、AI 应用助理、通信算法助理，期望通过实习积累经验。
联系电话：13800000000
邮箱：student@example.com
教育背景
2023.09 - 2027.06 | 示例学院 | 通信工程 | 本科
主修课程：计算机网络，人工智能
优势特长
掌握：Linux 基础操作、网络基础原理。`;

const profile = globalThis.ResumePilotImport.parseResumeProfile(resumeText, "张同学--13800000000.pdf");

assert.deepEqual({
  fullName: profile.fullName,
  phone: profile.phone,
  email: profile.email,
  school: profile.school,
  major: profile.major,
  degree: profile.degree,
  graduationYear: profile.graduationYear,
  targetRole: profile.targetRole,
  targetIndustry: profile.targetIndustry,
  positionType: profile.positionType
}, {
  fullName: "张同学",
  phone: "13800000000",
  email: "student@example.com",
  school: "示例学院",
  major: "通信工程",
  degree: "本科",
  graduationYear: "2027",
  targetRole: "网络工程师、数通工程师、通信运维、AI 应用助理、通信算法助理",
  targetIndustry: "通信、计算机网络、信息安全、人工智能",
  positionType: "实习"
});
assert.match(profile.skills, /H3C/);
assert.match(profile.skills, /OSPF/);
assert.match(profile.skills, /RAG/);
assert.match(profile.skills, /ResNet/);
assert.notEqual(profile.major, "课程：计算机网络");

const softwareResume = `个人简历
教育背景：示例大学 计算机科学与技术 本科 2027 年毕业
专业技能：熟悉 React、TypeScript、Vue、Node.js、MySQL、Redis、Python、Pandas 和 SQL。
项目经历：使用 React 与 TypeScript 开发管理后台；使用 Node.js、MySQL 和 Redis 设计接口；
使用 Python、Pandas 和 SQL 完成业务数据清洗、分析和可视化。`;
const softwareProfile = globalThis.ResumePilotImport.parseResumeProfile(softwareResume);
const recommendations = globalThis.ResumePilotImport.recommendTargetRoles(softwareResume);

assert.match(softwareProfile.targetRole, /前端开发工程师/);
assert.match(softwareProfile.targetRole, /后端开发工程师/);
assert.match(softwareProfile.targetRole, /数据分析与数据工程师/);
assert.doesNotMatch(softwareProfile.targetRole, /网络工程师/);
assert.match(softwareProfile.targetIndustry, /互联网软件/);
assert.match(softwareProfile.skills, /React/);
assert.match(softwareProfile.skills, /Node\.js/);
assert.match(softwareProfile.skills, /SQL/);
assert.match(softwareProfile.skills, /Python/);
assert.ok(recommendations.length > 0 && recommendations.length <= 6);
assert.ok(recommendations.every((item, index) => index === 0 || recommendations[index - 1].score >= item.score));

console.log("resume profile parser test passed");
