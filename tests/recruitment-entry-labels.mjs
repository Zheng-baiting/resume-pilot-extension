import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const playwrightModule = process.env.PLAYWRIGHT_MODULE || "playwright";
const { chromium } = await import(playwrightModule);
const root = fileURLToPath(new URL("../", import.meta.url)).replace(/\\/g, "/").replace(/\/$/, "");

const browser = await chromium.launch({
  headless: true,
  executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
});

try {
  const page = await browser.newPage();
  await page.addInitScript(() => {
    globalThis.chrome = {
      runtime: { onMessage: { addListener() {} }, sendMessage: async () => ({ ok: true }) },
      storage: { local: { get: async () => ({}), set: async () => {} } }
    };
  });
  await page.setContent(`
    <base href="https://www.intellif.com/int/join.html">
    <nav>
      <a href="https://intellif1.zhiye.com/">加入云天</a>
      <a href="https://intellif1.zhiye.com/social">社会招聘</a>
      <a href="https://intellif1.zhiye.com/campus">校园招聘</a>
      <a href="https://intellif1.zhiye.com/campus/jobs?city=shanghai">上海市 共7个职位</a>
      <a href="/cart">加入购物车</a>
    </nav>
    <button>加入意向单</button>
  `);
  await page.addScriptTag({ path: `${root}/city-preferences.js` });
  await page.addScriptTag({ path: `${root}/scoring.js` });
  await page.addScriptTag({ path: `${root}/main-click.js` });
  await page.addScriptTag({ path: `${root}/content.js` });

  const result = await page.evaluate(() => ({
    entrances: discoverJobEntrances({ targetCity: "上海", positionType: "实习" }),
    applications: findApplicationEntries().map((node) => node.textContent.trim()),
    platform: detectRecruitmentPlatform("https://intellif1.zhiye.com/campus")
  }));

  assert.deepEqual(result.entrances.map((item) => item.label), ["加入云天", "社会招聘", "校园招聘", "上海市 共7个职位"]);
  assert.equal(result.entrances.find((item) => item.label === "加入云天").kind, "career_home");
  assert.equal(result.entrances.find((item) => item.label === "校园招聘").audience, "campus");
  assert.equal(result.entrances.find((item) => item.label.includes("上海市")).cityMatchStatus, "matched");
  assert.deepEqual(result.applications, ["加入意向单"]);
  assert.equal(result.platform.id, "ats-zhiye");
  console.log("recruitment entry label tests passed");
} finally {
  await browser.close();
}
