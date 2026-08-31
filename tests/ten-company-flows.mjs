import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const playwrightModule = process.env.PLAYWRIGHT_MODULE || "playwright";
const { chromium } = await import(playwrightModule);

const root = fileURLToPath(new URL("../", import.meta.url)).replace(/\\/g, "/").replace(/\/$/, "");
const browser = await chromium.launch({
  headless: true,
  executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
});

const sites = [
  ["华为", "https://career.huawei.com/cn/campus-recruitment-job-list?recruitmentType=INTERN", `<input placeholder="搜索职位"><a href="/cn/job-details?advertisementId=1">软件开发工程师 实习生</a>`, "huawei-campus"],
  ["腾讯", "https://join.qq.com/post.html", `<input placeholder="搜索职位"><div class="post_box"><h3 class="post_title">前端开发 实习生</h3><p>JavaScript React</p></div>`, "tencent-campus"],
  ["字节", "https://jobs.bytedance.com/campus/position", `<input placeholder="搜索职位"><a href="/campus/position/123/detail">前端开发 实习生 JavaScript</a>`, "bytedance-campus"],
  ["阿里", "https://campus-talent.alibaba.com/campus/position", `<input placeholder="搜索职位或工作地点"><a href="/campus/position/123">AI应用研发工程师 Python</a><button>加入意向单</button>`, "alibaba-campus"],
  ["百度", "https://talent.baidu.com/jobs/list?recruitType=INTERN", `<input placeholder="请输入职位关键词"><a href="/jobs/detail/J104683">平台研发实习生 Python</a>`, "baidu-campus"],
  ["京东", "https://campus.jd.com/#/jobs?selProjects=45", `<input placeholder="搜索职位或关键词"><div class="item___1968K"><h3>算法工程师-语言大模型</h3><p>Python 实习生</p></div>`, "jd-campus"],
  ["美团", "https://job.meituan.com/web/campus", `<input placeholder="输入关键词搜索岗位"><div class="position_list_item" data-jobunionid="3383858111"><h3>前端开发工程师</h3><p>JavaScript 实习</p></div>`, "meituan-campus"],
  ["小米", "https://xiaomi.jobs.f.mioffice.cn/internship/", `<input placeholder="搜索职位"><a href="/internship/position/123/detail">大数据 AI 前端实习生</a>`, "xiaomi-feishu-campus"],
  ["大疆", "https://apply.careers.dji.com/campus-recruitment/dji/143359#/jobs", `<input placeholder="搜索职位关键词"><a href="#/job/abc">大前端开发工程师</a>`, "ats-moka"],
  ["OPPO", "https://careers.oppo.com/university/oppo/campus/post", `<input placeholder="按职位或者关键词搜索"><div class="job__item"><div class="job__title">软件工程师</div><p>React 实习生</p></div>`, "oppo-campus"]
];

try {
  for (const [name, url, html, adapterId] of sites) {
    const page = await browser.newPage();
    await page.addInitScript(() => {
      globalThis.chrome = {
        runtime: { onMessage: { addListener() {} }, sendMessage: async () => ({ ok: true }) },
        storage: { local: { get: async () => ({}), set: async () => {} } }
      };
    });
    await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: html }));
    await page.goto(url);
    await page.addScriptTag({ path: `${root}/scoring.js` });
    await page.addScriptTag({ path: `${root}/main-click.js` });
    await page.addScriptTag({ path: `${root}/content.js` });
    const result = await page.evaluate(() => {
      const flow = inspectRecruitmentFlow({ targetRole: "前端开发工程师", skills: "JavaScript React Python", positionType: "实习" });
      return { flow, adapter: getRecruitmentSiteAdapter(), cards: findClickableJobCards().length, links: findDirectJobLinks().length };
    });
    assert.ok(result.adapter, `${name}: adapter missing`);
    assert.equal(result.adapter.id, adapterId, `${name}: adapter mismatch`);
    assert.ok(["list", "detail"].includes(result.flow.pageType), `${name}: page type ${result.flow.pageType}`);
    assert.ok(result.cards + result.links > 0, `${name}: no job opening capability`);
    await page.close();
  }
  console.log("ten-company recruitment flow tests passed");
} finally {
  await browser.close();
}
