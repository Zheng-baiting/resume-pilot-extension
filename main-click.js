(function installMainWorldJobClickBridge() {
  const BRIDGE_VERSION = "0.8.0";
  const REQUEST_EVENT = "resume-pilot-open-job-main";
  const TOKEN_ATTRIBUTE = "data-resume-pilot-click-token";
  const RESULT_ATTRIBUTE = "data-resume-pilot-click-result";
  document.documentElement.setAttribute("data-resume-pilot-main-click-version", BRIDGE_VERSION);

  function normalize(value) {
    return String(value || "").toLowerCase().replace(/[\s|｜·—_\-（）()【】\[\]，,。.:：;/\\]/g, "").slice(0, 80);
  }

  function findCards() {
    const selectors = [
      ".job-item", ".position-item", ".job-card", ".position-card", ".post_box",
      "[class*='job-list'] > li", "[class*='position-list'] > li",
      "[class*='vacancy']", "[class*='opening']", "[class*='recruit'] [class*='item']",
      "[data-job-id]", "[data-position-id]", "[data-jobid]", "[data-positionid]"
    ];
    return [...new Set(document.querySelectorAll(selectors.join(",")))];
  }

  function titleOf(card) {
    if (card.matches?.(".post_box")) return card.textContent || "";
    return card.querySelector(".job-name, .position-name, .post_title, [class*='job-name'], [class*='position-name'], h1, h2, h3, h4, [class*='title']")?.textContent || card.textContent || "";
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
    const clickTarget = target.querySelector(".job-name-box, .position-name-box, .post_title, [class*='job-title'], [class*='position-title'], .job-name, .position-name") || target;
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
