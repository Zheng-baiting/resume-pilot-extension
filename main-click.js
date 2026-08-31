(function installMainWorldJobClickBridge() {
  const BRIDGE_VERSION = "0.17.0";
  const REQUEST_EVENT = "resume-pilot-open-job-main";
  const TOKEN_ATTRIBUTE = "data-resume-pilot-click-token";
  const RESULT_ATTRIBUTE = "data-resume-pilot-click-result";
  const TARGET_URL_ATTRIBUTE = "data-resume-pilot-click-target-url";
  document.documentElement.setAttribute("data-resume-pilot-main-click-version", BRIDGE_VERSION);

  function normalize(value) {
    return String(value || "").toLowerCase().replace(/[\s|｜·—_\-（）()【】\[\]，,。.:：;/\\]/g, "").slice(0, 80);
  }

  function findCards() {
    const selectors = [
      ".job-item", ".position-item", ".job-card", ".position-card", ".post_box",
      ".job__item", ".position_list_item", ".job_list_item",
      "[class*='job-list'] > li", "[class*='position-list'] > li",
      "[class*='job_list_item']", "[class*='position_list_item']", "[class^='item___']",
      "[class*='vacancy']", "[class*='opening']", "[class*='recruit'] [class*='item']",
      "[data-job-id]", "[data-position-id]", "[data-jobid]", "[data-positionid]", "[data-jobunionid]"
    ];
    return [...new Set(document.querySelectorAll(selectors.join(",")))];
  }

  function titleOf(card) {
    const stableId = card.getAttribute?.("data-jobunionid") || card.getAttribute?.("data-job-id")
      || card.getAttribute?.("data-position-id") || card.getAttribute?.("data-jobid") || card.getAttribute?.("data-positionid");
    if (card.matches?.(".post_box")) return card.textContent || "";
    const title = card.querySelector(".job-name, .position-name, .post_title, [class*='job-name'], [class*='position-name'], h1, h2, h3, h4, [class*='title']")?.textContent || card.textContent || "";
    return stableId ? `id:${stableId}:${title}` : title;
  }

  document.addEventListener(REQUEST_EVENT, () => {
    const root = document.documentElement;
    const clickToken = root.getAttribute(TOKEN_ATTRIBUTE) || "";
    const target = findCards().find((card) => normalize(titleOf(card)) === clickToken);
    if (!target) {
      root.setAttribute(RESULT_ATTRIBUTE, "card_missing");
      return;
    }
    target.scrollIntoView({ block: "center", behavior: "instant" });
    const clickTarget = target.querySelector(".job-name-box, .position-name-box, .post_title, .job__title, .pub_name, .tit, [class*='job-title'], [class*='position-title'], .job-name, .position-name") || target;
    root.removeAttribute(TARGET_URL_ATTRIBUTE);
    // 腾讯岗位卡会用 window.open(..., '_blank') 打开详情。Edge 并不总能把这个
    // 新标签稳定关联回扩展任务，因此在腾讯官网主环境中捕获官网自己生成的详情 URL，
    // 改为同标签跳转。URL 仍完全由腾讯页面生成，不猜测岗位 ID。
    if (location.hostname === "join.qq.com" && target.matches?.(".post_box")) {
      const nativeOpen = window.open;
      let targetUrl = "";
      try {
        window.open = function(url) {
          targetUrl = new URL(String(url || ""), location.href).href;
          return null;
        };
        clickTarget.click();
      } finally {
        window.open = nativeOpen;
      }
      if (targetUrl) {
        root.setAttribute(TARGET_URL_ATTRIBUTE, targetUrl);
        root.setAttribute(RESULT_ATTRIBUTE, "clicked");
        setTimeout(() => location.assign(targetUrl), 60);
        return;
      }
    }
    root.setAttribute(RESULT_ATTRIBUTE, "clicked");
    clickTarget.click();
  }, true);

  // 华为岗位列表不提供真实 a[href]，而是依赖 Vue 事件。直接读取官网公开接口，
  // 得到稳定的 advertisementId 和完整岗位意向，避免脚本点击被页面吞掉。
  const HUAWEI_REQUEST = "resume-pilot-huawei-official-request";
  const HUAWEI_RESPONSE = "resume-pilot-huawei-official-response";
  const huaweiCache = new Map();

  window.addEventListener("message", async (event) => {
    const request = event.data;
    if (event.source !== window || request?.source !== HUAWEI_REQUEST || !request.requestId) return;
    if (location.hostname !== "career.huawei.com") return;
    try {
      const recruitmentTypes = Array.isArray(request.recruitmentTypes) && request.recruitmentTypes.length
        ? request.recruitmentTypes.filter((value) => ["INTERN", "FRESH_GRADUATE"].includes(value))
        : ["INTERN"];
      const jobs = await fetchHuaweiJobs(recruitmentTypes);
      window.postMessage({ source: HUAWEI_RESPONSE, requestId: request.requestId, ok: true, jobs }, location.origin);
    } catch (error) {
      window.postMessage({ source: HUAWEI_RESPONSE, requestId: request.requestId, ok: false, error: error.message }, location.origin);
    }
  });

  async function fetchHuaweiJobs(recruitmentTypes) {
    const cacheKey = recruitmentTypes.slice().sort().join(",");
    const cached = huaweiCache.get(cacheKey);
    if (cached && Date.now() - cached.time < 10 * 60 * 1000) return cached.jobs;

    const page = await huaweiApi("recruitmentPosition/pub/getJobPage", {
      curPage: 1,
      pageSize: 100,
      jobType: "CR",
      recruitmentType: recruitmentTypes
    });
    const rows = Array.isArray(page?.data?.result) ? page.data.result : [];
    let cursor = 0;
    const jobs = new Array(rows.length);
    const workers = Array.from({ length: Math.min(6, rows.length) }, async () => {
      while (cursor < rows.length) {
        const index = cursor++;
        const row = rows[index];
        let intentions = [];
        try {
          const response = await huaweiApi("recruitmentPosition/pub/getPositionIntentionList", { jobId: row.jobId });
          intentions = (response?.data || []).map((item) => ({
            positionIntention: item.positionIntention || "",
            jobResponsibilities: item.jobResponsibilities || "",
            jobDemand: item.jobDemand || "",
            jobPlaceName: item.jobPlaceName || "",
            deptAndPlaceList: (item.deptAndPlaceList || []).map((dept) => ({
              deptName: dept.deptName || "",
              jobPlaceName: dept.jobPlaceName || ""
            }))
          }));
        } catch {}
        jobs[index] = {
          advertisementId: row.advertisementId,
          jobId: row.jobId,
          jobName: row.jobName || row.jobNameNew || "未命名岗位",
          categoryName: row.categoryName || "",
          workPlace: row.workPlace || "",
          lastUpdateDate: row.lastUpdateDate || "",
          mainBusiness: row.mainBusiness || "",
          jobRequire: row.jobRequire || "",
          intentions
        };
      }
    });
    await Promise.all(workers);
    const validJobs = jobs.filter((job) => job?.advertisementId);
    huaweiCache.set(cacheKey, { time: Date.now(), jobs: validJobs });
    return validJobs;
  }

  async function huaweiApi(path, body) {
    const response = await fetch(`https://apigw-dgg-b0.huawei.com/api/apig/channelhw/${path}?X-HW-ID=app_000000035886`, {
      method: "POST",
      credentials: "include",
      headers: {
        "content-type": "application/json",
        "x-hw-id": "app_000000035886",
        "x-referer": "https://career.huawei.com/cn",
        "x-alb-gray": "prod",
        "x-jalor-tenantalias": "hcm",
        "x-language": "zh_CN"
      },
      body: JSON.stringify(body)
    });
    if (!response.ok) throw new Error(`华为岗位接口返回 ${response.status}`);
    const payload = await response.json();
    if (payload?.status !== "SUCCESS") throw new Error(payload?.message || "华为岗位接口暂不可用");
    return payload;
  }
})();
