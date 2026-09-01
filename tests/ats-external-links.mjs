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
    <base href="https://example.com/">
    <main>
      <h1>Careers | Example Company</h1>
      <a href="/careers#open-positions">Open Positions</a>
      <section id="open-positions">
        <a href="https://jobs.lever.co/example/11111111-1111-4111-8111-111111111111">
          <strong>Software Engineer Intern</strong><span>Shanghai · Internship · JavaScript</span>
        </a>
        <a href="https://jobs.lever.co/example/22222222-2222-4222-8222-222222222222">
          <strong>Senior Software Engineer</strong><span>Tokyo · Full-time · JavaScript</span>
        </a>
      </section>
    </main>
  `);
  await page.addScriptTag({ path: `${root}/city-preferences.js` });
  await page.addScriptTag({ path: `${root}/scoring.js` });
  await page.addScriptTag({ path: `${root}/main-click.js` });
  await page.addScriptTag({ path: `${root}/content.js` });

  const result = await page.evaluate(() => {
    const profile = {
      targetRole: "软件开发",
      targetCity: "上海",
      positionType: "实习",
      skills: "JavaScript",
      maxExperienceYears: "0"
    };
    return {
      platform: detectRecruitmentPlatform("https://jobs.lever.co/example/11111111-1111-4111-8111-111111111111"),
      links: findDirectJobLinks().map((link) => link.href),
      flow: inspectRecruitmentFlow(profile),
      jobs: scanJobList(profile)
    };
  });

  assert.equal(result.platform.id, "ats-lever");
  assert.equal(result.links.length, 2);
  assert.equal(result.flow.pageType, "list");
  assert.equal(result.flow.openMethod, "direct_link");
  assert.deepEqual(result.flow.linkedAts, ["Lever"]);
  assert.equal(result.jobs.length, 2, JSON.stringify(result.jobs.map((job) => ({ title: job.title, url: job.url, clickToken: job.clickToken }))));
  const internship = result.jobs.find((job) => job.title.includes("Intern"));
  const senior = result.jobs.find((job) => job.title.includes("Senior"));
  assert.equal(internship.cityMatchStatus, "matched");
  assert.equal(internship.hardBlocked, false);
  assert.equal(senior.hardBlocked, true);
  assert.ok(senior.warnings.some((warning) => warning.includes("不符合实习目标")));
  console.log("external ATS link tests passed");
} finally {
  await browser.close();
}
