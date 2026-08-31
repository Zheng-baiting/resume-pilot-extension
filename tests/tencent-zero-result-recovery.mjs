import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../", import.meta.url)).replace(/\\/g, "/").replace(/\/$/, "");
const browser = await chromium.launch({
  headless: true,
  executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
});

const listHtml = `<!doctype html><html><body>
  <div id="search" class="search_box"></div><div id="count"></div><div id="list"></div>
  <script>
    function render(query) {
      history.replaceState(null, "", "/post.html?query=p_2,p_104&keyword=" + encodeURIComponent(query));
      document.querySelector("#search").innerHTML = '<input placeholder="搜索职位" value="' + query + '"><button class="search_text">查看</button>';
      document.querySelector(".search_text").onclick = () => render(document.querySelector("#search input").value);
      const hit = query === "前端";
      document.querySelector("#count").textContent = "共" + (hit ? 1 : 0) + "个岗位";
      document.querySelector("#list").innerHTML = hit
        ? '<div class="post_box"><h3 class="post_title">前端开发</h3><p>技术 ｜ 日常实习 ｜ JavaScript React</p></div>'
        : '';
      const card = document.querySelector(".post_box");
      if (card) card.onclick = () => window.open("/post_detail.html?postid=123", "_blank");
    }
    render("");
  </script>
</body></html>`;

try {
  const page = await browser.newPage();
  await page.addInitScript(() => {
    globalThis.chrome = {
      runtime: { onMessage: { addListener() {} }, sendMessage: async () => ({ ok: true }) },
      storage: { local: { get: async () => ({}), set: async () => {} } }
    };
  });
  await page.route("https://join.qq.com/**", route => route.fulfill({
    contentType: "text/html; charset=utf-8",
    body: route.request().url().includes("post_detail.html") ? "<main>职位详情<button>投递简历</button></main>" : listHtml
  }));
  await page.goto("https://join.qq.com/post.html");
  await page.addScriptTag({ path: `${root}/scoring.js` });
  await page.addScriptTag({ path: `${root}/main-click.js` });
  await page.addScriptTag({ path: `${root}/content.js` });

  const scan = await page.evaluate(() => deepScanJobList({
    targetRole: "前端开发工程师",
    skills: "JavaScript React",
    positionType: "实习"
  }));
  const candidate = scan.results.find(item => item.clickToken && item.officialSearchTerm === "前端");
  assert.ok(candidate, "broad Tencent search did not recover a candidate");

  await page.evaluate(() => runOfficialKeywordSearch(findOfficialSearchInput(), "前端开发工程师"));
  assert.match(page.url(), /keyword=%E5%89%8D%E7%AB%AF%E5%BC%80%E5%8F%91%E5%B7%A5%E7%A8%8B%E5%B8%88/);
  assert.equal(await page.locator(".post_box").count(), 0);

  const opened = await page.evaluate(candidate => handleMessage({
    type: "OPEN_SCANNED_JOB",
    clickToken: candidate.clickToken,
    searchTerm: candidate.officialSearchTerm
  }), candidate);
  assert.equal(opened.clicked, true);
  assert.match(opened.targetUrl, /post_detail\.html\?postid=123/);
  await page.waitForTimeout(150);
  assert.match(page.url(), /post_detail\.html\?postid=123/);
  console.log("Tencent zero-result recovery test passed");
} finally {
  await browser.close();
}
