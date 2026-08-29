(function installMainWorldJobClickBridge() {
  const REQUEST_EVENT = "resume-pilot-open-job-main";
  const TOKEN_ATTRIBUTE = "data-resume-pilot-click-token";
  const RESULT_ATTRIBUTE = "data-resume-pilot-click-result";

  function normalize(value) {
    return String(value || "").toLowerCase().replace(/[\s|｜·—_\-（）()【】\[\]，,。.:：;/\\]/g, "").slice(0, 80);
  }

  function findCards() {
    const selectors = [
      ".job-item", ".position-item", ".job-card", ".position-card",
      "[class*='job-list'] > li", "[class*='position-list'] > li",
      "[class*='vacancy']", "[class*='opening']", "[class*='recruit'] [class*='item']",
      "[data-job-id]", "[data-position-id]", "[data-jobid]", "[data-positionid]"
    ];
    return [...new Set(document.querySelectorAll(selectors.join(",")))];
  }

  function titleOf(card) {
    return card.querySelector(".job-name, .position-name, [class*='job-name'], [class*='position-name'], h1, h2, h3, h4, [class*='title']")?.textContent || card.textContent || "";
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
    const clickTarget = target.querySelector(".job-name-box, .position-name-box, [class*='job-title'], [class*='position-title'], .job-name, .position-name") || target;
    root.setAttribute(RESULT_ATTRIBUTE, "clicked");
    clickTarget.click();
  }, true);
})();
