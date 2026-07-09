(() => {
  const keywords = [
    "\u4e34\u65f6\u63d0\u4ea4",
    "\u6682\u5b58",
    "\u4fdd\u5b58\u8349\u7a3f",
  ];

  const isVisible = (el) => {
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.display !== "none" &&
      style.visibility !== "hidden"
    );
  };

  const textOf = (el) => [
    el.innerText,
    el.textContent,
    el.value,
    el.getAttribute("aria-label"),
    el.getAttribute("title"),
  ].filter(Boolean).join(" ").trim();

  const candidates = Array.from(document.querySelectorAll(
    "button,[role='button'],a,input[type='button'],input[type='submit']"
  )).filter(isVisible);

  const target = candidates.find((el) => {
    const text = textOf(el);
    return keywords.some((keyword) => text.includes(keyword));
  });

  if (!target) {
    console.warn(
      "No temp submit button found. Visible controls:",
      candidates.map(textOf).filter(Boolean)
    );
    return;
  }

  console.log("Found target:", target, textOf(target));

  target.disabled = false;
  target.removeAttribute("disabled");
  target.removeAttribute("aria-disabled");
  target.classList.remove("ant-btn-disabled");

  target.scrollIntoView({ block: "center", inline: "center" });
  target.focus();

  ["pointerdown", "mousedown", "mouseup", "click"].forEach((type) => {
    target.dispatchEvent(new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      view: window,
    }));
  });
  target.click();
})();
